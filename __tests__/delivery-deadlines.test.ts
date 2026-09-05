import { describe, expect, it, vi } from 'vitest';
import {
  classifyPunctuality,
  deliveryTerm,
  deliveryWindowSchema,
  fundingDeadline,
  punctualityAggregate,
  type DeadlineEvidence,
} from '@/lib/deals/deadline';
import {
  decideDeadline,
  proposeDeadline,
  type DeadlineDeps,
  type DeadlineRequestRow,
} from '@/lib/deals/deadline-requests';
import type { Tx } from '@/lib/authz';
import type { Notify } from '@/lib/notifications/notify';

const at = (day: number) => new Date(Date.UTC(2026, 8, day, 12));
const evidence: DeadlineEvidence = {
  status: 'funded',
  deliveryWindowDays: 7,
  originalDeliveryDueAt: at(8),
  currentDeliveryDueAt: at(8),
};
const brand = { role: 'brand', userId: 'brand' } as const;
const creator = { role: 'creator', userId: 'creator' } as const;
const requestId = '11111111-1111-4111-8111-111111111111';
const proposal = {
  expectedDueAt: at(8).toISOString(),
  proposedDueAt: at(10).toISOString(),
  note: 'Need another shoot',
};
const decision = {
  requestId,
  expectedDueAt: proposal.expectedDueAt,
  decision: 'accepted' as const,
};

describe('delivery terms and punctuality', () => {
  it.each([1, 7, 90])('accepts explicit %i day windows', (days) =>
    expect(deliveryWindowSchema.safeParse(days).success).toBe(true)
  );
  it.each([undefined, null, 0, -1, 91, 1.5, '7', NaN])(
    'refuses invalid window %s',
    (days) => expect(deliveryWindowSchema.safeParse(days).success).toBe(false)
  );
  it('uses elapsed UTC days without defaults or DST/calendar rounding', () => {
    expect(
      fundingDeadline(2, new Date('2026-03-28T23:45:30.125Z'))?.toISOString()
    ).toBe('2026-03-30T23:45:30.125Z');
    expect(fundingDeadline(null, at(1))).toBeNull();
    expect(fundingDeadline(undefined, at(1))).toBeNull();
    expect(deliveryTerm(null)).toBe('No delivery deadline recorded');
    expect(deliveryTerm(7)).toBe('Within 7 days after funding');
  });
  it('keeps equality on-time and strictly later open work overdue', () => {
    expect(classifyPunctuality(evidence, at(8))).toBe('due');
    expect(classifyPunctuality(evidence, new Date(+at(8) + 1))).toBe('overdue');
    const delivered = {
      ...evidence,
      status: 'delivered' as const,
      firstDeliveredAt: at(8),
      dueAtFirstDelivery: at(8),
    };
    expect(classifyPunctuality(delivered, at(20))).toBe('on_time');
    expect(
      classifyPunctuality(
        { ...delivered, firstDeliveredAt: new Date(+at(8) + 1) },
        at(20)
      )
    ).toBe('late');
    expect(
      classifyPunctuality(
        { ...delivered, missedDeliveryCommitment: true },
        at(20)
      )
    ).toBe('earlier_missed');
    expect(
      classifyPunctuality({ ...delivered, dueAtFirstDelivery: null }, at(20))
    ).toBe('unknown');
    expect(
      classifyPunctuality({ ...delivered, originalDeliveryDueAt: null }, at(20))
    ).toBe('unknown');
  });
  it('keeps legacy unknown, unpaid waiting, and closed work outside delivery rates', () => {
    expect(classifyPunctuality({ status: 'funded' }, at(20))).toBe('unknown');
    expect(
      classifyPunctuality({ status: 'accepted', deliveryWindowDays: 7 }, at(20))
    ).toBe('awaiting_funding');
    for (const status of ['refunded', 'declined', 'expired'] as const)
      expect(classifyPunctuality({ ...evidence, status }, at(20))).toBe(
        'closed'
      );
    for (const status of [
      'delivered',
      'revision_requested',
      'completed',
    ] as const)
      expect(classifyPunctuality({ ...evidence, status }, at(20))).toBe(
        'unknown'
      );
    expect(
      classifyPunctuality({ ...evidence, currentDeliveryDueAt: null }, at(20))
    ).toBe('unknown');
    expect(punctualityAggregate([], at(20)).onTimeRate).toBeNull();
    const result = punctualityAggregate(
      [
        { ...evidence, firstDeliveredAt: at(8), dueAtFirstDelivery: at(8) },
        {
          ...evidence,
          firstDeliveredAt: at(8),
          dueAtFirstDelivery: at(8),
          missedDeliveryCommitment: true,
        },
        { ...evidence, firstDeliveredAt: at(9), dueAtFirstDelivery: at(8) },
        evidence,
        { status: 'funded' },
        { ...evidence, currentDeliveryDueAt: at(30) },
      ],
      at(20)
    );
    expect(result).toMatchObject({
      eligible: 3,
      onTimeRate: 1 / 3,
      earlier_missed: 1,
      late: 1,
      unknown: 1,
      due: 1,
      overdue: 1,
      total: 6,
    });
  });
});

