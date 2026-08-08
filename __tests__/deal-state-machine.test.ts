import { describe, expect, it, vi } from 'vitest';
import { transitionDeal } from '../lib/deals/state-machine';
import { ErrorCode } from '../lib/validation/errors';
import type { Tx } from '../lib/authz';
import type { DealStatus } from '../db/schema';

describe('Deal State Machine (KAN-34)', () => {
  function createMockTx(existingDeal: { id: string; status: DealStatus } | null) {
    const limit = vi.fn().mockResolvedValue(existingDeal ? [existingDeal] : []);
    const forUpdate = vi.fn(() => ({ limit }));
    const whereSelect = vi.fn(() => ({ for: forUpdate }));
    const from = vi.fn(() => ({ where: whereSelect }));
    const select = vi.fn(() => ({ from }));

    const whereUpdate = vi.fn().mockResolvedValue([]);
    const setUpdate = vi.fn(() => ({ where: whereUpdate }));
    const update = vi.fn(() => ({ set: setUpdate }));

    const valuesInsert = vi.fn().mockResolvedValue([]);
    const insert = vi.fn(() => ({ values: valuesInsert }));

    const tx = {
      select,
      update,
      insert,
    } as unknown as Tx;

    return {
      tx,
      spies: { select, forUpdate, limit, update, setUpdate, insert, valuesInsert },
    };
  }

  const DEAL_ID = 'deal-123';
  const ACTOR_ID = 'actor-456';

  it('rejects transition if deal does not exist', async () => {
    const { tx } = createMockTx(null);

    await expect(
      transitionDeal(tx, DEAL_ID, 'accepted', ACTOR_ID)
    ).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('enforces FOR UPDATE lock before checking legality (AC-003)', async () => {
    const { tx, spies } = createMockTx({ id: DEAL_ID, status: 'pending' });

    await transitionDeal(tx, DEAL_ID, 'accepted', ACTOR_ID);

    expect(spies.select).toHaveBeenCalled();
    expect(spies.forUpdate).toHaveBeenCalledWith('update');
    expect(spies.limit).toHaveBeenCalledWith(1);
  });

  it('allows legal transitions and inserts deal_event (AC-001, AC-005)', async () => {
    const { tx, spies } = createMockTx({ id: DEAL_ID, status: 'pending' });

    const result = await transitionDeal(tx, DEAL_ID, 'accepted', ACTOR_ID, {
      reason: 'Offer accepted',
    });

    expect(result.status).toBe('accepted');

    // Asserts update occurred
    expect(spies.update).toHaveBeenCalled();
    expect(spies.setUpdate).toHaveBeenCalledWith({ status: 'accepted' });

    // Asserts deal_event was inserted
    expect(spies.insert).toHaveBeenCalled();
    expect(spies.valuesInsert).toHaveBeenCalledWith({
      dealId: DEAL_ID,
      fromStatus: 'pending',
      toStatus: 'accepted',
      actorId: ACTOR_ID,
      reason: 'Offer accepted',
    });
  });

  it('rejects illegal transitions and leaves state unchanged (AC-004)', async () => {
    const { tx, spies } = createMockTx({ id: DEAL_ID, status: 'pending' });

    await expect(
      transitionDeal(tx, DEAL_ID, 'funded', ACTOR_ID)
    ).rejects.toMatchObject({
      code: ErrorCode.NO_ACCEPTED_DEALS,
    });

    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('rejects idempotent retry with specific error code (AC-008)', async () => {
    // Already accepted
    const { tx, spies } = createMockTx({ id: DEAL_ID, status: 'accepted' });

    await expect(
      transitionDeal(tx, DEAL_ID, 'accepted', ACTOR_ID)
    ).rejects.toMatchObject({
      code: ErrorCode.OFFER_NOT_PENDING,
    });

    expect(spies.update).not.toHaveBeenCalled();
  });

  // Exhaustive check of FR-007 boundary mappings
  const errorMappingTests = [
    { from: 'accepted', to: 'accepted', code: ErrorCode.OFFER_NOT_PENDING },
    { from: 'accepted', to: 'delivered', code: ErrorCode.DEAL_NOT_FUNDED },
    { from: 'pending', to: 'completed', code: ErrorCode.DEAL_NOT_DELIVERED },
    { from: 'pending', to: 'refunded', code: ErrorCode.DEAL_NOT_FUNDED },
  ] as const;

  for (const { from, to, code } of errorMappingTests) {
    it(`maps illegal ${from} -> ${to} transition to ${code}`, async () => {
      const { tx } = createMockTx({ id: DEAL_ID, status: from as DealStatus });
      await expect(
        transitionDeal(tx, DEAL_ID, to as DealStatus, ACTOR_ID)
      ).rejects.toMatchObject({ code });
    });
  }
});
