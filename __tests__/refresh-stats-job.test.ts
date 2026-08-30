import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  REFRESH_BATCH_SIZE,
  runRefreshCreatorStats,
} from '@/lib/creators/refresh-stats-job';
import type { RefreshJobDeps } from '@/lib/creators/refresh-stats-job';
import type { RefreshStatsResult } from '@/lib/creators/refresh-stats';

/**
 * The weekly stats re-pull job (phase 3). The tier consequences live in
 * `refresh-stats.test.ts`; here the harness contract is what's under test —
 * bounded batch, per-creator isolation, abort between creators.
 */

const NOW = new Date('2026-09-01T00:00:00.000Z');

function okResult(): RefreshStatsResult {
  return {
    ok: true,
    stats: { followerCount: 1000, engagementRate: '1.00' },
    refreshedAt: NOW,
    tier: { kind: 'unchanged' },
  };
}

function jobDeps(overrides: Partial<RefreshJobDeps> = {}): RefreshJobDeps {
  return {
    listDue: async () => [{ userId: 'u1' }, { userId: 'u2' }],
    refresh: async () => okResult(),
    now: () => NOW,
    ...overrides,
  };
}

describe('runRefreshCreatorStats', () => {
  it('asks for at most the batch size, oldest first', async () => {
    const listDue = vi.fn(async () => []);
    await runRefreshCreatorStats(undefined, jobDeps({ listDue }));
    expect(listDue).toHaveBeenCalledWith(REFRESH_BATCH_SIZE, NOW);
  });

  it('refreshes every due creator and counts the writes', async () => {
    const refresh = vi.fn(async () => okResult());
    const output = await runRefreshCreatorStats(
      undefined,
      jobDeps({ refresh })
    );
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenNthCalledWith(1, 'u1');
    expect(refresh).toHaveBeenNthCalledWith(2, 'u2');
    expect(output).toEqual({ examined: 2, acted: 2 });
  });

  it('counts a not-ok refresh as examined but not acted', async () => {
    const refresh = vi
      .fn<RefreshJobDeps['refresh']>()
      .mockResolvedValueOnce({ ok: false, error: 'fetch_failed' })
      .mockResolvedValueOnce(okResult());
    const output = await runRefreshCreatorStats(
      undefined,
      jobDeps({ refresh })
    );
    // The failed creator is unstamped and selected again tomorrow.
    expect(output).toEqual({ examined: 2, acted: 1 });
  });

  it('isolates a throwing creator — the rest of the batch still refreshes', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refresh = vi
      .fn<RefreshJobDeps['refresh']>()
      .mockRejectedValueOnce(new Error('token revoked'))
      .mockResolvedValueOnce(okResult());

    const output = await runRefreshCreatorStats(
      undefined,
      jobDeps({ refresh })
    );

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(output).toEqual({ examined: 2, acted: 1 });
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it('stops between creators when the run is aborted', async () => {
    const controller = new AbortController();
    const refresh = vi.fn(async () => {
      // Abort fires mid-batch: after the first creator's own transaction.
      controller.abort();
      return okResult();
    });

    const output = await runRefreshCreatorStats(
      controller.signal,
      jobDeps({ refresh })
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(output).toEqual({ examined: 1, acted: 1 });
  });

  it('is registered in the cron route, after the notification passes', () => {
    // Same guard style as the harness tests: every route test injects
    // `runJobs`, so only reading the source catches an emptied registry.
    const routeSource = readFileSync('app/api/cron/route.ts', 'utf8');
    expect(routeSource).toMatch(
      /jobsToRun:\s*Job\[\]\s*=\s*\[\s*expireOffersJob,\s*metricRemindersJob,\s*refreshCreatorStatsJob,?\s*\]/
    );
  });
});
