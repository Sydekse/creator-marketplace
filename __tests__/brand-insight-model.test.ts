import { describe, expect, it } from 'vitest';
import {
  calculateBrandPerformance,
  distinctInsightRecords,
} from '@/lib/brands/insight-model';
import {
  calculateCampaignInsights,
  type InsightDealInput,
} from '@/lib/campaigns/insight-model';

const zero = { paidOut: 0, commission: 0, refunded: 0 };
function deal(
  id: string,
  campaignId = id,
  creatorId = id
): InsightDealInput & { campaignId: string } {
  return {
    id,
    campaignId,
    creatorId,
    creatorHandle: creatorId,
    status: 'completed',
    videoCount: 1,
    unitPrice: 1_000,
    totalPrice: 1_000,
    commitsBudget: true,
    videos: [
      {
        id: `video-${id}`,
        ordinal: 1,
        url: `https://vm.tiktok.com/${id}`,
        tiktokVideoId: null,
        views: 100,
        likes: 10,
        comments: 0,
        shares: 0,
        source: 'creator',
        updatedAt: null,
        stale: false,
      },
    ],
  };
}

describe('selection-wide performance aggregation', () => {
  it.each([true, false])(
    'preserves cross-campaign repeats in all cohorts (same creator: %s)',
    (sameCreator) => {
      const a = deal('a');
      const b = deal('b', 'b', sameCreator ? 'a' : 'b');
      a.videos[0].tiktokVideoId = '123456';
      b.videos[0].url = 'm.tiktok.com/@creator/video/123456?share=1';
      const result = calculateBrandPerformance(
        [a, b, deal('c')],
        ['a', 'b', 'c', 'draft'],
        new Map()
      );
      expect(result.overall).toMatchObject({
        duplicateVideos: 2,
        totals: { views: 300 },
        cpv: { deals: 1 },
      });
      for (const id of ['a', 'b']) {
        expect(result.campaigns.get(id)).toMatchObject({
          duplicateVideos: 1,
          cpv: { deals: 0, excludedDeals: 1 },
          cpe: { deals: 0 },
        });
        expect(result.campaigns.get(id)?.creators[0]).toMatchObject({
          viewShare: null,
          engagementShare: null,
        });
      }
      expect(result.campaigns.get('draft')).toMatchObject({
        totalDeals: 0,
        settled: 0,
        totals: { views: null },
      });
      expect(calculateCampaignInsights([a], zero).cpv.deals).toBe(1);
      expect(
        calculateBrandPerformance([a, b], ['a'], new Map()).overall.cpv.deals
      ).toBe(1);
      expect(
        result.overall.creators.find((row) => row.id === 'a')?.cpv.deals
      ).toBe(0);
    }
  );
  it('recomputes weighted cohorts, includes measured zero cost and separates partial engagement', () => {
    const a = deal('a');
    const b = deal('b');
    b.totalPrice = 3_000;
    b.videos[0].views = 900;
    b.videos[0].likes = null;
    const c = deal('c');
    c.videos[0].views = 0;
    c.videos[0].likes = 0;
    const result = calculateBrandPerformance(
      [a, b, c],
      ['a', 'b', 'c'],
      new Map()
    );
    expect(result.overall.cpv).toMatchObject({
      cost: 5_000,
      results: 1_000,
      ratio: 0.05,
      deals: 3,
    });
    expect(result.overall.cpe).toMatchObject({
      cost: 2_000,
      results: 10,
      ratio: 2,
      deals: 2,
    });
    expect(result.campaigns.get('c')?.cpv).toMatchObject({
      cost: 1_000,
      results: 0,
      ratio: null,
    });
  });
  it('counts repeated database IDs once but rejects conflicting record evidence', () => {
    const a = deal('a');
    a.videos.push({ ...a.videos[0] });
    const result = calculateBrandPerformance(
      [a, { ...a }],
      ['a', 'a'],
      new Map()
    );
    expect(result.overall).toMatchObject({
      totalDeals: 1,
      submittedVideos: 1,
      duplicateVideos: 0,
      cpv: { deals: 1 },
    });
    expect(() =>
      calculateBrandPerformance([a, { ...a, totalPrice: 9 }], ['a'], new Map())
    ).toThrow('Conflicting');
    expect(() =>
      calculateBrandPerformance(
        [{ ...a, videos: [a.videos[0], { ...a.videos[0], views: 900 }] }],
        ['a'],
        new Map()
      )
    ).toThrow('Conflicting');
    const b = deal('b');
    b.videos[0].id = a.videos[0].id;
    expect(() =>
      calculateBrandPerformance([a, b], ['a', 'b'], new Map())
    ).toThrow('ownership');
    expect(
      distinctInsightRecords(
        [
          { id: 'x', a: 1 },
          { a: 1, id: 'x' },
        ],
        (row) => row.id
      )
    ).toHaveLength(1);
  });
  it('uses distinct selected settlement sums above 32-bit limits and rejects unsafe sums', () => {
    const settlements = new Map([
      ['a', { paidOut: 3_000_000_000, commission: 500_000_000, refunded: 400 }],
      ['b', { paidOut: 4_000_000_000, commission: 100_000_000, refunded: 600 }],
      [
        'foreign',
        { paidOut: Number.MAX_SAFE_INTEGER, commission: 0, refunded: 0 },
      ],
    ]);
    expect(
      calculateBrandPerformance([], ['a', 'b', 'a'], settlements).overall
    ).toMatchObject({
      settled: 7_600_000_000,
      refunded: 1_000,
    });
    expect(() =>
      calculateBrandPerformance([], ['a', 'foreign'], settlements)
    ).toThrow(RangeError);
    expect(() =>
      calculateBrandPerformance(
        [],
        ['a'],
        new Map([['a', { ...zero, paidOut: -1 }]])
      )
    ).toThrow(RangeError);
  });
});
