import { and, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { brandProfile, campaign, creatorProfile, deal } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { transitionDeal, TransitionError } from '@/lib/deals/state-machine';
import { withNotifications } from '@/lib/notifications/notify';
import type { Notify } from '@/lib/notifications/notify';
import type { ErrorCode } from '@/lib/validation/errors';

/**
 * Declining an offer, and the brand's budget coming back with it (KAN-37,
 * US-006, AC-018, Tech Spec §4.4).
 *
 * The mirror of `accept-offer.ts`, and shorter than it for two reasons worth
 * stating rather than leaving as absences.
 *
 * **No rights-terms machinery.** Accepting is agreement to the usage-rights
 * text, so it reads the current terms, compares them against what the creator
 * was shown, and stamps them on the row. Declining is a refusal — there is
 * nothing to agree to, nothing to compare, and stamping terms on a deal the
 * creator just turned down would record consent that was never given.
 *
 * **No budget write, which is the strongest form of the AC's "one
 * transaction".** AC-018 asks that the release and the status change apply
 * together or not at all. They cannot come apart here, because there is only one
 * write: available budget is derived (`lib/campaigns/budget.ts`), and `declined`
 * is `false` in `COMMITS_BUDGET`, so flipping the status *is* the release. The
 * released amount equals `total_price` exactly and by construction — it is the
 * same column the sum stops counting. There is no second write to roll back and
 * no window in which status and budget disagree.
 *
 * And no ledger call: a deal is only declinable from `pending`, money first
 * moves at funding, so there is no `hold` to reverse. `REFUNDABLE_FROM` in
 * `lib/payment/ledger.ts` excludes `pending` for exactly this reason, and
 * `refundDeal` would throw on the missing provider reference. The KAN-40 spike
 * §6 is the authority over §4.4's looser wording here.
 *
 * **What is deliberately not checked: expiry.** `accept-offer.ts` compares
 * `offer_expires_at` against a clock because AC-4 of KAN-36 names a 409 for a
 * late acceptance. This ticket's AC list names one refusal only —
 * `OFFER_NOT_PENDING` — so a decline of a lapsed-but-unswept offer succeeds and
 * records `declined` rather than `expired`. That is a follow-up
 * (`project_context/FOLLOWUPS.md`), not an oversight: no money is at stake
 * either way, since both branches release the same `total_price`, and once
 * KAN-38's sweep exists `expired → declined` is already refused with
 * `OFFER_EXPIRED` by `getErrorCodeForInvalidTransition`.
 */

/** What the action needs about the deal, its campaign, and both parties. */
export interface DeclineOfferRow {
  id: string;
  status: DealStatus;
  /** The amount the decline releases. Integer santim (invariant 4). */
  totalPrice: number;
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
  /** Public handle — the only name for the creator that reaches the brand's inbox. */
  creatorHandle: string;
}

export type DeclineOfferResult =
  | { ok: true; dealId: string; releasedAmount: number }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'illegal'; code: ErrorCode };

export interface DeclineOfferDeps {
  /**
   * Loads the deal under a `FOR UPDATE` lock, scoped to the declining creator.
   *
   * The creator's profile id is part of the lookup rather than checked after it,
   * so there is no argument that produces a row this creator does not own. The
   * route's `guard` is layer one of NFR-005; this is layer two, and it holds even
   * if a future caller forgets the first.
   *
   * The lock is what serialises a concurrent accept and decline of the same
   * offer. The loser waits here, then reads the status the winner wrote and is
   * refused by the state machine rather than writing a contradicting event.
   */
  loadDeal: (
    tx: Tx,
    dealId: string,
    creatorProfileId: string
  ) => Promise<DeclineOfferRow | null>;
  transition: (
    tx: Tx,
    dealId: string,
    actorId: string,
    reason: string
  ) => Promise<unknown>;
  run: <T>(fn: (tx: Tx, notify: Notify) => Promise<T>) => Promise<T>;
}

