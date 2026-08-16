import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { notification } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { METRICS_REMINDER_MS } from '@/lib/config/pricing';
import { listDeliverablesAwaitingMetrics } from '@/lib/deals/pending-metrics';
import type { PendingMetricRow } from '@/lib/deals/pending-metrics';
import { withNotifications } from '@/lib/notifications/notify';
import type { Notify } from '@/lib/notifications/notify';
import type { Job, JobRunOutput } from '@/lib/scheduler/harness';

/**
 * The metric-reminder sweep (KAN-57, Tech Spec §5 — the scheduler's second
 * pass, beside offer expiry).
 *
 * KAN-50 built the read (`lib/deals/pending-metrics.ts`): completed deals
 * whose video is still unmeasured past the window. This is the consumer that
 * read was built for — the pass that tells the creator, so a brand's campaign
 * dashboard fills in without the brand chasing anyone (AC-027's final bullet).
 *
 * **The reminder is a notification, not a state change.** The deal stays
 * `completed`; nothing about the machine moves. That is the whole difference
 * from `expire-offers`, and it is why idempotency cannot be inherited from a
 * transition. It has to come from the `notification` table instead, which is
 * exactly where `pending-metrics.ts`'s header said it would: "KAN-57 can ask
 * the notification table whether it has already told this creator."
 *
 * **Once per interval, not once per run (AC-2, AC-5, AC-7).** Before notifying,
 * the pass asks whether a `metric_reminder` row already exists for this creator
 * younger than `METRICS_REMINDER_MS` — the same 7-day window the sweep measures
 * from. A re-run inside the interval finds that row and skips (AC-5); a creator
 * with several overdue videos gets one reminder, naming the oldest, because
 * every later deal's transaction sees the first one's row (AC-7). When the
 * interval has passed and the metrics are still missing, the row is no longer
 * younger than the window and the creator is reminded again — reconciliation,
 * not bookkeeping, exactly like the sweep that selected them.
 *
 * **The guard counts delivered reminders, not rows (KAN-57 review, F3).** A
 * row is written when the transaction commits; the email goes out after. If
 * dispatch fails — or the process dies before flush — the row exists but the
 * creator never saw it, and suppressing on the bare row would lose the reminder
 * for the whole interval. `hasReminderSince` therefore requires
 * `notification.delivered_at` to be set: an undelivered row is "never told",
 * and the next run reminds again. The `delivered_at` stamp is written by the
 * notify service after a successful send (see `notify.ts`), and the failure
 * direction is safe — a lost stamp means one mail twice at worst, never a
 * reminder believed sent.
 *
 * **The check and the notify share a transaction.** `withNotifications` writes
 * the row inside the caller's transaction and flushes the email only after it
 * commits, so a reminder that rolls back leaves no row and no mail. Two
 * sequential runs cannot double-send: the second run's check reads the first
 * run's committed row. A *concurrent* duplicate run could race the
 * check-then-insert, but the scheduler fires one instance on a schedule and
 * never retries a failed cron (harness contract), so the race is not reachable
 * in production — documented rather than engineered around.
 *
 * **No `guard()`.** The same exemption `expire-offers.ts` documents: a cron run
 * has no session and no user to own these rows, and the boundary is the shared
 * secret on `/api/cron`, one layer out. This module is not exported through
 * `lib/deals/index.ts`, so no request-scoped caller can pick it up.
 *
 * **The clock comes from the run, once.** `now` is read a single time at the
 * top and drives both the selection cutoff and the interval's "since" bound, so
 * one pass cannot disagree with itself about the boundary (the rule
 * `pending-metrics.ts` documents for its own `now` argument).
 *
 * **`examined` vs `acted`.** `examined` is what the predicate matched, `acted`
 * the reminders actually raised. The difference is the idempotency guard
 * firing — an operator reading the log can see a re-run skipping rows rather
 * than the pass pretending the work was fresh.
 */
export const METRIC_REMINDERS_JOB_NAME = 'metric-reminders';

/** The notification type this pass raises — named once, used in both queries. */
const METRIC_REMINDER_TYPE = 'metric_reminder' as const;

export type ReminderOutcome = 'reminded' | 'skipped' | 'failed';

