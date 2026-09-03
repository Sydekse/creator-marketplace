import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/lib/authz';
import type { Tx } from '@/lib/authz';
import type { RefreshStatsDeps } from '@/lib/creators/refresh-stats';
import type { TierCandidate } from '@/lib/creators/tier-assignment';
import type { NotifyDeps } from '@/lib/notifications/notify';

/**
 * `POST /api/creators/stats/refresh` (phase 3) — the outcome→envelope mapping.
 *
 * The service's own behaviour (rate limit arithmetic, tier asymmetry) is
 * covered in `refresh-stats.test.ts`; here each service outcome is checked
 * against the status, code and headers the route promises.
 */

// `guard` is the only thing replaced; `ForbiddenError` and `toErrorResponse`
// stay real, so the 403 envelope under test is the one production returns.
const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleRefreshStats } =
  await import('../app/api/creators/stats/refresh/route');

const TIERS: TierCandidate[] = [
  {
    id: 'tier-micro',
    name: 'Micro',
    pricePerVideo: 150_000,
    minFollowers: 10_000,
    minEngagement: '2.00',
    active: true,
  },
];

function fakeNotifyDeps(): NotifyDeps {
  const tx = {
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => {}) })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: async () => [{ id: 'n-1' }] })),
    })),
  } as unknown as Tx;
  return {
    db: { transaction: async (fn: (t: Tx) => unknown) => fn(tx) },
    provider: null,
    render: async () => ({ subject: '', text: '', html: '' }),
    log: { info: vi.fn(), error: vi.fn() },
    sleep: async () => {},
  } as unknown as NotifyDeps;
}

const NOW = new Date('2026-09-01T12:00:00.000Z');

function serviceDeps(
  overrides: Partial<RefreshStatsDeps> = {}
): Partial<RefreshStatsDeps> {
  return {
    loadProfile: async () => ({
      id: 'profile-1',
      tierId: null,
      statsRefreshedAt: null,
    }),
    linkedHandle: async () => '@selam',
    fetchStats: async () => ({
      followerCount: 12_000,
      engagementRate: '2.50',
      avatarUrl: null,
    }),
    now: () => NOW,
    notifyDeps: fakeNotifyDeps(),
    assignTierDeps: { loadTiers: async () => TIERS },
    ...overrides,
  };
}

function allowCreator() {
  guardMock.mockResolvedValue({ user: { id: 'user-creator' } });
}

describe('POST /api/creators/stats/refresh', () => {
  it('403s a caller the guard refuses', async () => {
    guardMock.mockRejectedValue(new ForbiddenError('not a creator'));
    const response = await handleRefreshStats(serviceDeps());
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('429s inside the window, with Retry-After in whole seconds', async () => {
    allowCreator();
    const halfHourAgo = new Date(NOW.getTime() - 30 * 60 * 1000);
    const response = await handleRefreshStats(
      serviceDeps({
        loadProfile: async () => ({
          id: 'profile-1',
          tierId: null,
          statsRefreshedAt: halfHourAgo,
        }),
      })
    );
    expect(response.status).toBe(429);
    // 23.5 hours remaining, in seconds.
    expect(response.headers.get('Retry-After')).toBe(String(23.5 * 3600));
    const body = await response.json();
    expect(body.error.code).toBe('STATS_REFRESH_RATE_LIMITED');
  });

  it('502s when TikTok returns nothing usable', async () => {
    allowCreator();
    const response = await handleRefreshStats(
      serviceDeps({ fetchStats: async () => null })
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe('STATS_FETCH_FAILED');
  });

  it('422s an email sign-up — nothing to pull from', async () => {
    allowCreator();
    const response = await handleRefreshStats(
      serviceDeps({ linkedHandle: async () => null })
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details._root).toEqual([
      'Stats refresh is only available for TikTok sign-ins.',
    ]);
  });

  it('404s before onboarding', async () => {
    allowCreator();
    const response = await handleRefreshStats(
      serviceDeps({ loadProfile: async () => null })
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns the fresh numbers and names an upgrade', async () => {
    allowCreator();
    const response = await handleRefreshStats(serviceDeps());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      follower_count: 12_000,
      engagement_rate: '2.50',
      refreshed_at: NOW.toISOString(),
      tier_change: { kind: 'upgraded', tier_name: 'Micro' },
    });
  });

  it('reports a flag-for-review as unchanged — the review is the admin’s', async () => {
    allowCreator();
    const response = await handleRefreshStats(
      serviceDeps({
        loadProfile: async () => ({
          id: 'profile-1',
          tierId: 'tier-mid-gone',
          statsRefreshedAt: null,
        }),
        // Numbers match no band while a tier is held → flagged internally.
        fetchStats: async () => ({
          followerCount: 500,
          engagementRate: '0.50',
          avatarUrl: null,
        }),
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tier_change).toEqual({ kind: 'unchanged' });
  });
});
