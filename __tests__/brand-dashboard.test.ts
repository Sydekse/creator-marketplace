import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../lib/authz';
import { readBrandDashboard } from '../lib/brands/dashboard';
import type {
  BrandDashboard,
  BrandDashboardDeps,
} from '../lib/brands/dashboard';
import type { CampaignStatus, DealStatus } from '../db/schema';

/**
 * §13 — the brand dashboard (KAN-104).
 *
 * Three claims:
 *
 * **The gate lives inside the module.** `readBrandDashboard` awaits
 * `requireBrand` before touching any data — a read protected only by its
 * callers is protected as well as its least careful one.
 *
 * **The money figures are ledger-derived.** The FILTER sums follow the admin
 * overview pattern (`lib/admin/overview.ts`), scoped to `campaign.brand_id`.
 *
 * **Awaiting review returns only `delivered` deals.** The set is driven by
 * `eq(deal.status, 'delivered')`, not by a status list that could drift.
 */

const BRAND_PROFILE_ID = 'b0000000-0000-4000-8000-000000000001';
const DEAL_ID = 'd0000000-0000-4000-8000-000000000001';
const CAMPAIGN_ID = 'c0000000-0000-4000-8000-000000000001';

function makeDeps(
  overrides: {
    failBrand?: boolean;
    counts?: Array<{ status: CampaignStatus; count: number }>;
    money?: {
      held: number;
      paidOut: number;
      commission: number;
      refunded: number;
    };
    awaitingReview?: BrandDashboard['awaitingReview'];
    spendEvents?: Array<{ createdAt: Date; amount: number }>;
    reachVideos?: BrandDashboard['reachVideos'];
    orderedVideos?: number;
    dealCounts?: Array<{ status: DealStatus; count: number }>;
    expiringOffers?: BrandDashboard['expiringOffers'];
    pendingFunding?: BrandDashboard['pendingFunding'];
    flaggedDeal?: BrandDashboard['flaggedDeal'];
    budgets?: BrandDashboard['budgets'];
    newViewsThisWeek?: number | null;
  } = {}
): { deps: BrandDashboardDeps; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      requireBrand: async () => {
        calls.push('requireBrand');
        if (overrides.failBrand) throw new ForbiddenError('not a brand');
        return { brandProfileId: BRAND_PROFILE_ID };
      },
      selectCampaignCounts: async () => {
        calls.push('selectCampaignCounts');
        return overrides.counts ?? [];
      },
      selectMoney: async () => {
        calls.push('selectMoney');
        return (
          overrides.money ?? { held: 0, paidOut: 0, commission: 0, refunded: 0 }
        );
      },
      selectAwaitingReview: async () => {
        calls.push('selectAwaitingReview');
        return overrides.awaitingReview ?? [];
      },
      selectSpendEvents: async () => {
        calls.push('selectSpendEvents');
        return overrides.spendEvents ?? [];
      },
      selectReachVideos: async () => {
        calls.push('selectReachVideos');
        return overrides.reachVideos ?? [];
      },
      selectOrderedVideos: async () => {
        calls.push('selectOrderedVideos');
        return overrides.orderedVideos ?? 0;
      },
      selectDealCounts: async () => {
        calls.push('selectDealCounts');
        return overrides.dealCounts ?? [];
      },
      selectExpiringOffers: async () => {
        calls.push('selectExpiringOffers');
        return overrides.expiringOffers ?? [];
      },
      selectPendingFunding: async () => {
        calls.push('selectPendingFunding');
        return overrides.pendingFunding ?? null;
      },
      selectFlaggedDeal: async () => {
        calls.push('selectFlaggedDeal');
        return overrides.flaggedDeal ?? null;
      },
      selectBudgets: async () => {
        calls.push('selectBudgets');
        return overrides.budgets ?? [];
      },
      selectNewViewsThisWeek: async () => {
        calls.push('selectNewViewsThisWeek');
        return overrides.newViewsThisWeek ?? null;
      },
    },
  };
}

// -- The gate ----------------------------------------------------------------

describe('the brand dashboard gate', () => {
  it('runs before any data seam', async () => {
    const { deps, calls } = makeDeps();

    await readBrandDashboard(deps);

    expect(calls[0]).toBe('requireBrand');
  });

  it('refuses a non-brand before any query runs', async () => {
    const { deps, calls } = makeDeps({ failBrand: true });

    await expect(readBrandDashboard(deps)).rejects.toThrow(ForbiddenError);
    expect(calls).toEqual(['requireBrand']);
  });

  it('returns empty defaults for a brand with no profile', async () => {
    const { deps } = makeDeps();
    deps.requireBrand = async () => ({ brandProfileId: null });

    const result = await readBrandDashboard(deps);

    expect(result.campaigns.total).toBe(0);
    expect(result.money).toEqual({
      held: 0,
      paidOut: 0,
      commission: 0,
      refunded: 0,
    });
    expect(result.awaitingReview).toEqual([]);
    expect(result.newViewsThisWeek).toBeNull();
  });
});

// -- Campaign counts ---------------------------------------------------------

describe('campaign counts', () => {
  it('sums the total from status rows', async () => {
    const { deps } = makeDeps({
      counts: [
        { status: 'draft', count: 2 },
        { status: 'funded', count: 1 },
      ],
    });

    const result = await readBrandDashboard(deps);

    expect(result.campaigns.total).toBe(3);
    expect(result.campaigns.byStatus.draft).toBe(2);
    expect(result.campaigns.byStatus.funded).toBe(1);
    expect(result.campaigns.byStatus.completed).toBe(0);
  });

  it('returns zero total for no campaigns', async () => {
    const { deps } = makeDeps({ counts: [] });

    const result = await readBrandDashboard(deps);

    expect(result.campaigns.total).toBe(0);
  });
});

