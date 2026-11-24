import { and, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  brandProfile,
  campaign,
  deal,
  deliverable,
  deliverableEvent,
} from '@/db/schema';
import {
  appendEvidence,
  currentVideos,
  preserveSuperseded,
  reviewReady,
  VersionConflict,
} from '@/lib/deliverables/history';
import type { DealStatus } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import {
  canDeliver,
  getErrorCodeForInvalidTransition,
  transitionDeal,
  TransitionError,
} from '@/lib/deals/state-machine';
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
 * `withNotifications` owns — a creator is never told "submitted" about a
 * deal whose deliverable did not survive, and the brand's notification cannot
 * outlive a rolled-back submission.
 *
 * **One row per video, and a deal delivers every video it was paid for (F38).**
 * A deal priced for three videos accepts three submissions. Until the third
 * lands the deal stays `funded`, so there is nothing for the brand to approve —
 * which is the whole bug this replaced: one URL used to unlock all three videos'
 * money. The rule, stated once:
 *
 * > A deal is `delivered` ⟺ it holds exactly `video_count` deliverable rows and
 * > none of them is `rejected`.
 *
 * **So the write comes first and the transition last**, the reverse of the
 * original order. Partially-submitted rows on a `funded` deal are the ordinary
 * case now, not corruption — the old invariant "a deliverable row must never
 * exist for a deal that is not `delivered`" is deliberately gone.
 *
 * **Which loses the transition's implicit status guard, so the guard is now
 * explicit.** `canDeliver` is checked before anything is written, and a refusal
 * carries `getErrorCodeForInvalidTransition`'s code rather than one this module
 * invents — the same answer the state machine would have given, including
 * `DEAL_NOT_FUNDED` for work submitted before the money was held and for a
 * double-tap arriving on an already-`delivered` deal.
 *
 * **At most one row can be `rejected` at any time**, which is what lets a
 * resubmission find its target without being told which video. The brand can
 * only reject from `delivered`, and rejecting moves the deal to
 * `revision_requested` where `canReview` is false — so a second rejection cannot
 * be issued until the first is replaced. A rejected row present means "replace
 * this one"; none means "add the next one".
 *
 * **The ceiling is enforced here, not by a constraint.** "At most `video_count`
 * rows" spans two tables and no per-row CHECK can express it. The count is taken
 * under the `FOR UPDATE` lock this action already holds on the deal, so two
 * concurrent submissions cannot both see room for the last video: the loser waits
 * at the load, then counts a full deal.
 *
 * **The brand is notified once, on the last video.** A `deliverable_submitted`
 * email whose CTA opens a review screen with no Approve button is worse than no
 * email — the brand cannot act on a partial delivery, and three emails for one
 * deal train them to ignore the one that matters.
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
  /**
   * How many videos this deal was priced for — the ceiling on submissions and
   * the trigger for `delivered` (F38).
   *
   * Read from the deal rather than passed in: it is snapshotted at offer time
   * alongside `unit_price` (invariant 8), and a client-supplied count would let
   * a creator decide when their own deal is complete.
   */
  videoCount: number;
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

/** What one submission did to the deal's set of videos. */
export interface SubmissionProgress {
  submissionVersion?: number;
  videoOrdinal?: number;
  previousThumbnailUrl?: string | null;
  /** The row written — inserted, or the rejected one replaced. */
  id: string;
  submittedAt: Date;
  /** Rows now present for this deal, after the write. */
  submitted: number;
  /** `video_count − submitted`. Zero is what fires the transition. */
  remaining: number;
}

export type SubmitDeliverableResult =
  | {
      ok: true;
      dealId: string;
      deliverableId: string;
      /** When the submission landed — the value the row recorded (AC-6). */
      submittedAt: Date;
      /**
       * The deal's status **after** this submission.
       *
       * No longer always `delivered`: a partial delivery leaves the deal where it
       * was, and the client needs to know which happened to say something true.
       */
      status: 'funded' | 'revision_requested' | 'delivered';
      /** Videos submitted so far, and how many the deal was priced for. */
      submitted: number;
      videoCount: number;
      submissionVersion?: number;
      videoOrdinal?: number;
      previousThumbnailUrl?: string | null;
    }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'illegal'; code: ErrorCode };

export interface SubmitDeliverableDeps {
  replay?: (
    tx: Tx,
    dealId: string,
    input: SubmissionInput,
    videoCount: number
  ) => Promise<Extract<SubmitDeliverableResult, { ok: true }> | null>;
  ready?: typeof reviewReady;
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
   * loser waits here, then counts a deal whose last slot the winner already
   * took, so two submissions cannot both believe they are the third of three.
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
    reason: string,
    occurredAt?: Date
  ) => Promise<unknown>;
  /**
   * Writes one video and reports where the deal now stands (F38).
   *
   * Replaces `upsertDeliverable`, which could only ever hold one row. Reads
   * first, under the caller's lock: a `rejected` row is replaced in place (new
   * URL, clock re-stamped, review state cleared so the fresh submission reads as
   * `pending` again), and otherwise a new row is inserted while the deal is
   * below its `video_count`.
   *
   * Throws past the ceiling rather than returning a refusal. It is unreachable —
   * a full deal is `delivered`, which `canDeliver` already rejected — so getting
   * here means the row set and the status disagree, and inserting an extra video
   * would make a brand owe money for it.
   */
  recordSubmission: (
    tx: Tx,
    dealId: string,
    videoCount: number,
    tiktokUrl: string,
    submittedAt: Date,
    input: SubmissionInput
  ) => Promise<SubmissionProgress>;
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

