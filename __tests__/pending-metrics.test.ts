import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  METRICS_REMINDER_BATCH_LIMIT,
  awaitingMetricsQuery,
  buildAwaitingMetricsWhere,
  listDeliverablesAwaitingMetrics,
} from '../lib/deals/pending-metrics';
import type {
  PendingMetricRow,
  PendingMetricsDeps,
} from '../lib/deals/pending-metrics';
import { LEGAL_TRANSITIONS } from '../lib/deals/state-machine';
import {
  METRICS_REMINDER_DAYS,
  METRICS_REMINDER_MS,
  metricsOverdueBefore,
} from '../lib/config/pricing';
import { db } from '../db';
import { deal } from '../db/schema';

/**
 * KAN-50 — completed videos nobody has measured (US-009, AC-027 final bullet,
 * NFR-011, Tech Spec §5 Metrics Service).
 *
 * The reminder half of AC-027. The dashboard says `Metrics pending` truthfully;
 * this is what stops it saying so forever, and like every scheduler read it runs
 * against a table nobody is looking at — so each of its failure modes is silent by
 * default and has to be asserted rather than noticed.
 *
 * **The predicate is the whole of it, so the predicate is what is tested.** There
 * is no transition, no write and no notification here (AC-027 asks that the row be
 * "flagged for a reminder (feeds the scheduler's second pass)", and KAN-57 owns the
 * job, the notification type and the email). What that leaves is a question of
 * *which rows*, answered against the emitted SQL — checkable without a database,
 * and the only form in which "did this clause survive the next edit" is checkable
 * at all.
 *
 * **Overdue is measured from the deal's completion event.** Not from
 * `deliverable.reviewed_at`, which looks like the obvious anchor but is not one:
 * `submit-deliverable.ts` writes `review_status = 'pending'`,
 * `reject-deliverable.ts` writes `'rejected'`, and the approval path sets
 * `'approved'` inside `payoutForDeal`'s transaction (KAN-55) — but deals
 * completed before that fix have no `reviewed_at`, and no back-fill can recover
 * which of them were approved. A predicate on `review_status = 'approved'` would
 * skip every one of them, with nothing failing — so one test below pins the
 * anchor that does exist and says why.
 *
 * **Two shapes of missing.** No `video_metric` row, or a row holding four nulls.
 * The second is reachable because `updateMetricsSchema` accepts any subset, and it
 * has to agree with `toCampaignTotals`'s notion of unmeasured or a brand reads
 * `Metrics pending` on a video this sweep believes is done.
 *
 * **A recorded `0` is a measurement.** That is the distinction the whole ticket
 * rests on, and it means a video with `views = 0` and three nulls is left alone.
 */

/** When the run started, and the cutoff it derives — kept distinct on purpose. */
const NOW = new Date('2026-08-16T12:00:00.000Z');
const CUTOFF = metricsOverdueBefore(NOW);

const compiled = () =>
  db.select().from(deal).where(buildAwaitingMetricsWhere(CUTOFF)).toSQL();

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const MODULE = 'lib/deals/pending-metrics.ts';
const SOURCE = readFileSync(MODULE, 'utf8');
const CODE = stripComments(SOURCE);

const pendingRow = (
  over: Partial<PendingMetricRow> = {}
): PendingMetricRow => ({
  deliverableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  dealId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  creatorUserId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  campaignName: 'Ramadan Beauty Push',
  creatorHandle: '@selam',
  completedAt: new Date('2026-08-01T00:00:00.000Z'),
  ...over,
});

const recordingDeps = (
  rows: PendingMetricRow[] = [pendingRow()]
): {
  deps: PendingMetricsDeps;
  seen: Array<{ cutoff: Date; limit: number }>;
} => {
  const seen: Array<{ cutoff: Date; limit: number }> = [];
  return {
    seen,
    deps: {
      selectAwaiting: async (cutoff, limit) => {
        seen.push({ cutoff, limit });
        return rows;
      },
    },
  };
};

// ---------------------------------------------------------------------------
// The window — a configured value, subtracted from the run's own clock
// ---------------------------------------------------------------------------

