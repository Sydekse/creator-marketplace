import type { CampaignStatus } from '@/db/schema';
import { UUID_REGEX } from '@/lib/validation';

export type InsightFilters = {
  campaignIds: string[];
  status: CampaignStatus | null;
  from: string | null;
  to: string | null;
  sort: 'spend' | 'views' | 'engagement' | 'cpv' | 'cpe' | 'name';
  metric: 'cpv' | 'cpe';
  campaignPage: number;
  creatorPage: number;
  waitingPage: number;
};

export const DEFAULT_INSIGHT_FILTERS: InsightFilters = {
  campaignIds: [],
  status: null,
  from: null,
  to: null,
  sort: 'spend',
  metric: 'cpv',
  campaignPage: 1,
  creatorPage: 1,
  waitingPage: 1,
};

const statuses: readonly CampaignStatus[] = [
  'draft',
  'confirmed',
  'funded',
  'in_progress',
  'completed',
  'cancelled',
];
const sorts: readonly InsightFilters['sort'][] = [
  'spend',
  'views',
  'engagement',
  'cpv',
  'cpe',
  'name',
];
type Params = Record<string, string | string[] | undefined>;
class InvalidInsightFilter extends Error {}

function scalar(params: Params, key: string): string | undefined {
  const value = params[key];
  if (!Array.isArray(value)) return value;
  if (value.length !== 1) throw new InvalidInsightFilter('Repeated filter');
  return value[0];
}

function date(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
    throw new InvalidInsightFilter('Invalid date');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new InvalidInsightFilter('Invalid date');
  return value;
}

export function parseInsightFilters(
  params: Params
): { ok: true; value: InsightFilters } | { ok: false; message: string } {
  try {
    const rawIds = params.campaign;
    const campaignIds =
      rawIds === undefined ? [] : Array.isArray(rawIds) ? rawIds : [rawIds];
    if (campaignIds.some((id) => !UUID_REGEX.test(id)))
      throw new InvalidInsightFilter('Invalid campaign');
    const status = scalar(params, 'status') || null;
    if (status !== null && !statuses.includes(status as CampaignStatus))
      throw new InvalidInsightFilter('Invalid status');
    const from = date(scalar(params, 'from'));
    const to = date(scalar(params, 'to'));
    if (from && to && from > to)
      throw new InvalidInsightFilter('Reversed range');
    const sort = scalar(params, 'sort') ?? 'spend';
    if (!sorts.includes(sort as InsightFilters['sort']))
      throw new InvalidInsightFilter('Invalid sort');
    const metric = scalar(params, 'metric') ?? 'cpv';
    if (metric !== 'cpv' && metric !== 'cpe')
      throw new InvalidInsightFilter('Invalid metric');
    const page = (key: string) => {
      const raw = scalar(params, key) ?? '1';
      const value = Number(raw);
      if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(value))
        throw new InvalidInsightFilter('Invalid page');
      return value;
    };
    return {
      ok: true,
      value: {
        campaignIds: [...new Set(campaignIds.map((id) => id.toLowerCase()))],
        status: status as CampaignStatus | null,
        from,
        to,
        sort: sort as InsightFilters['sort'],
        metric,
        campaignPage: page('campaignPage'),
        creatorPage: page('creatorPage'),
        waitingPage: page('waitingPage'),
      },
    };
  } catch (error) {
    if (!(error instanceof InvalidInsightFilter)) throw error;
    return {
      ok: false,
      message:
        'Invalid insight filters. Check campaigns, status, dates and pages.',
    };
  }
}

export function insightHref(
  filters: InsightFilters,
  changes: Partial<InsightFilters> = {}
): string {
  const selectionChanged = ['campaignIds', 'status', 'from', 'to'].some((key) =>
    Object.prototype.hasOwnProperty.call(changes, key)
  );
  const next = {
    ...filters,
    ...changes,
    ...(selectionChanged
      ? { campaignPage: 1, creatorPage: 1, waitingPage: 1 }
      : {}),
  };
  const params = new URLSearchParams();
  for (const id of next.campaignIds) params.append('campaign', id);
  for (const key of ['status', 'from', 'to'] as const)
    if (next[key] !== null) params.set(key, next[key]);
  if (next.sort !== 'spend') params.set('sort', next.sort);
  if (next.metric !== 'cpv') params.set('metric', next.metric);
  for (const key of ['campaignPage', 'creatorPage', 'waitingPage'] as const)
    if (next[key] !== 1) params.set(key, String(next[key]));
  const query = params.toString();
  return `/insights${query ? `?${query}` : ''}`;
}

export class InsightSelectionError extends Error {
  constructor() {
    super('Selected campaigns are unavailable.');
    this.name = 'InsightSelectionError';
  }
}

export function selectInsightCampaigns<
  T extends { id: string; status: CampaignStatus; createdAt: string },
>(options: readonly T[], filters: InsightFilters): T[] {
  const owned = new Set(options.map((option) => option.id));
  if (filters.campaignIds.some((id) => !owned.has(id)))
    throw new InsightSelectionError();
  const ids = new Set(filters.campaignIds);
  const start = filters.from
    ? Date.parse(`${filters.from}T00:00:00.000Z`)
    : null;
  const end = filters.to
    ? Date.parse(`${filters.to}T00:00:00.000Z`) + 86_400_000
    : null;
  return options.filter(
    (option) =>
      (!ids.size || ids.has(option.id)) &&
      (filters.status === null || option.status === filters.status) &&
      (start === null || Date.parse(option.createdAt) >= start) &&
      (end === null || Date.parse(option.createdAt) < end)
  );
}
