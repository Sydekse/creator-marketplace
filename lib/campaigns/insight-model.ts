import type { DealStatus } from '@/db/schema';

export const INSIGHT_FIELDS = ['views', 'likes', 'comments', 'shares'] as const;
export type InsightField = (typeof INSIGHT_FIELDS)[number];
export type Counts = Record<InsightField, number | null>;
export interface InsightVideoInput extends Counts {
  id: string;
  ordinal: number;
  url: string;
  tiktokVideoId: string | null;
  source: 'creator' | 'admin' | null;
  updatedAt: string | null;
  stale: boolean;
}
export interface InsightDealInput {
  id: string;
  creatorId: string;
  creatorHandle: string;
  status: DealStatus;
  videoCount: number;
  unitPrice: number;
  totalPrice: number;
  commitsBudget: boolean;
  videos: InsightVideoInput[];
}
export interface EfficiencyCohort {
  cost: number;
  results: number | null;
  ratio: number | null;
  deals: number;
  videos: number;
  excludedDeals: number;
}
export interface InsightVideo extends InsightVideoInput {
  duplicate: boolean;
  engagement: number | null;
  cpv: number | null;
  cpe: number | null;
}
export interface InsightDeal extends Omit<InsightDealInput, 'videos'> {
  videos: InsightVideo[];
  coverage: Record<InsightField, number>;
  totals: Counts;
  engagement: number | null;
  duplicate: boolean;
  cpv: number | null;
  cpe: number | null;
}
export interface CreatorInsight {
  id: string;
  handle: string;
  orderedVideos: number;
  submittedVideos: number;
  coverage: Record<InsightField, number>;
  totals: Counts;
  committed: number;
  cpv: EfficiencyCohort;
  cpe: EfficiencyCohort;
  viewCostShare: number | null;
  viewShare: number | null;
  engagementCostShare: number | null;
  engagementShare: number | null;
}
export interface CampaignInsightModel {
  deals: InsightDeal[];
  creators: CreatorInsight[];
  totals: Counts;
  coverage: Record<InsightField, number>;
  orderedVideos: number;
  submittedVideos: number;
  completedDeals: number;
  totalDeals: number;
  committed: number;
  settled: number;
  refunded: number;
  cpv: EfficiencyCohort;
  cpe: EfficiencyCohort;
  duplicateVideos: number;
  staleVideos: number;
}

export function checkedSum(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError(
        'Insight counts and costs must be safe non-negative integers'
      );
    sum += value;
    if (!Number.isSafeInteger(sum))
      throw new RangeError('Insight total exceeds safe integer precision');
  }
  return sum;
}

export function costRatio(santim: number, count: number | null): number | null {
  checkedSum([santim]);
  if (count === null) return null;
  checkedSum([count]);
  return count > 0 ? santim / count / 100 : null;
}

