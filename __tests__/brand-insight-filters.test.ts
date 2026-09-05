import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSIGHT_FILTERS,
  InsightSelectionError,
  insightHref,
  parseInsightFilters,
  selectInsightCampaigns,
} from '@/lib/brands/insight-filters';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const options = [
  { id: a, status: 'draft' as const, createdAt: '2026-09-01T00:00:00.000Z' },
  {
    id: b,
    status: 'completed' as const,
    createdAt: '2026-09-01T23:59:59.999Z',
  },
];
function parse(params: Parameters<typeof parseInsightFilters>[0]) {
  const result = parseInsightFilters(params);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe('strict shareable brand insight selection', () => {
  it('does not disguise unexpected failures as invalid user input', () => {
    const params = {
      get campaign(): string {
        throw new Error('Unexpected parameter access failure');
      },
    };
    expect(() => parseInsightFilters(params)).toThrow(
      'Unexpected parameter access failure'
    );
  });
  it('defaults all campaigns/status/dates without sharing the mutable ID array', () => {
    const first = parse({});
    expect(first).toEqual(DEFAULT_INSIGHT_FILTERS);
    first.campaignIds.push(a);
    expect(parse({}).campaignIds).toEqual([]);
    expect(parse({ status: '', from: '', to: '' })).toEqual(
      DEFAULT_INSIGHT_FILTERS
    );
    expect(insightHref(DEFAULT_INSIGHT_FILTERS)).toBe('/insights');
  });
  it('normalizes distinct UUIDs, supports repeated campaigns and round trips every field', () => {
    const filters = parse({
      campaign: [a.toUpperCase(), b, a],
      status: 'completed',
      from: '2024-02-29',
      to: '2026-09-05',
      sort: 'cpe',
      metric: 'cpe',
      campaignPage: '2',
      creatorPage: '3',
      waitingPage: '4',
    });
    expect(filters.campaignIds).toEqual([a, b]);
    const query = new URL(insightHref(filters), 'https://example.com')
      .searchParams;
    const params = Object.fromEntries(
      [...new Set(query.keys())].map((key) => [
        key,
        key === 'campaign' ? query.getAll(key) : query.get(key)!,
      ])
    );
    expect(parse(params)).toEqual(filters);
    expect(parse({ campaign: a }).campaignIds).toEqual([a]);
  });
  it.each([
    { campaign: '' },
    { campaign: [a, 'bad'] },
    { campaign: `${a} OR true` },
    { status: 'active' },
    { status: ['draft', 'completed'] },
    { from: '2026-02-29' },
    { from: '2026-04-31' },
    { from: '2026-13-01' },
    { from: '2026-00-01' },
    { from: '0000-01-01' },
    { from: '2026-1-01' },
    { from: '2026-01-01T00:00:00Z' },
    { to: '2026-09-32' },
    { from: '2026-09-02', to: '2026-09-01' },
    { from: ['2026-09-01', '2026-09-01'] },
    { to: [] },
    { sort: 'random' },
    { metric: 'views' },
    { sort: '' },
    { metric: '' },
    { sort: ['views', 'views'] },
    { metric: ['cpv', 'cpv'] },
    { campaignPage: '0' },
    { creatorPage: '-1' },
    { waitingPage: '1.5' },
    { campaignPage: '01' },
    { creatorPage: '1e2' },
    { waitingPage: ' 1' },
    { campaignPage: '9007199254740992' },
    { creatorPage: '' },
    { waitingPage: ['1', '2'] },
  ])('rejects malformed state rather than broadening %j', (params) => {
    expect(parseInsightFilters(params)).toMatchObject({ ok: false });
  });
  it.each([
    'draft',
    'confirmed',
    'funded',
    'in_progress',
    'completed',
    'cancelled',
  ])('supports current status %s', (status) =>
    expect(parse({ status }).status).toBe(status)
  );
  it.each(['spend', 'views', 'engagement', 'cpv', 'cpe', 'name'])(
    'supports sort %s',
    (sort) => expect(parse({ sort }).sort).toBe(sort)
  );
  it('uses inclusive UTC days and intersects IDs/status/date without broadening', () => {
    expect(
      selectInsightCampaigns(
        options,
        parse({ from: '2026-09-01', to: '2026-09-01' })
      )
    ).toEqual(options);
    expect(
      selectInsightCampaigns(options, parse({ to: '2026-08-31' }))
    ).toEqual([]);
    expect(
      selectInsightCampaigns(options, parse({ from: '2026-09-02' }))
    ).toEqual([]);
    expect(
      selectInsightCampaigns(
        options,
        parse({ campaign: a, status: 'completed' })
      )
    ).toEqual([]);
    expect(
      selectInsightCampaigns(
        options,
        parse({ campaign: b, status: 'completed' })
      )
    ).toEqual([options[1]]);
    expect(
      selectInsightCampaigns(options, parse({ to: '9999-12-31' }))
    ).toEqual(options);
  });
  it('rejects missing/foreign IDs even if another filter excludes them', () => {
    expect(() =>
      selectInsightCampaigns(
        options,
        parse({
          campaign: [a, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
          from: '9999-01-01',
        })
      )
    ).toThrow(InsightSelectionError);
  });
  it('preserves state on sorting/paging but resets all pagination on selection edits', () => {
    const filters = parse({
      campaign: a,
      campaignPage: '3',
      creatorPage: '4',
      waitingPage: '5',
    });
    const sorted = new URL(
      insightHref(filters, { sort: 'views' }),
      'https://example.com'
    );
    expect(sorted.searchParams.get('campaign')).toBe(a);
    expect(sorted.searchParams.get('campaignPage')).toBe('3');
    const changed = new URL(
      insightHref(filters, { from: '2026-09-01' }),
      'https://example.com'
    );
    expect(changed.searchParams.has('campaignPage')).toBe(false);
    expect(changed.searchParams.has('creatorPage')).toBe(false);
    expect(changed.searchParams.has('waitingPage')).toBe(false);
    expect(
      insightHref(DEFAULT_INSIGHT_FILTERS, { campaignIds: [a] })
    ).toContain(a);
    expect(parse({ status: ['draft'] }).status).toBe('draft');
  });
});
