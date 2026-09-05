import { describe, expect, it } from 'vitest';
import {
  calculateCampaignInsights,
  type InsightDealInput,
} from '@/lib/campaigns/insight-model';
import {
  cohortShare,
  insightPage,
  recordedEngagement,
  sortedCampaigns,
  sortedCreators,
} from '@/lib/brands/insight-presentation';

const settlement = { paidOut: 0, commission: 0, refunded: 0 };
function model(id: string, views: number | null, likes: number | null = 1) {
  const input: InsightDealInput = {
    id,
    creatorId: id,
    creatorHandle: id,
    status: 'completed',
    videoCount: 1,
    unitPrice: 10_000,
    totalPrice: 10_000,
    commitsBudget: true,
    videos: [
      {
        id: `video-${id}`,
        ordinal: 1,
        url: `https://vm.tiktok.com/${id}/`,
        tiktokVideoId: null,
        source: 'creator',
        updatedAt: null,
        stale: false,
        views,
        likes,
        comments: 0,
        shares: 0,
      },
    ],
  };
  return calculateCampaignInsights([input], settlement);
}

describe('overall Insights presentation', () => {
  it('counts only complete engagement observations; known zero is not pending', () => {
    expect(recordedEngagement(model('unknown', 1, null))).toEqual({
      total: null,
      videos: 0,
    });
    expect(recordedEngagement(model('zero', 1, 0))).toEqual({
      total: 0,
      videos: 1,
    });
    expect(recordedEngagement(model('measured', 1, 4))).toEqual({
      total: 4,
      videos: 1,
    });
  });

  it('paginates presentation only and clamps pages after data changes', () => {
    const rows = Array.from({ length: 45 }, (_, i) => i);
    expect(insightPage(rows, 2)).toEqual({
      rows: rows.slice(20, 40),
      page: 2,
      pages: 3,
      start: 20,
      total: 45,
    });
    expect(insightPage(rows, 999).rows).toEqual([40, 41, 42, 43, 44]);
    expect(insightPage([], 3)).toEqual({
      rows: [],
      page: 1,
      pages: 1,
      start: 0,
      total: 0,
    });
    expect(rows).toHaveLength(45);
  });

  it('keeps cost/result share denominators global, with null and zero separate', () => {
    expect(cohortShare(10, 100)).toBe(0.1);
    expect(cohortShare(0, 100)).toBe(0);
    expect(cohortShare(null, 100)).toBeNull();
    expect(cohortShare(10, null)).toBeNull();
    expect(cohortShare(10, 0)).toBeNull();
  });

  it('sorts campaign results descending and efficiency ascending with missing values last', () => {
    const rows = [
      { id: 'missing', name: 'Missing', metrics: model('missing', null) },
      { id: 'small', name: 'Small', metrics: model('small', 10) },
      { id: 'large', name: 'Large', metrics: model('large', 100) },
    ];
    for (const sort of ['views', 'cpv'] as const) {
      expect(sortedCampaigns(rows, sort).map((row) => row.id)).toEqual([
        'large',
        'small',
        'missing',
      ]);
    }
    expect(sortedCampaigns(rows, 'name').map((row) => row.id)).toEqual([
      'large',
      'missing',
      'small',
    ]);
    expect(sortedCampaigns(rows, 'spend').map((row) => row.id)).toEqual([
      'large',
      'missing',
      'small',
    ]);
    expect(sortedCampaigns(rows, 'engagement')).toHaveLength(3);
    expect(sortedCampaigns(rows, 'cpe')).toHaveLength(3);
    expect(rows[0].id).toBe('missing');
  });

  it('uses stable IDs for identical names and keeps unavailable creator ratios last', () => {
    const rows = ['b', 'a'].map((id) => ({
      id,
      name: 'Same',
      metrics: model(id, null),
    }));
    expect(sortedCampaigns(rows, 'cpv').map((row) => row.id)).toEqual([
      'a',
      'b',
    ]);
    const creators = [
      model('missing', null).creators[0],
      model('small', 1).creators[0],
      model('large', 100).creators[0],
    ];
    expect(sortedCreators(creators, 'cpv').map((row) => row.id)).toEqual([
      'large',
      'small',
      'missing',
    ]);
    expect(
      sortedCreators(
        creators.map((c) => ({ ...c, handle: 'same' })),
        'cpe'
      ).map((row) => row.id)
    ).toEqual(['large', 'missing', 'small']);
  });
});
