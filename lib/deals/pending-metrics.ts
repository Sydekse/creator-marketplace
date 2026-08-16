import { and, asc, eq, isNull, lt, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '@/db';
import {
  campaign,
  creatorProfile,
  deal,
  dealEvent,
  deliverable,
  videoMetric,
} from '@/db/schema';
import { metricsOverdueBefore } from '@/lib/config/pricing';

/**
 * Completed videos nobody has measured (KAN-50, US-009, AC-027 final bullet,
 * Tech Spec §5 Metrics Service).
 *
 * The reminder half of AC-027: the dashboard says `Metrics pending` truthfully,
 * and this is what stops it saying so forever. Metrics are entered by hand in the
 * MVP, so a video that nobody remembers to measure stays pending with nothing in
 * the system noticing — and the brand who paid for it is left reading an honest
 * blank instead of numbers.
 *
 * **A read, and only a read.** The AC asks that an overdue deliverable be
 * "flagged for a reminder (feeds the scheduler's second pass)", and feeding it is
 * the deliverable here. The `Job`, the notification type and the email are
 * KAN-57's — `app/api/cron/route.ts` already names it as the entry that joins
 * `expire-offers` later. Nothing in this module writes anything, and the suite
 * asserts that rather than trusting it.
 *
 * **Overdue is measured from the deal's completion event, not from the
 * deliverable row.** `deliverable.reviewed_at` looks like the natural anchor and
 * is not one: **not every completed deal has it.** `submit-deliverable.ts`
 * writes `review_status = 'pending'`, `reject-deliverable.ts` writes `'rejected'`
 * with `reviewed_at`, and the approval path sets `'approved'` inside
 * `EscrowLedgerService.payoutForDeal`'s transaction (KAN-55) — but deals
 * completed before that fix were never marked, and no back-fill can recover which
 * of them were approved. A predicate written against `review_status = 'approved'`
 * would silently skip every one of those rows — the same species of quiet
 * nothing as an offer issued with no expiry.
 *
 * `deal_event` is the honest source and arguably the better one. It is
 * append-only (invariant 5), every transition writes one as it happens (invariant
 * 6), and the row recording `to_status = 'completed'` *is* the moment the brand
 * approved. It also catches the completion an admin release produces
 * (`resolve-dispute.ts`), which is equally a video owed metrics and which no
 * deliverable column marks either.
 *
 * **Reconciliation, not bookkeeping.** The predicate describes what is still
 * true, so a duplicate cron delivery re-selects the same rows and a run that
 * missed its slot finds them waiting. Nothing is marked as "reminded", and no
 * column needs adding for it: KAN-57 can ask the `notification` table whether it
 * has already told this creator. That is the harness's rule (KAN-56) and it is
 * why this takes `now` as an argument — Vercel's Hobby cron fires anywhere inside
 * the scheduled hour, so a window computed from the schedule rather than the
 * clock would chase people early.
 *
 * **No `guard()`, deliberately.** There is no session on a cron run and no user
 * to own these rows; the authentication boundary is the shared secret on
 * `/api/cron`, one layer out. `expire-offers.ts` documents the same exemption at
 * greater length. What keeps it from being a hole is the same thing: this module
 * is reachable from the scheduler and from tests, and from nowhere else — it is
 * not exported to any request-scoped caller.
 */

/** What a reminder needs to name the video and reach the person who owes it. */
export interface PendingMetricRow {
  deliverableId: string;
  dealId: string;
  /**
   * `user.id`, not `creator_profile.id` — the two-hop rule from `lib/authz.ts`.
   *
   * Business rows reference profile ids and notifications address a user, so
   * `deal.creator_id` is walked through `creator_profile.user_id` here rather
   * than at whichever call site sends the reminder. Passing the profile id on
   * would write a notification row nobody can read.
   */
  creatorUserId: string;
  /** So the reminder can say which campaign, without a second read. */
  campaignName: string;
  /** The creator's own handle, for the same reason. Not a contact column (NFR-010). */
  creatorHandle: string;
  /** When the brand approved — the instant the window is measured from. */
  completedAt: Date;
}

/**
 * How many overdue videos one pass reports.
 *
 * A bound rather than the whole backlog, matching `EXPIRE_BATCH_LIMIT`: the
 * scheduler answers to a 290-second watchdog, and a first run over a long-ignored
 * table is unbounded work for whoever consumes this list. Reconciliation makes
 * the remainder cheap to leave — an unmeasured video is still unmeasured at the
 * next run — and the rows come back oldest first, so a backlog drains in the
 * order the videos actually completed.
 */
export const METRICS_REMINDER_BATCH_LIMIT = 200;

/**
 * The overdue predicate, as a `where` clause.
 *
 * Exported so the suite can read each part without a live Postgres, because every
 * one of them is a way for the sweep to be quietly wrong:
 *
 * - `deal.status = 'completed'` — the brand approved and the creator was paid.
 *   Anything earlier is not owed metrics yet; `refunded` is owed none at all,
 *   and both are excluded by naming the one status rather than the ones to skip.
 * - `deal_event.to_status = 'completed'` — supplies the clock. Joined rather than
 *   stored, for the reason in the module header.
 * - `deal_event.created_at < cutoff` — strictly before, so a video completed
 *   *exactly* one window ago has had its window and is not yet late. Compared
 *   against an injected instant, never midnight arithmetic.
 * - **metrics missing, in either of the two shapes it comes in.** No
 *   `video_metric` row at all, or a row holding four nulls. The second is
 *   reachable and easy to forget: `updateMetricsSchema` accepts any subset, so a
 *   request can create the row without recording a count. `toCampaignTotals` in
 *   `lib/campaigns/performance.ts` already treats that row as unmeasured, and the
 *   two definitions of unmeasured have to agree or a brand reads `Metrics
 *   pending` on a video this sweep believes is done.
 *
 * A recorded `0` is *not* missing — it is a measurement, which is the whole
 * distinction AC-027 rests on, so a video with `views = 0` and three nulls is
 * measured and is left alone.
 */
export function buildAwaitingMetricsWhere(cutoff: Date): SQL {
  return and(
    eq(deal.status, 'completed'),
    eq(dealEvent.toStatus, 'completed'),
    lt(dealEvent.createdAt, cutoff),
    or(
      isNull(videoMetric.id),
      and(
        isNull(videoMetric.views),
        isNull(videoMetric.likes),
        isNull(videoMetric.shares),
        isNull(videoMetric.comments)
      )
    )
  ) as SQL;
}

/**
 * The query as a builder rather than a promise, so a test can read the SQL it
 * emits without a database — `campaignVideosQuery`'s shape.
 *
 * `deal`, `campaign` and `creator_profile` are inner joins on `not null` foreign
 * keys, so none can miss. `deal_event` is inner too, and that is load-bearing
 * rather than incidental: `completed` is terminal in `LEGAL_TRANSITIONS`, so a
 * deal enters it at most once and `deal.status = 'completed'` guarantees the event
 * exists — exactly one row, no fan-out. `pending-metrics.test.ts` asserts that
 * terminality, so an edge added out of `completed` fails there and points here
 * instead of quietly doubling every reminder.
 *
 * `video_metric` is the one **left** join, because its absence is half of what
 * this query is looking for.
 */
export function awaitingMetricsQuery(cutoff: Date, limit: number) {
  return db
    .select({
      deliverableId: deliverable.id,
      dealId: deal.id,
      creatorUserId: creatorProfile.userId,
      campaignName: campaign.name,
      creatorHandle: creatorProfile.tiktokHandle,
      completedAt: dealEvent.createdAt,
    })
    .from(deliverable)
    .innerJoin(deal, eq(deliverable.dealId, deal.id))
    .innerJoin(campaign, eq(deal.campaignId, campaign.id))
    .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
    .innerJoin(dealEvent, eq(dealEvent.dealId, deal.id))
    .leftJoin(videoMetric, eq(videoMetric.deliverableId, deliverable.id))
    .where(buildAwaitingMetricsWhere(cutoff))
    .orderBy(asc(dealEvent.createdAt))
    .limit(limit);
}

/** Seam for tests, matching the shape the rest of `lib/deals` uses. */
export interface PendingMetricsDeps {
  selectAwaiting: (cutoff: Date, limit: number) => Promise<PendingMetricRow[]>;
}

const defaultDeps: PendingMetricsDeps = {
  selectAwaiting: (cutoff, limit) => awaitingMetricsQuery(cutoff, limit),
};

/**
 * Completed videos whose metrics window has run out (AC-027 final bullet).
 *
 * `now` is required rather than defaulted, unlike `metricsOverdueBefore`'s own
 * parameter. The only production caller is a scheduler run that already holds the
 * instant it started at, and a default here would let a future caller read the
 * clock twice in one pass and disagree with itself about the boundary.
 *
 * Returns rows rather than sending anything. An empty array is the ordinary
 * answer and means nothing is overdue — not that the read failed.
 */
export async function listDeliverablesAwaitingMetrics(
  now: Date,
  deps: PendingMetricsDeps = defaultDeps
): Promise<PendingMetricRow[]> {
  return deps.selectAwaiting(
    metricsOverdueBefore(now),
    METRICS_REMINDER_BATCH_LIMIT
  );
}