export const defaultDeps: SubmitDeliverableDeps = {
  ready: reviewReady,
  replay: async (tx, dealId, input, videoCount) => {
    if (!input.requestId) throw new VersionConflict();
    const [event] = await tx
      .select()
      .from(deliverableEvent)
      .where(
        and(
          eq(deliverableEvent.dealId, dealId),
          eq(deliverableEvent.requestId, input.requestId)
        )
      );
    if (!event) return null;
    if (
      event.tiktokUrl !== input.tiktokUrl ||
      event.actorId !== input.actorUserId ||
      event.metadata.requestExpectedVersion !== input.expectedVersion ||
      event.metadata.requestExpectedSubmitted !== input.expectedSubmitted ||
      event.metadata.requestTargetId !== (input.deliverableId ?? null)
    )
      throw new VersionConflict();
    return {
      ok: true,
      dealId,
      deliverableId: event.deliverableId,
      submissionVersion: event.submissionVersion,
      submittedAt: event.occurredAt,
      submitted: event.metadata.submitted!,
      status: event.metadata.status!,
      videoCount,
      videoOrdinal: event.metadata.videoOrdinal,
    };
  },
  loadDeal: async (tx, dealId, creatorProfileId) => {
    const [row] = await tx
      .select({
        id: deal.id,
        status: deal.status,
        videoCount: deal.videoCount,
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
  transition: (tx, dealId, actorId, reason, occurredAt) =>
    transitionDeal(tx, dealId, 'delivered', actorId, { reason, occurredAt }),
  recordSubmission: async (
    tx,
    dealId,
    videoCount,
    tiktokUrl,
    submittedAt,
    input
  ) => {
    // Every row for the deal, not a count and a separate lookup: the decision
    // needs both how many there are and whether one was sent back, and two
    // queries could disagree with each other even under the lock.
    const rows = await currentVideos(tx, dealId);

    const rejected = rows.find((row) => row.reviewStatus === 'rejected');
    if (
      rejected
        ? input.deliverableId !== rejected.id ||
          input.expectedVersion !== rejected.submissionVersion
        : input.deliverableId != null ||
          input.expectedVersion !== 0 ||
          input.expectedSubmitted !== rows.length
    ) {
      throw new VersionConflict();
    }

    const recordEvent = async (
      video: typeof deliverable.$inferSelect,
      submitted: number
    ) => {
      await appendEvidence(
        tx,
        video,
        'submitted',
        { actorId: input.actorUserId, actorRole: 'creator' },
        submittedAt,
        {
          requestId: input.requestId,
          metadata: {
            requestExpectedVersion: input.expectedVersion,
            requestTargetId: input.deliverableId ?? null,
            requestExpectedSubmitted: input.expectedSubmitted,
            videoOrdinal: video.videoOrdinal,
            submitted,
            status: submitted === videoCount ? 'delivered' : 'funded',
          },
        }
      );
    };

    if (rejected) {
      await preserveSuperseded(tx, rejected, input.actorUserId, submittedAt);
      // The revision path (AC-5). The review state is reset so the fresh
      // submission reads as `pending` again — a stale rejection note must not
      // follow a new video around — and the count is unchanged, because a
      // replacement is not an addition.
      const [updated] = await tx
        .update(deliverable)
        .set({
          tiktokUrl,
          submittedAt,
          reviewStatus: 'pending',
          reviewedAt: null,
          rejectionReason: null,
          revisionCategory: null,
          submissionVersion: rejected.submissionVersion + 1,
          thumbnailUrl: null,
          tiktokVideoId: null,
          reviewCycleId: null,
        })
        .where(eq(deliverable.id, rejected.id))
        .returning();
      await recordEvent(updated, rows.length);

      return {
        submissionVersion: updated.submissionVersion,
        videoOrdinal: updated.videoOrdinal,
        previousThumbnailUrl: rejected.thumbnailUrl,
        id: rejected.id,
        submittedAt,
        submitted: rows.length,
        remaining: videoCount - rows.length,
      };
    }

    if (rows.length >= videoCount) {
      // Unreachable through the action: a full deal is `delivered` and
      // `canDeliver` refused before this ran. Reaching it means the row set and
      // the status disagree, and quietly adding video four to a three-video deal
      // is the failure this whole ticket exists to remove.
      throw new Error(
        `Deal ${dealId} already holds ${rows.length} of ${videoCount} videos`
      );
    }

    const [created] = await tx
      .insert(deliverable)
      .values({
        dealId,
        tiktokUrl,
        submittedAt,
        videoOrdinal: Math.max(0, ...rows.map((v) => v.videoOrdinal)) + 1,
      })
      .returning();

    const submitted = rows.length + 1;
    await recordEvent(created, submitted);
    return {
      submissionVersion: created.submissionVersion,
      videoOrdinal: created.videoOrdinal,
      id: created.id,
      submittedAt: created.submittedAt,
      submitted,
      remaining: videoCount - submitted,
    };
  },
  run: (fn) => withNotifications(fn),
};

/**
 * Submits the live TikTok post URL on behalf of the creator the deal was made
 * to (AC-022).
 *
 * `creatorProfileId` and `actorUserId` come from `guard()`, never from the
 * request body. The client supplies the URL, request identity and expected
 * slot/version state. The route validates their shape; this module checks the
 * current state under the deal lock.
 *
 * **The status guard runs before the write**, and answers with the state
 * machine's own code (see the module header for why it is no longer the
 * transition that supplies it): `DEAL_NOT_FUNDED` for work submitted before the
 * money was held, and the same code for a double-tap on a deal already
 * `delivered`.
 *
 * **The transition fires only on the last video** (F38). One video short and the
 * deal stays where it was, with nothing written to `deal_event` — a partial
 * delivery is not a lifecycle event, and inventing one would put a row in an
 * append-only table for something that did not change (invariant 6).
 */
export interface SubmissionInput {
  creatorProfileId: string;
  actorUserId: string;
  tiktokUrl: string;
  requestId?: string;
  deliverableId?: string | null;
  expectedVersion?: number;
  expectedSubmitted?: number;
}

export async function submitDeliverable(
  dealId: string,
  input: SubmissionInput,
  deps: SubmitDeliverableDeps = defaultDeps
): Promise<SubmitDeliverableResult> {
  try {
    return await deps.run(async (tx, notify) => {
      const row = await deps.loadDeal(tx, dealId, input.creatorProfileId);
      if (!row) {
        return { ok: false, reason: 'not_found' };
      }
      const replay = await deps.replay?.(tx, dealId, input, row.videoCount);
      if (replay) return replay;

      // AC-022 and AC-4. `canDeliver` is `{funded, revision_requested}` read off
      // `LEGAL_TRANSITIONS`, so this gate cannot outlive the edge that permits it,
      // and the refusal carries the code the machine itself would have produced for
      // the `→ delivered` attempt rather than one this module chose.
      if (!canDeliver(row.status)) {
        return {
          ok: false,
          reason: 'illegal',
          code: getErrorCodeForInvalidTransition(row.status, 'delivered'),
        };
      }

      const submittedAt = new Date();
      const progress = await deps.recordSubmission(
        tx,
        dealId,
        row.videoCount,
        input.tiktokUrl,
        submittedAt,
        input
      );

      // One video short: the deal keeps its status, the brand is not told, and
      // its video evidence is already recorded, but no deal transition is
      // appended. The creator's screen reports partial progress.
      if (progress.remaining > 0) {
        return {
          ok: true,
          dealId,
          deliverableId: progress.id,
          submittedAt: progress.submittedAt,
          status: row.status as 'funded' | 'revision_requested',
          submitted: progress.submitted,
          videoCount: row.videoCount,
          submissionVersion: progress.submissionVersion,
          videoOrdinal: progress.videoOrdinal,
          previousThumbnailUrl: progress.previousThumbnailUrl,
        };
      }

      // The last video completes the delivery, so now there is a transition to
      // make. Still inside the same transaction as every row written above: a
      // refused transition takes the submissions with it rather than leaving a
      // deal whose videos are all in and whose status says otherwise.
      await deps.transition(
        tx,
        dealId,
        input.actorUserId,
        SUBMIT_DELIVERABLE_EVENT_REASON,
        submittedAt
      );
      await deps.ready?.(tx, dealId, input.actorUserId, submittedAt);

      // AC-6, and once per deal rather than once per video. The brand's `user.id`,
      // resolved through `brand_profile` in the load above. Inside the transaction,
      // so a rollback takes the row with it and the email is never queued.
      await notify(row.brandUserId, 'deliverable_submitted', {
        dealId,
        deliverableId: progress.id,
        campaignTitle: row.campaignName,
      });

      return {
        ok: true,
        dealId,
        deliverableId: progress.id,
        submittedAt: progress.submittedAt,
        submissionVersion: progress.submissionVersion,
        videoOrdinal: progress.videoOrdinal,
        previousThumbnailUrl: progress.previousThumbnailUrl,
        status: 'delivered',
        submitted: progress.submitted,
        videoCount: row.videoCount,
      };
    });
  } catch (error) {
    if (error instanceof TransitionError || error instanceof VersionConflict)
      return { ok: false, reason: 'illegal', code: error.code };
    throw error;
  }
}