describe('the configured window', () => {
  it('is seven days, matching the offer window a creator already knows', () => {
    // A product decision with no document behind it, so what is asserted is that
    // it exists in one importable place rather than what the number happens to be
    // — `pricing-config.test.ts`'s reasoning about the tier prices.
    expect(METRICS_REMINDER_DAYS).toBe(7);
    expect(METRICS_REMINDER_MS).toBe(
      METRICS_REMINDER_DAYS * 24 * 60 * 60 * 1000
    );
  });

  it('subtracts, where the offer window adds', () => {
    // Nothing stores a metrics deadline, so the sweep walks the clock backwards to
    // a cutoff instead of comparing a stored future instant. One fewer column, and
    // no nullable deadline that a missing value could make unreachable.
    expect(metricsOverdueBefore(NOW).toISOString()).toBe(
      '2026-08-09T12:00:00.000Z'
    );
  });

  it('takes the clock as an argument rather than reading it', () => {
    // Hobby cron fires anywhere in the scheduled hour, so a window derived from
    // the schedule rather than the run's own clock chases creators early.
    const a = metricsOverdueBefore(new Date('2026-08-16T00:47:00.000Z'));
    const b = metricsOverdueBefore(new Date('2026-08-16T00:58:00.000Z'));
    expect(a.getTime()).toBeLessThan(b.getTime());
  });

  it('is imported, never restated', () => {
    // A second copy of "7 days" here could drift from the one the reminder email
    // will quote, and the creator would be chased at one interval and told another.
    expect(CODE).toContain('metricsOverdueBefore');
    expect(CODE).not.toMatch(/METRICS_REMINDER_(DAYS|MS)\s*=/);
    expect(CODE).not.toMatch(/7\s*\*\s*24|604800000|604_800_000/);
  });
});

// ---------------------------------------------------------------------------
// AC-027 final bullet — which rows are overdue
// ---------------------------------------------------------------------------

describe('buildAwaitingMetricsWhere — the predicate', () => {
  it('selects completed deals only, by naming the status rather than the exclusions', () => {
    const { sql, params } = compiled();

    expect(sql).toMatch(/"deal"\."status" = \$/);
    expect(params).toContain('completed');
    // A `refunded` deal is owed no metrics and an earlier one is not owed them
    // yet. Both fall out of naming the one status that qualifies, which cannot go
    // stale the way a list of statuses to skip would when a new one is added.
    expect(params).not.toContain('refunded');
    expect(params).not.toContain('delivered');
  });

  it('takes its clock from the completion event, not the deliverable row', () => {
    const { sql, params } = compiled();

    expect(sql).toMatch(/"deal_event"\."to_status" = \$/);
    expect(sql).toMatch(/"deal_event"\."created_at" < \$/);
    expect(params.filter((p) => p === 'completed')).toHaveLength(2);
  });

  it('does not anchor on review_status, which not every completed deal has', () => {
    // The trap this module exists on the far side of. `payoutForDeal` has set
    // `review_status = 'approved'` since KAN-55, but deals completed before that
    // fix were never marked — so a predicate on 'approved' silently skips every
    // older completed deal instead of finding it.
    expect(compiled().params).not.toContain('approved');
    expect(CODE).not.toContain('reviewStatus');
    expect(CODE).not.toContain('reviewedAt');
  });

  it('compares strictly before the cutoff, so the boundary belongs to the creator', () => {
    // `<`, matching `buildLapsedOffersWhere`: a video completed exactly one window
    // ago has had its whole window and is not yet late.
    expect(compiled().sql).toMatch(/< \$/);
    expect(compiled().sql).not.toMatch(/<= \$/);
  });

  it('binds the cutoff rather than inlining it', () => {
    const { sql, params } = compiled();

    expect(sql).not.toContain('2026-08-09');
    expect(params.map(String)).toContain(CUTOFF.toISOString());
  });

  it('treats a missing metric row and a row of four nulls alike', () => {
    const { sql } = compiled();

    // The first is the ordinary case; the second is reachable because
    // `updateMetricsSchema` accepts any subset, so a request can create the row
    // without recording a count. Dropping the second clause is the edit this
    // assertion exists to fail on.
    expect(sql).toMatch(/"video_metric"\."id" is null/i);
    for (const key of ['views', 'likes', 'shares', 'comments']) {
      expect(sql).toMatch(new RegExp(`"video_metric"\\."${key}" is null`, 'i'));
    }
  });

  it('requires all four counts to be null, not any of them', () => {
    const { sql } = compiled();
    const nulls = sql.slice(sql.indexOf('"video_metric"."views" is null'));

    // `and`, not `or`. A row with views recorded and comments blank is measured —
    // `toCampaignTotals` counts it, the dashboard shows the views, and chasing the
    // creator for it would be a reminder about a number they already sent.
    expect(nulls).toMatch(/is null and .*is null and .*is null/i);
    expect(nulls).not.toMatch(/is null or /i);
  });

  it('leaves a recorded zero alone', () => {
    // Asserted as the absence of a comparison: the predicate tests nullity only,
    // so `views = 0` is measured. A `= 0` or a `coalesce(..., 0)` here would chase
    // a creator whose video genuinely got no engagement.
    const { sql, params } = compiled();
    expect(sql).not.toMatch(/"views" = /);
    expect(sql).not.toContain('coalesce');
    expect(params).not.toContain(0);
  });
});

