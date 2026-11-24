import { and, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { campaign, creatorProfile, deal } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import {
  canReview,
  getErrorCodeForInvalidTransition,
  transitionDeal,
  TransitionError,
} from '@/lib/deals/state-machine';
import { withNotifications } from '@/lib/notifications/notify';
import type { Notify } from '@/lib/notifications/notify';
import type { ErrorCode } from '@/lib/validation/errors';
import { rejectCurrent, VersionConflict } from '@/lib/deliverables/history';
import type { RevisionCategory } from '@/lib/deliverables/evidence';

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
    reason: string,
    occurredAt?: Date
  ) => Promise<unknown>;
  /**
   * Stores the rejection on the one video being sent back (AC-3, F38).
   *
   * Scoped by **both** ids. A deal can hold several videos, so the deliverable id
   * arrives from the client — and a client-supplied id checked only against its
   * own table would let a brand reject a video on somebody else's deal. ANDing
   * `deal_id` makes the ownership already established for the deal cover the
   * video too, which is layer two of NFR-005 in the shape
   * `buildRejectDeliverableWhere` uses one level up.
   *
   * Returns whether a row matched. A miss is a real refusal, not a no-op: it
   * means the id names no video on this deal, and rejecting without recording
   * the note would strand the creator with a revision and no instructions.
   */
  recordRejection: (
    tx: Tx,
    dealId: string,
    deliverableId: string,
    reason: string,
    reviewedAt: Date,
    evidence: {
      expectedVersion?: number;
      category?: RevisionCategory;
      actorId: string;
    }
  ) => Promise<{ tiktokUrl: string } | null>;
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

export const defaultDeps: RejectDeliverableDeps = {
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
  transition: (tx, dealId, actorId, reason, occurredAt) =>
    transitionDeal(tx, dealId, 'revision_requested', actorId, {
      reason,
      occurredAt,
    }),
  recordRejection: async (
    tx,
    dealId,
    deliverableId,
    reason,
    reviewedAt,
    evidence
  ) => {
    // One statement, and the `and` is the security half: an id naming a video on
    // another brand's deal matches nothing and returns null, without this module
    // needing a second read to check who owns it.
    if (evidence.expectedVersion === undefined || !evidence.category)
      throw new VersionConflict();
    return rejectCurrent(
      tx,
      dealId,
      deliverableId,
      evidence.expectedVersion,
      evidence.category,
      reason,
      { actorId: evidence.actorId, actorRole: 'brand' },
      reviewedAt
    );
  },
  run: (fn) => withNotifications(fn),
};

/**
 * Rejects one delivered video on behalf of the brand that owns its campaign
 * (AC-024).
 *
 * `brandProfileId` and `actorUserId` come from `guard()`, never from the
 * request body. `deliverableId` and `reason` are the client-supplied values, and
 * both have already survived `rejectDeliverableSchema` (a uuid, and a non-empty
 * bounded string) before this function is called.
 *
 * **The status guard runs before the write**, and answers with the state
 * machine's own code — `canReview` is exactly `{delivered}` read off
 * `LEGAL_TRANSITIONS`, so rejecting a video that was never delivered reports
 * `DEAL_NOT_DELIVERED` and a double-reject reports whatever the machine says for
 * `revision_requested → revision_requested`. Checked here rather than left to the
 * transition because the rejection is written first: a client-supplied
 * deliverable id that names nothing must not move the deal on its way to being
 * refused.
 *
 * **A deliverable id that matches nothing on this deal is `not_found`**, which
 * the route answers as 403 like every other owner-scoped miss. The brand already
 * proved they own the deal; an id naming a video on somebody else's is not a
 * reason to confirm that video exists.
 */
export async function rejectDeliverable(
  dealId: string,
  input: {
    brandProfileId: string;
    actorUserId: string;
    deliverableId: string;
    reason: string;
    expectedVersion?: number;
    category?: RevisionCategory;
  },
  deps: RejectDeliverableDeps = defaultDeps
): Promise<RejectDeliverableResult> {
  try {
    return await deps.run(async (tx, notify) => {
      const row = await deps.loadDeal(tx, dealId, input.brandProfileId);
      if (!row) {
        return { ok: false, reason: 'not_found' };
      }

      // AC-024 and AC-5. `delivered` is the only status a rejection is legal from,
      // and the code for every other one is the machine's rather than one this
      // module invents.
      if (!canReview(row.status)) {
        return {
          ok: false,
          reason: 'illegal',
          code: getErrorCodeForInvalidTransition(
            row.status,
            'revision_requested'
          ),
        };
      }

      // AC-3, in the same transaction as the status change below: a rejection note
      // must never exist for a deal that is not `revision_requested`, and a deal
      // the brand sent back must always carry one.
      const reviewedAt = new Date();
      const rejected = await deps.recordRejection(
        tx,
        dealId,
        input.deliverableId,
        input.reason,
        reviewedAt,
        {
          expectedVersion: input.expectedVersion,
          category: input.category,
          actorId: input.actorUserId,
        }
      );

      if (!rejected) {
        return { ok: false, reason: 'not_found' };
      }

      await deps.transition(
        tx,
        dealId,
        input.actorUserId,
        REJECT_DELIVERABLE_EVENT_REASON,
        reviewedAt
      );

      // AC-1. The creator's `user.id`, resolved through `creator_profile` in
      // the load above. Inside the transaction, so a rollback takes the row
      // with it and the email is never queued. The reason travels with the
      // notification, which is what the creator acts on (AC-3), and so does the
      // URL — with several videos on one deal, the note alone would not say which.
      await notify(row.creatorUserId, 'revision_requested', {
        dealId,
        campaignTitle: row.campaignName,
        reason: input.reason,
        tiktokUrl: rejected.tiktokUrl,
      });

      return {
        ok: true,
        dealId,
        status: 'revision_requested',
        reason: input.reason,
      };
    });
  } catch (error) {
    if (error instanceof TransitionError || error instanceof VersionConflict)
      return { ok: false, reason: 'illegal', code: error.code };
    throw error;
  }
}
