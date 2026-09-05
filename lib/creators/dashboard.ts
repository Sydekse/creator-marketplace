import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  campaign,
  creatorMetricSnapshot,
  deal,
  deliverable,
  ledgerEntry,
  videoMetric,
} from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import { guard } from '@/lib/authz';
import { groupDeals } from '@/lib/deals/groups';
import type { DealGroup } from '@/lib/deals/groups';
import {
  buildCumulativeWeeklyPayouts,
  type PayoutPoint,
} from '@/lib/creators/payout-series';

/**
 * Everything the creator dashboard reads (KAN-25, US-001, AC-2 – AC-6).
 *
 * Two properties are structural here rather than observed, and both are the
 * reason this module exists instead of the queries living in the page.
 *
 * **AC-6, ownership.** `readCreatorDashboard` takes no creator id. The gate runs
 * inside the module and `guard` hands back the caller's own `creatorProfileId`
 * (`lib/authz.ts`), which is the only thing any `where` is built from. There is
 * no argument a caller could pass to read somebody else's deals, which is a
 * stronger guarantee than checking an argument against the session — the check
 * cannot be forgotten because there is nothing to check.
 *
 * Note the two hops: `deal.creator_id` references `creator_profile.id`, **not**
 * `user.id`. Filtering on the session user's id would match no rows and read on
 * screen as "you have no deals", which is the quiet version of this bug.
 *
 * **AC-4, the ledger is the source.** Neither earnings figure is computed. The
 * ledger already applied the commission split when it wrote the rows, so both
 * numbers fall out of summing entries — `computeSplit` is not imported here and
 * must not be. See `earningsQuery` for why the sums say what they say.
 */

/** Both figures are integer ETB santim (invariant 4). */
export interface CreatorEarnings {
  /** Released to this creator to date, net of commission. Never negative. */
  paidOut: number;
  /** Still held against this creator's deals. Zero once every deal settles. */
  inEscrow: number;
}

export interface CreatorDealRow {
  id: string;
  status: DealStatus;
  campaignName: string;
  videoCount: number;
  /**
   * `unit_price × video_count`, snapshotted onto the deal at offer time — the
   * gross the brand pays, not the creator's net. Displayed as the deal's value
   * and never turned into a payout estimate; see the note on `CreatorDashboard`.
   */
  totalPrice: number;
  offerExpiresAt: Date | null;
}

export interface CreatorDealGroup {
  group: DealGroup;
  deals: CreatorDealRow[];
  count: number;
}

export interface CreatorDashboard {
  earnings: CreatorEarnings;
  /** All five groups, always, in `DEAL_GROUPS` order — empty ones included. */
  groups: CreatorDealGroup[];
  /** True when this creator has no deals at all, in any group (AC-5). */
  isEmpty: boolean;
  /** Cumulative weekly payouts for the dashboard chart, ledger-sourced. */
  payouts: PayoutPoint[];
  /** Deal ids with completed videos still awaiting metrics (KAN-48, KAN-57). */
  unmeasuredDealIds: string[];
  /** Pending offers expiring within 48 hours of the read (nearest first). */
  expiringOffers: Array<{
    id: string;
    campaignName: string;
    offerExpiresAt: Date;
  }>;
  /**
   * The creator's recorded engagement across every measured video — the same
   * honesty rules as the brand's campaign dashboard (null ≠ 0), rolled up to
   * the creator. All null when nothing has been recorded yet.
   */
  metrics: {
    views: number | null;
    likes: number | null;
    shares: number | null;
    comments: number | null;
    measuredVideos: number;
    totalVideos: number;
  };
  actions: {
    pendingOffers: number;
    readyToDeliver: number;
    needsRevision: number;
    needsMetrics: number;
  };
  topVideos: Array<{
    deliverableId: string;
    dealId: string;
    campaignName: string;
    tiktokUrl: string;
    thumbnailUrl: string | null;
    tiktokVideoId: string | null;
    reviewStatus: string;
    submittedAt: Date;
    views: number | null;
    likes: number | null;
    shares: number | null;
    comments: number | null;
  }>;
  relationships: {
    brandsWorkedWith: number;
    repeatBrands: number;
  };
  reliability: {
    avgSubmitDays: number | null;
    approvalRate: number | null;
    revisionRate: number | null;
  };
  growth: {
    followersDelta: number | null;
    engagementDelta: number | null;
    latestAt: Date | null;
    previousAt: Date | null;
  };
  weeklyLift: {
    views: number | null;
    likes: number | null;
    shares: number | null;
    comments: number | null;
  };
}

