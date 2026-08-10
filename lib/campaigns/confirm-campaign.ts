import { and, eq } from 'drizzle-orm';
import {
  brandProfile,
  campaign,
  campaignItem,
  creatorProfile,
  deal,
} from '@/db/schema';
import type { CampaignStatus } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { offerExpiresAt } from '@/lib/config/pricing';
import { recordDealsCreated } from '@/lib/deals/state-machine';
import { withNotifications } from '@/lib/notifications/notify';
import type { Notify } from '@/lib/notifications/notify';
import { getCurrentRightsTerms } from '@/lib/rights-terms/current';

/**
 * Campaign confirmation — a `pending` deal offer per selected creator (KAN-33,
 * US-006, AC-016, Tech Spec §4.3).
 *
 * This is the point the cart becomes a commitment. Everything the brand picked
 * lives in `campaign_item` until now precisely so no creator sees an offer the
 * brand has not yet stood behind (`add-to-cart.ts` records that reasoning).
 *
 * **Why this inserts deals rather than calling `transitionDeal`.** The state
 * machine has no inbound edge to `pending` — `LEGAL_TRANSITIONS` lists it only
 * as a source, and a `pending` *target* is mapped to `VALIDATION_ERROR` on the
 * grounds that reaching it means the caller invented a target. A deal is
 * *created* at `pending`; it never arrives there from somewhere else. So the
 * `deal` rows are inserted here, and their opening `deal_event` is written by
 * `recordDealsCreated` — in the state machine's own module, which owns every
 * write to that table. Invariant 6 still holds: every deal's history starts
 * with a row, in the same transaction as the deal itself.
 *
 * **Why `withNotifications` owns the transaction.** AC-5 wants all offers in one
 * transaction and AC-7 wants each creator notified; `withNotifications` is
 * already both. It writes each notification row through the transaction and
 * flushes email strictly after commit, so a rolled-back confirmation leaves
 * neither a half-sent batch of offers nor an email about offers that do not
 * exist. Opening a `db.transaction` here as well would nest two transactions on
 * two pool connections — see `decide-verification.ts` for the same composition.
 */

export interface ConfirmCampaignContext {
  id: string;
  name: string;
  budget: number;
  status: CampaignStatus;
  /** The offering brand's display name — AC-1's offers say who they are from. */
  companyName: string;
}

/** One cart row, plus the recipient the offer notification goes to. */
export interface ConfirmCampaignItem {
  creatorId: string;
  /**
   * `user.id`, not `creator_profile.id`.
   *
   * Notifications address a user; `campaign_item.creator_id` points at a
   * profile. The two are never interchangeable (`lib/authz.ts` calls this the
   * two-hop rule), and passing the profile id here would write notification
   * rows nobody can read.
   */
  creatorUserId: string;
  videoCount: number;
  unitPrice: number;
  totalPrice: number;
  commissionRate: string;
}

export interface NewDealRow {
  campaignId: string;
  creatorId: string;
  videoCount: number;
  unitPrice: number;
  totalPrice: number;
  commissionRate: string;
  /**
   * Set explicitly even though the column defaults to it.
   *
   * AC-1 is a statement about the status these deals are created in, so it
   * belongs in the insert where a test can read it, not only in the schema. The
   * column default stays as the backstop; if it were ever changed, this would
   * keep the offers where the AC says they start.
   */
  status: 'pending';
  rightsTermsId: string;
  offerExpiresAt: Date;
}

export type ConfirmCampaignResult =
  | {
      ok: true;
      campaignId: string;
      dealIds: string[];
      totalCommitted: number;
      offerExpiresAt: Date;
    }
  | { ok: false; reason: 'budget_exceeded'; excess: number }
  | { ok: false; reason: 'not_found' | 'not_draft' | 'empty_cart' };

/**
 * No usage-rights version has taken effect, so there is nothing for an offer to
 * cite (AC-1).
 *
 * A thrown error rather than a result reason, and deliberately not an
 * `ErrorCode`: this is an unseeded environment, not something the brand did or
 * can fix, and there is no useful sentence to show them. `withAdminAudit`
 * treats a miswired audit target the same way — turning a wiring fault into a
 * 4xx only invites a caller to catch and ignore it.
 *
 * Issuing the offers anyway is the alternative, and it is worse: a deal with a
 * null `rights_terms_id` can never be accepted, because acceptance must match
 * the current version.
 */
