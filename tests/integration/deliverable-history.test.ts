import { describe, expect, it } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { Client, type QueryResult } from 'pg';
import { db } from '@/db';
import {
  brandProfile,
  deal,
  deliverable,
  deliverableEvent,
  ledgerEntry,
  videoMetric,
} from '@/db/schema';
import {
  submitDeliverable,
  defaultDeps as submissionDeps,
} from '@/lib/deals/submit-deliverable';
import {
  rejectDeliverable,
  defaultDeps as rejectionDeps,
} from '@/lib/deals/reject-deliverable';
import { recordMetrics } from '@/lib/deals/record-metrics';
import { resolveDispute } from '@/lib/deals/resolve-dispute';
import { EscrowLedgerService } from '@/lib/payment/ledger';
import { getPaymentProvider } from '@/lib/payment';
import { currentVideos, VersionConflict } from '@/lib/deliverables/history';
import {
  createMoneyFixture,
  profileIdForEmail,
  realResolveDeps,
  signInCookie,
  userIdForEmail,
} from './helpers';

async function identities() {
  const creatorId = await profileIdForEmail('creator@demo.com');
  const creatorUserId = await userIdForEmail('creator@demo.com');
  const brandUserId = await userIdForEmail('brand@demo.com');
  const [brand] = await db
    .select()
    .from(brandProfile)
    .where(eq(brandProfile.userId, brandUserId));
  return { creatorId, creatorUserId, brandUserId, brandId: brand.id };
}
const videosFor = (id: string) =>
  db
    .select()
    .from(deliverable)
    .where(eq(deliverable.dealId, id))
    .orderBy(asc(deliverable.videoOrdinal));
const eventsFor = (id: string) =>
  db
    .select()
    .from(deliverableEvent)
    .where(eq(deliverableEvent.dealId, id))
    .orderBy(asc(deliverableEvent.seq));

