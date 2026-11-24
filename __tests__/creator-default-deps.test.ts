import { describe, expect, it, vi } from 'vitest';

/**
 * Default-dep smoke tests for the creator dashboard read, following the
 * `default-deps.test.ts` precedent: mock `@/db` so the drizzle chains and raw
 * `db.execute` aggregates resolve without a database, then run
 * `readCreatorDashboard()` against its real default deps. The business logic
 * is owned by the seam-injected tests in `creator-dashboard.test.ts`; this
 * file exists so the ten default query functions — including the raw-SQL
 * relationship/reliability/growth/lift aggregates — execute their row
 * mappings and null fallbacks.
 */

const NOW = Date.now();

// One fat row satisfies every select-based query: each reads only its own
// columns. The offer expiry sits inside the 48h window so the expiring-offer
// filter takes its true branch; `videoCount` and `status` drive the groups.
const FAT_ROW = {
  paidOut: 255_000,
  inEscrow: 150_000,
  id: 'd0000000-0000-4000-8000-000000000001',
  status: 'pending',
  campaignName: 'Test Campaign',
  videoCount: 2,
  totalPrice: 300_000,
  offerExpiresAt: new Date(NOW + 60 * 60 * 1000),
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  amount: 100_000,
  dealId: 'd0000000-0000-4000-8000-000000000001',
  views: 1000,
  likes: 100,
  shares: 10,
  comments: 5,
  measuredVideos: 1,
  totalVideos: 2,
  deliverableId: 'de000000-0000-4000-8000-000000000001',
  campaignId: 'c0000000-0000-4000-8000-000000000001',
  tiktokUrl: 'https://www.tiktok.com/@t/video/1',
  thumbnailUrl: null,
  tiktokVideoId: null,
  reviewStatus: 'pending',
  submittedAt: new Date('2026-08-02T00:00:00.000Z'),
  followerCount: 12_000,
  engagementRate: '2.50',
  capturedAt: new Date('2026-08-03T00:00:00.000Z'),
};

/** Flipped by the tests: empty responses walk the `?? fallback` branches. */
const state = { empty: false };

vi.mock('../db', () => {
  const makeChain = (): unknown => {
    const chain: Record<string, unknown> = {};
    for (const m of [
      'select',
      'from',
      'where',
      'groupBy',
      'orderBy',
      'innerJoin',
      'leftJoin',
      'limit',
    ]) {
      chain[m] = vi.fn(() => chain);
    }
    chain.then = (resolve: (v: unknown) => void) =>
      resolve(state.empty ? [] : [FAT_ROW, FAT_ROW]);
    return chain;
  };
  return {
    db: {
      select: vi.fn(() => makeChain()),
      execute: vi.fn(async () =>
        state.empty
          ? { rows: [] }
          : {
              rows: [
                {
                  brands_worked_with: 2,
                  repeat_brands: 1,
                  avg_submit_days: 1.5,
                  approval_rate: 0.75,
                  revision_rate: 0.25,
                  views: 500,
                  likes: 50,
                  shares: 5,
                  comments: 2,
                },
              ],
            }
      ),
    },
  };
});

vi.mock('../lib/authz', async (importOriginal) => {
  const actual: object = await importOriginal();
  return {
    ...actual,
    guard: vi.fn(async () => ({
      creatorProfileId: 'cr000000-0000-4000-8000-000000000001',
    })),
  };
});

describe('default deps: readCreatorDashboard', () => {
  it('exercises every default query dep on populated rows', async () => {
    state.empty = false;
    const { readCreatorDashboard } = await import('../lib/creators/dashboard');
    const result = await readCreatorDashboard();

    expect(result).not.toBeNull();
    expect(result?.earnings.paidOut).toBe(255_000);
    expect(result?.groups).toBeDefined();
    expect(result?.expiringOffers.length).toBeGreaterThan(0);
    expect(result?.relationships.brandsWorkedWith).toBe(2);
    expect(result?.reliability.approvalRate).toBe(0.75);
    expect(result?.growth.followersDelta).toBe(0);
    expect(result?.weeklyLift.views).toBe(500);
    expect(result?.topVideos.length).toBeGreaterThan(0);
  }, 15_000);

  it('walks the null fallbacks when every query comes back empty', async () => {
    state.empty = true;
    const { readCreatorDashboard } = await import('../lib/creators/dashboard');
    const result = await readCreatorDashboard();

    expect(result).not.toBeNull();
    expect(result?.earnings).toEqual({ paidOut: 0, inEscrow: 0 });
    expect(result?.isEmpty).toBe(true);
    expect(result?.metrics.views).toBeNull();
    expect(result?.relationships.brandsWorkedWith).toBe(0);
    expect(result?.reliability.approvalRate).toBeNull();
    expect(result?.growth.followersDelta).toBeNull();
    expect(result?.weeklyLift.views).toBeNull();
    expect(result?.expiringOffers).toEqual([]);
  }, 15_000);
});