/** Recorded on the `deal_event`, so the history says what happened in words. */
export const DECLINE_EVENT_REASON = 'Creator declined the offer';

/**
 * The lookup, as a `where` clause — layer two of NFR-005, expressed in SQL.
 *
 * Exported for the reason `buildAcceptOfferWhere` is: asserting that the
 * ownership half is present is easier here than through a database. The creator
 * id is the base the deal id narrows, not a filter this function chooses to add,
 * so there is no argument that produces a lookup without it. Another creator's
 * deal therefore does not come back at all — it is `not_found`, which the route
 * collapses into the same 403 as a missing row.
 */
export function buildDeclineOfferWhere(
  dealId: string,
  creatorProfileId: string
): SQL {
  return and(eq(deal.id, dealId), eq(deal.creatorId, creatorProfileId)) as SQL;
}

const defaultDeps: DeclineOfferDeps = {
  loadDeal: async (tx, dealId, creatorProfileId) => {
    const [row] = await tx
      .select({
        id: deal.id,
        status: deal.status,
        totalPrice: deal.totalPrice,
        campaignId: deal.campaignId,
        campaignName: campaign.name,
        brandUserId: brandProfile.userId,
        creatorHandle: creatorProfile.tiktokHandle,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(brandProfile, eq(campaign.brandId, brandProfile.id))
      .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
      .where(buildDeclineOfferWhere(dealId, creatorProfileId))
      // Locks the deal row only. The joined rows are reads nobody is competing
      // for here, and locking them would serialise unrelated work on the same
      // campaign. All three joins are inner on `not null` foreign keys, so none
      // of them can miss.
      .for('update', { of: deal })
      .limit(1);

    return row ?? null;
  },
  // Delegated to the state machine, which owns every `deal_event` write and
  // re-reads the row under its own lock before judging legality (invariant 6).
  transition: (tx, dealId, actorId, reason) =>
    transitionDeal(tx, dealId, 'declined', actorId, { reason }),
  run: (fn) => withNotifications(fn),
};

/**
 * Declines a pending offer on behalf of the creator it was made to (AC-018).
 *
 * `creatorProfileId` and `actorUserId` come from `guard()`, never from the
 * request. There is no request body at all — §4.4 specifies none, and a decline
 * carries no information beyond who and which deal.
 *
 * Returns the released amount so the caller can say what came back without
 * re-reading the row. It is read under the lock, which is what makes it the
 * deal's `total_price` *at the moment of the decline* rather than a figure that
 * might have moved between two statements.
 */
export async function declineOffer(
  dealId: string,
  input: { creatorProfileId: string; actorUserId: string },
  deps: DeclineOfferDeps = defaultDeps
): Promise<DeclineOfferResult> {
  return deps.run(async (tx, notify) => {
    const row = await deps.loadDeal(tx, dealId, input.creatorProfileId);
    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    try {
      // The only guard this action needs, and it covers three of the ACs at
      // once. `pending → declined` is legal and nothing else is, so every other
      // status returns `OFFER_NOT_PENDING`; a declined deal cannot be
      // resurrected because `LEGAL_TRANSITIONS.declined` is empty; and a
      // double-tap arrives as `declined → declined`, refused rather than
      // appending a second event.
      await deps.transition(
        tx,
        dealId,
        input.actorUserId,
        DECLINE_EVENT_REASON
      );
    } catch (error) {
      if (error instanceof TransitionError) {
        return { ok: false, reason: 'illegal', code: error.code };
      }
      throw error;
    }

    // "The brand is notified." The brand's `user.id`, resolved through
    // `brand_profile` in the load above. Inside the transaction, so a rollback
    // takes the row with it and the email is never queued.
    await notify(row.brandUserId, 'offer_declined', {
      dealId,
      campaignId: row.campaignId,
      campaignTitle: row.campaignName,
      creatorHandle: row.creatorHandle,
      releasedAmount: row.totalPrice,
    });

    return { ok: true, dealId, releasedAmount: row.totalPrice };
  });
}