describe('per-video permanent evidence in PostgreSQL', () => {
  it('serializes thumbnail attachment with the locked replacement snapshot', async () => {
    const ids = await identities();
    const { dealId } = await createMoneyFixture({
      kind: 'funded',
      label: 'thumbnail replacement race',
      videoCount: 1,
    });
    const input = {
      creatorProfileId: ids.creatorId,
      actorUserId: ids.creatorUserId,
      tiktokUrl: 'https://www.tiktok.com/@creator/video/987',
      requestId: crypto.randomUUID(),
      deliverableId: null,
      expectedVersion: 0,
      expectedSubmitted: 0,
    };
    await submitDeliverable(dealId, input);
    const [target] = await videosFor(dealId);
    await rejectDeliverable(dealId, {
      brandProfileId: ids.brandId,
      actorUserId: ids.brandUserId,
      deliverableId: target.id,
      expectedVersion: 1,
      category: 'other',
      reason: 'Replace the video',
    });
    const previousThumbnail = 'https://test.public.blob.vercel-storage.com/old';
    await db
      .update(deliverable)
      .set({ thumbnailUrl: previousThumbnail })
      .where(eq(deliverable.id, target.id));

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    let enrichment: Promise<QueryResult> | undefined;
    try {
      const { rows } = await client.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid'
      );
      const result = await submitDeliverable(
        dealId,
        {
          ...input,
          requestId: crypto.randomUUID(),
          deliverableId: target.id,
          expectedVersion: 1,
          expectedSubmitted: 1,
        },
        {
          ...submissionDeps,
          recordSubmission: async (...args) => {
            const locked = await currentVideos(args[0], dealId);
            expect(locked[0].thumbnailUrl).toBe(previousThumbnail);
            enrichment = client.query(
              `UPDATE deliverable SET thumbnail_url = $1
               WHERE id = $2 AND submission_version = 1 AND thumbnail_url = $3
               RETURNING id`,
              [
                'https://test.public.blob.vercel-storage.com/late',
                target.id,
                previousThumbnail,
              ]
            );
            await expect
              .poll(async () => {
                const blocked = await db.execute<{ count: number }>(
                  sql`SELECT cardinality(pg_blocking_pids(${rows[0].pid}::integer)) AS count`
                );
                return blocked.rows[0].count;
              })
              .toBeGreaterThan(0);
            return submissionDeps.recordSubmission(...args);
          },
        }
      );
      expect(result).toMatchObject({
        ok: true,
        submissionVersion: 2,
        previousThumbnailUrl: previousThumbnail,
      });
      expect((await enrichment)?.rowCount).toBe(0);
      expect((await videosFor(dealId))[0]).toMatchObject({
        submissionVersion: 2,
        thumbnailUrl: null,
      });
    } finally {
      await client.end();
    }
  });

  it('rolls back submission and rejection rows when a later transactional history write fails', async () => {
    const ids = await identities();
    const { dealId } = await createMoneyFixture({
      kind: 'funded',
      label: 'history write failure',
      videoCount: 1,
    });
    const input = {
      creatorProfileId: ids.creatorId,
      actorUserId: ids.creatorUserId,
      tiktokUrl: 'https://www.tiktok.com/@creator/video/987',
      requestId: crypto.randomUUID(),
      deliverableId: null,
      expectedVersion: 0,
      expectedSubmitted: 0,
    };
    await expect(
      submitDeliverable(dealId, input, {
        ...submissionDeps,
        ready: async (tx) => {
          await tx.execute(sql`SELECT 1 / 0`);
        },
      })
    ).rejects.toThrow();
    expect(await videosFor(dealId)).toEqual([]);
    expect(await eventsFor(dealId)).toEqual([]);
    expect(
      (await db.select().from(deal).where(eq(deal.id, dealId)))[0].status
    ).toBe('funded');
    await submitDeliverable(dealId, input);
    const [target] = await videosFor(dealId);
    const before = await eventsFor(dealId);
    await expect(
      rejectDeliverable(
        dealId,
        {
          brandProfileId: ids.brandId,
          actorUserId: ids.brandUserId,
          deliverableId: target.id,
          expectedVersion: 1,
          category: 'other',
          reason: 'Redo',
        },
        {
          ...rejectionDeps,
          transition: async (tx) => {
            await tx.execute(sql`SELECT 1 / 0`);
          },
        }
      )
    ).rejects.toThrow();
    expect(await eventsFor(dealId)).toEqual(before);
    expect((await videosFor(dealId))[0].reviewStatus).toBe('pending');
    expect(
      (await db.select().from(deal).where(eq(deal.id, dealId)))[0].status
    ).toBe('delivered');
  });
  it('records three stable slots, two revisions, retry identities, review cycles and one batch approval', async () => {
    const ids = await identities();
    const { dealId } = await createMoneyFixture({
      kind: 'funded',
      label: 'history rounds',
      videoCount: 3,
    });
    const base = {
      creatorProfileId: ids.creatorId,
      actorUserId: ids.creatorUserId,
    };
    const firstInput = {
      ...base,
      tiktokUrl: 'https://www.tiktok.com/@creator/video/1',
      requestId: crypto.randomUUID(),
      deliverableId: null,
      expectedVersion: 0,
      expectedSubmitted: 0,
    };
    const [first, retry] = await Promise.all([
      submitDeliverable(dealId, firstInput),
      submitDeliverable(dealId, firstInput),
    ]);
    expect(first).toEqual(retry);
    expect(await videosFor(dealId)).toHaveLength(1);
    expect(await eventsFor(dealId)).toHaveLength(1);
    expect(
      await submitDeliverable(dealId, {
        ...firstInput,
        tiktokUrl: 'https://www.tiktok.com/@creator/video/999',
      })
    ).toMatchObject({ ok: false, code: 'DELIVERABLE_VERSION_STALE' });
    for (let index = 1; index < 3; index++) {
      expect(
        await submitDeliverable(dealId, {
          ...firstInput,
          tiktokUrl: `https://www.tiktok.com/@creator/video/${index + 1}`,
          requestId: crypto.randomUUID(),
          expectedSubmitted: index,
        })
      ).toMatchObject({
        ok: true,
        status: index === 2 ? 'delivered' : 'funded',
      });
    }
    const original = await videosFor(dealId);
    const target = original[1];
    const staleVersions = original.map(({ id, submissionVersion }) => ({
      id,
      submissionVersion,
    }));
    for (let version = 1; version <= 2; version++) {
      expect(
        await recordMetrics(target.id, {
          values: { views: version * 10, likes: 0 },
          source: 'creator',
          expectedVersion: version,
        })
      ).toMatchObject({ ok: true });
      expect(
        await rejectDeliverable(dealId, {
          brandProfileId: ids.brandId,
          actorUserId: ids.brandUserId,
          deliverableId: target.id,
          expectedVersion: version,
          category: 'brief_requirement',
          reason: `Round ${version}`,
        })
      ).toMatchObject({ ok: true });
      expect(
        await submitDeliverable(dealId, {
          ...firstInput,
          requestId: crypto.randomUUID(),
          deliverableId: target.id,
          tiktokUrl: target.tiktokUrl,
          expectedVersion: version,
          expectedSubmitted: 3,
        })
      ).toMatchObject({
        ok: true,
        submissionVersion: version + 1,
        videoOrdinal: 2,
      });
      expect(
        await db
          .select()
          .from(videoMetric)
          .where(eq(videoMetric.deliverableId, target.id))
      ).toEqual([]);
      expect(
        await recordMetrics(target.id, {
          values: { views: 99 },
          source: 'creator',
          expectedVersion: version,
        })
      ).toEqual({ ok: false, reason: 'conflict' });
    }
    const current = await videosFor(dealId);
    expect(current.map((v) => [v.id, v.videoOrdinal])).toEqual(
      original.map((v) => [v.id, v.videoOrdinal])
    );
    const ledger = new EscrowLedgerService(db, getPaymentProvider());
    await expect(
      ledger.payoutForDeal(dealId, ids.brandUserId, {
        expectedVersions: staleVersions,
        actorRole: 'brand',
      })
    ).rejects.toThrow(VersionConflict);
    await ledger.payoutForDeal(dealId, ids.brandUserId, {
      expectedVersions: current.map(({ id, submissionVersion }) => ({
        id,
        submissionVersion,
      })),
      actorRole: 'brand',
    });
    const events = await eventsFor(dealId);
    expect(events.filter((e) => e.kind === 'batch_approved')).toHaveLength(3);
    expect(
      events
        .filter((e) => e.deliverableId === target.id && e.kind === 'submitted')
        .map((e) => e.submissionVersion)
    ).toEqual([1, 2, 3]);
    expect(
      events
        .filter((e) => e.kind === 'superseded')
        .map((e) => e.metadata.metrics?.views)
    ).toEqual([10, 20]);
    expect(events.filter((e) => e.kind === 'review_ready')).toHaveLength(9);
    expect(events.filter((e) => e.kind === 'review_interrupted')).toHaveLength(
      4
    );
    expect(
      new Set(
        events
          .filter((e) => e.kind === 'review_ready')
          .map((e) => e.reviewCycleId)
      ).size
    ).toBe(3);
    expect(
      (await videosFor(dealId)).every((v) => v.reviewStatus === 'approved')
    ).toBe(true);
    await expect(
      ledger.payoutForDeal(dealId, ids.brandUserId)
    ).rejects.toThrow();
    expect(await eventsFor(dealId)).toEqual(events);
  });

  it('admin revision identifies a replaceable video and admin release is not brand approval', async () => {
    const ids = await identities();
    const { dealId } = await createMoneyFixture({
      kind: 'funded',
      label: 'history admin',
      videoCount: 1,
    });
    const submit = {
      creatorProfileId: ids.creatorId,
      actorUserId: ids.creatorUserId,
      tiktokUrl: 'https://www.tiktok.com/@creator/video/123',
      requestId: crypto.randomUUID(),
      deliverableId: null,
      expectedVersion: 0,
      expectedSubmitted: 0,
    };
    await submitDeliverable(dealId, submit);
    const [video] = await videosFor(dealId);
    const adminId = await userIdForEmail('admin@demo.com');
    const adminDeps = realResolveDeps(await signInCookie('admin@demo.com'));
    expect(
      await resolveDispute(
        dealId,
        {
          resolution: 'revision',
          note: 'Fix disclosure',
          deliverableId: video.id,
          expectedVersion: 1,
          category: 'disclosure_compliance',
        },
        adminId,
        adminDeps
      )
    ).toMatchObject({ ok: true });
    expect((await videosFor(dealId))[0].reviewStatus).toBe('rejected');
    expect(
      await submitDeliverable(dealId, {
        ...submit,
        requestId: crypto.randomUUID(),
        deliverableId: video.id,
        expectedVersion: 1,
        expectedSubmitted: 1,
      })
    ).toMatchObject({ ok: true });
    expect(
      await resolveDispute(
        dealId,
        {
          resolution: 'release',
          note: 'Reviewed correction',
          expectedVersions: [{ id: video.id, submissionVersion: 2 }],
        },
        adminId,
        adminDeps
      )
    ).toMatchObject({ ok: true });
    const events = await eventsFor(dealId);
    expect(events.filter((e) => e.kind === 'admin_release')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'batch_approved')).toHaveLength(0);
    expect(events.find((e) => e.kind === 'revision_requested')?.actorRole).toBe(
      'admin'
    );
  });

  it('refund keeps submitted evidence and relational constraints reject mismatched deal ownership', async () => {
    const ids = await identities();
    const first = await createMoneyFixture({
      kind: 'funded',
      label: 'history refund',
    });
    const other = await createMoneyFixture({
      kind: 'funded',
      label: 'history ownership',
    });
    await submitDeliverable(first.dealId, {
      creatorProfileId: ids.creatorId,
      actorUserId: ids.creatorUserId,
      tiktokUrl: 'https://www.tiktok.com/@creator/video/456',
      requestId: crypto.randomUUID(),
      deliverableId: null,
      expectedVersion: 0,
      expectedSubmitted: 0,
    });
    const [video] = await videosFor(first.dealId);
    await expect(
      db.insert(deliverableEvent).values({
        deliverableId: video.id,
        dealId: other.dealId,
        submissionVersion: 1,
        kind: 'refunded',
        actorRole: 'system',
        occurredAt: new Date(),
        tiktokUrl: video.tiktokUrl,
      })
    ).rejects.toThrow();
    await new EscrowLedgerService(db, getPaymentProvider()).refundDeal(
      first.dealId
    );
    expect((await eventsFor(first.dealId)).map((e) => e.kind)).toEqual([
      'submitted',
      'refunded',
    ]);
    expect(await videosFor(first.dealId)).toHaveLength(1);
  });

  it('a mandatory approval event failure rolls back local payout, review and deal writes', async () => {
    const ids = await identities();
    const { dealId } = await createMoneyFixture({
      kind: 'funded',
      label: 'history rollback',
      videoCount: 1,
    });
    await submitDeliverable(dealId, {
      creatorProfileId: ids.creatorId,
      actorUserId: ids.creatorUserId,
      tiktokUrl: 'https://www.tiktok.com/@creator/video/789',
      requestId: crypto.randomUUID(),
      deliverableId: null,
      expectedVersion: 0,
      expectedSubmitted: 0,
    });
    const [video] = await videosFor(dealId);
    // Duplicate evidence is a real constraint failure, not a mocked ledger method.
    await db.insert(deliverableEvent).values({
      deliverableId: video.id,
      dealId,
      submissionVersion: 1,
      kind: 'batch_approved',
      actorRole: 'system',
      occurredAt: new Date(),
      tiktokUrl: video.tiktokUrl,
    });
    const before = await db
      .select()
      .from(ledgerEntry)
      .where(eq(ledgerEntry.dealId, dealId));
    await expect(
      new EscrowLedgerService(db, getPaymentProvider()).payoutForDeal(
        dealId,
        ids.brandUserId,
        { expectedVersions: [{ id: video.id, submissionVersion: 1 }] }
      )
    ).rejects.toThrow();
    expect(
      await db.select().from(ledgerEntry).where(eq(ledgerEntry.dealId, dealId))
    ).toEqual(before);
    expect((await videosFor(dealId))[0].reviewStatus).toBe('pending');
    expect(
      (await db.select().from(deal).where(eq(deal.id, dealId)))[0].status
    ).toBe('delivered');
    expect(
      (
        await db.execute(
          sql`select count(*)::int as n from deliverable_event where deal_id = ${dealId} and kind = 'batch_approved'`
        )
      ).rows[0].n
    ).toBe(1);
  });
});