function fixture() {
  const row = {
    ...evidence,
    id: 'deal',
    campaignId: 'campaign',
    creatorId: 'creator-profile',
    brandUserId: 'brand',
    creatorUserId: 'creator',
    campaignTitle: 'Campaign',
    missedDeliveryCommitment: false,
  } as Awaited<ReturnType<DeadlineDeps['load']>> & {};
  const requests: DeadlineRequestRow[] = [];
  const notify = vi.fn<Notify>().mockResolvedValue(undefined);
  const deps: DeadlineDeps = {
    now: () => at(5),
    run: async (fn) => fn({} as Tx, notify),
    load: vi.fn(async (_tx, _id, actor) =>
      ['brand', 'creator'].includes(actor.userId) ? row : null
    ),
    requests: vi.fn(async () => requests),
    insert: vi.fn(async (_tx, input) => {
      const request = {
        ...input,
        id: requestId,
        decidedAt: null,
        decidedBy: null,
        closureReason: null,
      } as DeadlineRequestRow;
      requests.push(request);
      return request;
    }),
    decide: vi.fn(async (_tx, id, values) => {
      Object.assign(
        requests.find((r) => r.id === id)!,
        values
      );
    }),
    extend: vi.fn(async (_tx, _id, due, missed) => {
      row.currentDeliveryDueAt = due;
      row.missedDeliveryCommitment = missed;
    }),
  };
  return { row, requests, notify, deps };
}
describe('locked delivery agreement service', () => {
  it.each([brand, creator])(
    'allows either party to propose, then only counterparty accepts',
    async (actor) => {
      const f = fixture();
      const other = actor.role === 'brand' ? creator : brand;
      await proposeDeadline('deal', actor, proposal, f.deps);
      expect(f.deps.load).toHaveBeenCalledBefore(
        f.deps.requests as ReturnType<typeof vi.fn>
      );
      expect(f.row.currentDeliveryDueAt).toEqual(at(8));
      expect(f.notify).toHaveBeenCalledWith(
        other.userId,
        'deadline_requested',
        expect.objectContaining({ requestId, recipientRole: other.role })
      );
      await expect(
        decideDeadline('deal', actor, decision, f.deps)
      ).rejects.toMatchObject({ code: 'DEADLINE_FORBIDDEN' });
      await decideDeadline('deal', other, decision, f.deps);
      expect(f.row.currentDeliveryDueAt).toEqual(at(10));
      expect(f.row.missedDeliveryCommitment).toBe(false);
      expect(f.requests[0]).toMatchObject({
        status: 'accepted',
        decidedBy: other.userId,
        note: proposal.note,
      });
      await decideDeadline('deal', other, decision, f.deps);
      expect(f.deps.extend).toHaveBeenCalledTimes(1);
      expect(f.notify).toHaveBeenCalledTimes(2);
      await expect(
        decideDeadline(
          'deal',
          other,
          { ...decision, decision: 'rejected' },
          f.deps
        )
      ).rejects.toMatchObject({ code: 'DEADLINE_CONFLICT' });
    }
  );
  it.each([
    ['rejected', creator],
    ['withdrawn', brand],
  ] as const)(
    'records %s without changing the deadline',
    async (outcome, actor) => {
      const f = fixture();
      await proposeDeadline('deal', brand, proposal, f.deps);
      await decideDeadline(
        'deal',
        actor,
        { ...decision, decision: outcome },
        f.deps
      );
      await decideDeadline(
        'deal',
        actor,
        { ...decision, decision: outcome },
        f.deps
      );
      expect(f.deps.extend).not.toHaveBeenCalled();
      expect(f.notify).toHaveBeenCalledTimes(2);
      expect(f.requests[0].status).toBe(outcome);
    }
  );
  it.each([0, 1])(
    'preserves prior misses only when accepted after due (offset %i)',
    async (offset) => {
      const f = fixture();
      await proposeDeadline('deal', brand, proposal, f.deps);
      f.deps.now = () => new Date(+at(8) + offset);
      await decideDeadline('deal', creator, decision, f.deps);
      expect(f.row.missedDeliveryCommitment).toBe(offset > 0);
    }
  );
  it('never clears an earlier missed commitment', async () => {
    const f = fixture();
    f.row.missedDeliveryCommitment = true;
    await proposeDeadline('deal', brand, proposal, f.deps);
    await decideDeadline('deal', creator, decision, f.deps);
    expect(f.row.missedDeliveryCommitment).toBe(true);
  });
  it('rejects duplicate pending proposals and stale versions', async () => {
    const f = fixture();
    await proposeDeadline('deal', brand, proposal, f.deps);
    await expect(
      proposeDeadline('deal', creator, proposal, f.deps)
    ).rejects.toMatchObject({ code: 'DEADLINE_CONFLICT' });
    await expect(
      decideDeadline(
        'deal',
        creator,
        { ...decision, expectedDueAt: at(7).toISOString() },
        f.deps
      )
    ).rejects.toMatchObject({ code: 'DEADLINE_CONFLICT' });
    await expect(
      decideDeadline(
        'deal',
        creator,
        { ...decision, requestId: crypto.randomUUID() },
        f.deps
      )
    ).rejects.toMatchObject({ code: 'DEADLINE_CONFLICT' });
    f.row.currentDeliveryDueAt = at(9);
    await expect(
      decideDeadline('deal', creator, decision, f.deps)
    ).rejects.toMatchObject({ code: 'DEADLINE_CONFLICT' });
    expect(f.notify).toHaveBeenCalledTimes(1);
  });
  it.each([
    { status: 'refunded' },
    { status: 'accepted' },
    { firstDeliveredAt: at(4) },
    { deliveryWindowDays: null },
    { currentDeliveryDueAt: null },
  ])('refuses inactive agreement %j under lock', async (patch) => {
    const f = fixture();
    Object.assign(f.row, patch);
    await expect(
      proposeDeadline('deal', brand, proposal, f.deps)
    ).rejects.toMatchObject({ code: 'DEADLINE_CONFLICT' });
    expect(f.deps.insert).not.toHaveBeenCalled();
  });
  it('refuses shortening, past proposal, expired acceptance and self withdrawal by counterparty', async () => {
    const f = fixture();
    await expect(
      proposeDeadline(
        'deal',
        brand,
        { ...proposal, proposedDueAt: at(8).toISOString() },
        f.deps
      )
    ).rejects.toMatchObject({ code: 'DEADLINE_CONFLICT' });
    f.deps.now = () => at(11);
    await expect(
      proposeDeadline('deal', brand, proposal, f.deps)
    ).rejects.toMatchObject({ code: 'DEADLINE_CONFLICT' });
    f.deps.now = () => at(5);
    await proposeDeadline('deal', brand, proposal, f.deps);
    await expect(
      decideDeadline(
        'deal',
        creator,
        { ...decision, decision: 'withdrawn' },
        f.deps
      )
    ).rejects.toMatchObject({ code: 'DEADLINE_FORBIDDEN' });
    f.deps.now = () => at(10);
    await expect(
      decideDeadline('deal', creator, decision, f.deps)
    ).rejects.toMatchObject({ code: 'DEADLINE_CONFLICT' });
    expect(f.deps.extend).not.toHaveBeenCalled();
  });
  it('refuses cross-owner and malformed inputs without side effects', async () => {
    const f = fixture();
    const outsider = { ...brand, userId: 'stranger' };
    await expect(
      proposeDeadline('deal', outsider, proposal, f.deps)
    ).rejects.toMatchObject({ code: 'DEADLINE_FORBIDDEN' });
    await expect(
      decideDeadline('deal', outsider, decision, f.deps)
    ).rejects.toMatchObject({ code: 'DEADLINE_FORBIDDEN' });
    await expect(
      proposeDeadline('deal', brand, { ...proposal, note: '' }, f.deps)
    ).rejects.toMatchObject({ code: 'DEADLINE_INVALID' });
    await expect(
      decideDeadline('deal', brand, { ...decision, requestId: 'bad' }, f.deps)
    ).rejects.toMatchObject({ code: 'DEADLINE_INVALID' });
    expect(f.notify).not.toHaveBeenCalled();
  });
  it('propagates failed history persistence rather than returning success', async () => {
    const f = fixture();
    vi.mocked(f.deps.insert).mockRejectedValue(new Error('write failed'));
    await expect(
      proposeDeadline('deal', brand, proposal, f.deps)
    ).rejects.toThrow('write failed');
    expect(f.notify).not.toHaveBeenCalled();
  });
});
