import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { deal, deadlineRequest, notification } from '@/db/schema';
import {
  decideDeadline,
  proposeDeadline,
  defaultDeps,
} from '@/lib/deals/deadline-requests';
import { classifyPunctuality } from '@/lib/deals/deadline';
import {
  submitDeliverable,
  defaultDeps as submitDeps,
} from '@/lib/deals/submit-deliverable';
import { transitionDeal } from '@/lib/deals/state-machine';
import { EscrowLedgerService } from '@/lib/payment/ledger';
import { getPaymentProvider } from '@/lib/payment';
import {
  createMoneyFixture,
  profileIdForEmail,
  userIdForEmail,
} from './helpers';

const load = async (id: string) =>
  (await db.select().from(deal).where(eq(deal.id, id)))[0];
const requests = (id: string) =>
  db.select().from(deadlineRequest).where(eq(deadlineRequest.dealId, id));
async function fixture(videoCount = 1) {
  const ids = await createMoneyFixture({
    kind: 'funded',
    label: 'delivery agreement',
    deliveryWindowDays: 7,
    videoCount,
  });
  const row = await load(ids.dealId);
  const brand = {
    role: 'brand',
    userId: await userIdForEmail('brand@demo.com'),
  } as const;
  const creator = {
    role: 'creator',
    userId: await userIdForEmail('creator@demo.com'),
  } as const;
  const input = {
    expectedDueAt: row.currentDeliveryDueAt!.toISOString(),
    proposedDueAt: new Date(
      +row.currentDeliveryDueAt! + 86_400_000
    ).toISOString(),
    note: 'Allow another shoot',
  };
  return { ...ids, row, brand, creator, input };
}
async function submissionInput(actorUserId: string, expectedSubmitted = 0) {
  return {
    creatorProfileId: await profileIdForEmail('creator@demo.com'),
    actorUserId,
    tiktokUrl: 'https://www.tiktok.com/@creator/video/9876543210',
    requestId: crypto.randomUUID(),
    expectedSubmitted,
    deliverableId: null,
    expectedVersion: 0,
  };
}