export class MissingRightsTermsError extends Error {
  constructor() {
    super(
      'No usage-rights terms are in effect; cannot issue offers. Seed `rights_terms`.'
    );
    this.name = 'MissingRightsTermsError';
  }
}

export interface ConfirmCampaignDeps {
  getCampaign: (
    tx: Tx,
    campaignId: string,
    brandProfileId: string
  ) => Promise<ConfirmCampaignContext | null>;
  listItems: (tx: Tx, campaignId: string) => Promise<ConfirmCampaignItem[]>;
  getRightsTerms: (tx: Tx) => Promise<{ id: string } | null>;
  insertDeals: (
    tx: Tx,
    rows: NewDealRow[]
  ) => Promise<Array<{ id: string; creatorId: string }>>;
  /**
   * Writes the opening `deal_event` for each new deal (AC-6, invariant 6).
   *
   * Defaults to `recordDealsCreated` — the row shape lives there, with the rest
   * of the deal history writes, so this seam carries only the ids and the actor.
   */
  recordCreated: (tx: Tx, dealIds: string[], actorId: string) => Promise<void>;
  markConfirmed: (tx: Tx, campaignId: string) => Promise<void>;
  /** Injected so the offer window is assertable without freezing the clock. */
  now: () => Date;
  /**
   * Runs the body in a transaction and delivers its notifications after commit.
   *
   * The seam is `withNotifications` itself rather than a bare `transaction`,
   * because the notify handed to the body only exists inside one — there is no
   * form of it that writes outside the transaction, which is what makes AC-5 and
   * AC-7 one guarantee instead of two.
   */
  run: <T>(fn: (tx: Tx, notify: Notify) => Promise<T>) => Promise<T>;
}

const defaultDeps: ConfirmCampaignDeps = {
  getCampaign: async (tx, campaignId, brandProfileId) => {
    const [row] = await tx
      .select({
        id: campaign.id,
        name: campaign.name,
        budget: campaign.budget,
        status: campaign.status,
        companyName: brandProfile.companyName,
      })
      .from(campaign)
      .innerJoin(brandProfile, eq(campaign.brandId, brandProfile.id))
      .where(
        and(eq(campaign.id, campaignId), eq(campaign.brandId, brandProfileId))
      )
      // The lock is what serialises two concurrent confirms: the second waits
      // here, then reads `confirmed` and returns before writing anything.
      // Without it both could pass the draft check and race to insert.
      .for('update')
      .limit(1);

    return row ?? null;
  },
  listItems: async (tx, campaignId) =>
    tx
      .select({
        creatorId: campaignItem.creatorId,
        creatorUserId: creatorProfile.userId,
        videoCount: campaignItem.videoCount,
        unitPrice: campaignItem.unitPrice,
        totalPrice: campaignItem.totalPrice,
        commissionRate: campaignItem.commissionRate,
      })
      .from(campaignItem)
      .innerJoin(creatorProfile, eq(campaignItem.creatorId, creatorProfile.id))
      .where(eq(campaignItem.campaignId, campaignId)),
  // Through `tx`, never the global `db`. The pool is `max: 5` and the campaign
  // row is locked above, so a query on `db` here would hold one connection
  // hostage while waiting for another — the deadlock documented at length in
  // `remove-from-cart.ts`.
  getRightsTerms: (tx) => getCurrentRightsTerms(tx),
  insertDeals: (tx, rows) =>
    tx
      .insert(deal)
      .values(rows)
      .returning({ id: deal.id, creatorId: deal.creatorId }),
  // Delegated to the module that owns `deal_event`, not written here. The suite
  // refuses any `insert(dealEvent)` outside `lib/deals/state-machine.ts`,
  // because an event written beside unrelated business logic is how an audit
  // row with no status change behind it gets created (KAN-34).
  recordCreated: recordDealsCreated,
  markConfirmed: async (tx, campaignId) => {
    await tx
      .update(campaign)
      .set({ status: 'confirmed' })
      .where(eq(campaign.id, campaignId));
  },
  now: () => new Date(),
  run: (fn) => withNotifications(fn),
};

/**
 * Confirms a draft campaign: issues one `pending` offer per cart item, moves the
 * campaign to `confirmed`, and notifies every creator (AC-016).
 *
 * `brandProfileId` and `actorUserId` come from `guard()`, never from the client
 * payload. The campaign query filters on `brandProfileId` regardless, so a
 * caller who does not own the campaign gets `not_found` even if the route's gate
 * were removed — a read or write protected only by its caller is protected as
 * well as its least careful caller.
 */
