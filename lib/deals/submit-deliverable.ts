import { and, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { brandProfile, campaign, deal, deliverable } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { transitionDeal, TransitionError } from '@/lib/deals/state-machine';
import { withNotifications } from '@/lib/notifications/notify';
import type { Notify } from '@/lib/notifications/notify';
import type { ErrorCode } from '@/lib/validation/errors';

/**
 * Submitting the live TikTok post URL for a funded deal (KAN-46, US-008,
 * AC-022, AC-025, Tech Spec §4.4 deliverable).
 *
 * The first action in the app that *creates content against a deal* rather
 * than moving a status: the status change to `delivered` and the
 * `deliverable` row land together or not at all, inside the transaction
 * `withNotifications` owns — a creator is never told \"submitted\" about a
 * deal whose deliverable did not survive, and the brand's notification cannot
 * outlive a rolled-back submission.
 *
 * **Only two writes, and the deliverable write is an upsert.** AC-5 says
 * exactly one deliverable exists per deal — the schema's unique constraint on
 * `deliverable.deal_id` is the backstop — and that resubmitting after a
 * revision request updates the existing row rather than creating a second.
 * So the default `upsertDeliverable` reads first: a row already there is
 * updated in place (new URL, submission clock re-stamped, review state reset
 * so a fresh submission is `pending` again), and only a deal with no row yet
 * gets an insert. The deal row is held `FOR UPDATE` from the load through the
 * transition, so two concurrent submissions of the same deal cannot race the
 * read-then-write: the loser reads `delivered` and is refused by the state
 * machine before it ever reaches the upsert.
 *
 * **Why no clock seam.** `accept-offer.ts` injects `now()` because its AC
 * names a deadline boundary worth asserting against a frozen clock. Nothing
 * here has a boundary to draw: `submitted_at` is a record of when the
 * submission happened, asserted as a value carried through to the response,
 * not as a comparison against anything.
 *
 * **The URL is validated and stored, never fetched** (AC-8, Tech Spec §6.3).
 * The allowlist check happens in `submitDeliverableSchema` before this action
 * is ever reached, and nothing in this module touches the network.
 */

/** What the action needs about the deal, its campaign, and the brand. */
export interface SubmitDeliverableRow {
  id: string;
  status: DealStatus;
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
}

export type SubmitDeliverableResult =
  | {
      ok: true;
      dealId: string;
      deliverableId: string;
      /** When the submission landed — the value the row recorded (AC-6). */
      submittedAt: Date;
      status: 'delivered';
    }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'illegal'; code: ErrorCode };

export interface SubmitDeliverableDeps {
  /**
   * Loads the deal under a `FOR UPDATE` lock, scoped to the submitting creator.
   *
   * The creator's profile id is part of the lookup rather than checked after
   * it, so there is no argument that produces a row this creator does not own —
   * the same shape `buildAcceptOfferWhere` uses. The route's `guard` is layer
   * one of NFR-005; this is layer two, and it holds even if a future caller
   * forgets the first.
   *
   * The lock is what serialises concurrent submissions of the same deal: the
   * loser waits here, then reads `delivered` and is refused by the state
   * machine instead of racing the deliverable upsert.
   */
  loadDeal: (
    tx: Tx,
    dealId: string,
    creatorProfileId: string
  ) => Promise<SubmitDeliverableRow | null>;
  /** Delegates to the state machine, which owns every status write and `deal_event`. */
  transition: (
    tx: Tx,
    dealId: string,
    actorId: string,
    reason: string
  ) => Promise<unknown>;
  /**
   * One deliverable per deal (AC-5): insert the first time, update in place on
   * resubmission. Returns the row's id and the recorded submission time, which
   * is what the response echoes so the client never re-reads to learn them.
   */
  upsertDeliverable: (
    tx: Tx,
    dealId: string,
    tiktokUrl: string,
    submittedAt: Date
  ) => Promise<{ id: string; submittedAt: Date }>;
  run: <T>(fn: (tx: Tx, notify: Notify) => Promise<T>) => Promise<T>;
}

/** Recorded on the `deal_event`, so the history says what happened in words. */
export const SUBMIT_DELIVERABLE_EVENT_REASON =
  'Creator submitted the live TikTok post URL';

/**
 * The lookup, as a `where` clause — layer two of NFR-005, expressed in SQL.
 *
 * Exported for the same reason `buildAcceptOfferWhere` is: asserting that the
 * ownership half is present is easier here than through a database. The
 * creator id is the base the deal id narrows, not a filter this function
 * chooses to add, so there is no argument that produces a lookup without it.
 */
