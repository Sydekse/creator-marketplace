import { describe, expect, it, vi } from 'vitest';

/**
 * Default-dep smoke tests for the wallet modules (KAN-70 PR 3).
 *
 * These exercise the real default deps — the DB-backed closures in
 * `lib/wallet` — by mocking `@/db` so the drizzle chains resolve without a
 * database, and `getPaymentGateway` so the transfer legs answer. The business
 * logic is already tested by the seam-injected tests in `wallet-withdraw`,
 * `settle-withdrawal`, `payout-method` and `sweep-withdrawals`; the goal here
 * is function-level coverage of the closures those tests inject around.
 */

// One row wearing every hat: balance aggregates, withdrawal columns, payout
// method columns. Each mocked query picks the keys it selected.
const ROW = {
  earned: 100_000,
  withdrawn: 0,
  inFlight: 0,
  id: 'w0000000-0000-4000-8000-000000000001',
  amount: 20_000,
  status: 'processing',
  txRef: 'cmwd_00000000-0000-4000-8000-000000000001',
  providerRef: 'tr-1',
  methodKind: 'bank',
  kind: 'bank',
  bankCode: '946',
  bankName: 'Awash Bank',
  accountNumber: '01320811436100',
  accountNumberMasked: '••••6100',
  accountName: 'Abebe Bikila',
  failureReason: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  resolvedAt: null,
  creatorUserId: 'u0000000-0000-4000-8000-000000000001',
};

vi.mock('../db', () => {
  // A fresh chain per query (see default-deps.test.ts for why sharing one
  // chain object deadlocks concurrent queries).
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    for (const m of [
      'select',
      'from',
      'where',
      'innerJoin',
      'leftJoin',
      'orderBy',
      'limit',
      'insert',
      'values',
      'onConflictDoUpdate',
      'returning',
      'update',
      'set',
    ]) {
      chain[m] = vi.fn(() => chain);
    }
    chain.then = (resolve: (v: unknown) => void) => resolve([ROW]);
    return chain;
  };
  const tx = {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => makeChain()),
  };
  return {
    db: {
      select: vi.fn(() => makeChain()),
      insert: vi.fn(() => makeChain()),
      update: vi.fn(() => makeChain()),
      transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
        fn(tx)
      ),
    },
  };
});

const gateway = vi.hoisted(() => ({
  mode: 'chapa-test' as const,
  listBanks: vi.fn(async () => [
    {
      code: '946',
      name: 'Awash Bank',
      accountLength: 14,
      isMobileMoney: false,
    },
  ]),
  sendTransfer: vi.fn(async () => ({ providerRef: 'tr-1' })),
  verifyTransfer: vi.fn(async () => ({
    status: 'success',
    txRef: ROW.txRef,
    providerRef: 'tr-1',
    amountSantim: 20_000,
  })),
}));

vi.mock('../lib/payment/gateway', () => ({
  getPaymentGateway: vi.fn(() => gateway),
}));

vi.mock('../lib/notifications', () => ({
  notify: vi.fn(async () => undefined),
}));

describe('default deps: wallet balance reads', () => {
  it('exercises the balance, history and receipt queries', async () => {
    const { readWalletBalance, listWithdrawals, getWithdrawalForCreator } =
      await import('../lib/wallet/balance');

    const balance = await readWalletBalance('c1');
    expect(balance.available).toBe(100_000);

    const history = await listWithdrawals('c1');
    expect(Array.isArray(history)).toBe(true);

    const receipt = await getWithdrawalForCreator(ROW.id, 'c1');
    expect(receipt?.id).toBe(ROW.id);
  });
});

describe('default deps: requestWithdrawal', () => {
  it('exercises getMethod, reserve, and markProcessing', async () => {
    const { requestWithdrawal } = await import('../lib/wallet/withdraw');
    const result = await requestWithdrawal('c1', 20_000);
    expect(result.ok).toBe(true);
    expect(gateway.sendTransfer).toHaveBeenCalled();
  });
});

describe('default deps: settleWithdrawal', () => {
  it('exercises getWithdrawal and markPaid on a success verification', async () => {
    const { settleWithdrawal } =
      await import('../lib/wallet/settle-withdrawal');
    const result = await settleWithdrawal(ROW.txRef);
    expect(result.outcome).toBe('paid');
  });

  it('exercises markFailed on a failed verification', async () => {
    gateway.verifyTransfer.mockResolvedValueOnce({
      status: 'failed',
      txRef: ROW.txRef,
      providerRef: 'tr-1',
      amountSantim: 20_000,
    });
    const { settleWithdrawal } =
      await import('../lib/wallet/settle-withdrawal');
    const result = await settleWithdrawal(ROW.txRef);
    expect(result.outcome).toBe('failed');
  });
});

describe('default deps: sweepWithdrawals', () => {
  it('exercises listStale, settle, and abandonStalePending', async () => {
    const { sweepWithdrawalsJob } =
      await import('../lib/wallet/sweep-withdrawals');
    const output = await sweepWithdrawalsJob.run();
    expect(output.examined).toBe(1);
  });
});

describe('default deps: payout method', () => {
  it('exercises listBanks, upsert, and the masked read', async () => {
    const { savePayoutMethod, getPayoutMethodView } =
      await import('../lib/wallet/payout-method');
    const saved = await savePayoutMethod('c1', {
      bankCode: '946',
      accountNumber: '01320811436100',
      accountName: 'Abebe Bikila',
    });
    expect(saved.ok).toBe(true);

    const view = await getPayoutMethodView('c1');
    expect(view?.accountNumberMasked).toBe('••••6100');
  });
});
