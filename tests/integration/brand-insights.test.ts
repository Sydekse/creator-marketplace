import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  brandProfile,
  campaign,
  deal,
  deliverable,
  deliverableEvent,
  ledgerEntry,
  videoMetric,
} from '@/db/schema';
import { auth } from '@/lib/auth';
import { ForbiddenError } from '@/lib/authz';
import {
  DEFAULT_INSIGHT_FILTERS,
  type InsightFilters,
} from '@/lib/brands/insight-filters';
import {
  InsightSelectionError,
  readBrandInsights,
  readBrandInsightSummary,
} from '@/lib/brands/insights';
import { readCampaignInsights } from '@/lib/campaigns/insights';
import { getPaymentProvider } from '@/lib/payment';
import { EscrowLedgerService } from '@/lib/payment/ledger';
import {
  createMoneyFixture,
  DEMO_PASSWORD,
  guardForCookie,
  signInCookie,
} from './helpers';

// Uses only the integration runner's disposable CI PostgreSQL, never live data.
let owner: { id: string; userId: string; cookie: string };
let foreign: typeof owner;
let creatorCookie: string;
let adminCookie: string;

async function brand() {
  const email = `overall-${crypto.randomUUID()}@example.com`;
  const registered = await auth.api.signUpEmail({
    body: {
      email,
      password: DEMO_PASSWORD,
      name: 'Overall insight brand',
      role: 'brand',
    },
  });
  const [profile] = await db
    .insert(brandProfile)
    .values({
      userId: registered.user.id,
      companyName: email,
    })
    .returning();
  return {
    id: profile.id,
    userId: registered.user.id,
    cookie: await signInCookie(email),
  };
}

const ledger = () => new EscrowLedgerService(db, getPaymentProvider());
const read = (ids: string[], filters: Partial<InsightFilters> = {}) =>
  readBrandInsights(
    { ...DEFAULT_INSIGHT_FILTERS, campaignIds: ids, ...filters },
    guardForCookie(owner.cookie)
  );

async function fixture(
  kind: 'accepted' | 'funded' | 'delivered' = 'delivered',
  videoCount = 1
) {
  const ids = await createMoneyFixture({
    kind,
    videoCount,
    label: 'overall insights',
  });
  await db
    .update(campaign)
    .set({ brandId: owner.id, createdAt: new Date('2026-09-01T00:00:00Z') })
    .where(eq(campaign.id, ids.campaignId));
  const [row] = await db.select().from(deal).where(eq(deal.id, ids.dealId));
  return { ...ids, creatorId: row.creatorId, totalPrice: row.totalPrice };
}

async function video(
  dealId: string,
  ordinal = 1,
  extra: Partial<typeof deliverable.$inferInsert> = {}
) {
  const identity = BigInt(`0x${crypto.randomUUID().replaceAll('-', '')}`)
    .toString()
    .slice(0, 19);
  const [row] = await db
    .insert(deliverable)
    .values({
      dealId,
      videoOrdinal: ordinal,
      tiktokVideoId: identity,
      tiktokUrl: `https://www.tiktok.com/@overall/video/${identity}`,
      ...extra,
    })
    .returning();
  await db.insert(deliverableEvent).values({
    dealId,
    deliverableId: row.id,
    submissionVersion: row.submissionVersion,
    kind:
      row.historyCompleteness === 'legacy_baseline'
        ? 'legacy_baseline'
        : 'submitted',
    actorRole: 'creator',
    occurredAt: new Date(),
    tiktokUrl: row.tiktokUrl,
  });
  return row;
}

async function metrics(
  row: typeof deliverable.$inferSelect,
  views: number | null = 100
) {
  await db.insert(videoMetric).values({
    deliverableId: row.id,
    submissionVersion: row.submissionVersion,
    views,
    likes: views === 0 ? 0 : 10,
    comments: 0,
    shares: 0,
  });
}

beforeAll(async () => {
  owner = await brand();
  foreign = await brand();
  creatorCookie = await signInCookie('creator@demo.com');
  adminCookie = await signInCookie('admin@demo.com');
});

