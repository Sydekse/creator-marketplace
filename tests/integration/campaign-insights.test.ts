import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  brandProfile,
  campaign,
  creatorProfile,
  deal,
  deliverable,
  deliverableEvent,
  user,
  videoMetric,
} from '@/db/schema';
import { auth } from '@/lib/auth';
import { ForbiddenError } from '@/lib/authz';
import { readCampaignInsights } from '@/lib/campaigns/insights';
import { getPaymentProvider } from '@/lib/payment';
import { EscrowLedgerService } from '@/lib/payment/ledger';
import {
  createMoneyFixture,
  DEMO_PASSWORD,
  guardForCookie,
  signInCookie,
  userIdForEmail,
} from './helpers';

let ownerCookie: string;
let foreignCookie: string;
let creatorCookie: string;
let adminCookie: string;
let foreignBrandId: string;
let brandUserId: string;

async function freshCreator() {
  const tag = crypto.randomUUID();
  const [person] = await db
    .insert(user)
    .values({ name: 'Insight creator', email: `insight-${tag}@example.com` })
    .returning();
  const [profile] = await db
    .insert(creatorProfile)
    .values({
      userId: person.id,
      tiktokHandle: `insight-${tag}`,
      niche: 'lifestyle',
      audience: {},
    })
    .returning();
  return profile.id;
}

async function fixture(
  kind: 'accepted' | 'funded' | 'delivered' = 'accepted',
  videoCount = 1,
  creatorId?: string
) {
  const ids = await createMoneyFixture({
    kind,
    videoCount,
    label: 'campaign insights',
  });
  const selectedCreatorId = creatorId ?? (await freshCreator());
  const [row] = await db
    .update(deal)
    .set({ creatorId: selectedCreatorId })
    .where(eq(deal.id, ids.dealId))
    .returning();
  return { ...ids, creatorId: selectedCreatorId, totalPrice: row.totalPrice };
}

async function video(dealId: string, ordinal = 1, submissionVersion = 1) {
  const tiktokVideoId = BigInt(`0x${crypto.randomUUID().replaceAll('-', '')}`)
    .toString()
    .slice(0, 19);
  const [row] = await db
    .insert(deliverable)
    .values({
      dealId,
      videoOrdinal: ordinal,
      submissionVersion,
      tiktokUrl: `https://www.tiktok.com/@insight/video/${tiktokVideoId}`,
      tiktokVideoId,
    })
    .returning();
  await db.insert(deliverableEvent).values(
    Array.from({ length: submissionVersion }, (_, index) => ({
      dealId,
      deliverableId: row.id,
      submissionVersion: index + 1,
      kind: 'submitted' as const,
      actorRole: 'creator' as const,
      occurredAt: new Date(Date.now() - 10_000),
      tiktokUrl: row.tiktokUrl,
    }))
  );
  return row;
}

const ledger = () => new EscrowLedgerService(db, getPaymentProvider());
const read = (id: string) =>
  readCampaignInsights(id, guardForCookie(ownerCookie));

beforeAll(async () => {
  [ownerCookie, creatorCookie, adminCookie] = await Promise.all([
    signInCookie('brand@demo.com'),
    signInCookie('creator@demo.com'),
    signInCookie('admin@demo.com'),
  ]);
  brandUserId = await userIdForEmail('brand@demo.com');
  const email = `insight-brand-${crypto.randomUUID()}@example.com`;
  const registered = await auth.api.signUpEmail({
    body: {
      name: 'Foreign insight brand',
      email,
      password: DEMO_PASSWORD,
      role: 'brand',
    },
  });
  const [brand] = await db
    .insert(brandProfile)
    .values({ userId: registered.user.id, companyName: 'Foreign brand' })
    .returning();
  foreignBrandId = brand.id;
  foreignCookie = await signInCookie(email);
});

