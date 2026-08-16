import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { METRICS_REMINDER_MS } from '../lib/config/pricing';
import {
  metricReminders,
  metricRemindersJob,
} from '../lib/deals/metric-reminders';
import type { MetricRemindersDeps } from '../lib/deals/metric-reminders';
import type { PendingMetricRow } from '../lib/deals/pending-metrics';

/**
 * KAN-57 — the scheduler's second pass reminds a creator when a completed
 * video is still unmeasured past its window.
 *
 * The read was built by KAN-50 and is tested there (`pending-metrics.test.ts`
 * pins the predicate against emitted SQL). What this suite owns is the
 * *consumer*: who gets reminded, how often, and what makes a re-run a no-op.
 * The idempotency contract — "ask the notification table whether it has
 * already told this creator" — is the whole difference from `expire-offers`,
 * which inherits idempotency from a state transition. There is no transition
 * here, so this is where that behaviour has to be proven.
 */

/** The run's clock, fixed so the interval bound is observable. */
const NOW = new Date('2026-08-16T12:00:00.000Z');

function row(overrides: Partial<PendingMetricRow> = {}): PendingMetricRow {
  return {
    deliverableId: 'dl-1',
    dealId: 'd-1',
    creatorUserId: 'u-creator-a',
    campaignName: 'Spring Coffee Push',
    creatorHandle: '@selam',
    completedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

interface Harness {
  notified: Array<{ userId: string; type: string; payload: unknown }>;
  remindersSince: Array<{ creator: string; since: Date }>;
  deps: MetricRemindersDeps;
  logError: ReturnType<typeof vi.fn>;
}

/**
 * Fakes the notification table the way the real one behaves: `hasReminderSince`
 * reports what has already been recorded, and the notify seam records a
 * reminder the same instant. The real table's rows commit between deals (one
 * transaction each), which is exactly what the per-creator bound relies on.
 *
 * `preReminded` lets a test simulate a *prior run's* committed rows — the AC-5
 * re-run case.
 */
function makeDeps(overrides: Partial<MetricRemindersDeps> = {}): Harness {
  const notified: Harness['notified'] = [];
  const remindersSince: Harness['remindersSince'] = [];
  const alreadyTold = new Set<string>();
  const logError = vi.fn();

  const deps: MetricRemindersDeps = {
    selectAwaiting: async () => [],
    hasReminderSince: async (_tx, creator, since) => {
      remindersSince.push({ creator, since });
      return alreadyTold.has(creator);
    },
    run: async (fn) => {
      const notify = async (userId: string, type: string, payload: unknown) => {
        notified.push({ userId, type, payload });
        alreadyTold.add(userId);
      };
      return fn({} as never, notify as never);
    },
    log: { error: logError },
    now: () => NOW,
    ...overrides,
  };

  return { notified, remindersSince, deps, logError };
}

describe('metricReminders — AC-1: selects completed deals owed metrics', () => {
  it('uses the pending-metrics read rather than reimplementing the predicate', async () => {
    const { deps, notified } = makeDeps({
      selectAwaiting: async () => [row({ dealId: 'd-1' })],
    });

    await expect(metricReminders(deps)).resolves.toEqual({
      examined: 1,
      acted: 1,
    });
    // The row that comes back is the row the reminder names.
    expect(notified).toEqual([
      {
        userId: 'u-creator-a',
        type: 'metric_reminder',
        payload: { dealId: 'd-1', campaignTitle: 'Spring Coffee Push' },
      },
    ]);
  });

  it('sends nothing when nothing is overdue', async () => {
    const { deps, notified } = makeDeps();

    await expect(metricReminders(deps)).resolves.toEqual({
      examined: 0,
      acted: 0,
    });
    expect(notified).toEqual([]);
  });
});

describe('metricReminders — AC-2/AC-5: once per interval, re-runs resend nothing', () => {
  it('skips a creator already reminded within the interval', async () => {
    const { deps, notified } = makeDeps({
      selectAwaiting: async () => [row({ dealId: 'd-1' })],
      hasReminderSince: async () => true,
    });

    await expect(metricReminders(deps)).resolves.toEqual({
      examined: 1,
      acted: 0,
    });
    expect(notified).toEqual([]);
  });

  it('computes the interval bound from the run clock, not a second read', async () => {
    const { deps, remindersSince } = makeDeps({
      selectAwaiting: async () => [row({ dealId: 'd-1' })],
    });

    await metricReminders(deps);

    // `since = now - METRICS_REMINDER_MS` exactly — the same window the sweep
    // measures from, so a reminder is re-eligible the moment it is old.
    expect(remindersSince).toEqual([
      {
        creator: 'u-creator-a',
        since: new Date(NOW.getTime() - METRICS_REMINDER_MS),
      },
    ]);
  });
});

describe('metricReminders — AC-7: at most one reminder per creator per interval', () => {
  it('reminds a creator once even when several of their videos qualify', async () => {
    const { deps, notified } = makeDeps({
      selectAwaiting: async () => [
        row({ dealId: 'd-1' }),
        row({ dealId: 'd-2', campaignName: 'Holiday Fashion' }),
      ],
    });

    await expect(metricReminders(deps)).resolves.toEqual({
      examined: 2,
      acted: 1,
    });
    // The oldest qualifying deal is the one named; the second is skipped
    // because the first's row is already in the (fake) table.
    expect(notified).toHaveLength(1);
    expect(notified[0].payload).toMatchObject({ dealId: 'd-1' });
  });

  it('reminds different creators independently', async () => {
    const { deps, notified } = makeDeps({
      selectAwaiting: async () => [
        row({ dealId: 'd-1', creatorUserId: 'u-a' }),
        row({ dealId: 'd-2', creatorUserId: 'u-b' }),
      ],
    });

    await expect(metricReminders(deps)).resolves.toEqual({
      examined: 2,
      acted: 2,
    });
    expect(notified.map((n) => n.userId).sort()).toEqual(['u-a', 'u-b']);
  });
});

describe('metricReminders — run behaviour', () => {
  it('honours the abort signal between reminders', async () => {
    const { deps } = makeDeps({
      selectAwaiting: async () => [
        row({ dealId: 'd-1' }),
        row({ dealId: 'd-2' }),
        row({ dealId: 'd-3' }),
      ],
    });
    const signal = { aborted: false };

    const first = await metricReminders(deps, signal as AbortSignal);
    signal.aborted = true;
    const second = await metricReminders(deps, signal as AbortSignal);

    expect(first.examined).toBe(3);
    expect(second.examined).toBe(0);
  });

  it('isolates a failing reminder and logs the deal, not the row content', async () => {
    const failing = new Error('db gone');
    const { deps, notified, logError } = makeDeps({
      selectAwaiting: async () => [
        row({ dealId: 'd-1' }),
        row({ dealId: 'd-2' }),
      ],
      run: async () => {
        throw failing;
      },
    });

    await expect(metricReminders(deps)).resolves.toEqual({
      examined: 2,
      acted: 0,
    });
    expect(notified).toEqual([]);
    expect(logError).toHaveBeenCalledTimes(2);
    const line = JSON.parse(String(logError.mock.calls[0][0]));
    expect(line.dealId).toBe('d-1');
    expect(line.message).toBe('db gone');
    expect(JSON.stringify(line)).not.toContain('@selam');
  });

  it('registers as a Job with the scheduler name', () => {
    expect(metricRemindersJob.name).toBe('metric-reminders');
    expect(typeof metricRemindersJob.run).toBe('function');
  });
});

// -- Source guards ----------------------------------------------------------

const SOURCE = readFileSync('lib/deals/metric-reminders.ts', 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
  .trim();
const CRON_ROUTE = readFileSync('app/api/cron/route.ts', 'utf8');

describe('metric-reminders source guards', () => {
  it('reuses the pending-metrics predicate instead of restating it', () => {
    // The definition of "unmeasured" lives in KAN-50's read (and its suite
    // pins it against emitted SQL). This pass must consume that read, never
    // carry its own copy of the predicate — a second copy is a second answer
    // to "is this video owed metrics?".
    expect(SOURCE).toMatch(/listDeliverablesAwaitingMetrics/);
    expect(CODE).not.toMatch(/videoMetric/);
    expect(CODE).not.toMatch(/deal\.status/);
  });

  it('writes nothing except through the notify seam', () => {
    // AC-4: recording metrics clears the pending state — the reminder must not
    // touch metrics or deal rows. All writes flow through the `notify` passed
    // by `withNotifications`.
    expect(CODE).not.toMatch(/\.insert\(/);
    expect(CODE).not.toMatch(/\.update\(/);
    expect(CODE).not.toMatch(/\.delete\(/);
  });

  it('suppresses only delivered reminders (F3)', () => {
    // A row whose email failed dispatch must not silence the next run for the
    // whole interval: the guard requires the notify service's `delivered_at`
    // stamp, so an undelivered row reads as "never told" and the next run
    // reminds again. The stamp itself is written by `notify.ts` and asserted
    // there; this pins that the guard demands it.
    expect(CODE).toMatch(/isNotNull\(notification\.deliveredAt\)/);
    expect(CODE).toMatch(/eq\(notification\.type, METRIC_REMINDER_TYPE\)/);
    expect(CODE).toMatch(/gte\(notification\.createdAt, since\)/);
  });

  it('has no guard(), like every cron-owned sweep', () => {
    // Same exemption expire-offers documents: the boundary is the cron secret,
    // one layer out; this module is not request-scoped.
    expect(CODE).not.toMatch(/guard\(/);
  });

  it('is not exported through the deals barrel', () => {
    expect(readFileSync('lib/deals/index.ts', 'utf8')).not.toContain(
      'metric-reminders'
    );
  });

  it('is registered in the cron route after expire-offers', () => {
    expect(CRON_ROUTE).toMatch(
      /jobsToRun:\s*Job\[\]\s*=\s*\[\s*expireOffersJob,\s*metricRemindersJob/
    );
  });
});

// -- The guards can fail -----------------------------------------------------

describe('the source guards are not vacuous', () => {
  it('reads a source long enough to be the real thing', () => {
    expect(CODE.length).toBeGreaterThan(200);
  });

  it('would catch a reimplemented predicate', () => {
    const restated = /videoMetric/;
    expect('const missing = isNull(videoMetric.views)').toMatch(restated);
    expect('import { listDeliverablesAwaitingMetrics }').not.toMatch(restated);
  });

  it('would catch a direct write', () => {
    const writes = /\.insert\(|\.update\(|\.delete\(/;
    expect('await db.insert(notification).values({})').toMatch(writes);
    expect('await deps.run(async (tx, notify) => {').not.toMatch(writes);
  });

  it('would catch the guard dropping the delivered requirement', () => {
    const withStamp = /isNotNull\(notification\.deliveredAt\)/;
    expect('isNotNull(notification.deliveredAt)').toMatch(withStamp);
    expect('gte(notification.createdAt, since)').not.toMatch(withStamp);
  });

  it('would catch a job dropped from the registry', () => {
    expect(
      'const jobsToRun: Job[] = [expireOffersJob, metricRemindersJob];'
    ).toMatch(/metricRemindersJob/);
    expect('const jobsToRun: Job[] = [expireOffersJob];').not.toMatch(
      /,\s*metricRemindersJob/
    );
  });
});
