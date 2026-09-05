import type {
  CreatorInsight,
  CampaignInsightModel,
} from '@/lib/campaigns/insight-model';
import { checkedSum } from '@/lib/campaigns/insight-model';
import type { InsightFilters } from './insight-filters';

export const INSIGHT_PAGE_SIZE = 20;
export const INSIGHT_CHART_SIZE = 10;

export function recordedEngagement(model: CampaignInsightModel) {
  const known = model.deals.flatMap((deal) =>
    deal.videos.flatMap((video) =>
      video.engagement === null ? [] : [video.engagement]
    )
  );
  return {
    total: known.length ? checkedSum(known) : null,
    videos: known.length,
  };
}

export function insightPage<T>(rows: readonly T[], requested: number) {
  const pages = Math.max(1, Math.ceil(rows.length / INSIGHT_PAGE_SIZE));
  const page = Math.min(requested, pages);
  const start = (page - 1) * INSIGHT_PAGE_SIZE;
  return {
    rows: rows.slice(start, start + INSIGHT_PAGE_SIZE),
    page,
    pages,
    start,
    total: rows.length,
  };
}

function nullableCompare(
  a: number | null,
  b: number | null,
  ascending: boolean
) {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return ascending ? a - b : b - a;
}

export function sortedCampaigns<
  T extends { id: string; name: string; metrics: CampaignInsightModel },
>(rows: readonly T[], sort: InsightFilters['sort']) {
  const value = (row: T) => {
    if (sort === 'spend') return row.metrics.settled;
    if (sort === 'views') return row.metrics.totals.views;
    if (sort === 'engagement') return recordedEngagement(row.metrics).total;
    if (sort === 'cpv' || sort === 'cpe') return row.metrics[sort].ratio;
    return null;
  };
  return [...rows].sort(
    (a, b) =>
      (sort === 'name'
        ? 0
        : nullableCompare(
            value(a),
            value(b),
            sort === 'cpv' || sort === 'cpe'
          )) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
  );
}

export function sortedCreators(
  rows: readonly CreatorInsight[],
  metric: 'cpv' | 'cpe'
) {
  return [...rows].sort(
    (a, b) =>
      nullableCompare(a[metric].ratio, b[metric].ratio, true) ||
      a.handle.localeCompare(b.handle) ||
      a.id.localeCompare(b.id)
  );
}

export function cohortShare(part: number | null, total: number | null) {
  return part === null || total === null || total <= 0 ? null : part / total;
}
