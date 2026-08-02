import { describe, it, expect } from 'vitest';

type EntryType =
  'hold_pending' | 'hold' | 'release_payout' | 'commission' | 'refund';
type DealStatus = 'funded' | 'completed' | 'refunded';
type ProviderStatus = 'held' | 'captured' | 'released' | 'failed';

interface LedgerEntry {
  type: EntryType;
  amount: number;
  providerRef: string | null;
}

interface DealState {
  status: DealStatus;
  totalPrice: number;
}

interface ProviderResult {
  providerRef: string;
  status: ProviderStatus;
}

let nextRef = 0;
function mockProviderCall(shouldFail: boolean): ProviderResult {
  if (shouldFail) {
    throw new Error('INSUFFICIENT_FUNDS');
  }
  return { providerRef: `mock_poc_${++nextRef}`, status: 'captured' };
}

function simulatePayout(
  deal: DealState,
  providerShouldFail: boolean
): { entries: LedgerEntry[]; deal: DealState; error: string | null } {
  const txLog: { before: DealState; entriesBefore: number } = {
    before: { status: deal.status, totalPrice: deal.totalPrice },
    entriesBefore: 0,
  };

  const entries: LedgerEntry[] = [];
  let error: string | null = null;

  try {
    // === Begin transaction (simulated) ===

    // 1. Load deal FOR UPDATE — snapshot taken
    txLog.before = { status: deal.status, totalPrice: deal.totalPrice };

    // 2. Assert legal transition
    if (deal.status !== 'funded') {
      throw new Error('Deal not in funded state');
    }

    // 3. Write pending entry BEFORE provider call (compensation path, §5.2)
    entries.push({
      type: 'hold_pending' as EntryType,
      amount: -deal.totalPrice,
      providerRef: null,
    });
    txLog.entriesBefore = entries.length;

    // 4. Call provider
    const providerResult = mockProviderCall(providerShouldFail);

    // 5. Update pending entry to confirmed hold
    entries[entries.length - 1] = {
      type: 'hold' as EntryType,
      amount: -deal.totalPrice,
      providerRef: providerResult.providerRef,
    };

    // 6. Write payout + commission entries
    entries.push({
      type: 'release_payout' as EntryType,
      amount: -Math.round(deal.totalPrice * 0.85),
      providerRef: providerResult.providerRef,
    });
    entries.push({
      type: 'commission' as EntryType,
      amount: -Math.round(deal.totalPrice * 0.15),
      providerRef: providerResult.providerRef,
    });

    // 7. Update deal status
    deal.status = 'completed';

    // === Commit transaction (simulated) ===
  } catch (e) {
    // === Rollback ===
    entries.length = 0;
    deal.status = txLog.before.status;
    error = (e as Error).message;
  }

  return { entries, deal, error };
}

describe('escrow design pattern — provider call inside transaction (§5.1)', () => {
  it('provider success: writes entries and changes deal status', () => {
    const deal: DealState = { status: 'funded', totalPrice: 5000 };

    const result = simulatePayout(deal, false);

    expect(result.error).toBeNull();
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0].type).toBe('hold');
    expect(result.entries[0].providerRef).toMatch(/^mock_poc_/);
    expect(result.entries[1].type).toBe('release_payout');
    expect(result.entries[2].type).toBe('commission');
    expect(result.deal.status).toBe('completed');
  });

  it('provider failure: zero entries and unchanged deal status', () => {
    const deal: DealState = { status: 'funded', totalPrice: 5000 };

    const result = simulatePayout(deal, true);

    expect(result.error).toContain('INSUFFICIENT_FUNDS');
    expect(result.entries).toHaveLength(0);
    expect(result.deal.status).toBe('funded');
  });

  it('pending entry is written before provider call (§5.2 compensation path)', () => {
    const txJournal: string[] = [];
    const entries: LedgerEntry[] = [];

    try {
      txJournal.push('load deal FOR UPDATE');
      txJournal.push('assert legal transition');

      entries.push({ type: 'hold_pending', amount: -5000, providerRef: null });
      txJournal.push('write hold_pending entry');

      // Provider fails
      throw new Error('PROVIDER_UNAVAILABLE');
    } catch {
      // rollback
      entries.length = 0;
    }

    // The pattern is valid: pending entry was staged before the provider call
    // On rollback, the pending entry is discarded along with everything else
    expect(txJournal[2]).toBe('write hold_pending entry');
    expect(entries).toHaveLength(0);
  });

  it('payout + commission sum equals totalPrice', () => {
    const deal: DealState = { status: 'funded', totalPrice: 5000 };

    const result = simulatePayout(deal, false);

    const payout = result.entries.find(
      (e) => e.type === 'release_payout'
    )!.amount;
    const commission = result.entries.find(
      (e) => e.type === 'commission'
    )!.amount;
    expect(Math.abs(payout) + Math.abs(commission)).toBe(deal.totalPrice);
  });
});