// -- Money totals ------------------------------------------------------------

describe('money totals', () => {
  it('returns ledger-derived figures', async () => {
    const { deps } = makeDeps({
      money: {
        held: 400_000,
        paidOut: 85_000,
        commission: 15_000,
        refunded: 150_000,
      },
    });

    const result = await readBrandDashboard(deps);

    expect(result.money).toEqual({
      held: 400_000,
      paidOut: 85_000,
      commission: 15_000,
      refunded: 150_000,
    });
  });

  it('returns zeros when no ledger entries exist', async () => {
    const { deps } = makeDeps();

    const result = await readBrandDashboard(deps);

    expect(result.money).toEqual({
      held: 0,
      paidOut: 0,
      commission: 0,
      refunded: 0,
    });
  });
});

// -- Awaiting review ---------------------------------------------------------

describe('awaiting review', () => {
  it('returns delivered deals with creator handles', async () => {
    const { deps } = makeDeps({
      awaitingReview: [
        {
          dealId: DEAL_ID,
          creatorHandle: '@selam',
          creatorImage: null,
          campaignName: 'Summer launch',
          campaignId: CAMPAIGN_ID,
          videoCount: 2,
          totalPrice: 300_000,
        },
      ],
    });

    const result = await readBrandDashboard(deps);

    expect(result.awaitingReview).toHaveLength(1);
    expect(result.awaitingReview[0].creatorHandle).toBe('@selam');
    expect(result.awaitingReview[0].totalPrice).toBe(300_000);
  });

  it('returns empty when no deals need review', async () => {
    const { deps } = makeDeps({ awaitingReview: [] });

    const result = await readBrandDashboard(deps);

    expect(result.awaitingReview).toEqual([]);
  });
});

// -- The reads run in parallel -------------------------------------------------

describe('parallel reads', () => {
  it('issues every read after the gate', async () => {
    const { deps, calls } = makeDeps();

    await readBrandDashboard(deps);

    expect(calls[0]).toBe('requireBrand');
    expect(calls.slice(1).sort()).toEqual(
      [
        'selectAwaitingReview',
        'selectBudgets',
        'selectCampaignCounts',
        'selectDealCounts',
        'selectExpiringOffers',
        'selectFlaggedDeal',
        'selectMoney',
        'selectNewViewsThisWeek',
        'selectOrderedVideos',
        'selectPendingFunding',
        'selectReachVideos',
        'selectSpendEvents',
      ].sort()
    );
  });
});

// -- Reach, funnel, and alerts -------------------------------------------------

describe('reach and funnel', () => {
  it('passes reach videos through, nulls preserved', async () => {
    const { deps } = makeDeps({
      reachVideos: [
        {
          deliverableId: 'v1',
          campaignId: CAMPAIGN_ID,
          campaignName: 'Summer launch',
          creatorHandle: '@selam',
          views: 12_400,
          likes: 980,
          shares: 45,
          comments: 61,
          submittedAt: new Date('2026-08-01'),
        },
        {
          deliverableId: 'v2',
          campaignId: CAMPAIGN_ID,
          campaignName: 'Summer launch',
          creatorHandle: '@selam',
          views: null,
          likes: null,
          shares: null,
          comments: null,
          submittedAt: new Date('2026-08-10'),
        },
      ],
      orderedVideos: 4,
    });

    const result = await readBrandDashboard(deps);

    expect(result.reachVideos).toHaveLength(2);
    expect(result.reachVideos[1].views).toBeNull();
    expect(result.orderedVideos).toBe(4);
  });

  it('fills every deal status, missing ones as zero', async () => {
    const { deps } = makeDeps({
      dealCounts: [
        { status: 'pending', count: 3 },
        { status: 'completed', count: 8 },
      ],
    });

    const result = await readBrandDashboard(deps);

    expect(result.dealsByStatus.pending).toBe(3);
    expect(result.dealsByStatus.completed).toBe(8);
    expect(result.dealsByStatus.declined).toBe(0);
    expect(result.dealsByStatus.refunded).toBe(0);
  });

  it('surfaces alerts only when their rows exist', async () => {
    const { deps } = makeDeps({
      pendingFunding: { campaignName: 'Injera Week', amount: 600_000 },
      flaggedDeal: { campaignName: 'Summer launch', creatorHandle: '@selam' },
    });

    const result = await readBrandDashboard(deps);

    expect(result.pendingFunding?.amount).toBe(600_000);
    expect(result.flaggedDeal?.creatorHandle).toBe('@selam');
  });

  it('defaults alerts to null and the weekly delta to null', async () => {
    const { deps } = makeDeps();

    const result = await readBrandDashboard(deps);

    expect(result.pendingFunding).toBeNull();
    expect(result.flaggedDeal).toBeNull();
    expect(result.newViewsThisWeek).toBeNull();
  });
});

// -- Source guards -----------------------------------------------------------

describe('source guards', () => {
  it('the money query uses FILTER sums, not re-derived arithmetic', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync('lib/brands/dashboard.ts', 'utf8');

    expect(source).toContain("= 'release_payout'");
    expect(source).toContain("= 'commission'");
    expect(source).not.toContain('computeSplit');
  });

  it('the awaiting review query filters to delivered status', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync('lib/brands/dashboard.ts', 'utf8');

    expect(source).toContain("eq(deal.status, 'delivered'");
  });
});