describe('awaitingMetricsQuery — the shape of the read', () => {
  const { sql, params } = awaitingMetricsQuery(
    CUTOFF,
    METRICS_REMINDER_BATCH_LIMIT
  ).toSQL();

  it('left-joins only the table whose absence it is looking for', () => {
    expect(sql).toMatch(/left join "video_metric"/i);
    expect(sql.match(/left join/gi)).toHaveLength(1);
  });

  it('inner-joins the four rows that cannot miss', () => {
    // `deal`, `campaign` and `creator_profile` hang off `not null` foreign keys.
    // `deal_event` is inner too and that is load-bearing rather than incidental —
    // see the terminality assertion below.
    for (const table of ['deal', 'campaign', 'creator_profile', 'deal_event']) {
      expect(sql).toMatch(new RegExp(`inner join "${table}"`, 'i'));
    }
    expect(sql.match(/inner join/gi)).toHaveLength(4);
  });

  it('cannot fan out, because completed is terminal', () => {
    // The join to `deal_event` yields exactly one row per deal: `completed` has no
    // outbound edge, so a deal enters it at most once, and `deal.status =
    // 'completed'` guarantees the event exists. An edge added out of `completed`
    // would silently double every reminder — it fails here instead, and points at
    // the query that assumed otherwise.
    expect(LEGAL_TRANSITIONS.completed).toEqual([]);
    expect(LEGAL_TRANSITIONS.delivered).toContain('completed');
  });

  it('reaches the creator’s user id, not their profile id', () => {
    // The two-hop rule. `deal.creator_id` is a profile id, and a notification row
    // addressed to one is a row nobody can read.
    expect(sql).toContain('"user_id"');
    expect(CODE).toContain('creatorUserId: creatorProfile.userId');
  });

  it('selects no contact column (NFR-010)', () => {
    // The handle names the video for whoever is chasing it. How the reminder
    // reaches the creator is the notification layer's business, and a scheduler log
    // is the last place an email address should be able to appear.
    expect(sql).toContain('"tiktok_handle"');
    expect(sql).not.toMatch(/"email"|"phone"/);
  });

  it('drains a backlog oldest-first, bounded', () => {
    expect(sql).toMatch(/order by "deal_event"\."created_at" asc/i);
    expect(sql).toMatch(/limit \$/i);
    expect(params).toContain(METRICS_REMINDER_BATCH_LIMIT);
  });

  it('bounds the batch below the watchdog’s reach', () => {
    // The harness kills a run at 290 seconds, so a first pass over a
    // long-ignored table must not be unbounded work for whoever consumes the list.
    // Reconciliation makes the remainder cheap to leave.
    expect(METRICS_REMINDER_BATCH_LIMIT).toBeGreaterThan(0);
    expect(METRICS_REMINDER_BATCH_LIMIT).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// The boundary, against an injected clock
// ---------------------------------------------------------------------------

describe('listDeliverablesAwaitingMetrics — the boundary', () => {
  const completedAt = new Date('2026-08-01T00:00:00.000Z');
  const exactly = new Date(completedAt.getTime() + METRICS_REMINDER_MS);

  const cutoffFor = async (now: Date) => {
    const { deps, seen } = recordingDeps();
    await listDeliverablesAwaitingMetrics(now, deps);
    return seen[0].cutoff;
  };

  it('is not yet due at exactly one window', async () => {
    // The cutoff equals the completion instant, and the predicate is strictly
    // before it. A creator who is told they are late on the last minute of the
    // window they were given would be right to complain.
    expect((await cutoffFor(exactly)).getTime()).toBe(completedAt.getTime());
  });

  it('is due one second later', async () => {
    const cutoff = await cutoffFor(new Date(exactly.getTime() + 1_000));
    expect(cutoff.getTime()).toBeGreaterThan(completedAt.getTime());
  });

  it('passes the run’s clock through, and the configured limit with it', async () => {
    const { deps, seen } = recordingDeps();

    await listDeliverablesAwaitingMetrics(NOW, deps);

    expect(seen).toEqual([
      {
        cutoff: CUTOFF,
        limit: METRICS_REMINDER_BATCH_LIMIT,
      },
    ]);
  });

  it('requires the clock rather than defaulting it', () => {
    // One pass must not be able to read the clock twice and disagree with itself
    // about the boundary. `metricsOverdueBefore` defaults its own parameter; this
    // deliberately does not.
    expect(CODE).toMatch(/listDeliverablesAwaitingMetrics\(\s*now: Date,/);
    expect(CODE).not.toMatch(/now: Date = new Date\(\)/);
  });

  it('returns the rows a reminder needs to name the video', async () => {
    const { deps } = recordingDeps([pendingRow()]);

    const rows = await listDeliverablesAwaitingMetrics(NOW, deps);

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'campaignName',
      'completedAt',
      'creatorHandle',
      'creatorUserId',
      'dealId',
      'deliverableId',
    ]);
  });

  it('treats an empty result as the ordinary answer', async () => {
    const { deps } = recordingDeps([]);

    // Nothing overdue is the state this sweep should be in most days, and it is
    // not a failed read.
    await expect(listDeliverablesAwaitingMetrics(NOW, deps)).resolves.toEqual(
      []
    );
  });
});

// ---------------------------------------------------------------------------
// Scope — this reads, and KAN-57 acts
// ---------------------------------------------------------------------------

describe('structural guards', () => {
  it('nudges nobody', () => {
    // AC-027 asks that the row be flagged for a reminder; feeding the list is the
    // deliverable, and the job, the notification type and the email are KAN-57's.
    // A notification sent from here would also be sent again on the next run,
    // because reconciliation deliberately keeps no record of having sent one.
    expect(CODE).not.toMatch(/notify|createNotification|withNotifications/);
    expect(CODE).not.toMatch(/\bJob\b/);
    expect(CODE).not.toMatch(/resend|sendEmail/i);
  });

  it('writes nothing at all', () => {
    // No "reminded" column, and none needed: the predicate describes what is still
    // true, so a duplicate cron delivery re-selects the same rows and a run that
    // missed its slot finds them waiting. KAN-57 can ask the `notification` table
    // whether this creator has already been told.
    expect(CODE).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(CODE).not.toContain('transitionDeal');
  });

  it('opens no transaction, because it changes nothing', () => {
    expect(CODE).not.toMatch(/db\.transaction|withTransaction/);
  });

  it('takes no session and no role guard, because there is no user (NFR-005)', () => {
    // The authentication boundary is the shared secret on `/api/cron`, one layer
    // out — the same exemption `expire-offers.ts` documents at greater length.
    expect(CODE).not.toMatch(/\bguard\(/);
    expect(CODE).not.toMatch(/requireRole|getSession/);
  });

  it('is reachable from the scheduler and tests only', () => {
    // Not exported through the barrel, so no request-scoped caller can pick it up
    // by accident and read across every brand's campaigns without a session.
    expect(readFileSync('lib/deals/index.ts', 'utf8')).not.toContain(
      'pending-metrics'
    );
  });

  it('says in prose why the anchor is the event and not the deliverable', () => {
    // The one thing a reader needs and cannot see from the code: the obvious
    // column is not reliably present — written on approval and rejection, but
    // missing for deals completed before KAN-55. Asserted so the explanation
    // cannot be dropped by an edit that leaves the query working.
    expect(SOURCE).toContain('reviewed_at');
    expect(SOURCE).toMatch(/not every completed deal has it/i);
  });
});

// ---------------------------------------------------------------------------
// The guards can fail
// ---------------------------------------------------------------------------

describe('the source guards are not vacuous', () => {
  it('reads a source long enough to be the real thing', () => {
    expect(CODE.length).toBeGreaterThan(200);
  });

  it('strips comments before matching', () => {
    // The module documents at length that it must not notify, must not write, and
    // must not guard — so all three names appear in prose and nowhere else. An
    // un-stripped guard would read the explanation as the violation.
    expect(SOURCE).toMatch(/notification/i);
    expect(CODE).not.toMatch(/notification/i);
    // And the strip does not eat real code.
    expect(CODE).toContain('listDeliverablesAwaitingMetrics');
  });

  it('would catch a write', () => {
    const writes = /\.insert\(|\.update\(|\.delete\(/;
    expect('await tx.insert(notification).values({})').toMatch(writes);
    expect('return deps.selectAwaiting(cutoff, limit)').not.toMatch(writes);
  });

  it('would catch a restated window', () => {
    const restated = /7\s*\*\s*24|604800000|604_800_000/;
    expect(
      'const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000)'
    ).toMatch(restated);
    expect('const cutoff = metricsOverdueBefore(now)').not.toMatch(restated);
  });

  it('would catch a defaulted clock', () => {
    const defaulted = /now: Date = new Date\(\)/;
    expect('async function run(now: Date = new Date()) {').toMatch(defaulted);
    expect('async function run(now: Date) {').not.toMatch(defaulted);
  });

  it('reads a real file, so a renamed path fails loudly', () => {
    expect(() => readFileSync('lib/deals/does-not-exist.ts', 'utf8')).toThrow();
  });
});