describe('campaign insights with real sessions and PostgreSQL', () => {
  it('admits only the owner, denying anonymous, creator, admin and foreign brand sessions', async () => {
    const owned = await fixture();
    const foreign = await fixture();
    await db
      .update(campaign)
      .set({ brandId: foreignBrandId })
      .where(eq(campaign.id, foreign.campaignId));

    for (const cookie of ['', creatorCookie, adminCookie, foreignCookie]) {
      await expect(
        readCampaignInsights(owned.campaignId, guardForCookie(cookie))
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(read(foreign.campaignId)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    await expect(read(crypto.randomUUID())).rejects.toBeInstanceOf(
      ForbiddenError
    );
    expect(
      (await read(owned.campaignId)).campaign.deals.map((row) => row.id)
    ).toEqual([owned.dealId]);
    expect(
      (
        await readCampaignInsights(
          foreign.campaignId,
          guardForCookie(foreignCookie)
        )
      ).campaign.deals.map((row) => row.id)
    ).toEqual([foreign.dealId]);
  });

  it('includes other owned campaigns only for displayed creators, excluding foreign and unselected history', async () => {
    const current = await fixture();
    const historical = await fixture('delivered', 1, current.creatorId);
    const foreign = await fixture('delivered', 1, current.creatorId);
    const unselected = await fixture('delivered');
    await db
      .update(campaign)
      .set({ brandId: foreignBrandId })
      .where(eq(campaign.id, foreign.campaignId));
    const currentVideo = await video(current.dealId);
    const historicalVideo = await video(historical.dealId);
    const foreignVideo = await video(foreign.dealId);
    const unselectedVideo = await video(unselected.dealId);
    await db.insert(videoMetric).values(
      [currentVideo, historicalVideo, foreignVideo, unselectedVideo].map(
        (row, index) => ({
          deliverableId: row.id,
          submissionVersion: 1,
          views: index === 0 ? 25 : 999_999,
        })
      )
    );
    for (const row of [historicalVideo, foreignVideo, unselectedVideo]) {
      await db.insert(deliverableEvent).values({
        dealId: row.dealId,
        deliverableId: row.id,
        submissionVersion: 1,
        kind: 'revision_requested',
        actorRole: 'brand',
        occurredAt: new Date(),
        tiktokUrl: row.tiktokUrl,
        revisionCategory: 'other',
      });
    }

    const result = await read(current.campaignId);
    expect(result.campaign.deals.map((row) => row.id)).toEqual([
      current.dealId,
    ]);
    expect(result.campaign.totals.views).toBe(25);
    expect(result.history.creators.map((row) => row.creatorId)).toEqual([
      current.creatorId,
    ]);
    expect(result.history.aggregate.acceptance.issued).toBe(2);
    expect(result.history.aggregate.completion.funded).toBe(1);
    expect(result.history.aggregate.videoRevisions.rounds).toBe(1);
    expect(
      result.history.aggregate.videoRevisions.perVideo
        .map((row) => row.videoId)
        .sort()
    ).toEqual([currentVideo.id, historicalVideo.id].sort());
    expect(
      result.history.aggregate.timing.firstFullDelivery.samples.map(
        (row) => row.dealId
      )
    ).toEqual([historical.dealId]);
    expect(JSON.stringify(result)).not.toContain(foreign.dealId);
    expect(JSON.stringify(result)).not.toContain(unselected.dealId);
  });

  it('joins only current-version metrics and requires every ordered video for cost eligibility', async () => {
    const ids = await fixture('delivered', 3);
    const third = await video(ids.dealId, 3);
    const first = await video(ids.dealId, 1, 2);
    await db.insert(videoMetric).values([
      {
        deliverableId: first.id,
        submissionVersion: 1,
        views: 999_999,
        likes: 999,
        comments: 999,
        shares: 999,
        stale: true,
        source: 'admin',
      },
      {
        deliverableId: third.id,
        submissionVersion: 1,
        views: 0,
        likes: null,
        comments: 0,
        shares: 0,
        source: 'creator',
      },
    ]);
    await ledger().payoutForDeal(ids.dealId, brandUserId);
    const partial = (await read(ids.campaignId)).campaign;
    expect(partial.orderedVideos).toBe(3);
    expect(partial.submittedVideos).toBe(2);
    expect(partial.totals.views).toBe(0);
    expect(partial.coverage.views).toBe(1);
    expect(partial.deals[0].videos.map((row) => row.ordinal)).toEqual([1, 3]);
    expect(partial.deals[0].videos[0]).toMatchObject({
      views: null,
      likes: null,
      source: null,
      updatedAt: null,
      stale: false,
    });
    expect(partial.cpv.deals).toBe(0);
    expect(partial.cpe.deals).toBe(0);
    expect(partial.settled).toBe(ids.totalPrice);

    const second = await video(ids.dealId, 2);
    await db.insert(videoMetric).values({
      deliverableId: second.id,
      submissionVersion: 1,
      views: 200,
      likes: 10,
      comments: 1,
      shares: 1,
    });
    await db
      .update(videoMetric)
      .set({
        submissionVersion: 2,
        views: 100,
        likes: 20,
        comments: 2,
        shares: 2,
        lastUpdatedAt: new Date('2026-01-01T00:00:00Z'),
      })
      .where(eq(videoMetric.deliverableId, first.id));
    const fullViews = (await read(ids.campaignId)).campaign;
    expect(fullViews.cpv).toMatchObject({
      cost: ids.totalPrice,
      results: 300,
      deals: 1,
      videos: 3,
      excludedDeals: 0,
    });
    expect(fullViews.cpv.ratio).toBeCloseTo(ids.totalPrice / 300 / 100);
    expect(fullViews.cpe.deals).toBe(0);
    expect(fullViews.staleVideos).toBe(1);
    expect(fullViews.deals[0].videos[0]).toMatchObject({
      source: 'admin',
      updatedAt: '2026-01-01T00:00:00.000Z',
      stale: true,
    });

    await db
      .update(videoMetric)
      .set({ likes: 0 })
      .where(eq(videoMetric.deliverableId, third.id));
    const fullEngagement = (await read(ids.campaignId)).campaign;
    expect(fullEngagement.cpe).toMatchObject({
      cost: ids.totalPrice,
      results: 36,
      deals: 1,
      videos: 3,
    });
    expect(fullEngagement.cpe.ratio).toBeCloseTo(ids.totalPrice / 36 / 100);
  });

  it('reads actual payout plus commission and refunds without other campaigns leaking into settlement', async () => {
    const paid = await fixture('delivered');
    await video(paid.dealId);
    const refund = await fixture('funded');
    const unrelated = await fixture('delivered');
    await video(unrelated.dealId);
    const payout = await ledger().payoutForDeal(paid.dealId, brandUserId);
    await ledger().refundDeal(refund.dealId, brandUserId);
    await ledger().payoutForDeal(unrelated.dealId, brandUserId);
    expect((await read(paid.campaignId)).campaign).toMatchObject({
      settled: payout.payout + payout.commission,
      refunded: 0,
      completedDeals: 1,
    });
    expect((await read(refund.campaignId)).campaign).toMatchObject({
      settled: 0,
      refunded: refund.totalPrice,
      completedDeals: 0,
    });
  });

  it('returns no creator history for an owned campaign with no current deals', async () => {
    const [brand] = await db
      .select()
      .from(brandProfile)
      .where(eq(brandProfile.userId, brandUserId));
    const [empty] = await db
      .insert(campaign)
      .values({
        brandId: brand.id,
        name: `Empty insight ${crypto.randomUUID()}`,
        budget: 1,
        desiredVideos: 1,
      })
      .returning();
    const result = await read(empty.id);
    expect(result.campaign).toMatchObject({
      creators: [],
      deals: [],
      totalDeals: 0,
      orderedVideos: 0,
      settled: 0,
      refunded: 0,
      totals: { views: null, likes: null, comments: null, shares: null },
    });
    expect(result.history.creators).toEqual([]);
    expect(result.history.aggregate.acceptance.issued).toBe(0);
  });

  it('rechecks campaign ownership inside the snapshot after the real guard succeeds', async () => {
    const ids = await fixture();
    const realGuard = guardForCookie(ownerCookie);
    await expect(
      readCampaignInsights(ids.campaignId, async (options) => {
        const authorized = await realGuard(options);
        await db
          .update(campaign)
          .set({ brandId: foreignBrandId })
          .where(eq(campaign.id, ids.campaignId));
        return authorized;
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('keeps deals, metrics, evidence and settlement on one real repeatable-read snapshot across a concurrent payout', async () => {
    const ids = await fixture('delivered');
    const submitted = await video(ids.dealId);
    await db.insert(videoMetric).values({
      deliverableId: submitted.id,
      submissionVersion: 1,
      views: 100,
    });
    const originalTransaction = db.transaction.bind(db);
    const transactionSpy = vi.spyOn(db, 'transaction');
    transactionSpy.mockImplementationOnce((callback, options) =>
      originalTransaction(async (tx) => {
        // Establish a real MVCC snapshot, then commit on another pool connection.
        await tx.execute(
          sql`select id from ${campaign} where id = ${ids.campaignId}`
        );
        await ledger().payoutForDeal(ids.dealId, brandUserId, {
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
    const snapshot = await read(ids.campaignId);
    expect(transactionSpy.mock.calls[0][1]).toEqual({
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
    expect(snapshot.campaign).toMatchObject({
      completedDeals: 0,
      settled: 0,
      totals: { views: 100 },
    });
    expect(snapshot.history.aggregate.completion.completed).toBe(0);
    expect(snapshot.history.aggregate.approvalWithoutRevision.approved).toBe(0);

    const after = await read(ids.campaignId);
    expect(after.campaign).toMatchObject({
      completedDeals: 1,
      settled: ids.totalPrice,
      totals: { views: 900 },
    });
    expect(after.history.aggregate.completion.completed).toBe(1);
    expect(after.history.aggregate.approvalWithoutRevision.approved).toBe(1);
  });
});
