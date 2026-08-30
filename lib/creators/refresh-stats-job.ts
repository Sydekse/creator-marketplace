import { and, eq, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { creatorProfile, user } from '@/db/schema';
import { refreshCreatorStats } from '@/lib/creators/refresh-stats';
import type { RefreshStatsResult } from '@/lib/creators/refresh-stats';
import type { Job, JobRunOutput } from '@/lib/scheduler/harness';

/**
 * The weekly stats re-pull (phase 3) — the scheduler's third pass, beside
 * offer expiry and metric reminders.
 *
 * The cron fires daily (vercel.json, `0 0 * * *`); *this job* is what makes
 * the cadence weekly per creator: it selects only verified, TikTok-linked
 * profiles whose `stats_refreshed_at` is null or older than seven days, so
 * each creator is pulled about once a week while the daily runs spread the
 * work out. A manual refresh stamps the same column and naturally pushes that
 * creator's next cron pull out a week.
 *
 * Reconciliation-based, per the harness contract: nothing here counts runs or
 * remembers state — the stamp on the row *is* the state, and a duplicate run
 * finds nothing older than the window and does nothing.
 *
 * **Bounded batch.** At most `REFRESH_BATCH_SIZE` creators per run, oldest
 * stamp first (nulls first — never pulled at all), two TikTok calls each.
 * That caps the run's API cost and keeps it far inside the 290s budget; a
 * backlog larger than the batch simply drains over consecutive daily runs.
 *
 * **Per-creator isolation.** One creator's failed fetch (revoked token,
 * deleted account) must not cost the rest of the batch their refresh — each
 * is caught and counted, not thrown. `examined` is the batch, `acted` is the
 * refreshes that wrote.
 *
 * **No `guard()`.** Same exemption `expire-offers.ts` and `metric-reminders.ts`
 * document: a cron run has no session; the boundary is the shared secret on
 * `/api/cron`. The tier consequences are `refreshCreatorStats`'s — upgrades
 * assign and mail, downgrades only flag — so the button and the cron cannot
 * disagree.
 */

/** At most this many creators per daily run — ≤2× this in TikTok calls. */
export const REFRESH_BATCH_SIZE = 50;

/** A stamp older than this (or absent) makes a creator due for a re-pull. */
export const REFRESH_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface RefreshJobDeps {
  listDue: (limit: number, now: Date) => Promise<Array<{ userId: string }>>;
  refresh: (userId: string) => Promise<RefreshStatsResult>;
  now: () => Date;
}

/**
 * Verified, TikTok-linked, stale-or-never stamped — oldest first.
 *
 * The link test is the same signal the refresh service itself trusts: a
 * non-empty `user.tiktok_handle` (Login Kit sign-ups get one in the
 * `user.create.before` hook; email sign-ups never do). Filtering here saves
 * burning batch slots on creators the service would refuse anyway.
 */
const defaultListDue: RefreshJobDeps['listDue'] = async (limit, now) => {
  const staleBefore = new Date(now.getTime() - REFRESH_STALE_MS);
  return db
    .select({ userId: creatorProfile.userId })
    .from(creatorProfile)
    .innerJoin(user, eq(creatorProfile.userId, user.id))
    .where(
      and(
        eq(creatorProfile.status, 'verified'),
        sql`${user.tiktokHandle} is not null`,
        ne(user.tiktokHandle, ''),
        or(
          isNull(creatorProfile.statsRefreshedAt),
          lte(creatorProfile.statsRefreshedAt, staleBefore)
        )
      )
    )
    .orderBy(sql`${creatorProfile.statsRefreshedAt} asc nulls first`)
    .limit(limit);
};

const defaultDeps: RefreshJobDeps = {
  listDue: defaultListDue,
  // The weekly filter above is the cadence; the 24h button limit is not for
  // the scheduler (and a creator who pressed the button today has a fresh
  // stamp, so the filter already skipped them).
  refresh: (userId) => refreshCreatorStats(userId, { ignoreRateLimit: true }),
  now: () => new Date(),
};

export async function runRefreshCreatorStats(
  signal?: AbortSignal,
  deps: RefreshJobDeps = defaultDeps
): Promise<JobRunOutput> {
  const due = await deps.listDue(REFRESH_BATCH_SIZE, deps.now());

  let acted = 0;
  let examined = 0;
  for (const { userId } of due) {
    // Between creators, not mid-write: each refresh is its own transaction,
    // so stopping here leaves no half-applied row behind.
    if (signal?.aborted) break;
    examined += 1;
    try {
      const result = await deps.refresh(userId);
      if (result.ok) acted += 1;
      // A not-ok result (fetch failed, link revoked since the query) is this
      // creator's problem, not the run's: unstamped, they are selected again
      // tomorrow.
    } catch (error) {
      console.error(
        `[refresh-creator-stats] refresh failed for user ${userId}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return { examined, acted };
}

export const refreshCreatorStatsJob: Job = {
  name: 'refresh-creator-stats',
  run: (signal) => runRefreshCreatorStats(signal),
};