export async function confirmCampaign(
  campaignId: string,
  brandProfileId: string,
  actorUserId: string,
  deps: ConfirmCampaignDeps = defaultDeps
): Promise<ConfirmCampaignResult> {
  return deps.run(async (tx, notify) => {
    const camp = await deps.getCampaign(tx, campaignId, brandProfileId);
    if (!camp) {
      return { ok: false, reason: 'not_found' };
    }

    // AC-4. A second confirm stops here, so it cannot create duplicate deals —
    // `deal_campaign_creator_unique` is the backstop behind this check, not the
    // mechanism.
    if (camp.status !== 'draft') {
      return { ok: false, reason: 'not_draft' };
    }

    const items = await deps.listItems(tx, campaignId);

    // Not named by any AC, and refused on purpose. Confirming an empty cart
    // would move the campaign to `confirmed` with no deals: funding needs at
    // least one accepted deal, and the brief is only editable while draft, so
    // the campaign would be permanently stuck with no way back.
    if (items.length === 0) {
      return { ok: false, reason: 'empty_cart' };
    }

    // AC-8, before any write. Summed from the rows already loaded rather than a
    // second `sum()` query: `campaign_item_total_price_valid` guarantees each
    // `total_price` is `unit_price * video_count`, so the two agree by
    // construction. Integer santim throughout (invariant 4).
    const totalCommitted = items.reduce(
      (sum, item) => sum + item.totalPrice,
      0
    );
    if (totalCommitted > camp.budget) {
      return {
        ok: false,
        reason: 'budget_exceeded',
        excess: totalCommitted - camp.budget,
      };
    }

    const terms = await deps.getRightsTerms(tx);
    if (!terms) {
      throw new MissingRightsTermsError();
    }

    // One instant for the whole batch (AC-3). Computed per row instead, offers
    // in the same confirmation would expire microseconds apart for no reason.
    const expiresAt = offerExpiresAt(deps.now());

    const inserted = await deps.insertDeals(
      tx,
      items.map((item) => ({
        campaignId,
        creatorId: item.creatorId,
        // AC-2: copied from the cart row, not re-read from `pricing_tier`. A
        // re-read would let a tier re-priced between carting and confirming
        // silently change what the brand agreed to pay.
        videoCount: item.videoCount,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        commissionRate: item.commissionRate,
        status: 'pending' as const,
        rightsTermsId: terms.id,
        offerExpiresAt: expiresAt,
      }))
    );

    // Keyed by creator rather than by position: `RETURNING` is not specified to
    // preserve input order, and `(campaign_id, creator_id)` is unique, so the
    // creator is a reliable key within one campaign.
    const dealIdByCreator = new Map(
      inserted.map((row) => [row.creatorId, row.id])
    );

    // AC-6, invariant 6. Written through the state machine's module, which owns
    // every `deal_event` write; `from_status` is null there because the deal did
    // not come from another status — it began at `pending`.
    await deps.recordCreated(
      tx,
      inserted.map((row) => row.id),
      actorUserId
    );

    await deps.markConfirmed(tx, campaignId);

    // AC-7. Sequential rather than `Promise.all`: a campaign's worth of offers
    // is a small batch, and a parallel burst is what turns a provider rate
    // limit into a failed confirmation.
    for (const item of items) {
      const dealId = dealIdByCreator.get(item.creatorId);

      // One insert per item and `(campaign_id, creator_id)` unique, so a miss
      // here is impossible unless the insert seam returned something other than
      // what it was given. Throwing rolls the whole confirmation back, which is
      // the right end for that: skipping the notification would leave a creator
      // holding an offer nobody ever told them about, and AC-7 would be
      // silently false.
      if (!dealId) {
        throw new Error(
          `Deal insert returned no row for creator ${item.creatorId}.`
        );
      }

      await notify(item.creatorUserId, 'offer_received', {
        dealId,
        campaignTitle: camp.name,
        companyName: camp.companyName,
        totalPrice: item.totalPrice,
        videoCount: item.videoCount,
        offerExpiresAt: expiresAt.toISOString(),
      });
    }

    return {
      ok: true,
      campaignId,
      dealIds: inserted.map((row) => row.id),
      totalCommitted,
      offerExpiresAt: expiresAt,
    };
  });
}
