import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { ForbiddenError, guard, type AuthzContext } from '@/lib/authz';
import { DEFAULT_INSIGHT_FILTERS } from '@/lib/brands/insight-filters';
import {
  InsightSelectionError,
  readBrandInsights,
  readBrandInsightSummary,
} from '@/lib/brands/insights';
import { sumSettledByCampaigns } from '@/lib/payment/escrow';

vi.mock('@/db', () => ({ db: { transaction: vi.fn() } }));
vi.mock('@/lib/authz', () => ({
  ForbiddenError: class extends Error {},
  guard: vi.fn(),
}));
vi.mock('@/lib/payment/escrow', () => ({ sumSettledByCampaigns: vi.fn() }));

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const brandId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const authorized: AuthzContext = {
  user: {
    id: 'owner',
    name: 'Owner',
    email: 'owner@example.com',
    role: 'brand',
  },
  brandProfileId: brandId,
  creatorProfileId: null,
};
const now = new Date('2026-09-05T12:00:00.000Z');
const options = [a, b].map((id, index) => ({
  id,
  name: `Campaign ${index}`,
  goal: null,
  status: index ? 'draft' : 'completed',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
}));
const rows = [
  {
    deal: {
      id: 'd1',
      campaignId: a,
      creatorId: 'creator',
      status: 'completed',
      videoCount: 1,
      unitPrice: 1_000,
      totalPrice: 1_000,
      rightsAcceptedAt: new Date('2026-09-01T00:00:00Z'),
      deliveryWindowDays: 2,
      originalDeliveryDueAt: new Date('2026-09-04T00:00:00Z'),
      dueAtFirstDelivery: new Date('2026-09-04T00:00:00Z'),
      firstDeliveredAt: new Date('2026-09-03T00:00:00Z'),
    },
    handle: 'same-creator',
  },
];
const videos = [
  {
    video: {
      id: 'v1',
      dealId: 'd1',
      videoOrdinal: 1,
      submissionVersion: 2,
      tiktokUrl: 'https://tiktok.com/@creator/video/123',
      tiktokVideoId: '123',
      historyCompleteness: 'complete',
    },
    metric: {
      id: 'm1',
      submissionVersion: 2,
      views: 100,
      likes: 10,
      comments: 0,
      shares: 0,
      source: 'admin',
      stale: true,
      lastUpdatedAt: now,
    },
  },
];
const statuses = [
  {
    event: {
      id: 's1',
      dealId: 'd1',
      fromStatus: 'accepted',
      toStatus: 'funded',
      createdAt: new Date('2026-09-02T00:00:00Z'),
    },
  },
  {
    event: {
      id: 's2',
      dealId: 'd1',
      fromStatus: 'funded',
      toStatus: 'delivered',
      createdAt: new Date('2026-09-03T00:00:00Z'),
    },
  },
];
const evidence = [
  {
    event: {
      id: 'e1',
      seq: 1,
      dealId: 'd1',
      deliverableId: 'v1',
      submissionVersion: 2,
      kind: 'submitted',
      actorRole: 'creator',
      occurredAt: new Date('2026-09-03T00:00:00Z'),
      reviewCycleId: null,
      revisionCategory: null,
      metadata: {},
    },
  },
];