export function formatEfficiency(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0)
    return 'Unavailable';
  if (value > 0 && value < 0.0001) return '<0.0001 ETB';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 4 })} ETB`;
}

export function formatShare(value: number | null): string {
  return value === null ? 'Unavailable' : `${(value * 100).toFixed(1)}%`;
}

function identity(video: InsightVideoInput): string | null {
  if (video.tiktokVideoId && /^\d+$/.test(video.tiktokVideoId))
    return video.tiktokVideoId;
  try {
    const url = new URL(
      /^https?:\/\//i.test(video.url) ? video.url : `https://${video.url}`
    );
    if (
      !['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'].includes(url.hostname)
    )
      return null;
    return url.pathname.match(/^\/@[\w.-]+\/video\/(\d+)\/?$/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

function knownSum(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? checkedSum(known) : null;
}

function aggregate(videos: readonly InsightVideoInput[]) {
  const totals: Counts = {
    views: null,
    likes: null,
    comments: null,
    shares: null,
  };
  const coverage = { views: 0, likes: 0, comments: 0, shares: 0 };
  for (const key of INSIGHT_FIELDS) {
    totals[key] = knownSum(videos.map((v) => v[key]));
    coverage[key] = videos.filter((v) => v[key] !== null).length;
  }
  return { totals, coverage };
}

function cohort(deals: InsightDeal[], key: 'cpv' | 'cpe'): EfficiencyCohort {
  // A fully measured zero-result deal still incurred cost. Include its cost
  // in a wider positive cohort even though its own ratio is unavailable.
  const included = deals.filter(
    (d) =>
      d.status === 'completed' &&
      !d.duplicate &&
      d.videoCount > 0 &&
      d.videos.length === d.videoCount &&
      (key === 'cpv'
        ? d.coverage.views === d.videoCount
        : d.engagement !== null)
  );
  const cost = checkedSum(included.map((d) => d.totalPrice));
  const results = knownSum(
    included.map((d) => (key === 'cpv' ? d.totals.views : d.engagement))
  );
  return {
    cost,
    results,
    ratio: costRatio(cost, results),
    deals: included.length,
    videos: checkedSum(included.map((d) => d.videoCount)),
    excludedDeals: deals.length - included.length,
  };
}

export function calculateCampaignInsights(
  inputs: readonly InsightDealInput[],
  settlement: { paidOut: number; commission: number; refunded: number }
): CampaignInsightModel {
  const identities = new Map<string, number>();
  for (const video of inputs.flatMap((d) => d.videos)) {
    const key = identity(video);
    if (key) identities.set(key, (identities.get(key) ?? 0) + 1);
  }
  const deals: InsightDeal[] = inputs.map((input) => {
    checkedSum([input.unitPrice, input.totalPrice, input.videoCount]);
    const videos = [...input.videos]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((video) => {
        const key = identity(video);
        const duplicate = key !== null && identities.get(key)! > 1;
        const engagement =
          video.likes !== null &&
          video.comments !== null &&
          video.shares !== null
            ? checkedSum([video.likes, video.comments, video.shares])
            : null;
        return {
          ...video,
          duplicate,
          engagement,
          cpv: duplicate ? null : costRatio(input.unitPrice, video.views),
          cpe: duplicate ? null : costRatio(input.unitPrice, engagement),
        };
      });
    const { totals, coverage } = aggregate(videos);
    const full = videos.length === input.videoCount && input.videoCount > 0;
    const duplicate = videos.some((v) => v.duplicate);
    const engagement =
      full && videos.every((v) => v.engagement !== null)
        ? knownSum(videos.map((v) => v.engagement))
        : null;
    return {
      ...input,
      videos,
      totals,
      coverage,
      duplicate,
      engagement,
      cpv:
        full && coverage.views === input.videoCount && !duplicate
          ? costRatio(input.totalPrice, totals.views)
          : null,
      cpe: !duplicate ? costRatio(input.totalPrice, engagement) : null,
    };
  });
  const cpv = cohort(deals, 'cpv');
  const cpe = cohort(deals, 'cpe');
  const byCreator = new Map<string, InsightDeal[]>();
  for (const d of deals)
    byCreator.set(d.creatorId, [...(byCreator.get(d.creatorId) ?? []), d]);
  const share = (part: number | null, total: number | null) =>
    part !== null && total !== null && total > 0 ? part / total : null;
  const creators: CreatorInsight[] = [...byCreator.entries()]
    .map(([id, rows]) => {
      const views = cohort(rows, 'cpv');
      const engagement = cohort(rows, 'cpe');
      const videos = rows.flatMap((d) => d.videos);
      return {
        id,
        handle: rows[0].creatorHandle,
        ...aggregate(videos),
        orderedVideos: checkedSum(rows.map((d) => d.videoCount)),
        submittedVideos: videos.length,
        committed: checkedSum(
          rows.filter((d) => d.commitsBudget).map((d) => d.totalPrice)
        ),
        cpv: views,
        cpe: engagement,
        viewCostShare: views.deals ? share(views.cost, cpv.cost) : null,
        viewShare: share(views.results, cpv.results),
        engagementCostShare: engagement.deals
          ? share(engagement.cost, cpe.cost)
          : null,
        engagementShare: share(engagement.results, cpe.results),
      };
    })
    .sort((a, b) => {
      if (a.cpv.ratio === null && b.cpv.ratio !== null) return 1;
      if (b.cpv.ratio === null && a.cpv.ratio !== null) return -1;
      return (
        (a.cpv.ratio ?? 0) - (b.cpv.ratio ?? 0) ||
        a.handle.localeCompare(b.handle) ||
        a.id.localeCompare(b.id)
      );
    });
  const videos = deals.flatMap((d) => d.videos);
  return {
    deals,
    creators,
    ...aggregate(videos),
    cpv,
    cpe,
    orderedVideos: checkedSum(deals.map((d) => d.videoCount)),
    submittedVideos: videos.length,
    completedDeals: deals.filter((d) => d.status === 'completed').length,
    totalDeals: deals.length,
    committed: checkedSum(
      deals.filter((d) => d.commitsBudget).map((d) => d.totalPrice)
    ),
    settled: checkedSum([settlement.paidOut, settlement.commission]),
    refunded: checkedSum([settlement.refunded]),
    duplicateVideos: videos.filter((v) => v.duplicate).length,
    staleVideos: videos.filter((v) => v.stale).length,
  };
}