export function buildSubmitDeliverableWhere(
  dealId: string,
  creatorProfileId: string
): SQL {
  return and(eq(deal.id, dealId), eq(deal.creatorId, creatorProfileId)) as SQL;
}

const defaultDeps: SubmitDeliverableDeps = {
  loadDeal: async (tx, dealId, creatorProfileId) => {
    const [row] = await tx
      .select({
        id: deal.id,
        status: deal.status,
        campaignName: campaign.name,
        brandUserId: brandProfile.userId,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(brandProfile, eq(campaign.brandId, brandProfile.id))
      .where(buildSubmitDeliverableWhere(dealId, creatorProfileId))
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
    transitionDeal(tx, dealId, 'delivered', actorId, { reason }),
  upsertDeliverable: async (tx, dealId, tiktokUrl, submittedAt) => {
    const [existing] = await tx
      .select({ id: deliverable.id })
      .from(deliverable)
      .where(eq(deliverable.dealId, dealId))
      .limit(1);

    if (existing) {
      // AC-5: resubmitting after a revision request updates the one row. The
      // review state is reset so the fresh submission reads as `pending`
      // again — a stale rejection note must not follow a new video around.
      await tx
        .update(deliverable)
        .set({
          tiktokUrl,
          submittedAt,
          reviewStatus: 'pending',
          reviewedAt: null,
          rejectionReason: null,
        })
        .where(eq(deliverable.id, existing.id));
      return { id: existing.id, submittedAt };
    }

    const [created] = await tx
      .insert(deliverable)
      .values({ dealId, tiktokUrl, submittedAt })
      .returning({ id: deliverable.id, submittedAt: deliverable.submittedAt });
    return { id: created.id, submittedAt: created.submittedAt };
  },
  run: (fn) => withNotifications(fn),
};

/**
 * Submits the live TikTok post URL on behalf of the creator the deal was made
 * to (AC-022).
 *
 * `creatorProfileId` and `actorUserId` come from `guard()`, never from the
 * request body. `tiktokUrl` is the only value the client supplies, and it has
 * already survived `submitDeliverableSchema`'s allowlist before this function
 * is called — this module stores it and does not second-guess it.
 *
 * The state machine is the status guard, and it answers AC-4 on its own: only
 * a `funded` (or, on resubmission, `revision_requested`) deal can reach
 * `delivered`, so every other status surfaces the machine's own code —
 * `DEAL_NOT_FUNDED` for work submitted before the money was held, and the
 * idempotency answer for a double-tap that arrives as `delivered →
 * delivered`.
 */
export async function submitDeliverable(
  dealId: string,
  input: { creatorProfileId: string; actorUserId: string; tiktokUrl: string },
  deps: SubmitDeliverableDeps = defaultDeps
): Promise<SubmitDeliverableResult> {
  return deps.run(async (tx, notify) => {
    const row = await deps.loadDeal(tx, dealId, input.creatorProfileId);
    if (!row) {
      return { ok: false, reason: 'not_found' };
    }

    try {
      // AC-022 and AC-4 together. `funded → delivered` and
      // `revision_requested → delivered` are the legal edges, and everything
      // else is refused here with the machine's own code rather than one this
      // module invents.
      await deps.transition(
        tx,
        dealId,
        input.actorUserId,
        SUBMIT_DELIVERABLE_EVENT_REASON
      );
    } catch (error) {
      if (error instanceof TransitionError) {
        return { ok: false, reason: 'illegal', code: error.code };
      }
      throw error;
    }

    // After the transition, in the same transaction: a deliverable row must
    // never exist for a deal that is not `delivered`, and a deal that is
    // `delivered` must always have one (AC-5).
    const submittedAt = new Date();
    const stored = await deps.upsertDeliverable(
      tx,
      dealId,
      input.tiktokUrl,
      submittedAt
    );

    // AC-6. The brand's `user.id`, resolved through `brand_profile` in the
    // load above. Inside the transaction, so a rollback takes the row with it
    // and the email is never queued.
    await notify(row.brandUserId, 'deliverable_submitted', {
      dealId,
      deliverableId: stored.id,
      campaignTitle: row.campaignName,
    });

    return {
      ok: true,
      dealId,
      deliverableId: stored.id,
      submittedAt: stored.submittedAt,
      status: 'delivered',
    };
  });
}
