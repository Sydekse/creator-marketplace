import { describe, expect, it, vi } from 'vitest';
import {
  readPaymentsForAdmin,
  retryRefundForAdmin,
} from '@/lib/admin/payments';
import type { AdminPaymentsDeps, RetryRefundDeps } from '@/lib/admin/payments';
import { handleRetryRefund } from '@/app/api/admin/refunds/[id]/retry/route';
import { ForbiddenError } from '@/lib/authz';
import { ErrorCode } from '@/lib/validation';

/**
 * The admin payments & reconciliation read and its refund retry
 * (KAN-70 PR 4).
 *
 * The properties worth a test: the admin gate runs before any query fires
 * (the `lib/admin/overview.ts` rule), the retry delegates its idempotency to
 * `issueExternalRefund`'s claim rather than re-implementing one, and the
 * route maps each refusal to the documented status without inventing codes.
 */

const REFUND_ID = 'ffffffff-1111-2222-3333-444444444444';

const TOTALS = {
  deposited: 500_000,
  withdrawn: 120_000,
  refunded: 30_000,
  commission: 25_000,
  escrowHeld: 200_000,
};

function makeReadDeps(overrides: Partial<AdminPaymentsDeps> = {}) {
  const deps: AdminPaymentsDeps = {
    requireAdmin: vi.fn(async () => ({})),
    totals: vi.fn(async () => TOTALS),
    listSessions: vi.fn(async () => []),
    listWithdrawals: vi.fn(async () => []),
    listRefunds: vi.fn(async () => []),
    ...overrides,
  };
  return deps;
}

describe('readPaymentsForAdmin', () => {
  it('assembles totals and the three lists', async () => {
    const deps = makeReadDeps();

    const view = await readPaymentsForAdmin(deps);

    expect(view.totals).toEqual(TOTALS);
    expect(view.sessions).toEqual([]);
    expect(view.withdrawals).toEqual([]);
    expect(view.refunds).toEqual([]);
  });

  it('gates before any read fires', async () => {
    const deps = makeReadDeps({
      requireAdmin: vi.fn(async () => {
        throw new ForbiddenError('nope');
      }),
    });

    await expect(readPaymentsForAdmin(deps)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    // The gate is the module's, not just the layout's — a denied caller's
    // request must not have already summed the ledger by the time it is
    // refused.
    expect(deps.totals).not.toHaveBeenCalled();
    expect(deps.listSessions).not.toHaveBeenCalled();
    expect(deps.listWithdrawals).not.toHaveBeenCalled();
    expect(deps.listRefunds).not.toHaveBeenCalled();
  });
});

function makeRetryDeps(overrides: Partial<RetryRefundDeps> = {}) {
  const deps: RetryRefundDeps = {
    requireAdmin: vi.fn(async () => ({})),
    loadRefund: vi.fn(async () => ({
      dealId: 'dddddddd-1111-2222-3333-444444444444',
      campaignId: 'cccccccc-1111-2222-3333-444444444444',
      amount: 100_000,
    })),
    issue: vi.fn(async () => ({
      ok: true as const,
      refundId: REFUND_ID,
      status: 'processing' as const,
    })),
    ...overrides,
  };
  return deps;
}

describe('retryRefundForAdmin', () => {
  it('re-issues the refund with the row’s own figures', async () => {
    const deps = makeRetryDeps();

    const result = await retryRefundForAdmin(REFUND_ID, deps);

    expect(result).toEqual({ ok: true, status: 'processing' });
    // The retry re-runs the same claim path as the original attempt — the
    // amount and ids come from the row, never from the request.
    expect(deps.issue).toHaveBeenCalledWith({
      dealId: 'dddddddd-1111-2222-3333-444444444444',
      campaignId: 'cccccccc-1111-2222-3333-444444444444',
      amount: 100_000,
      reason: 'Dispute resolved: refunded to brand (admin retry)',
    });
  });

  it('gates before the row is even loaded', async () => {
    const deps = makeRetryDeps({
      requireAdmin: vi.fn(async () => {
        throw new ForbiddenError('nope');
      }),
    });

    await expect(retryRefundForAdmin(REFUND_ID, deps)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    expect(deps.loadRefund).not.toHaveBeenCalled();
  });

  it('answers not_found for a row nobody holds, without touching the gateway', async () => {
    const deps = makeRetryDeps({ loadRefund: vi.fn(async () => null) });

    const result = await retryRefundForAdmin(REFUND_ID, deps);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(deps.issue).not.toHaveBeenCalled();
  });

  it('passes already_settled through — the claim is the idempotency, not this module', async () => {
    const deps = makeRetryDeps({
      issue: vi.fn(async () => ({
        ok: false as const,
        reason: 'already_settled' as const,
      })),
    });

    expect(await retryRefundForAdmin(REFUND_ID, deps)).toEqual({
      ok: false,
      reason: 'already_settled',
    });
  });

  it('maps every other refusal to gateway_rejected', async () => {
    for (const reason of ['gateway_rejected', 'no_funding_charge'] as const) {
      const deps = makeRetryDeps({
        issue: vi.fn(async () => ({ ok: false as const, reason })),
      });

      expect(await retryRefundForAdmin(REFUND_ID, deps)).toEqual({
        ok: false,
        reason: 'gateway_rejected',
      });
    }
  });
});

describe('POST /api/admin/refunds/{id}/retry', () => {
  it('answers 404 for a malformed id before anything runs', async () => {
    const retryDeps = makeRetryDeps();

    const response = await handleRetryRefund('not-a-uuid', { retryDeps });

    expect(response.status).toBe(404);
    // The shape check short-circuits: a mistyped id must not become a
    // Postgres 22P02 → 500, and must not even reach the gate's session read.
    expect(retryDeps.requireAdmin).not.toHaveBeenCalled();
  });

  it('answers 403 for a non-admin, as the guard’s own envelope', async () => {
    const retryDeps = makeRetryDeps({
      requireAdmin: vi.fn(async () => {
        throw new ForbiddenError('nope');
      }),
    });

    const response = await handleRetryRefund(REFUND_ID, { retryDeps });

    expect(response.status).toBe(403);
  });

  it('answers 200 with the new status on success', async () => {
    const response = await handleRetryRefund(REFUND_ID, {
      retryDeps: makeRetryDeps(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      refund_id: REFUND_ID,
      status: 'processing',
    });
  });

  it.each([
    ['not_found', 404, ErrorCode.NOT_FOUND],
    ['already_settled', 409, ErrorCode.REFUND_ALREADY_SETTLED],
    ['gateway_rejected', 402, ErrorCode.PAYMENT_FAILED],
  ] as const)('maps %s to %i %s', async (reason, status, code) => {
    // `not_found` is the loader's answer (no such row); the other two come
    // back through `issueExternalRefund`'s own result.
    const retryDeps =
      reason === 'not_found'
        ? makeRetryDeps({ loadRefund: vi.fn(async () => null) })
        : makeRetryDeps({
            issue: vi.fn(async () => ({ ok: false as const, reason })),
          });

    const response = await handleRetryRefund(REFUND_ID, { retryDeps });

    expect(response.status).toBe(status);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe(code);
  });
});