function snapshot(data: Record<string, unknown[]> = {}) {
  const queries: { table: string; where?: SQL; joins: SQL[] }[] = [];
  const tx = {
    select: vi.fn(() => {
      const query = {
        table: '',
        joins: [] as SQL[],
        where: undefined as SQL | undefined,
      };
      queries.push(query);
      const chain = {
        from: vi.fn((table) => {
          query.table = getTableName(table);
          return chain;
        }),
        innerJoin: vi.fn((_table, condition: SQL) => {
          query.joins.push(condition);
          return chain;
        }),
        leftJoin: vi.fn((_table, condition: SQL) => {
          query.joins.push(condition);
          return chain;
        }),
        where: vi.fn((condition: SQL) => {
          query.where = condition;
          return chain;
        }),
        orderBy: vi.fn(() => chain),
        then: (resolve: (value: unknown[]) => unknown) =>
          Promise.resolve(data[query.table] ?? []).then(resolve),
      };
      return chain;
    }),
  };
  vi.mocked(db.transaction).mockImplementation(async (callback) =>
    callback(tx as unknown as Parameters<typeof callback>[0])
  );
  return { tx, queries };
}
const populated = () =>
  snapshot({
    campaign: options,
    deal: rows,
    deliverable: videos,
    deal_event: statuses,
    deliverable_event: evidence,
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(guard).mockResolvedValue(authorized);
  vi.mocked(sumSettledByCampaigns).mockResolvedValue(
    new Map([[a, { paidOut: 850, commission: 150, refunded: 40 }]])
  );
});

