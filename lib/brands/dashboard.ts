import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaign, creatorProfile, deal, ledgerEntry } from '@/db/schema';
import type { CampaignStatus, DealStatus } from '@/db/schema';
import { guard } from '@/lib/authz';

/**
 * The brand dashboard (§13).
 *
 * Cross-campaign summary: how many campaigns, how much money is held/paid
 * across all of them, and which deals are waiting on the brand's review.
 *
 * **The gate is inside the module.** Same rule as every read: a page and a
 * route handler are two call sites today and more later, and a read whose
 * protection lives in its callers is protected exactly as well as the least
 * careful one.
 *
 * **The money figures are ledger-derived, never recomputed.** Same rule as
 * the admin overview (`lib/admin/overview.ts`): `held` is `sum(amount)`,
 * and `paidOut`/`commission` are FILTER sums over their entry types. The
 * numbers shown here cannot disagree with what the ledger enforces.
 *
 * **One query for campaigns, one for money, one for awaiting review.** The
 * three touch different tables and neither feeds the other, so they run in
 * parallel (NFR-001).
 */

export interface BrandDashboard {
  campaigns: {
    total: number;
    byStatus: Record<CampaignStatus, number>;
  };
  money: {
    held: number;
    paidOut: number;
    commission: number;
  };
  awaitingReview: Array<{
    dealId: string;
    creatorHandle: string;
    campaignName: string;
    campaignId: string;
    videoCount: number;
    totalPrice: number;
  }>;
}

const EMPTY_BY_STATUS: Record<CampaignStatus, number> = {
  draft: 0,
  confirmed: 0,
  funded: 0,
  in_progress: 0,
  completed: 0,
  cancelled: 0,
};

/** Seam for tests. */
export interface BrandDashboardDeps {
  requireBrand: () => Promise<{ brandProfileId: string | null }>;
  selectCampaignCounts: (
    brandProfileId: string
  ) => Promise<Array<{ status: CampaignStatus; count: number }>>;
  selectMoney: (
    brandProfileId: string
  ) => Promise<{ held: number; paidOut: number; commission: number }>;
  selectAwaitingReview: (
    brandProfileId: string
  ) => Promise<BrandDashboard['awaitingReview']>;
}

const defaultDeps: BrandDashboardDeps = {
  requireBrand: () => guard({ roles: ['brand'] }),
  selectCampaignCounts: async (brandProfileId) => {
    const rows = await db
      .select({
        status: campaign.status,
        count: sql<number>`count(*)::int`,
      })
      .from(campaign)
      .where(eq(campaign.brandId, brandProfileId))
      .groupBy(campaign.status);
    return rows;
  },
  selectMoney: async (brandProfileId) => {
    const [row] = await db
      .select({
        held: sql<number>`coalesce(sum(${ledgerEntry.amount}), 0)::int`,
        paidOut: sql<number>`coalesce(-sum(case when ${ledgerEntry.entryType} = 'release_payout' then ${ledgerEntry.amount} else 0 end), 0)::int`,
        commission: sql<number>`coalesce(-sum(case when ${ledgerEntry.entryType} = 'commission' then ${ledgerEntry.amount} else 0 end), 0)::int`,
      })
      .from(ledgerEntry)
      .innerJoin(campaign, eq(ledgerEntry.campaignId, campaign.id))
      .where(eq(campaign.brandId, brandProfileId));
    return {
      held: Number(row?.held ?? 0),
      paidOut: Number(row?.paidOut ?? 0),
      commission: Number(row?.commission ?? 0),
    };
  },
  selectAwaitingReview: async (brandProfileId) => {
    const rows = await db
      .select({
        dealId: deal.id,
        creatorHandle: creatorProfile.tiktokHandle,
        campaignName: campaign.name,
        campaignId: campaign.id,
        videoCount: deal.videoCount,
        totalPrice: deal.totalPrice,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
      .where(
        and(
          eq(campaign.brandId, brandProfileId),
          eq(deal.status, 'delivered' as DealStatus)
        )
      )
      .orderBy(sql`${deal.createdAt} desc`);
    return rows;
  },
};

/**
 * The brand dashboard summary. Throws `ForbiddenError` for every non-brand
 * caller, including unauthenticated ones — `guard` fails closed.
 */
export async function readBrandDashboard(
  deps: BrandDashboardDeps = defaultDeps
): Promise<BrandDashboard> {
  const { brandProfileId } = await deps.requireBrand();
  if (!brandProfileId) {
    return {
      campaigns: { total: 0, byStatus: { ...EMPTY_BY_STATUS } },
      money: { held: 0, paidOut: 0, commission: 0 },
      awaitingReview: [],
    };
  }

  const [counts, money, awaitingReview] = await Promise.all([
    deps.selectCampaignCounts(brandProfileId),
    deps.selectMoney(brandProfileId),
    deps.selectAwaitingReview(brandProfileId),
  ]);

  const byStatus: Record<CampaignStatus, number> = { ...EMPTY_BY_STATUS };
  let total = 0;
  for (const row of counts) {
    byStatus[row.status] = row.count;
    total += row.count;
  }

  return {
    campaigns: { total, byStatus },
    money,
    awaitingReview,
  };
}