describe('owned overall insights with real sessions and PostgreSQL', () => {
  it('requires owner guards outside the page, rejects foreign/missing selections generically', async () => {
    const owned = await fixture('accepted');
    const other = await fixture('accepted');
    await db
      .update(campaign)
      .set({ brandId: foreign.id, name: 'Never expose foreign campaign' })
      .where(eq(campaign.id, other.campaignId));
    for (const cookie of ['', creatorCookie, adminCookie]) {
      await expect(
        readBrandInsights(DEFAULT_INSIGHT_FILTERS, guardForCookie(cookie))
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        readBrandInsightSummary(guardForCookie(cookie))
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    for (const id of [other.campaignId, crypto.randomUUID(), 'malformed']) {
      await expect(read([id])).rejects.toThrow(new InsightSelectionError());
    }
    await expect(
      readBrandInsights(
        {
          ...DEFAULT_INSIGHT_FILTERS,
          campaignIds: [owned.campaignId],
        },
        guardForCookie(foreign.cookie)
      )
    ).rejects.toBeInstanceOf(InsightSelectionError);
    const result = await read([owned.campaignId]);
    expect(result.overall.deals.map((row) => row.id)).toEqual([owned.dealId]);
    expect(JSON.stringify(result)).not.toContain(
      'Never expose foreign campaign'
    );
    expect(result.options.some((row) => row.id === other.campaignId)).toBe(
      false
    );
  });

  it('classifies cross-campaign content once, preserving group exclusions and selected-only history', async () => {
    const a = await fixture();
    const b = await fixture();
    const other = await fixture();
    await db
      .update(campaign)
      .set({ brandId: foreign.id })
      .where(eq(campaign.id, other.campaignId));
    const first = await video(a.dealId);
    const repeated = await video(b.dealId, 1, {
      tiktokVideoId: null,
      tiktokUrl: `m.tiktok.com/@different/video/${first.tiktokVideoId}?shared=1`,
    });
    const foreignVideo = await video(other.dealId, 1, {
      tiktokVideoId: first.tiktokVideoId,
      tiktokUrl: first.tiktokUrl,
    });
    await metrics(first);
    await metrics(repeated, 300);
    await metrics(foreignVideo, 999_999);
    await ledger().payoutForDeal(a.dealId, owner.userId);
    await ledger().payoutForDeal(b.dealId, owner.userId);
    const both = await read([a.campaignId, b.campaignId]);
    expect(both.overall).toMatchObject({
      duplicateVideos: 2,
      totals: { views: 400 },
      cpv: { deals: 0 },
      cpe: { deals: 0 },
      settled: a.totalPrice + b.totalPrice,
    });
    expect(both.history.aggregate.acceptance.issued).toBe(2);
    expect(both.history.creators).toHaveLength(1);
    for (const row of both.campaigns) {
      expect(row.metrics.cpv.deals).toBe(0);
      expect(row.metrics.creators[0].viewShare).toBeNull();
      expect(row.history.acceptance.issued).toBe(1);
    }
    const single = await read([a.campaignId]);
    expect(single.overall).toMatchObject({
      duplicateVideos: 0,
      cpv: { deals: 1 },
      totals: { views: 100 },
    });
    expect(single.history.aggregate.acceptance.issued).toBe(1);
    expect(
      single.history.aggregate.videoRevisions.perVideo.map((row) => row.videoId)
    ).toEqual([first.id]);
    expect(JSON.stringify(single.history)).not.toContain(b.dealId);
    expect(JSON.stringify(both)).not.toContain(other.dealId);
    expect(
      (await readCampaignInsights(a.campaignId, guardForCookie(owner.cookie)))
        .campaign.cpv
    ).toEqual(single.overall.cpv);
  });

  it('intersects UTC creation dates, current statuses and explicit IDs consistently including empty drafts', async () => {
    const first = await fixture('funded');
    const last = await fixture('funded');
    const excluded = await fixture('funded');
    await db
      .update(campaign)
      .set({
        createdAt: new Date('2026-09-01T23:59:59.999Z'),
        status: 'in_progress',
      })
      .where(eq(campaign.id, last.campaignId));
    await db
      .update(campaign)
      .set({ createdAt: new Date('2026-09-02T00:00:00.000Z') })
      .where(eq(campaign.id, excluded.campaignId));
    const [draft] = await db
      .insert(campaign)
      .values({
        brandId: owner.id,
        name: 'No-offer draft',
        budget: 1,
        desiredVideos: 1,
        createdAt: new Date('2026-09-01T12:00:00Z'),
      })
      .returning();
    const ids = [
      first.campaignId,
      last.campaignId,
      excluded.campaignId,
      draft.id,
    ];
    const range = await read(ids, { from: '2026-09-01', to: '2026-09-01' });
    expect(range.campaigns.map((row) => row.id).sort()).toEqual(
      [first.campaignId, last.campaignId, draft.id].sort()
    );
    expect(range.overall.totalDeals).toBe(2);
    expect(range.history.aggregate.acceptance.issued).toBe(2);
    expect(
      range.history.aggregate.timing.firstFullDelivery.waiting
        .map((row) => row.dealId)
        .sort()
    ).toEqual([first.dealId, last.dealId].sort());
    expect(
      range.campaigns.find((row) => row.id === draft.id)?.metrics
    ).toMatchObject({
      committed: 0,
      settled: 0,
      totalDeals: 0,
      totals: { views: null },
      cpv: { ratio: null },
    });
    const filtered = await read(ids, {
      from: '2026-09-01',
      to: '2026-09-01',
      status: 'in_progress',
    });
    expect(filtered.campaigns.map((row) => row.id)).toEqual([last.campaignId]);
    expect(
      filtered.history.aggregate.timing.firstFullDelivery.waiting.map(
        (row) => row.dealId
      )
    ).toEqual([last.dealId]);
    const empty = await read([first.campaignId], { status: 'cancelled' });
    expect(empty.campaigns).toEqual([]);
    expect(empty.overall.settled).toBe(0);
    expect(empty.history.aggregate.acceptance.issued).toBe(0);
  });

  it('joins only current metrics, keeps measured zeros and legacy evidence separate from missing videos', async () => {
    const old = await fixture('delivered', 2);
    const zero = await fixture();
    const oldVideo = await video(old.dealId, 1, {
      submissionVersion: 2,
      historyCompleteness: 'legacy_baseline',
    });
    await db.insert(videoMetric).values({
      deliverableId: oldVideo.id,
      submissionVersion: 1,
      views: 999_999,
      likes: 999,
    });
    const zeroVideo = await video(zero.dealId);
    await metrics(zeroVideo, 0);
    await ledger().payoutForDeal(old.dealId, owner.userId);
    await ledger().payoutForDeal(zero.dealId, owner.userId);
    const result = await read([old.campaignId, zero.campaignId]);
    expect(result.overall).toMatchObject({
      orderedVideos: 3,
      submittedVideos: 2,
      coverage: { views: 1 },
      totals: { views: 0 },
      cpv: { deals: 1, cost: zero.totalPrice, results: 0, ratio: null },
      settled: old.totalPrice + zero.totalPrice,
    });
    expect(
      result.overall.deals.find((row) => row.id === old.dealId)?.videos[0]
    ).toMatchObject({
      views: null,
      source: null,
      updatedAt: null,
      stale: false,
    });
    expect(result.history.aggregate.videoRevisions.excludedIncomplete).toBe(1);
  });

  it('uses lifetime ledger settlement for selected creation dates without multiplying video/events', async () => {
    const paid = await fixture('delivered', 2);
    const refunded = await fixture('funded');
    for (const ordinal of [1, 2]) {
      const row = await video(paid.dealId, ordinal);
      await metrics(row);
      await db.insert(deliverableEvent).values({
        dealId: paid.dealId,
        deliverableId: row.id,
        submissionVersion: 1,
        kind: 'revision_requested',
        actorRole: 'brand',
        occurredAt: new Date(),
        tiktokUrl: row.tiktokUrl,
        revisionCategory: 'other',
      });
    }
    await ledger().payoutForDeal(paid.dealId, owner.userId);
    await ledger().refundDeal(refunded.dealId, owner.userId);
    const result = await read([paid.campaignId, refunded.campaignId], {
      from: '2026-09-01',
      to: '2026-09-01',
    });
    expect(result.overall).toMatchObject({
      settled: paid.totalPrice,
      refunded: refunded.totalPrice,
      totalDeals: 2,
    });
    expect(result.history.aggregate.completion).toMatchObject({
      completed: 1,
      refunded: 1,
      funded: 2,
    });
    expect(result.history.aggregate.videoRevisions.rounds).toBe(2);
  });

  it('uses selected agreed-deadline evidence for campaign, creator and overall punctuality', async () => {
    const onTime = await fixture();
    const extended = await fixture();
    const fundedAt = new Date('2026-01-01T00:00:00Z');
    const original = new Date('2026-01-03T00:00:00Z');
    const extension = new Date('2026-01-05T00:00:00Z');
    await db
      .update(deal)
      .set({
        deliveryWindowDays: 2,
        fundedAt,
        originalDeliveryDueAt: original,
        currentDeliveryDueAt: original,
        dueAtFirstDelivery: original,
        firstDeliveredAt: new Date('2026-01-02T00:00:00Z'),
      })
      .where(eq(deal.id, onTime.dealId));
    await db
      .update(deal)
      .set({
        deliveryWindowDays: 2,
        fundedAt,
        originalDeliveryDueAt: original,
        currentDeliveryDueAt: extension,
        dueAtFirstDelivery: extension,
        firstDeliveredAt: new Date('2026-01-04T00:00:00Z'),
        missedDeliveryCommitment: true,
      })
      .where(eq(deal.id, extended.dealId));
    const result = await read([onTime.campaignId, extended.campaignId]);
    expect(result.history.aggregate.punctuality).toMatchObject({
      on_time: 1,
      earlier_missed: 1,
      eligible: 2,
      total: 2,
      onTimeRate: 0.5,
    });
    expect(result.history.creators[0].punctuality.onTimeRate).toBe(0.5);
    expect(
      result.campaigns.find((row) => row.id === extended.campaignId)?.history
        .punctuality
    ).toMatchObject({
      earlier_missed: 1,
      eligible: 1,
      onTimeRate: 0,
    });
    const selected = await read([onTime.campaignId]);
    expect(selected.history.aggregate.punctuality).toMatchObject({
      on_time: 1,
      eligible: 1,
      onTimeRate: 1,
    });
  });

  it('sums settlements beyond 32-bit integer range in PostgreSQL', async () => {
    const [large] = await db
      .insert(campaign)
      .values({
        brandId: owner.id,
        name: 'Large lifetime ledger',
        budget: 1,
        desiredVideos: 1,
      })
      .returning();
    await db.insert(ledgerEntry).values(
      Array.from({ length: 2 }, () => [
        {
          campaignId: large.id,
          entryType: 'hold' as const,
          amount: 1_500_000_000,
          balanceAfter: 1_500_000_000,
        },
        {
          campaignId: large.id,
          entryType: 'release_payout' as const,
          amount: -1_400_000_000,
          balanceAfter: 100_000_000,
        },
        {
          campaignId: large.id,
          entryType: 'commission' as const,
          amount: -100_000_000,
          balanceAfter: 0,
        },
      ]).flat()
    );
    expect((await read([large.id])).overall.settled).toBe(3_000_000_000);
  });

  it('rechecks selected campaign ownership after guard and propagates deletion/races as generic selection errors', async () => {
    const ids = await fixture('accepted');
    const realGuard = guardForCookie(owner.cookie);
    await expect(
      readBrandInsights(
        { ...DEFAULT_INSIGHT_FILTERS, campaignIds: [ids.campaignId] },
        async (options) => {
          const context = await realGuard(options);
          await db
            .update(campaign)
            .set({ brandId: foreign.id })
            .where(eq(campaign.id, ids.campaignId));
          return context;
        }
      )
    ).rejects.toBeInstanceOf(InsightSelectionError);
  });

  it('reads status, evidence, metrics and ledger from one repeatable-read snapshot', async () => {
    const ids = await fixture();
    const submitted = await video(ids.dealId);
    await metrics(submitted);
    const transaction = db.transaction.bind(db);
    const spy = vi.spyOn(db, 'transaction');
    spy.mockImplementationOnce((callback, options) =>
      transaction(async (tx) => {
        await tx.execute(
          sql`select id from ${campaign} where id = ${ids.campaignId}`
        );
        await ledger().payoutForDeal(ids.dealId, owner.userId, {
          onCommit: async (writer) => {
            await writer
              .update(videoMetric)
              .set({ views: 900 })
              .where(eq(videoMetric.deliverableId, submitted.id));
          },
        });
        return callback(tx);
      }, options)
    );
    const before = await read([ids.campaignId]);
    expect(before.overall).toMatchObject({
      completedDeals: 0,
      settled: 0,
      totals: { views: 100 },
    });
    expect(before.history.aggregate.completion.completed).toBe(0);
    expect(before.history.aggregate.approvalWithoutRevision.approved).toBe(0);
    expect(spy.mock.calls[0][1]).toEqual({
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
    const after = await read([ids.campaignId]);
    expect(after.overall).toMatchObject({
      completedDeals: 1,
      settled: ids.totalPrice,
      totals: { views: 900 },
    });
    expect(after.history.aggregate.approvalWithoutRevision.approved).toBe(1);
  });

  it('keeps query count constant as campaign count grows and omits history from dashboard summary', async () => {
    const ids = await fixture();
    await metrics(await video(ids.dealId));
    const queryCounts: number[] = [];
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementation((callback, options) =>
      transaction(async (tx) => {
        const spy = vi.spyOn(tx, 'select');
        try {
          return await callback(tx);
        } finally {
          queryCounts.push(spy.mock.calls.length);
          spy.mockRestore();
        }
      }, options)
    );
    await read([ids.campaignId]);
    const full = await read([]);
    const summary = await readBrandInsightSummary(guardForCookie(owner.cookie));
    expect(queryCounts).toEqual([6, 6, 4]);
    expect(summary.overall).toEqual(full.overall);
    expect(summary.campaignCount).toBe(full.campaigns.length);
    expect(summary.creatorCount).toBe(full.overall.creators.length);
  });
});