describe('brand insights guarded snapshot', () => {
  it.each([readBrandInsights, () => readBrandInsightSummary()])(
    'requires the internal brand guard',
    async (read) => {
      snapshot();
      await read(DEFAULT_INSIGHT_FILTERS);
      expect(guard).toHaveBeenCalledExactlyOnceWith({ roles: ['brand'] });
    }
  );
  it('denies missing brand profiles and propagates guard errors without any DB call', async () => {
    vi.mocked(guard).mockResolvedValueOnce({
      ...authorized,
      brandProfileId: null,
    });
    await expect(
      readBrandInsights(DEFAULT_INSIGHT_FILTERS)
    ).rejects.toBeInstanceOf(ForbiddenError);
    const denied = new ForbiddenError('Denied');
    vi.mocked(guard).mockRejectedValueOnce(denied);
    await expect(readBrandInsightSummary()).rejects.toBe(denied);
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it.each(['bad', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'])(
    'fails closed for invalid/missing/foreign ID %s',
    async (id) => {
      const { queries } = populated();
      await expect(
        readBrandInsights({ ...DEFAULT_INSIGHT_FILTERS, campaignIds: [id] })
      ).rejects.toBeInstanceOf(InsightSelectionError);
      expect(queries.length).toBeLessThanOrEqual(1);
      expect(sumSettledByCampaigns).not.toHaveBeenCalled();
    }
  );
  it('preserves drafts, uses one owner-constrained snapshot and current metric versions', async () => {
    const { tx, queries } = populated();
    const result = await readBrandInsights(DEFAULT_INSIGHT_FILTERS);
    expect(db.transaction).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      }
    );
    expect(sumSettledByCampaigns).toHaveBeenCalledExactlyOnceWith(
      [a, b],
      brandId,
      tx
    );
    expect(result.campaigns).toHaveLength(2);
    expect(result.campaigns[1].metrics).toMatchObject({
      totalDeals: 0,
      settled: 0,
    });
    expect(result.overall).toMatchObject({
      settled: 1_000,
      refunded: 40,
      cpv: { deals: 1, results: 100 },
      staleVideos: 1,
    });
    expect(result.history.aggregate.punctuality).toMatchObject({
      on_time: 1,
      eligible: 1,
      total: 1,
    });
    expect(result.history.aggregate.timing.firstFullDelivery).toMatchObject({
      n: 1,
      medianMs: 86_400_000,
    });
    expect(result.history.creators[0].creatorId).toBe(
      result.overall.creators[0].id
    );
    const dialect = new PgDialect();
    for (const query of queries) {
      const sql = dialect.sqlToQuery(query.where!);
      expect(sql.sql).toContain('"campaign"."brand_id"');
      expect(sql.params).toContain(brandId);
      if (query.table !== 'campaign') {
        expect(sql.sql).toContain('"campaign"."id" in');
        expect(sql.params).toEqual([brandId, a, b]);
      }
    }
    const metricJoin = queries
      .find((query) => query.table === 'deliverable')!
      .joins.at(-1)!;
    const sql = dialect.sqlToQuery(metricJoin).sql;
    expect(sql).toContain(
      '"video_metric"."submission_version" = "deliverable"."submission_version"'
    );
  });
  it('keeps history/results/settlement under the same selected scope and no creator expansion', async () => {
    const { queries } = populated();
    const result = await readBrandInsights({
      ...DEFAULT_INSIGHT_FILTERS,
      campaignIds: [a],
    });
    expect(result.campaigns.map((row) => row.id)).toEqual([a]);
    expect(result.options.map((row) => row.id)).toEqual([a, b]);
    expect(result.history.aggregate.acceptance.issued).toBe(1);
    const dialect = new PgDialect();
    for (const query of queries.slice(1))
      expect(dialect.sqlToQuery(query.where!).params).toEqual([brandId, a]);
    expect(sumSettledByCampaigns).toHaveBeenCalledWith(
      [a],
      brandId,
      expect.anything()
    );
  });
  it('returns a dedicated empty selection without loading unrelated inputs', async () => {
    const { queries } = populated();
    const result = await readBrandInsights({
      ...DEFAULT_INSIGHT_FILTERS,
      from: '9999-01-01',
    });
    expect(queries.map((query) => query.table)).toEqual(['campaign']);
    expect(result.options).toHaveLength(2);
    expect(result.campaigns).toEqual([]);
    expect(result.overall).toMatchObject({
      totalDeals: 0,
      settled: 0,
      totals: { views: null },
    });
    expect(result.history.aggregate.acceptance.issued).toBe(0);
    expect(result.history.aggregate.punctuality.total).toBe(0);
  });
  it('deduplicates identical joined records, events and videos before measurement', async () => {
    snapshot({
      campaign: [...options, options[0]],
      deal: [...rows, ...rows],
      deliverable: [...videos, ...videos],
      deal_event: [...statuses, ...statuses],
      deliverable_event: [...evidence, ...evidence],
    });
    const result = await readBrandInsights(DEFAULT_INSIGHT_FILTERS);
    expect(result.campaigns).toHaveLength(2);
    expect(result.overall).toMatchObject({
      totalDeals: 1,
      submittedVideos: 1,
      duplicateVideos: 0,
    });
    expect(result.history.aggregate.timing.firstFullDelivery.n).toBe(1);
  });
  it('summary matches the full default report without status/evidence queries', async () => {
    populated();
    const full = await readBrandInsights(DEFAULT_INSIGHT_FILTERS);
    const { queries } = populated();
    const summary = await readBrandInsightSummary();
    expect(summary.overall).toEqual(full.overall);
    expect(summary).toMatchObject({ campaignCount: 2, creatorCount: 1 });
    expect(queries.map((query) => query.table)).toEqual([
      'campaign',
      'deal',
      'deliverable',
    ]);
  });
  it('recomputes raw history medians across campaigns rather than averaging summaries', async () => {
    const starts = new Date('2026-01-01T00:00:00Z');
    const durations = [1, 3, 20];
    const deals = durations.map((hours, index) => ({
      ...rows[0],
      deal: { ...rows[0].deal, id: `d${index}`, campaignId: index < 2 ? a : b },
    }));
    const events = durations.flatMap((hours, index) => [
      {
        event: {
          id: `f${index}`,
          dealId: `d${index}`,
          fromStatus: 'accepted',
          toStatus: 'funded',
          createdAt: starts,
        },
      },
      {
        event: {
          id: `s${index}`,
          dealId: `d${index}`,
          fromStatus: 'funded',
          toStatus: 'delivered',
          createdAt: new Date(starts.getTime() + hours * 3_600_000),
        },
      },
    ]);
    snapshot({ campaign: options, deal: deals, deal_event: events });
    const result = await readBrandInsights(DEFAULT_INSIGHT_FILTERS);
    expect(result.history.aggregate.timing.firstFullDelivery).toMatchObject({
      n: 3,
      medianMs: 3 * 3_600_000,
    });
    expect(result.history.creators[0].timing.firstFullDelivery.medianMs).toBe(
      3 * 3_600_000
    );
    expect(result.campaigns[0].history.timing.firstFullDelivery.medianMs).toBe(
      2 * 3_600_000
    );
    expect(result.campaigns[1].history.timing.firstFullDelivery.medianMs).toBe(
      20 * 3_600_000
    );
  });
  it('uses the existing punctuality denominator and classifications in every group', async () => {
    const base = rows[0].deal;
    const due = new Date('9999-01-01T00:00:00Z');
    const overdue = new Date('2020-01-01T00:00:00Z');
    const deadlines = [
      { ...base },
      { ...base, dueAtFirstDelivery: overdue },
      { ...base, missedDeliveryCommitment: true },
      {
        ...base,
        status: 'funded',
        firstDeliveredAt: null,
        currentDeliveryDueAt: due,
      },
      {
        ...base,
        status: 'funded',
        firstDeliveredAt: null,
        currentDeliveryDueAt: overdue,
      },
      {
        ...base,
        status: 'accepted',
        firstDeliveredAt: null,
        currentDeliveryDueAt: null,
      },
      { ...base, deliveryWindowDays: null },
      { ...base, status: 'refunded', firstDeliveredAt: null },
    ];
    snapshot({
      campaign: options,
      deal: deadlines.map((deadline, index) => ({
        handle: `creator${index}`,
        deal: {
          ...deadline,
          id: `d${index}`,
          creatorId: `c${index}`,
          campaignId: index < 3 ? a : b,
        },
      })),
    });
    const result = await readBrandInsights(DEFAULT_INSIGHT_FILTERS);
    expect(result.history.aggregate.punctuality).toEqual({
      unknown: 1,
      awaiting_funding: 1,
      due: 1,
      overdue: 1,
      on_time: 1,
      late: 1,
      earlier_missed: 1,
      closed: 1,
      total: 8,
      eligible: 3,
      onTimeRate: 1 / 3,
    });
    expect(result.campaigns[0].history.punctuality).toMatchObject({
      total: 3,
      eligible: 3,
      onTimeRate: 1 / 3,
    });
    expect(result.campaigns[1].history.punctuality).toMatchObject({
      total: 5,
      eligible: 0,
      onTimeRate: null,
    });
    expect(
      result.history.creators.find((row) => row.creatorId === 'c0')?.punctuality
        .onTimeRate
    ).toBe(1);
    expect(
      result.history.creators.find((row) => row.creatorId === 'c2')?.punctuality
        .onTimeRate
    ).toBe(0);
  });
  it('query count stays constant with many campaigns and pagination never limits aggregation', async () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      ...options[0],
      id: `${index}`,
    }));
    const { queries } = snapshot({
      campaign: many,
      deal: rows,
      deliverable: videos,
    });
    await readBrandInsights({
      ...DEFAULT_INSIGHT_FILTERS,
      campaignPage: 9,
      creatorPage: 5,
      waitingPage: 4,
    });
    expect(queries).toHaveLength(5);
    expect(sumSettledByCampaigns).toHaveBeenCalledTimes(1);
  });
  it('propagates real DB and evidence consistency errors', async () => {
    const failure = new Error('DB unavailable');
    vi.mocked(db.transaction).mockRejectedValueOnce(failure);
    await expect(readBrandInsights(DEFAULT_INSIGHT_FILTERS)).rejects.toBe(
      failure
    );
    snapshot({
      campaign: options,
      deal: rows,
      deliverable: [
        videos[0],
        { ...videos[0], metric: { ...videos[0].metric, views: 500 } },
      ],
    });
    await expect(readBrandInsights(DEFAULT_INSIGHT_FILTERS)).rejects.toThrow(
      'Conflicting insight records'
    );
  });
});