/**
 * The two earnings figures, as one query over the ledger.
 *
 * Exported so a test can read the emitted SQL: AC-4 is a claim about *which
 * rows are summed*, and that is checkable here without a database.
 *
 * The sign convention is `lib/payment/ledger.ts`'s: `hold` is `+total_price`,
 * `release_payout` is `−payout`, `commission` is `−commission`, `refund` is
 * `−total_price`. Payout is derived by subtraction (KAN-40 spike §3.3), so per
 * deal `hold + release_payout + commission === 0` exactly, and `hold + refund
 * === 0`. Which gives both figures for free:
 *
 * - **paidOut** negates the `release_payout` rows. It is net of commission *by
 *   construction* — the split was applied when the row was written, and the
 *   `commission` row is a separate entry this sum never touches. Recomputing
 *   `total × rate` here would be a second implementation of the arithmetic that
 *   pays people, and the two would drift on the first rounding disagreement.
 * - **inEscrow** sums every entry. It is positive exactly while money is held
 *   and returns to zero the moment a deal is released or refunded, because the
 *   entries were written to cancel.
 *
 * `::int` is not optional. `SUM()` returns bigint, which node-postgres hands
 * back as a **string** — without the cast `paidOut` is a string that
 * concatenates instead of adding. `sumBalance` in `lib/payment/ledger.ts`
 * records the same trap.
 *
 * The join is inner. `ledger_entry.deal_id` is nullable for campaign-level
 * funding, and those rows are not attributable to any one creator, so dropping
 * them is the correct reading rather than an omission.
 */
