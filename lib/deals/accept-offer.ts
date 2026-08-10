import { and, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { brandProfile, campaign, creatorProfile, deal } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { MissingRightsTermsError } from '@/lib/campaigns/confirm-campaign';
import { transitionDeal, TransitionError } from '@/lib/deals/state-machine';
import { withNotifications } from '@/lib/notifications/notify';
import type { Notify } from '@/lib/notifications/notify';
import { getCurrentRightsTerms } from '@/lib/rights-terms/current';
import type { ErrorCode } from '@/lib/validation/errors';

/**
 * Accepting an offer, and agreeing to the usage-rights terms with it (KAN-36,
 * US-006, AC-017, Tech Spec §4.4).
 *
 * The first write in the app that moves a deal through the state machine. Three
 * things happen together or not at all: the status becomes `accepted`, the
 * `deal_event` is appended, and the terms the creator agreed to are stamped on
 * the row with the instant they agreed. `withNotifications` owns the
 * transaction, so the brand's email cannot outlive a rolled-back acceptance.
 *
 * **Why the terms are re-read here rather than taken from the request.** The
 * client sends `rights_terms_id` and it is *compared* against what the server
 * reads — that comparison is AC-3's 409. But what gets *stamped* is the
 * server's own value, always. The two are equal by the time the write happens,
 * so this looks redundant; it is the thing that keeps NFR-005 true if the
 * comparison is ever loosened, and it is what stops a client naming a version
 * nobody is currently governed by. F31 asked for exactly this.
 *
 * **Why expiry is checked here and not left to the state machine.**
 * `LEGAL_TRANSITIONS` permits `pending → accepted`, and the sweep that moves
 * lapsed offers to `expired` is KAN-38 and does not exist yet. So a deal whose
 * deadline passed three days ago is still `pending` in the database, and
 * `transitionDeal` would accept it without complaint. AC-4 says that must be a
 * 409, so the deadline is compared against an injected clock before the
 * transition is attempted. This only *refuses* — it does not write `expired`,
 * because that transition releases the reserved budget back to the brand
 * (AC-018) and that is KAN-38's work, not a side effect of someone tapping
 * Accept too late.
 *
 * **Ordering is load-bearing.** The terms check runs before the transition, so
 * a stale-terms rejection leaves no `deal_event` behind — an audit trail should
 * not record a status change that never happened. The stamp runs after, in the
 * same transaction, so no reader ever sees a deal at `accepted` with null
 * rights columns. `deal_rights_accepted_when_accepted` enforces that from the
 * database's side; this is the code path that satisfies it.
 */

/** What the action needs about the deal, its campaign, and both parties. */
export interface AcceptOfferRow {
  id: string;
  status: DealStatus;
  totalPrice: number;
  offerExpiresAt: Date | null;
  campaignId: string;
  campaignName: string;
  /**
   * `user.id`, not `brand_profile.id`.
   *
   * The two-hop rule from `lib/authz.ts`: business rows reference profile ids
   * and notifications address a user, so `campaign.brand_id` has to be walked
   * through `brand_profile.user_id` before anything can be sent. Passing the
   * profile id here writes a notification row nobody can read.
   */
  brandUserId: string;
  /** Public handle, the only name for the creator that reaches the brand's inbox. */
  creatorHandle: string;
}

export type AcceptOfferResult =
  | { ok: true; dealId: string; rightsTermsId: string; rightsAcceptedAt: Date }
  | { ok: false; reason: 'not_found' | 'stale_terms' | 'expired' }
  | { ok: false; reason: 'illegal'; code: ErrorCode };

export interface AcceptOfferDeps {
  /**
   * Loads the deal under a `FOR UPDATE` lock, scoped to the accepting creator.
   *
   * The creator's profile id is part of the lookup rather than checked after
   * it, so there is no argument that produces a row this creator does not own —
   * the same shape `buildCreatorDealWhere` uses for the read path. The route's
   * `guard` is the first layer; this is the second, and it holds even if a
   * future caller forgets the first.
   *
   * The lock is what serialises two concurrent accepts of the same offer. The
   * second waits here, then reads `accepted` and is refused by the state
   * machine rather than writing a duplicate event.
   */
  loadDeal: (
    tx: Tx,
    dealId: string,
    creatorProfileId: string
  ) => Promise<AcceptOfferRow | null>;
  /** Read inside the caller's transaction — never on the global `db`. */
  getRightsTerms: (tx: Tx) => Promise<{ id: string } | null>;
  transition: (
    tx: Tx,
    dealId: string,
    actorId: string,
    reason: string
  ) => Promise<unknown>;
  stampRights: (
    tx: Tx,
    dealId: string,
    rightsTermsId: string,
    acceptedAt: Date
  ) => Promise<void>;
  /** Injected so the expiry boundary is assertable without freezing the clock. */
  now: () => Date;
  run: <T>(fn: (tx: Tx, notify: Notify) => Promise<T>) => Promise<T>;
}

/** Recorded on the `deal_event`, so the history says what happened in words. */
export const ACCEPT_EVENT_REASON =
  'Creator accepted the offer and agreed to the usage-rights terms';

/**
 * The lookup, as a `where` clause — layer two of NFR-005, expressed in SQL.
 *
 * Exported for the reason `buildCreatorDealWhere` is: asserting that the
 * ownership half is present is easier here than through a database. The creator
 * id is the base the deal id narrows, not a filter this function chooses to
 * add, so there is no argument that produces a lookup without it. A deal
 * belonging to another creator therefore does not come back at all — it is
 * `not_found`, which the route collapses into the same 403 as a missing row.
 */
export function buildAcceptOfferWhere(
  dealId: string,
  creatorProfileId: string
): SQL {
  return and(eq(deal.id, dealId), eq(deal.creatorId, creatorProfileId)) as SQL;
}

const defaultDeps: AcceptOfferDeps = {
  loadDeal: async (tx, dealId, creatorProfileId) => {
    const [row] = await tx
      .select({
        id: deal.id,
        status: deal.status,
        totalPrice: deal.totalPrice,
        offerExpiresAt: deal.offerExpiresAt,
        campaignId: deal.campaignId,
        campaignName: campaign.name,
        brandUserId: brandProfile.userId,
        creatorHandle: creatorProfile.tiktokHandle,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(brandProfile, eq(campaign.brandId, brandProfile.id))
      .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
      .where(buildAcceptOfferWhere(dealId, creatorProfileId))
      // Locks the deal row only. The joined rows are reads nobody is competing
      // for here, and locking them would serialise unrelated work on the same
      // campaign. All three joins are inner on `not null` foreign keys, so none
      // of them can miss.
      .for('update', { of: deal })
      .limit(1);

    return row ?? null;
  },
  getRightsTerms: (tx) => getCurrentRightsTerms(tx),
  // Delegated to the state machine, which owns every `deal_event` write and
  // re-reads the row under its own lock before judging legality (invariant 6).
  transition: (tx, dealId, actorId, reason) =>
    transitionDeal(tx, dealId, 'accepted', actorId, { reason }),
  stampRights: async (tx, dealId, rightsTermsId, acceptedAt) => {
    await tx
      .update(deal)
      .set({ rightsTermsId, rightsAcceptedAt: acceptedAt })
      .where(eq(deal.id, dealId));
  },
  now: () => new Date(),
  run: (fn) => withNotifications(fn),
};

/**
 * Has the offer window closed? (AC-4.)
 *
 * Exported and pure for the reason `ownsResource` is: this is the one piece of
 * judgement the state machine cannot supply, and every branch of it should be
 * reachable in a test without a database or a frozen clock.
 *
 * The boundary is inclusive — an offer is expired *at* its deadline, not one
 * microsecond after. `offerExpiresAt` is the instant the window shuts, and the
 * sweep that KAN-38 will add is specified the same way, so accepting at exactly
 * that timestamp must not depend on which of the two ran first.
 */
export function isOfferExpired(
  offerExpiresAt: Date | null,
  now: Date
): boolean {
  // A deal with no deadline never lapses. Every offer KAN-33 issues carries
  // one; a null is an older row, and refusing it would be inventing a rule the
  // brand never set.
  if (offerExpiresAt === null) return false;
  return offerExpiresAt.getTime() <= now.getTime();
}

/**
 * Accepts a pending offer on behalf of the creator it was made to (AC-017).
 *
 * `creatorProfileId` and `actorUserId` come from `guard()`, never from the
 * request body. `submittedRightsTermsId` is the only value the client supplies,
 * and it is used for one thing: deciding whether the creator was looking at the
 * terms that are currently in effect.
 */
export async function acceptOffer(
  dealId: string,
  input: {
    creatorProfileId: string;
    actorUserId: string;
    submittedRightsTermsId: string;
  },
  deps: AcceptOfferDeps = defaultDeps
): Promise<AcceptOfferResult> {
  return deps.run(async (tx, notify) => {
    const row = await deps.loadDeal(tx, dealId, input.creatorProfileId);
    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    // Before the transition, so a refusal leaves no history behind.
    const current = await deps.getRightsTerms(tx);
    if (!current) {
      // An unseeded environment, not something the creator did. Same treatment
      // as in `confirmCampaign`: a thrown error rather than a 4xx, because
      // there is no sentence that would help and no action they could take.
      throw new MissingRightsTermsError();
    }

    // AC-3. The creator agreed to whatever the page showed them; if that is no
    // longer the version in effect, their agreement is to the wrong text.
    if (input.submittedRightsTermsId !== current.id) {
      return { ok: false, reason: 'stale_terms' };
    }

    const acceptedAt = deps.now();

    // AC-4. Checked here because the status alone cannot tell us — see the
    // header. A lapsed offer is still `pending` until KAN-38's sweep runs.
    if (isOfferExpired(row.offerExpiresAt, acceptedAt)) {
      return { ok: false, reason: 'expired' };
    }

    try {
      // AC-6 and invariant 6. Also the idempotency guard: a retry arrives as
      // `accepted → accepted`, which is not a legal edge, so the second call is
      // refused rather than writing a second event.
      await deps.transition(tx, dealId, input.actorUserId, ACCEPT_EVENT_REASON);
    } catch (error) {
      if (error instanceof TransitionError) {
        return { ok: false, reason: 'illegal', code: error.code };
      }
      throw error;
    }

    // AC-1 and AC-2, in the same transaction as the status change. `current.id`
    // rather than the submitted id — equal here, but the server's own read is
    // what the row records.
    await deps.stampRights(tx, dealId, current.id, acceptedAt);

    // AC-8. The brand's `user.id`, resolved through `brand_profile` in the load
    // above. Inside the transaction, so a rollback takes the row with it and
    // the email is never queued.
    await notify(row.brandUserId, 'offer_accepted', {
      dealId,
      campaignId: row.campaignId,
      campaignTitle: row.campaignName,
      creatorHandle: row.creatorHandle,
      totalPrice: row.totalPrice,
    });

    return {
      ok: true,
      dealId,
      rightsTermsId: current.id,
      rightsAcceptedAt: acceptedAt,
    };
  });
}
