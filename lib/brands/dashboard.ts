import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  campaign,
  creatorProfile,
  deal,
  deliverable,
  fundingSession,
  ledgerEntry,
  user,
  videoMetric,
} from '@/db/schema';
import type { CampaignStatus, DealStatus } from '@/db/schema';
import { guard } from '@/lib/authz';
import {
  buildCumulativeWeeklyPayouts,
  type PayoutPoint,
} from '@/lib/creators/payout-series';

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
    refunded: number;
  };
  awaitingReview: Array<{
    dealId: string;
    creatorHandle: string;
    /** The creator's profile picture; initials fallback when null. */
    creatorImage: string | null;
    campaignName: string;
    campaignId: string;
    videoCount: number;
    totalPrice: number;
  }>;
  /** Cumulative weekly spend (holds out), ledger-sourced. */
  spent: PayoutPoint[];
  /** One row per delivered video, for the reach bubble swarm. Null counts mean "no view data yet". */
  reachVideos: Array<{
    deliverableId: string;
    campaignId: string;
    campaignName: string;
    creatorHandle: string;
    views: number | null;
    likes: number | null;
    shares: number | null;
    comments: number | null;
    submittedAt: Date;
  }>;
  /** Videos the brand has ordered across live deals (funded onward). */
  orderedVideos: number;
  /** Deal counts by status — the funnel and the acceptance rate derive from this. */
  dealsByStatus: Record<DealStatus, number>;
  /** The soonest-expiring open offers, at most 3. */
  expiringOffers: Array<{
    dealId: string;
    creatorHandle: string;
    expiresAt: Date;
  }>;
  /** An open Chapa checkout (initialized/verified) awaiting confirmation, if any. */
  pendingFunding: { campaignName: string; amount: number } | null;
  /** The first flagged deal, if any — surfaces the "under review" alert. */
  flaggedDeal: { campaignName: string; creatorHandle: string } | null;
  /** Per-campaign committed money vs budget for the meters (active campaigns, top 3 by budget). */
  budgets: Array<{
    campaignId: string;
    name: string;
    budget: number;
    committed: number;
  }>;
  /** Views gained in the last 7 days, snapshot-derived; null until history exists. */
  newViewsThisWeek: number | null;
}

const EMPTY_BY_STATUS: Record<CampaignStatus, number> = {
  draft: 0,
  confirmed: 0,
  funded: 0,
  in_progress: 0,
  completed: 0,
  cancelled: 0,
};

const EMPTY_DEALS_BY_STATUS: Record<DealStatus, number> = {
  pending: 0,
  accepted: 0,
  declined: 0,
  expired: 0,
  funded: 0,
  delivered: 0,
  revision_requested: 0,
  completed: 0,
  refunded: 0,
};

/** Deal statuses that mean "the brand has ordered these videos". */
const LIVE_DEAL_STATUSES: DealStatus[] = [
  'funded',
  'delivered',
  'revision_requested',
  'completed',
];

