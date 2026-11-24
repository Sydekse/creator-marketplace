import { describe, expect, it } from 'vitest';
import {
  calculateCampaignInsights,
  checkedSum,
  costRatio,
  formatEfficiency,
  formatShare,
  type InsightDealInput,
  type InsightVideoInput,
} from '@/lib/campaigns/insight-model';
import {
  comparisonRows,
  contributionRows,
  efficiencyRows,
  stageRows,
} from '@/lib/campaigns/insight-display';
import { calculateCollaborationHistory } from '@/lib/campaigns/insight-history';

const settlement = { paidOut: 850, commission: 150, refunded: 400 };
function video(
  id = 'v1',
  extra: Partial<InsightVideoInput> = {}
): InsightVideoInput {
  return {
    id,
    ordinal: 1,
    url: `https://vm.tiktok.com/${id}`,
    tiktokVideoId: null,
    views: 100,
    likes: 10,
    comments: 5,
    shares: 5,
    source: 'creator',
    updatedAt: '2026-09-01T00:00:00Z',
    stale: false,
    ...extra,
  };
}
function deal(
  id = 'd1',
  extra: Partial<InsightDealInput> = {}
): InsightDealInput {
  return {
    id,
    creatorId: id,
    creatorHandle: id,
    status: 'completed',
    videoCount: 1,
    unitPrice: 1_000,
    totalPrice: 1_000,
    commitsBudget: true,
    videos: [video(id)],
    ...extra,
  };
}
const calculate = (deals: InsightDealInput[]) =>
  calculateCampaignInsights(deals, settlement);