export interface MetricRemindersDeps {
  /**
   * The overdue list, oldest first — `listDeliverablesAwaitingMetrics`, which
   * owns the predicate (completed + unmeasured + past the window). Reused, not
   * reimplemented, so this pass cannot drift from the definition of
   * "unmeasured" the dashboard renders.
   */
  selectAwaiting: (now: Date) => Promise<PendingMetricRow[]>;
  /**
   * True when this creator was already **delivered** a reminder within the
   * interval.
   *
   * Runs inside the same transaction as the notify it guards, so the check and
   * the row commit together — the whole reason re-running inside the interval
   * resends nothing (AC-5). The delivered-at requirement is the F3 fix: a row
   * whose email failed dispatch must not suppress the next run.
   */
  hasReminderSince: (
    tx: Tx,
    creatorUserId: string,
    since: Date
  ) => Promise<boolean>;
  /** One transaction per reminder — `withNotifications`. */
  run: <T>(fn: (tx: Tx, notify: Notify) => Promise<T>) => Promise<T>;
  log: Pick<Console, 'error'>;
  now: () => Date;
}

const defaultDeps: MetricRemindersDeps = {
  selectAwaiting: (now) => listDeliverablesAwaitingMetrics(now),
  hasReminderSince: async (tx, creatorUserId, since) => {
    const [row] = await tx
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.userId, creatorUserId),
          eq(notification.type, METRIC_REMINDER_TYPE),
          gte(notification.createdAt, since),
          // F3: only a delivered reminder has served the interval. An
          // undelivered one (dispatch failed, or the process died before
          // flush) is "never told", so the next run may remind again.
          isNotNull(notification.deliveredAt)
        )
      )
      .limit(1);
    return row !== undefined;
  },
  run: (fn) => withNotifications(fn),
  log: console,
  now: () => new Date(),
};

/**
 * Reminds one creator about one overdue video, in one transaction.
 *
 * `skipped` is not a degraded `reminded`: it is the idempotency guard firing —
 * the interval has already been served, so the sweep behaving correctly. The
 * reminder names the most overdue qualifying video (rows arrive oldest first),
 * which is also the deal the creator should act on first.
 */
async function remindOne(
  row: PendingMetricRow,
  deps: MetricRemindersDeps,
  now: Date
): Promise<ReminderOutcome> {
  try {
    return await deps.run(async (tx, notify) => {
      const since = new Date(now.getTime() - METRICS_REMINDER_MS);

      if (await deps.hasReminderSince(tx, row.creatorUserId, since)) {
        return 'skipped';
      }

      await notify(row.creatorUserId, METRIC_REMINDER_TYPE, {
        dealId: row.dealId,
        campaignTitle: row.campaignName,
      });

      return 'reminded';
    });
  } catch (error) {
    // One failing reminder does not abort the sweep (the harness's per-job
    // isolation would cover it, but the per-deal boundary is the finer one, the
    // same unit `expire-offers` uses). Logged with the deal id for the operator
    // (KAN-56 AC-7) and nothing else — no row content, so no PII (NFR-010).
    // The row is still unmeasured at the next run, so nothing is lost.
    deps.log.error(
      JSON.stringify({
        level: 'error',
        event: 'metric_reminders.deal_failed',
        job: METRIC_REMINDERS_JOB_NAME,
        dealId: row.dealId,
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      })
    );
    return 'failed';
  }
}

/**
 * Reminds the creators owed metrics, once per interval (AC-1, AC-2).
 *
 * Sequential rather than concurrent, for the same reason as `expireOffers`: a
 * batch of 200 transactions would exhaust a `max: 5` pool and turn the sweep's
 * own connections into the failure. The work is small and the window is 290
 * seconds.
 */
export async function metricReminders(
  deps: MetricRemindersDeps = defaultDeps,
  signal?: AbortSignal
): Promise<JobRunOutput> {
  const now = deps.now();
  // The batch bound lives inside the pending-metrics read
  // (`METRICS_REMINDER_BATCH_LIMIT`), so the number is written once and this
  // pass cannot retype it.
  const rows = await deps.selectAwaiting(now);

  let acted = 0;
  let examined = 0;

  for (const row of rows) {
    // Honoured between reminders rather than inside one: a transaction is not
    // interruptible without leaving the row half-written, so the signal is
    // checked at the only boundary where stopping is safe. Whatever is left is
    // still overdue at the next run.
    if (signal?.aborted) break;

    examined += 1;
    if ((await remindOne(row, deps, now)) === 'reminded') {
      acted += 1;
    }
  }

  return { examined, acted };
}

/**
 * The scheduler's registration for this pass (KAN-56 AC-003).
 *
 * A `Job`, so the harness owns the timing, the counters, the per-job isolation
 * and the log line. This module owns only what reminding a creator means.
 */
export const metricRemindersJob: Job = {
  name: METRIC_REMINDERS_JOB_NAME,
  run: (signal) => metricReminders(defaultDeps, signal),
};
