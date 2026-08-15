import { and, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { campaign, creatorProfile, deal, deliverable } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { transitionDeal, TransitionError } from '@/lib/deals/state-machine';
import { withNotifications } from '@/lib/notifications/notify';
import type { Notify } from '@/lib/notifications/notify';
import type { ErrorCode } from '@/lib/validation/errors';

/**
 * Rejecting a delivered video with a reason (KAN-47, US-008, AC-024,
 * Tech Spec §4.4 reject).
 *
 * The brand sends the deliverable back: the deal returns to
 * `revision_requested`, the rejection reason lands on the deliverable row
 * and in the creator's notification, and **no money moves** — AC bullet 4
 * is satisfied by there being no ledger call at all, not by a ledger call
 * that happens to write nothing. The hold from funding stays exactly where
 * it is; only KAN-45's approval (or KAN-51's refund) moves it.
 *
 * The mirror of `submit-deliverable.ts` with three deliberate differences:
 *
 *   - **Brand-scoped load.** The brand's profile id is part of the lookup
 *     (through `campaign.brand_id`), so there is no argument that produces a
 *     row this brand does not own — the same two-layer shape every brand
 *     action uses, with the route's `guard` as layer one.
 *   - **The reason is stored twice, on purpose.** AC-3 puts it on the
 *     deliverable (the durable record, reset on resubmission by KAN-46's
 *     upsert) and in the creator's notification (what they act on). The
 *     `deal_event` reason stays a fixed description of the transition, like
 *     every other event — the note itself has a home; it does not need to be
 *     restated in the history.
 *   - **No money.** Declining and expiring release budget because a pending
 *     offer never held any; rejection releases nothing because the hold is
 *     the whole point of escrow (AC-021). `refundDeal` is KAN-51's call.
 *
 * **What the state machine supplies.** `delivered → revision_requested` is
 * the only legal edge, so every other status surfaces the machine's own
 * code — `DEAL_NOT_DELIVERED` for anything that was never delivered, and the
 * idempotency answer for a double-reject. The creator's resubmit edge
 * (`revision_requested → delivered`) already exists from KAN-46, so AC-6
 * holds without new code.
 */

/** What the action needs about the deal, its campaign, and the creator. */
export interface RejectDeliverableRow {
  id: string;
  status: DealStatus;
  campaignName: string;
  /**
   * `user.id`, not `creator_profile.id`.
   *
   * The two-hop rule from `lib/authz.ts`: business rows reference profile ids
   * and notifications address a user, so `deal.creator_id` has to be walked
   * through `creator_profile.user_id` before anything can be sent. Passing
   * the profile id here writes a notification row nobody can read.
   */
  creatorUserId: string;
}

export type RejectDeliverableResult =
  | { ok: true; dealId: string; status: 'revision_requested'; reason: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'illegal'; code: ErrorCode };

export interface RejectDeliverableDeps {
  /**
   * Loads the deal under a `FOR UPDATE` lock, scoped to the owning brand.
   *
   * The brand's profile id is part of the lookup rather than checked after
   * it, so there is no argument that produces a row this brand does not own.
   * The lock serialises a concurrent approve/reject of the same delivery:
   * the loser waits here, then reads the status the winner wrote and is
   * refused by the state machine.
   */
  loadDeal: (
    tx: Tx,
    dealId: string,
    brandProfileId: string
  ) => Promise<RejectDeliverableRow | null>;
  /** Delegates to the state machine, which owns every status write and `deal_event`. */
  transition: (
    tx: Tx,
    dealId: string,
    actorId: string,
    reason: string
  ) => Promise<unknown>;
  /**
   * Stores the rejection on the deliverable row (AC-3): `rejected`, the
   * review timestamp, and the brand's reason. Throws if the deal has no
   * deliverable row at all — a `delivered` deal is guaranteed one by KAN-46,
   * so a miss here is corrupted data, and rejecting without recording the
   * note would strand the creator with a revision and no instructions.
   */
  recordRejection: (
    tx: Tx,
    dealId: string,
    reason: string,
    reviewedAt: Date
  ) => Promise<void>;
  run: <T>(fn: (tx: Tx, notify: Notify) => Promise<T>) => Promise<T>;
}

/** Recorded on the `deal_event`; the note itself lives on the deliverable. */
export const REJECT_DELIVERABLE_EVENT_REASON =
  'Brand requested changes to the deliverable';

/**
 * The lookup, as a `where` clause — layer two of NFR-005, expressed in SQL.
 *
 * Exported for the same reason `buildSubmitDeliverableWhere` is: asserting
 * that the ownership half is present is easier here than through a database.
 * The brand id is the base the deal id narrows, so there is no argument that
 * produces a lookup without it.
 */
export function buildRejectDeliverableWhere(
  dealId: string,
  brandProfileId: string
): SQL {
  return and(eq(deal.id, dealId), eq(campaign.brandId, brandProfileId)) as SQL;
}

const defaultDeps: RejectDeliverableDeps = {
  loadDeal: async (tx, dealId, brandProfileId) => {
    const [row] = await tx
      .select({
        id: deal.id,
        status: deal.status,
        campaignName: campaign.name,
        creatorUserId: creatorProfile.userId,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
      .where(buildRejectDeliverableWhere(dealId, brandProfileId))
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
    transitionDeal(tx, dealId, 'revision_requested', actorId, { reason }),
  recordRejection: async (tx, dealId, reason, reviewedAt) => {
    const [existing] = await tx
      .select({ id: deliverable.id })
      .from(deliverable)
      .where(eq(deliverable.dealId, dealId))
      .limit(1);

    if (!existing) {
      throw new Error(`No deliverable to reject for deal ${dealId}`);
    }

    await tx
      .update(deliverable)
      .set({
        reviewStatus: 'rejected',
        reviewedAt,
        rejectionReason: reason,
      })
      .where(eq(deliverable.id, existing.id));
  },
  run: (fn) => withNotifications(fn),
};

/**
 * Rejects a delivered deliverable on behalf of the brand that owns its
 * campaign (AC-024).
 *
 * `brandProfileId` and `actorUserId` come from `guard()`, never from the
 * request body. `reason` is the only value the client supplies, and it has
 * already survived `rejectDeliverableSchema` (non-empty, bounded) before this
 * function is called.
 *
 * The state machine is the status guard: only a `delivered` deal can reach
 * `revision_requested`, so every other status surfaces the machine's own
 * code — `DEAL_NOT_DELIVERED` for a video that was never submitted, and the
 * idempotency answer for a double-reject arriving as `revision_requested →
 * revision_requested`.
 */
export async function rejectDeliverable(
  dealId: string,
  input: { brandProfileId: string; actorUserId: string; reason: string },
  deps: RejectDeliverableDeps = defaultDeps
): Promise<RejectDeliverableResult> {
  return deps.run(async (tx, notify) => {
    const row = await deps.loadDeal(tx, dealId, input.brandProfileId);
    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    try {
      // AC-024 and AC-5 together. `delivered → revision_requested` is the
      // only legal edge; the machine refuses everything else with its own
      // code rather than one this module invents.
      await deps.transition(
        tx,
        dealId,
        input.actorUserId,
        REJECT_DELIVERABLE_EVENT_REASON
      );
    } catch (error) {
      if (error instanceof TransitionError) {
        return { ok: false, reason: 'illegal', code: error.code };
      }
      throw error;
    }

    // AC-3, in the same transaction as the status change: a rejection note
    // must never exist for a deal that is not `revision_requested`, and a
    // deal the brand sent back must always carry one.
    const reviewedAt = new Date();
    await deps.recordRejection(tx, dealId, input.reason, reviewedAt);

    // AC-1. The creator's `user.id`, resolved through `creator_profile` in
    // the load above. Inside the transaction, so a rollback takes the row
    // with it and the email is never queued. The reason travels with the
    // notification, which is what the creator acts on (AC-3).
    await notify(row.creatorUserId, 'revision_requested', {
      dealId,
      campaignTitle: row.campaignName,
      reason: input.reason,
    });

    return {
      ok: true,
      dealId,
      status: 'revision_requested',
      reason: input.reason,
    };
  });
}