export function earningsQuery(creatorProfileId: string) {
  return db
    .select({
      paidOut: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntry.entryType} = 'release_payout' THEN -${ledgerEntry.amount} ELSE 0 END), 0)::int`,
      inEscrow: sql<number>`COALESCE(SUM(${ledgerEntry.amount}), 0)::int`,
    })
    .from(ledgerEntry)
    .innerJoin(deal, eq(ledgerEntry.dealId, deal.id))
    .where(eq(deal.creatorId, creatorProfileId));
}

/**
 * Every deal for one creator, newest first, with the campaign it belongs to.
 *
 * One query for all five groups rather than five queries: the grouping is a
 * partition of the same rows, so five round trips would read the same index
 * five times to produce the same set (AC-7, NFR-001). Served by
 * `deal_creator_status_idx`.
 *
 * Selects `total_price` and not a payout. The dashboard's payout figures come
 * from the ledger; putting a computed per-row estimate beside them is exactly
 * the drift AC-4 forbids, and `lib/creators/pricing.ts` already records why an
 * estimate must not be dressed up as a promise.
 */
export function payoutEventsQuery(creatorProfileId: string) {
  return db
    .select({
      createdAt: ledgerEntry.createdAt,
      amount: ledgerEntry.amount,
    })
    .from(ledgerEntry)
    .innerJoin(deal, eq(ledgerEntry.dealId, deal.id))
    .where(
      and(
        eq(deal.creatorId, creatorProfileId),
        eq(ledgerEntry.entryType, 'release_payout')
      )
    )
    .orderBy(ledgerEntry.createdAt);
}

export function dealsQuery(creatorProfileId: string) {
  return db
    .select({
      id: deal.id,
      status: deal.status,
      campaignName: campaign.name,
      videoCount: deal.videoCount,
      totalPrice: deal.totalPrice,
      offerExpiresAt: deal.offerExpiresAt,
    })
    .from(deal)
    .innerJoin(campaign, eq(deal.campaignId, campaign.id))
    .where(eq(deal.creatorId, creatorProfileId))
    .orderBy(desc(deal.createdAt));
}

/**
 * Completed videos with no metrics recorded, joined to the deal so the
 * dashboard card can deep-link. Shares the `pending-metrics.ts` definition of
 * unmeasured (no row, or four nulls) so the card and the reminder sweep can
 * never disagree about who owes numbers.
 */
export function unmeasuredDealsQuery(creatorProfileId: string) {
  return db
    .select({ dealId: deal.id })
    .from(deliverable)
    .innerJoin(deal, eq(deliverable.dealId, deal.id))
    .leftJoin(videoMetric, eq(videoMetric.deliverableId, deliverable.id))
    .where(
      and(
        eq(deal.creatorId, creatorProfileId),
        eq(deal.status, 'completed'),
        or(
          isNull(videoMetric.id),
          and(
            isNull(videoMetric.views),
            isNull(videoMetric.likes),
            isNull(videoMetric.shares),
            isNull(videoMetric.comments)
          )
        )
      )
    );
}

/**
 * The creator's engagement rollup (US-009, creator side of AC-026).
 *
 * Sums only recorded counts — a null field contributes nothing and drags no
 * average down, the same rule `toCampaignTotals` holds the brand's dashboard
 * to. `measuredVideos` counts rows with at least one count written, so the
 * card can say "across N videos" truthfully; `totalVideos` counts every
 * submitted deliverable, measured or not, which is the coverage denominator.
 */
export function creatorMetricsQuery(creatorProfileId: string) {
  return db
    .select({
      views: sql<number | null>`SUM(${videoMetric.views})::int`,
      likes: sql<number | null>`SUM(${videoMetric.likes})::int`,
      shares: sql<number | null>`SUM(${videoMetric.shares})::int`,
      comments: sql<number | null>`SUM(${videoMetric.comments})::int`,
      measuredVideos: sql<number>`COUNT(*) FILTER (WHERE ${videoMetric.id} IS NOT NULL AND COALESCE(${videoMetric.views}, ${videoMetric.likes}, ${videoMetric.shares}, ${videoMetric.comments}) IS NOT NULL)::int`,
      totalVideos: sql<number>`COUNT(*)::int`,
    })
    .from(deliverable)
    .innerJoin(deal, eq(deliverable.dealId, deal.id))
    .leftJoin(videoMetric, eq(videoMetric.deliverableId, deliverable.id))
    .where(eq(deal.creatorId, creatorProfileId));
}

export function topVideosQuery(creatorProfileId: string) {
  return db
    .select({
      deliverableId: deliverable.id,
      dealId: deal.id,
      campaignName: campaign.name,
      tiktokUrl: deliverable.tiktokUrl,
      thumbnailUrl: deliverable.thumbnailUrl,
      tiktokVideoId: deliverable.tiktokVideoId,
      reviewStatus: deliverable.reviewStatus,
      submittedAt: deliverable.submittedAt,
      views: videoMetric.views,
      likes: videoMetric.likes,
      shares: videoMetric.shares,
      comments: videoMetric.comments,
    })
    .from(deliverable)
    .innerJoin(deal, eq(deliverable.dealId, deal.id))
    .innerJoin(campaign, eq(deal.campaignId, campaign.id))
    .leftJoin(videoMetric, eq(videoMetric.deliverableId, deliverable.id))
    .where(eq(deal.creatorId, creatorProfileId))
    .orderBy(
      sql`${videoMetric.views} desc nulls last`,
      desc(deliverable.submittedAt)
    )
    .limit(5);
}

export async function relationshipStatsQuery(creatorProfileId: string) {
  const result = await db.execute<{
    brands_worked_with: number;
    repeat_brands: number;
  }>(sql`
    with brand_counts as (
      select c.brand_id, count(*)::int as deals
      from deal d
      inner join campaign c on c.id = d.campaign_id
      where d.creator_id = ${creatorProfileId}
      group by c.brand_id
    )
    select
      count(*)::int as brands_worked_with,
      count(*) filter (where deals > 1)::int as repeat_brands
    from brand_counts
  `);
  const row = result.rows[0];

  return {
    brandsWorkedWith: Number(row?.brands_worked_with ?? 0),
    repeatBrands: Number(row?.repeat_brands ?? 0),
  };
}

export async function reliabilityQuery(creatorProfileId: string) {
  const result = await db.execute<{
    avg_submit_days: number | null;
    approval_rate: number | null;
    revision_rate: number | null;
  }>(sql`
    select
      avg(extract(epoch from (dl.submitted_at - d.created_at)) / 86400.0)::float as avg_submit_days,
      (
        count(*) filter (where dl.review_status = 'approved')::float
        / nullif(count(*), 0)
      ) as approval_rate,
      (
        count(*) filter (where dl.review_status = 'rejected')::float
        / nullif(count(*), 0)
      ) as revision_rate
    from deliverable dl
    inner join deal d on d.id = dl.deal_id
    where d.creator_id = ${creatorProfileId}
  `);
  const row = result.rows[0];

  return {
    avgSubmitDays:
      row?.avg_submit_days === null || row?.avg_submit_days === undefined
        ? null
        : Number(row.avg_submit_days),
    approvalRate:
      row?.approval_rate === null || row?.approval_rate === undefined
        ? null
        : Number(row.approval_rate),
    revisionRate:
      row?.revision_rate === null || row?.revision_rate === undefined
        ? null
        : Number(row.revision_rate),
  };
}

export async function growthQuery(
  creatorProfileId: string
): Promise<CreatorDashboard['growth']> {
  const rows = await db
    .select({
      followerCount: creatorMetricSnapshot.followerCount,
      engagementRate: creatorMetricSnapshot.engagementRate,
      capturedAt: creatorMetricSnapshot.capturedAt,
    })
    .from(creatorMetricSnapshot)
    .where(eq(creatorMetricSnapshot.creatorId, creatorProfileId))
    .orderBy(desc(creatorMetricSnapshot.capturedAt))
    .limit(2);

  const [latest, previous] = rows;
  return {
    followersDelta:
      latest && previous ? latest.followerCount - previous.followerCount : null,
    engagementDelta:
      latest && previous && latest.engagementRate !== null
        ? Number(latest.engagementRate) - Number(previous.engagementRate ?? 0)
        : null,
    latestAt: latest?.capturedAt ?? null,
    previousAt: previous?.capturedAt ?? null,
  };
}

export async function weeklyLiftQuery(
  creatorProfileId: string,
  now: Date
): Promise<CreatorDashboard['weeklyLift']> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const result = await db.execute<{
    views: number | null;
    likes: number | null;
    shares: number | null;
    comments: number | null;
  }>(sql`
    with creator_deliverables as (
      select dl.id
      from deliverable dl
      inner join deal d on d.id = dl.deal_id
      where d.creator_id = ${creatorProfileId}
    ),
    latest as (
      select distinct on (s.deliverable_id)
        s.deliverable_id, s.views, s.likes, s.shares, s.comments
      from video_metric_snapshot s
      inner join creator_deliverables cd on cd.id = s.deliverable_id
      order by s.deliverable_id, s.captured_at desc
    ),
    baseline as (
      select distinct on (s.deliverable_id)
        s.deliverable_id, s.views, s.likes, s.shares, s.comments
      from video_metric_snapshot s
      inner join creator_deliverables cd on cd.id = s.deliverable_id
      where s.captured_at <= ${weekAgo}
      order by s.deliverable_id, s.captured_at desc
    )
    select
      sum(latest.views - baseline.views)::int as views,
      sum(latest.likes - baseline.likes)::int as likes,
      sum(latest.shares - baseline.shares)::int as shares,
      sum(latest.comments - baseline.comments)::int as comments
    from latest
    inner join baseline on baseline.deliverable_id = latest.deliverable_id
  `);
  const row = result.rows[0];

  return {
    views: row?.views ?? null,
    likes: row?.likes ?? null,
    shares: row?.shares ?? null,
    comments: row?.comments ?? null,
  };
}

/**
 * Partitions rows into all five groups, in `DEAL_GROUPS` order.
 *
 * Re-exported rather than defined here since KAN-39: the deal inbox partitions
 * the same nine statuses, so this arrived at its second caller and moved to
 * `lib/deals/groups.ts` beside the mapping it is built on. Kept exported from
 * this module because it is part of the dashboard's surface and its callers
 * have no reason to learn where the implementation went.
 */
export { groupDeals };

/** Seam for tests, matching the shape the rest of `lib/` uses. */
export interface CreatorDashboardDeps {
  requireCreator: () => Promise<{ creatorProfileId: string | null }>;
  selectEarnings: (creatorProfileId: string) => Promise<CreatorEarnings>;
  selectDeals: (creatorProfileId: string) => Promise<CreatorDealRow[]>;
  selectPayoutEvents: (
    creatorProfileId: string
  ) => Promise<Array<{ createdAt: Date; amount: number }>>;
  selectUnmeasuredDeals: (
    creatorProfileId: string
  ) => Promise<Array<{ dealId: string }>>;
  selectMetrics: (
    creatorProfileId: string
  ) => Promise<CreatorDashboard['metrics']>;
  selectTopVideos: (
    creatorProfileId: string
  ) => Promise<CreatorDashboard['topVideos']>;
  selectRelationships: (
    creatorProfileId: string
  ) => Promise<CreatorDashboard['relationships']>;
  selectReliability: (
    creatorProfileId: string
  ) => Promise<CreatorDashboard['reliability']>;
  selectGrowth: (
    creatorProfileId: string
  ) => Promise<CreatorDashboard['growth']>;
  selectWeeklyLift: (
    creatorProfileId: string,
    now: Date
  ) => Promise<CreatorDashboard['weeklyLift']>;
}

async function selectEarnings(
  creatorProfileId: string
): Promise<CreatorEarnings> {
  const [row] = await earningsQuery(creatorProfileId);

  // Belt and braces on the bigint-as-string trap above: the cast makes these
  // numbers, and `Number` keeps them numbers if the cast is ever edited away.
  return {
    paidOut: Number(row?.paidOut ?? 0),
    inEscrow: Number(row?.inEscrow ?? 0),
  };
}

async function selectDeals(
  creatorProfileId: string
): Promise<CreatorDealRow[]> {
  return dealsQuery(creatorProfileId);
}

async function selectPayoutEvents(
  creatorProfileId: string
): Promise<Array<{ createdAt: Date; amount: number }>> {
  return payoutEventsQuery(creatorProfileId);
}

async function selectUnmeasuredDeals(
  creatorProfileId: string
): Promise<Array<{ dealId: string }>> {
  return unmeasuredDealsQuery(creatorProfileId);
}

async function selectMetrics(
  creatorProfileId: string
): Promise<CreatorDashboard['metrics']> {
  const [row] = await creatorMetricsQuery(creatorProfileId);
  return {
    views: row?.views ?? null,
    likes: row?.likes ?? null,
    shares: row?.shares ?? null,
    comments: row?.comments ?? null,
    measuredVideos: Number(row?.measuredVideos ?? 0),
    totalVideos: Number(row?.totalVideos ?? 0),
  };
}

const defaultDeps: CreatorDashboardDeps = {
  requireCreator: () => guard({ roles: ['creator'] }),
  selectEarnings,
  selectDeals,
  selectPayoutEvents,
  selectUnmeasuredDeals,
  selectMetrics,
  selectTopVideos: topVideosQuery,
  selectRelationships: relationshipStatsQuery,
  selectReliability: reliabilityQuery,
  selectGrowth: growthQuery,
  selectWeeklyLift: weeklyLiftQuery,
};

/**
 * The creator's own dashboard data. Throws `ForbiddenError` for every non-
 * creator caller, including unauthenticated ones — `guard` fails closed.
 *
 * Returns `null` when the caller is a creator with no profile row yet. That is
 * the pre-onboarding state, and it is the page's cue to redirect to the form
 * rather than render an empty dashboard — the same thing `/creator` already
 * does when `getCreatorProfileWithTier` misses.
 *
 * The two reads are issued together. They touch different tables and neither
 * feeds the other, so awaiting them in sequence would add a round trip to a
 * page with a 3-second budget (AC-7).
 */
export async function readCreatorDashboard(
  deps: CreatorDashboardDeps = defaultDeps
): Promise<CreatorDashboard | null> {
  const { creatorProfileId } = await deps.requireCreator();
  if (!creatorProfileId) return null;

  const now = new Date();
  const [
    earnings,
    rows,
    payoutEvents,
    unmeasured,
    metrics,
    topVideos,
    relationships,
    reliability,
    growth,
    weeklyLift,
  ] = await Promise.all([
    deps.selectEarnings(creatorProfileId),
    deps.selectDeals(creatorProfileId),
    deps.selectPayoutEvents(creatorProfileId),
    deps.selectUnmeasuredDeals(creatorProfileId),
    deps.selectMetrics(creatorProfileId),
    deps.selectTopVideos(creatorProfileId),
    deps.selectRelationships(creatorProfileId),
    deps.selectReliability(creatorProfileId),
    deps.selectGrowth(creatorProfileId),
    deps.selectWeeklyLift(creatorProfileId, now),
  ]);

  const unmeasuredDealIds = [...new Set(unmeasured.map((r) => r.dealId))];
  const cutoff = Date.now() + 48 * 60 * 60 * 1000;
  const expiringOffers = rows
    .filter(
      (r) =>
        r.status === 'pending' &&
        r.offerExpiresAt !== null &&
        r.offerExpiresAt.getTime() < cutoff
    )
    .sort(
      (a, b) =>
        (a.offerExpiresAt as Date).getTime() -
        (b.offerExpiresAt as Date).getTime()
    )
    .map((r) => ({
      id: r.id,
      campaignName: r.campaignName,
      offerExpiresAt: r.offerExpiresAt as Date,
    }));

  return {
    earnings,
    groups: groupDeals(rows),
    isEmpty: rows.length === 0,
    payouts: buildCumulativeWeeklyPayouts(
      payoutEvents.map((event) => ({
        createdAt: event.createdAt,
        paidOut: -event.amount,
      })),
      now
    ),
    unmeasuredDealIds,
    expiringOffers,
    metrics,
    actions: {
      pendingOffers: rows.filter((r) => r.status === 'pending').length,
      readyToDeliver: rows.filter(
        (r) => r.status === 'funded' || r.status === 'accepted'
      ).length,
      needsRevision: rows.filter((r) => r.status === 'revision_requested')
        .length,
      needsMetrics: unmeasuredDealIds.length,
    },
    topVideos,
    relationships,
    reliability,
    growth,
    weeklyLift,
  };
}

/**
 * Dashboard copy, held here for the reason `NO_MATCHES_TITLE` is held beside
 * discovery's query: a string that exists in exactly one place cannot be
 * paraphrased apart from itself by a later edit to a page.
 *
 * AC-5 asks for a useful empty state rather than a blank page, and "no offers
 * yet" is the wrong sentence for a creator who is not bookable — they are not
 * waiting on a brand, they are waiting on verification or a tier. So there are
 * two, and the page picks by whether the creator can actually be booked.
 */
export const EARNINGS_PAID_OUT_LABEL = 'Paid out to date';
export const EARNINGS_IN_ESCROW_LABEL = 'Held in escrow';
export const EARNINGS_NET_NOTE =
  'Payouts are shown net of the commission agreed on each deal.';

export const NO_DEALS_TITLE = 'No deals yet.';
export const NO_DEALS_DESCRIPTION =
  'When a brand adds you to a campaign, their offer appears here for you to accept or decline.';

export const NOT_BOOKABLE_TITLE = 'No deals yet.';
export const NOT_BOOKABLE_DESCRIPTION =
  'Brands can send you offers once your profile is verified and priced. Nothing is needed from you in the meantime.';
/**
 * The TikTok-linked variant of the sentence above. "Nothing is needed from
 * you" is wrong for a creator whose stats came up short at onboarding — they
 * *can* post, then use the refresh button on this same page (phase 3 cleanup).
 */
export const NOT_BOOKABLE_TIKTOK_DESCRIPTION =
  'Brands can send you offers once your profile is verified and priced. Posting on TikTok and refreshing your stats above can qualify you for a tier.';