describe('delivery agreements on real PostgreSQL', () => {
  it('initializes one UTC deadline in shared funding and cannot restart it on replay', async () => {
    const f = await fixture();
    expect(+f.row.currentDeliveryDueAt! - +f.row.fundedAt!).toBe(
      7 * 86_400_000
    );
    expect(f.row.currentDeliveryDueAt).toEqual(f.row.originalDeliveryDueAt);
    const ledger = new EscrowLedgerService(db, getPaymentProvider());
    await expect(ledger.holdForCampaign(f.campaignId)).rejects.toThrow();
    const replayed = await load(f.dealId);
    expect(replayed.fundedAt).toEqual(f.row.fundedAt);
    expect(replayed.currentDeliveryDueAt).toEqual(f.row.currentDeliveryDueAt);
    const legacy = await createMoneyFixture({
      kind: 'funded',
      label: 'legacy deadline',
    });
    expect(await load(legacy.dealId)).toMatchObject({
      deliveryWindowDays: null,
      currentDeliveryDueAt: null,
      originalDeliveryDueAt: null,
    });
  });
  it('serializes competing proposals, enforces one pending in SQL, rejects self and cross-owner decisions', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      proposeDeadline(f.dealId, f.brand, f.input),
      proposeDeadline(f.dealId, f.creator, f.input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const [request] = await requests(f.dealId);
    await expect(
      db.insert(deadlineRequest).values({ ...request, id: crypto.randomUUID() })
    ).rejects.toThrow();
    const proposer = request.proposerRole === 'brand' ? f.brand : f.creator;
    const other = request.proposerRole === 'brand' ? f.creator : f.brand;
    const input = {
      requestId: request.id,
      expectedDueAt: f.input.expectedDueAt,
      decision: 'accepted' as const,
    };
    await expect(
      decideDeadline(f.dealId, proposer, input)
    ).rejects.toMatchObject({ code: 'DEADLINE_FORBIDDEN' });
    await expect(
      decideDeadline(f.dealId, { ...other, userId: crypto.randomUUID() }, input)
    ).rejects.toMatchObject({ code: 'DEADLINE_FORBIDDEN' });
    await expect(
      proposeDeadline(
        f.dealId,
        { ...f.brand, userId: crypto.randomUUID() },
        f.input
      )
    ).rejects.toMatchObject({ code: 'DEADLINE_FORBIDDEN' });
    await Promise.all([
      decideDeadline(f.dealId, other, input),
      decideDeadline(f.dealId, other, input),
    ]);
    const notices = await db
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.userId, proposer.userId),
          eq(notification.type, 'deadline_accepted')
        )
      );
    expect(
      notices.filter(
        (n) => (n.payload as { requestId: string }).requestId === request.id
      )
    ).toHaveLength(1);
    expect((await load(f.dealId)).currentDeliveryDueAt?.toISOString()).toBe(
      f.input.proposedDueAt
    );
    await expect(
      decideDeadline(f.dealId, other, { ...input, decision: 'rejected' })
    ).rejects.toMatchObject({ code: 'DEADLINE_CONFLICT' });
  });
  it('freezes only the last required submission, closes pending, and retains evidence through revisions', async () => {
    const f = await fixture(2);
    const request = await proposeDeadline(f.dealId, f.creator, f.input);
    expect(
      await submitDeliverable(f.dealId, await submissionInput(f.creator.userId))
    ).toMatchObject({ ok: true, status: 'funded' });
    expect((await load(f.dealId)).firstDeliveredAt).toBeNull();
    expect(
      await submitDeliverable(
        f.dealId,
        await submissionInput(f.creator.userId, 1)
      )
    ).toMatchObject({ ok: true, status: 'delivered' });
    const frozen = await load(f.dealId);
    expect(frozen.firstDeliveredAt).toBeInstanceOf(Date);
    expect(frozen.dueAtFirstDelivery).toEqual(f.row.currentDeliveryDueAt);
    expect((await requests(f.dealId))[0]).toMatchObject({
      status: 'closed',
      closureReason: 'first_delivery',
    });
    await expect(
      decideDeadline(f.dealId, f.brand, {
        requestId: request.id,
        expectedDueAt: f.input.expectedDueAt,
        decision: 'accepted',
      })
    ).rejects.toMatchObject({ code: 'DEADLINE_CONFLICT' });
    await db.transaction(async (tx) => {
      await transitionDeal(tx, f.dealId, 'revision_requested', f.brand.userId);
      await transitionDeal(tx, f.dealId, 'delivered', f.creator.userId);
    });
    expect((await load(f.dealId)).firstDeliveredAt).toEqual(
      frozen.firstDeliveredAt
    );
    expect((await load(f.dealId)).dueAtFirstDelivery).toEqual(
      frozen.dueAtFirstDelivery
    );
  });
  it('rolls back the freeze and closure if submission history fails', async () => {
    const f = await fixture();
    await proposeDeadline(f.dealId, f.creator, f.input);
    await expect(
      submitDeliverable(f.dealId, await submissionInput(f.creator.userId), {
        ...submitDeps,
        ready: async () => {
          throw new Error('history unavailable');
        },
      })
    ).rejects.toThrow('history unavailable');
    expect((await load(f.dealId)).firstDeliveredAt).toBeNull();
    expect((await requests(f.dealId))[0].status).toBe('pending');
  });
  it.each(['acceptance', 'submission'] as const)(
    'serializes %s winning the initial-delivery race',
    async (winner) => {
      const f = await fixture();
      const request = await proposeDeadline(f.dealId, f.creator, f.input);
      let release!: () => void;
      let locked!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const decision = {
        requestId: request.id,
        expectedDueAt: f.input.expectedDueAt,
        decision: 'accepted' as const,
      };
      const input = await submissionInput(f.creator.userId);
      const first =
        winner === 'acceptance'
          ? decideDeadline(f.dealId, f.brand, decision, {
              ...defaultDeps,
              load: async (...args) => {
                const row = await defaultDeps.load(...args);
                locked();
                await gate;
                return row;
              },
            })
          : submitDeliverable(f.dealId, input, {
              ...submitDeps,
              loadDeal: async (...args) => {
                const row = await submitDeps.loadDeal(...args);
                locked();
                await gate;
                return row;
              },
            });
      await entered;
      const second =
        winner === 'acceptance'
          ? submitDeliverable(f.dealId, input)
          : decideDeadline(f.dealId, f.brand, decision);
      const results = Promise.allSettled([first, second]);
      release();
      const outcomes = await results;
      expect(outcomes[0].status).toBe('fulfilled');
      expect(outcomes[1].status).toBe(
        winner === 'acceptance' ? 'fulfilled' : 'rejected'
      );
      expect((await load(f.dealId)).dueAtFirstDelivery?.toISOString()).toBe(
        winner === 'acceptance' ? f.input.proposedDueAt : f.input.expectedDueAt
      );
      expect((await requests(f.dealId))[0].status).toBe(
        winner === 'acceptance' ? 'accepted' : 'closed'
      );
    }
  );
  it('closes pending on real ledger refund, preserving original dates and refusing decisions', async () => {
    const f = await fixture();
    const request = await proposeDeadline(f.dealId, f.brand, f.input);
    await new EscrowLedgerService(db, getPaymentProvider()).refundDeal(
      f.dealId,
      f.brand.userId
    );
    expect((await requests(f.dealId))[0]).toMatchObject({
      status: 'closed',
      closureReason: 'refunded',
    });
    expect((await load(f.dealId)).originalDeliveryDueAt).toEqual(
      f.row.originalDeliveryDueAt
    );
    await expect(
      decideDeadline(f.dealId, f.creator, {
        requestId: request.id,
        expectedDueAt: f.input.expectedDueAt,
        decision: 'accepted',
      })
    ).rejects.toMatchObject({ code: 'DEADLINE_CONFLICT' });
  });
  it('retains an earlier miss when a later extension is accepted after the previous deadline', async () => {
    const f = await fixture();
    const request = await proposeDeadline(f.dealId, f.brand, f.input);
    await decideDeadline(
      f.dealId,
      f.creator,
      {
        requestId: request.id,
        expectedDueAt: f.input.expectedDueAt,
        decision: 'accepted',
      },
      { ...defaultDeps, now: () => new Date(+f.row.currentDeliveryDueAt! + 1) }
    );
    const row = await load(f.dealId);
    expect(row.missedDeliveryCommitment).toBe(true);
    await db.transaction((tx) =>
      transitionDeal(tx, f.dealId, 'delivered', f.creator.userId, {
        occurredAt: new Date(+row.currentDeliveryDueAt! - 1000),
      })
    );
    expect(classifyPunctuality(await load(f.dealId), new Date())).toBe(
      'earlier_missed'
    );
  });
});