describe('recorded campaign efficiency', () => {
  it('keeps empty measurements unknown and ledger refunds distinct', () => {
    const m = calculate([]);
    expect(m).toMatchObject({
      totals: { views: null, likes: null },
      orderedVideos: 0,
      settled: 1_000,
      refunded: 400,
      committed: 0,
      cpv: { ratio: null, cost: 0, deals: 0 },
    });
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
  it('uses ratio of sums, includes measured zeros, never averages ratios', () => {
    const m = calculate([
      deal('a'),
      deal('b', { totalPrice: 3_000, videos: [video('b', { views: 900 })] }),
      deal('c', {
        videos: [video('c', { views: 0, likes: 0, shares: 0, comments: 0 })],
      }),
    ]);
    expect(m.cpv).toMatchObject({
      cost: 5_000,
      results: 1_000,
      ratio: 0.05,
      deals: 3,
      videos: 3,
    });
    expect(m.cpe).toMatchObject({ cost: 5_000, results: 40, ratio: 1.25 });
    expect(m.deals[2].cpv).toBeNull();
    expect(m.creators.find((c) => c.id === 'c')).toMatchObject({
      viewCostShare: 0.2,
      viewShare: 0,
    });
  });
  it('requires every ordered current video and independently complete fields', () => {
    const m = calculate([
      deal('a', { videoCount: 2, totalPrice: 2_000, videos: [video('a')] }),
      deal('b', { videos: [video('b', { likes: null })] }),
      deal('c', { videos: [video('c', { views: null })] }),
    ]);
    expect(m.cpv).toMatchObject({ deals: 1, cost: 1_000, excludedDeals: 2 });
    expect(m.cpe).toMatchObject({ deals: 1, cost: 1_000, excludedDeals: 2 });
    expect(m.coverage).toEqual({ views: 2, likes: 2, comments: 3, shares: 3 });
    expect(m.orderedVideos).toBe(4);
    expect(m.deals[0]).toMatchObject({ cpv: null, cpe: null });
    expect(m.deals[1].videos[0].cpe).toBeNull();
  });
  it('keeps zero counts real, but zero denominators unavailable', () => {
    const m = calculate([
      deal('a', {
        videos: [video('a', { views: 0, likes: 0, shares: 0, comments: 0 })],
      }),
    ]);
    expect(m.totals).toEqual({ views: 0, likes: 0, shares: 0, comments: 0 });
    expect(m.cpv).toMatchObject({
      results: 0,
      ratio: null,
      cost: 1_000,
      deals: 1,
    });
    expect(m.cpe.ratio).toBeNull();
    expect(m.creators[0].viewShare).toBeNull();
    expect(m.creators[0].viewCostShare).toBe(1);
  });
  it.each([
    'pending',
    'accepted',
    'funded',
    'delivered',
    'revision_requested',
    'declined',
    'expired',
    'refunded',
  ] as const)(
    'excludes %s from efficiency but preserves labeled raw totals',
    (status) => {
      const m = calculate([
        deal('a', {
          status,
          commitsBudget: !['declined', 'expired', 'refunded'].includes(status),
        }),
      ]);
      expect(m.cpv.deals).toBe(0);
      expect(m.cpe.deals).toBe(0);
      expect(m.totals.views).toBe(100);
      expect(m.committed).toBe(
        ['declined', 'expired', 'refunded'].includes(status) ? 0 : 1_000
      );
    }
  );
  it('counts deal money once for multiple ordered videos and sorts by stable ordinal', () => {
    const m = calculate([
      deal('a', {
        videoCount: 2,
        totalPrice: 2_000,
        videos: [video('second', { ordinal: 2 }), video('first')],
      }),
    ]);
    expect(m.deals[0].videos.map((v) => v.id)).toEqual(['first', 'second']);
    expect(m.committed).toBe(2_000);
    expect(m.cpv).toMatchObject({
      cost: 2_000,
      results: 200,
      ratio: 0.1,
      videos: 2,
    });
    expect(m.deals[0].videos[0]).toMatchObject({ cpv: 0.1, cpe: 0.5 });
  });
  it('keeps stale reported counts visible and qualified', () => {
    const m = calculate([
      deal('a', { videos: [video('a', { stale: true, source: 'admin' })] }),
    ]);
    expect(m.staleVideos).toBe(1);
    expect(m.cpv.deals).toBe(1);
    expect(m.deals[0].videos[0].source).toBe('admin');
  });
  it('suppresses all deals with known duplicate IDs even across URL variants', () => {
    const m = calculate([
      deal('a', { videos: [video('a', { tiktokVideoId: '123456' })] }),
      deal('b', {
        videos: [
          video('b', { url: 'https://www.tiktok.com/@other/video/123456?x=1' }),
        ],
      }),
      deal('c'),
    ]);
    expect(m.duplicateVideos).toBe(2);
    expect(m.cpv.deals).toBe(1);
    expect(m.deals[0].videos[0].cpv).toBeNull();
    expect(m.deals[1].cpe).toBeNull();
    expect(m.totals.views).toBe(300);
  });
  it('never guesses opaque short links, invalid URLs, or unrelated hosts', () => {
    const urls = [
      'https://vm.tiktok.com/same',
      'https://vm.tiktok.com/same',
      'invalid',
      'https://example.org/@a/video/123',
      'https://tiktok.com/@a/photo/123',
      'https://tiktok.com/@a/video/456/',
    ];
    const m = calculate(
      urls.map((url, i) =>
        deal(String(i), {
          videos: [video(String(i), { url, tiktokVideoId: 'invalid-id' })],
        })
      )
    );
    expect(m.duplicateVideos).toBe(0);
    expect(m.cpv.deals).toBe(urls.length);
  });
  it.each([
    'https://m.tiktok.com/@creator/video/123456?from=share',
    'm.tiktok.com/@creator/video/123456/',
    'www.tiktok.com/@creator/video/123456',
    'tiktok.com/@creator/video/123456',
    'HTTP://M.TIKTOK.COM/@creator/VIDEO/123456',
  ])('excludes duplicate legacy identities in accepted URL form %s', (url) => {
    const m = calculate([
      deal('a', {
        videos: [
          video('a', { url: 'https://www.tiktok.com/@creator/video/123456' }),
        ],
      }),
      deal('b', { videos: [video('b', { url })] }),
    ]);
    expect(m.duplicateVideos).toBe(2);
    expect(m.cpv.deals).toBe(0);
    expect(m.cpe.deals).toBe(0);
    expect(m.totals.views).toBe(200);
  });
  it('null-only metric fields stay null and no submission is not a measured zero', () => {
    const m = calculate([
      deal('a', { videos: [] }),
      deal('b', {
        videos: [
          video('b', {
            views: null,
            likes: null,
            shares: null,
            comments: null,
          }),
        ],
      }),
    ]);
    expect(m.totals.views).toBeNull();
    expect(m.coverage.views).toBe(0);
    expect(m.deals[0].engagement).toBeNull();
  });
  it('groups same creators by ID and preserves same-label creators separately', () => {
    const m = calculate([
      deal('z', { creatorId: 'same', creatorHandle: 'equal' }),
      deal('a', { creatorId: 'same', creatorHandle: 'equal' }),
      deal('b', { creatorHandle: 'equal' }),
    ]);
    expect(m.creators).toHaveLength(2);
    expect(m.creators.find((c) => c.id === 'same')?.cpv.deals).toBe(2);
    expect(m.creators.map((c) => c.id)).toEqual(['b', 'same']);
  });
});

describe('precision and chart reconciliation', () => {
  it.each([
    [-1],
    [NaN],
    [Infinity],
    [0.1],
    [Number.MAX_SAFE_INTEGER + 1],
    [Number.MAX_SAFE_INTEGER, 1],
  ])('rejects unsafe arithmetic %j', (...values) => {
    expect(() => checkedSum(values)).toThrow(RangeError);
  });
  it('keeps safe integer boundaries and sub-santim ratios', () => {
    expect(checkedSum([Number.MAX_SAFE_INTEGER])).toBe(Number.MAX_SAFE_INTEGER);
    expect(costRatio(1, 1_000_000)).toBe(0.00000001);
    expect(costRatio(0, 10)).toBe(0);
    expect(costRatio(1, null)).toBeNull();
    expect(costRatio(1, 0)).toBeNull();
  });
  it.each([
    [null, 'Unavailable'],
    [NaN, 'Unavailable'],
    [Infinity, 'Unavailable'],
    [-1, 'Unavailable'],
    [0, '0 ETB'],
    [0.00001, '<0.0001 ETB'],
    [0.0001, '0.0001 ETB'],
    [1.123456, '1.1235 ETB'],
  ])('formats %s honestly as %s', (input, expected) => {
    expect(formatEfficiency(input as number | null)).toBe(expected);
  });
  it('formats null and real zero shares differently', () => {
    expect(formatShare(null)).toBe('Unavailable');
    expect(formatShare(0)).toBe('0.0%');
    expect(formatShare(1 / 3)).toBe('33.3%');
  });
  it('projects the same creator values and order into chart data, with nulls last per metric', () => {
    const m = calculate([
      deal('zero', { videos: [video('zero', { views: null, likes: null })] }),
      deal('b', { videos: [video('b', { likes: 100, views: 10 })] }),
      deal('a'),
    ]);
    for (const key of ['cpv', 'cpe'] as const) {
      const sorted = comparisonRows(m, key);
      expect(sorted.at(-1)?.id).toBe('zero');
      const bars = efficiencyRows(sorted, key);
      expect(bars.map((r) => r.primary)).toEqual(
        sorted.map((c) => c[key].ratio)
      );
      const shares = contributionRows(sorted, key);
      expect(shares.map((r) => r.id)).toEqual(sorted.map((c) => c.id));
      expect(shares[0].primary).toBe(
        (key === 'cpv'
          ? sorted[0].viewCostShare!
          : sorted[0].engagementCostShare!) * 100
      );
      expect(shares.at(-1)?.primary).toBeNull();
    }
    expect(comparisonRows(m, 'cpv')[0].id).toBe('a');
    expect(comparisonRows(m, 'cpe')[0].id).toBe('b');
    const missing = calculate([
      deal('z', { videos: [] }),
      deal('a', { videos: [] }),
    ]);
    expect(comparisonRows(missing, 'cpe').map((c) => c.id)).toEqual(['a', 'z']);
  });
  it('projects stage medians as hours without inventing missing timing', () => {
    const h = calculateCollaborationHistory(
      [],
      '2026-09-01T00:00:00Z'
    ).aggregate;
    h.timing.reviewDecision.medianMs = 1_800_000;
    expect(stageRows(h).map((r) => r.primary)).toEqual([null, 0.5, null]);
  });
});