/** Seam for tests. */
export interface BrandDashboardDeps {
  requireBrand: () => Promise<{ brandProfileId: string | null }>;
  selectCampaignCounts: (
    brandProfileId: string
  ) => Promise<Array<{ status: CampaignStatus; count: number }>>;
  selectMoney: (brandProfileId: string) => Promise<{
    held: number;
    paidOut: number;
    commission: number;
    refunded: number;
  }>;
  selectAwaitingReview: (
    brandProfileId: string
  ) => Promise<BrandDashboard['awaitingReview']>;
  selectSpendEvents: (
    brandProfileId: string
  ) => Promise<Array<{ createdAt: Date; amount: number }>>;
  selectReachVideos: (
    brandProfileId: string
  ) => Promise<BrandDashboard['reachVideos']>;
  selectOrderedVideos: (brandProfileId: string) => Promise<number>;
  selectDealCounts: (
    brandProfileId: string
  ) => Promise<Array<{ status: DealStatus; count: number }>>;
  selectExpiringOffers: (
    brandProfileId: string
  ) => Promise<BrandDashboard['expiringOffers']>;
  selectPendingFunding: (
    brandProfileId: string
  ) => Promise<BrandDashboard['pendingFunding']>;
  selectFlaggedDeal: (
    brandProfileId: string
  ) => Promise<BrandDashboard['flaggedDeal']>;
  selectBudgets: (brandProfileId: string) => Promise<BrandDashboard['budgets']>;
  selectNewViewsThisWeek: (
    brandProfileId: string,
    now: Date
  ) => Promise<number | null>;
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
        refunded: sql<number>`coalesce(-sum(case when ${ledgerEntry.entryType} = 'refund' then ${ledgerEntry.amount} else 0 end), 0)::int`,
      })
      .from(ledgerEntry)
      .innerJoin(campaign, eq(ledgerEntry.campaignId, campaign.id))
      .where(eq(campaign.brandId, brandProfileId));
    return {
      held: Number(row?.held ?? 0),
      paidOut: Number(row?.paidOut ?? 0),
      commission: Number(row?.commission ?? 0),
      refunded: Number(row?.refunded ?? 0),
    };
  },
  selectAwaitingReview: async (brandProfileId) => {
    const rows = await db
      .select({
        dealId: deal.id,
        creatorHandle: creatorProfile.tiktokHandle,
        creatorImage: user.image,
        campaignName: campaign.name,
        campaignId: campaign.id,
        videoCount: deal.videoCount,
        totalPrice: deal.totalPrice,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
      // Only `image` travels off `user` — the row's face, nothing contactable.
      .innerJoin(user, eq(creatorProfile.userId, user.id))
      .where(
        and(
          eq(campaign.brandId, brandProfileId),
          eq(deal.status, 'delivered' as DealStatus)
        )
      )
      .orderBy(sql`${deal.createdAt} desc`);
    return rows;
  },
  selectSpendEvents: async (brandProfileId) => {
    // Money out of the brand's escrow: a hold is `+total_price` when a deal is
    // funded and `release_payout` is negative. The chart reads gross spend, so
    // the series is the holds only — never a recomputation (AC-4's rule).
    const rows = await db
      .select({
        createdAt: ledgerEntry.createdAt,
        amount: ledgerEntry.amount,
      })
      .from(ledgerEntry)
      .innerJoin(campaign, eq(ledgerEntry.campaignId, campaign.id))
      .where(
        and(
          eq(campaign.brandId, brandProfileId),
          eq(ledgerEntry.entryType, 'hold')
        )
      );
    return rows;
  },
  selectReachVideos: async (brandProfileId) => {
    // One row per delivered video; the LEFT JOIN keeps videos whose metrics
    // have not arrived — the swarm renders those as dashed "awaiting view
    // data" bubbles rather than dropping them (AC-027's null discipline).
    const rows = await db
      .select({
        deliverableId: deliverable.id,
        campaignId: campaign.id,
        campaignName: campaign.name,
        creatorHandle: creatorProfile.tiktokHandle,
        views: videoMetric.views,
        likes: videoMetric.likes,
        shares: videoMetric.shares,
        comments: videoMetric.comments,
        submittedAt: deliverable.submittedAt,
      })
      .from(deliverable)
      .innerJoin(deal, eq(deliverable.dealId, deal.id))
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
      .leftJoin(videoMetric, eq(videoMetric.deliverableId, deliverable.id))
      .where(eq(campaign.brandId, brandProfileId))
      .orderBy(sql`${deliverable.submittedAt} asc`);
    return rows;
  },
  selectOrderedVideos: async (brandProfileId) => {
    const [row] = await db
      .select({
        ordered: sql<number>`coalesce(sum(${deal.videoCount}), 0)::int`,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .where(
        and(
          eq(campaign.brandId, brandProfileId),
          inArray(deal.status, LIVE_DEAL_STATUSES)
        )
      );
    return Number(row?.ordered ?? 0);
  },
  selectDealCounts: async (brandProfileId) => {
    const rows = await db
      .select({
        status: deal.status,
        count: sql<number>`count(*)::int`,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .where(eq(campaign.brandId, brandProfileId))
      .groupBy(deal.status);
    return rows;
  },
  selectExpiringOffers: async (brandProfileId) => {
    // Rides `deal_status_offer_expires_idx`: pending offers with a deadline,
    // soonest first. Three is the card's capacity, not a page size.
    const rows = await db
      .select({
        dealId: deal.id,
        creatorHandle: creatorProfile.tiktokHandle,
        expiresAt: deal.offerExpiresAt,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
      .where(
        and(
          eq(campaign.brandId, brandProfileId),
          eq(deal.status, 'pending' as DealStatus),
          isNotNull(deal.offerExpiresAt),
          gt(deal.offerExpiresAt, new Date())
        )
      )
      .orderBy(sql`${deal.offerExpiresAt} asc`)
      .limit(3);
    return rows.filter(
      (r): r is typeof r & { expiresAt: Date } => r.expiresAt !== null
    );
  },
  selectPendingFunding: async (brandProfileId) => {
    // `initialized` is an open checkout, `verified` is money at Chapa waiting
    // for the escrow transaction — both read as "payment in progress" here.
    const [row] = await db
      .select({
        campaignName: campaign.name,
        amount: fundingSession.amount,
      })
      .from(fundingSession)
      .innerJoin(campaign, eq(fundingSession.campaignId, campaign.id))
      .where(
        and(
          eq(fundingSession.brandId, brandProfileId),
          inArray(fundingSession.status, ['initialized', 'verified'])
        )
      )
      .orderBy(sql`${fundingSession.createdAt} desc`)
      .limit(1);
    return row ?? null;
  },
  selectFlaggedDeal: async (brandProfileId) => {
    const [row] = await db
      .select({
        campaignName: campaign.name,
        creatorHandle: creatorProfile.tiktokHandle,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
      .where(and(eq(campaign.brandId, brandProfileId), eq(deal.flagged, true)))
      .limit(1);
    return row ?? null;
  },
  selectBudgets: async (brandProfileId) => {
    // Committed = the campaign's gross holds, ledger-sourced like every other
    // money figure here. Active campaigns only; three fills the meter list.
    const rows = await db
      .select({
        campaignId: campaign.id,
        name: campaign.name,
        budget: campaign.budget,
        committed: sql<number>`coalesce(sum(case when ${ledgerEntry.entryType} = 'hold' then ${ledgerEntry.amount} else 0 end), 0)::int`,
      })
      .from(campaign)
      .leftJoin(ledgerEntry, eq(ledgerEntry.campaignId, campaign.id))
      .where(
        and(
          eq(campaign.brandId, brandProfileId),
          inArray(campaign.status, ['confirmed', 'funded', 'in_progress'])
        )
      )
      .groupBy(campaign.id, campaign.name, campaign.budget)
      .orderBy(sql`${campaign.budget} desc`)
      .limit(3);
    return rows.map((r) => ({ ...r, committed: Number(r.committed) }));
  },
  selectNewViewsThisWeek: async (brandProfileId, now) => {
    // Reach gained in 7 days = latest snapshot minus the newest snapshot at
    // least 7 days old, per deliverable. With no week-old snapshot anywhere
    // the answer is honestly unknown — null, which the UI renders as a dash.
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = await db.execute<{
      baseline_count: number;
      delta: number;
    }>(sql`
      with latest as (
        select distinct on (s.deliverable_id) s.deliverable_id, s.views
        from video_metric_snapshot s
        order by s.deliverable_id, s.captured_at desc
      ),
      baseline as (
        select distinct on (s.deliverable_id) s.deliverable_id, s.views
        from video_metric_snapshot s
        where s.captured_at <= ${weekAgo}
        order by s.deliverable_id, s.captured_at desc
      )
      select
        count(b.deliverable_id)::int as baseline_count,
        coalesce(sum(l.views - coalesce(b.views, 0)), 0)::int as delta
      from latest l
      join deliverable dv on dv.id = l.deliverable_id
      join deal dl on dl.id = dv.deal_id
      join campaign c on c.id = dl.campaign_id
      left join baseline b on b.deliverable_id = l.deliverable_id
      where c.brand_id = ${brandProfileId}
    `);
    const row = result.rows[0];
    if (!row || Number(row.baseline_count) === 0) return null;
    return Number(row.delta);
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
      money: { held: 0, paidOut: 0, commission: 0, refunded: 0 },
      awaitingReview: [],
      spent: buildCumulativeWeeklyPayouts([], new Date()),
      reachVideos: [],
      orderedVideos: 0,
      dealsByStatus: { ...EMPTY_DEALS_BY_STATUS },
      expiringOffers: [],
      pendingFunding: null,
      flaggedDeal: null,
      budgets: [],
      newViewsThisWeek: null,
    };
  }

  const now = new Date();
  const [
    counts,
    money,
    awaitingReview,
    spendEvents,
    reachVideos,
    orderedVideos,
    dealCounts,
    expiringOffers,
    pendingFunding,
    flaggedDeal,
    budgets,
    newViewsThisWeek,
  ] = await Promise.all([
    deps.selectCampaignCounts(brandProfileId),
    deps.selectMoney(brandProfileId),
    deps.selectAwaitingReview(brandProfileId),
    deps.selectSpendEvents(brandProfileId),
    deps.selectReachVideos(brandProfileId),
    deps.selectOrderedVideos(brandProfileId),
    deps.selectDealCounts(brandProfileId),
    deps.selectExpiringOffers(brandProfileId),
    deps.selectPendingFunding(brandProfileId),
    deps.selectFlaggedDeal(brandProfileId),
    deps.selectBudgets(brandProfileId),
    deps.selectNewViewsThisWeek(brandProfileId, now),
  ]);

  const byStatus: Record<CampaignStatus, number> = { ...EMPTY_BY_STATUS };
  let total = 0;
  for (const row of counts) {
    byStatus[row.status] = row.count;
    total += row.count;
  }

  const dealsByStatus: Record<DealStatus, number> = {
    ...EMPTY_DEALS_BY_STATUS,
  };
  for (const row of dealCounts) {
    dealsByStatus[row.status] = row.count;
  }

  return {
    campaigns: { total, byStatus },
    money,
    awaitingReview,
    spent: buildCumulativeWeeklyPayouts(
      spendEvents.map((event) => ({
        createdAt: event.createdAt,
        paidOut: event.amount,
      })),
      now
    ),
    reachVideos,
    orderedVideos,
    dealsByStatus,
    expiringOffers,
    pendingFunding,
    flaggedDeal,
    budgets,
    newViewsThisWeek,
  };
}
