import { describe, expect, it, vi } from 'vitest';

/**
 * Default-dep smoke tests for the refund modules and the admin payments read
 * (KAN-70 PR 4) — `wallet-default-deps.test.ts`'s pattern.
 *
 * These exercise the real default deps — the DB-backed closures in
 * `lib/refunds/external-refund.ts`, `lib/admin/payments.ts` and the two new
 * closures in `lib/deals/brand-detail.ts` — by mocking `@/db` so the drizzle
 * chains resolve without a database, `getPaymentGateway` so the refund leg
 * answers, and `guard` so the admin/brand gates pass. The business logic is
 * already covered by the seam-injected tests; the goal here is function-level
 * coverage of the closures those tests inject around.
 */

// One row wearing every hat: totals aggregates, refund columns, brand deal
// join columns. Each mocked query picks the keys it selected.
const ROW: Record<string, unknown> = {
  // refund row / claim
  id: 'ffffffff-0000-4000-8000-000000000001',
  dealId: 'dddddddd-0000-4000-8000-000000000001',
  campaignId: 'cccccccc-0000-4000-8000-000000000001',
  amount: 100_000,
  status: 'completed',
  txRef: 'cmfund_00000000-0000-4000-8000-000000000001',
  failureReason: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  resolvedAt: null,
  // payments totals
  deposited: 500_000,
  withdrawn: 120_000,
  refunded: 30_000,
  commission: 45_000,
  escrowHeld: 200_000,
  // brand deal join
  campaignName: 'Ramadan Beauty Push',
  brandCompanyName: 'Sheba Cosmetics',
  creatorHandle: '@selam',
  creatorImage: null,
  videoCount: 2,
  unitPrice: 150_000,
  totalPrice: 300_000,
  rightsTermsVersion: 'v1.0',
  bankName: 'Awash Bank',
  fundingTxRef: 'cmfund_00000000-0000-4000-8000-000000000001',
  payout: 255_000,
};

vi.mock('../db', () => {
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
      'onConflictDoNothing',
      'returning',
      'update',
      'set',
    ]) {
      chain[m] = vi.fn(() => chain);
    }
    chain.then = (resolve: (v: unknown) => void) => resolve([ROW]);
    return chain;
  };
  return {
    db: {
      select: vi.fn(() => makeChain()),
      insert: vi.fn(() => makeChain()),
      update: vi.fn(() => makeChain()),
    },
  };
});

const gateway = vi.hoisted(() => ({
  mode: 'chapa-test' as const,
  refund: vi.fn(async () => undefined),
}));

vi.mock('../lib/payment/gateway', () => ({
  getPaymentGateway: vi.fn(() => gateway),
}));

vi.mock('../lib/authz', () => ({
  guard: vi.fn(async () => ({
    user: { id: 'admin-user' },
    brandProfileId: '11111111-1111-4111-8111-111111111111',
  })),
}));

describe('default deps: issueExternalRefund', () => {
  it('exercises findFundingTxRef, claimRow (insert path), and markProcessing', async () => {
    const { issueExternalRefund } =
      await import('../lib/refunds/external-refund');

    const result = await issueExternalRefund({
      dealId: ROW.dealId as string,
      campaignId: ROW.campaignId as string,
      amount: 100_000,
      reason: 'test',
    });

    expect(result).toMatchObject({ ok: true, status: 'processing' });
    expect(gateway.refund).toHaveBeenCalled();
  });
});

describe('default deps: settleRefundEvent', () => {
  it('exercises settleRows on a success event', async () => {
    const { settleRefundEvent } =
      await import('../lib/refunds/external-refund');

    const result = await settleRefundEvent({
      txRef: ROW.txRef as string,
      status: 'success',
    });

    expect(result).toEqual({ outcome: 'refunded', count: 1 });
  });
});

describe('default deps: readPaymentsForAdmin', () => {
  it('exercises the totals and the three list queries', async () => {
    const { readPaymentsForAdmin } = await import('../lib/admin/payments');

    const view = await readPaymentsForAdmin();

    expect(view.totals.deposited).toBe(500_000);
    expect(view.sessions[0].campaignName).toBe('Ramadan Beauty Push');
    expect(view.withdrawals[0].bankName).toBe('Awash Bank');
    expect(view.refunds[0].amount).toBe(100_000);
  });
});

describe('default deps: retryRefundForAdmin', () => {
  it('exercises loadRefund and the real issue path', async () => {
    const { retryRefundForAdmin } = await import('../lib/admin/payments');

    const result = await retryRefundForAdmin(ROW.id as string);

    expect(result).toEqual({ ok: true, status: 'processing' });
  });
});

describe('default deps: brand deal settlement and refund closures', () => {
  it('exercises selectSettlementFromLedger for a completed deal', async () => {
    ROW.status = 'completed';
    const { readBrandDeal } = await import('../lib/deals/brand-detail');

    const detail = await readBrandDeal(ROW.dealId as string);

    expect(detail?.settlement).toEqual({
      payout: 255_000,
      commission: 45_000,
    });
  });

  it('exercises selectRefundStatusRow for a refunded deal', async () => {
    ROW.status = 'refunded';
    const { readBrandDeal } = await import('../lib/deals/brand-detail');

    const detail = await readBrandDeal(ROW.dealId as string);

    expect(detail?.externalRefundStatus).toBe('refunded');
  });
});
