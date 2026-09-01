import { describe, expect, it, vi } from 'vitest';
import {
  issueExternalRefund,
  settleRefundEvent,
} from '@/lib/refunds/external-refund';
import type {
  ExternalRefundDeps,
  RefundInput,
  SettleRefundDeps,
} from '@/lib/refunds/external-refund';
import type { PaymentGateway } from '@/lib/payment/gateway';
import { ChapaError } from '@/lib/chapa/client';

/**
 * The external leg of a dispute refund (KAN-70 PR 4).
 *
 * `issueExternalRefund` runs after the escrow ledger has already returned the
 * money on our books, so the property under test throughout is *containment*:
 * whatever the gateway does, the result is a refund row in an honest state —
 * never a thrown error the caller has to defend the resolution against, and
 * never a second gateway call for a deal already in flight.
 */

const INPUT: RefundInput = {
  dealId: 'dddddddd-1111-2222-3333-444444444444',
  campaignId: 'cccccccc-1111-2222-3333-444444444444',
  amount: 100_000,
  reason: 'Dispute resolved: refunded to brand',
};

const REFUND_ID = 'ffffffff-1111-2222-3333-444444444444';
const TX_REF = 'cmfund_11111111-2222-3333-4444-555555555555';

function gatewayMock(refund = vi.fn(async () => {})): PaymentGateway {
  return { refund } as unknown as PaymentGateway;
}

function makeDeps(overrides: Partial<ExternalRefundDeps> = {}) {
  const refundFn = vi.fn(async () => {});
  const deps: ExternalRefundDeps = {
    gateway: () => gatewayMock(refundFn),
    findFundingTxRef: vi.fn(async () => TX_REF),
    claimRow: vi.fn(async () => REFUND_ID),
    markProcessing: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    logFailure: vi.fn(),
    ...overrides,
  };
  return { deps, refundFn };
}

describe('issueExternalRefund', () => {
  it('answers mock and touches nothing when no gateway is configured', async () => {
    const { deps } = makeDeps({ gateway: () => null });

    const result = await issueExternalRefund(INPUT, deps);

    expect(result).toEqual({ ok: true, status: 'mock' });
    // No row, no lookup — mock mode has no external money to account for.
    expect(deps.findFundingTxRef).not.toHaveBeenCalled();
    expect(deps.claimRow).not.toHaveBeenCalled();
  });

  it('answers no_funding_charge, logged, when the campaign has no consumed Chapa session', async () => {
    const { deps } = makeDeps({
      findFundingTxRef: vi.fn(async () => null),
    });

    const result = await issueExternalRefund(INPUT, deps);

    expect(result).toEqual({ ok: false, reason: 'no_funding_charge' });
    // Logged so reconciliation can tell "mock-funded campaign" apart from a
    // gateway failure — but no row is written: there is nothing to retry.
    expect(deps.logFailure).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'external_refund',
      dealId: INPUT.dealId,
    });
    expect(deps.claimRow).not.toHaveBeenCalled();
  });

  it('answers already_settled without calling the gateway when the claim is refused', async () => {
    const { deps, refundFn } = makeDeps({
      claimRow: vi.fn(async () => null),
    });

    const result = await issueExternalRefund(INPUT, deps);

    expect(result).toEqual({ ok: false, reason: 'already_settled' });
    // The whole point of the claim: a processing/refunded row means another
    // attempt already asked Chapa, and this one must not ask again.
    expect(refundFn).not.toHaveBeenCalled();
  });

  it('claims with the funding charge reference and the deal amount', async () => {
    const { deps } = makeDeps();

    await issueExternalRefund(INPUT, deps);

    expect(deps.claimRow).toHaveBeenCalledWith(
      INPUT.dealId,
      INPUT.campaignId,
      TX_REF,
      INPUT.amount
    );
  });

  it('marks processing and answers the row id when the gateway accepts', async () => {
    const { deps, refundFn } = makeDeps();

    const result = await issueExternalRefund(INPUT, deps);

    expect(result).toEqual({
      ok: true,
      refundId: REFUND_ID,
      status: 'processing',
    });
    // The partial refund is addressed to the original charge, sized to the
    // one deal — santim in, conversion is the Chapa client's alone.
    expect(refundFn).toHaveBeenCalledWith({
      txRef: TX_REF,
      amountSantim: INPUT.amount,
      reason: INPUT.reason,
    });
    expect(deps.markProcessing).toHaveBeenCalledWith(REFUND_ID);
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it('fails the row with the ChapaError code when the gateway refuses', async () => {
    const { deps } = makeDeps({
      gateway: () =>
        gatewayMock(
          vi.fn(async () => {
            throw new ChapaError('insufficient balance', 'REJECTED', 400);
          })
        ),
    });

    const result = await issueExternalRefund(INPUT, deps);

    expect(result).toEqual({ ok: false, reason: 'gateway_rejected' });
    expect(deps.markFailed).toHaveBeenCalledWith(
      REFUND_ID,
      'REJECTED: insufficient balance'
    );
    expect(deps.logFailure).toHaveBeenCalledWith(expect.any(ChapaError), {
      operation: 'external_refund',
      dealId: INPUT.dealId,
    });
    expect(deps.markProcessing).not.toHaveBeenCalled();
  });

  it('contains a non-Chapa throw the same way, without leaking its message to the row', async () => {
    const { deps } = makeDeps({
      gateway: () =>
        gatewayMock(
          vi.fn(async () => {
            throw new TypeError('fetch failed: ECONNREFUSED 10.0.0.1');
          })
        ),
    });

    const result = await issueExternalRefund(INPUT, deps);

    expect(result).toEqual({ ok: false, reason: 'gateway_rejected' });
    // An arbitrary error's message is not for the failure_reason column —
    // the full error went to the log, the row gets a stable sentence.
    expect(deps.markFailed).toHaveBeenCalledWith(
      REFUND_ID,
      'unexpected error during refund request'
    );
  });
});

describe('settleRefundEvent', () => {
  function settleDeps(count = 1) {
    const settleRows = vi.fn(async () => count);
    const deps: SettleRefundDeps = { settleRows };
    return { deps, settleRows };
  }

  it('ignores an event that does not name one of our funding charges', async () => {
    const { deps, settleRows } = settleDeps();

    // A payout reference, a foreign reference, and no reference at all — the
    // refund leg owns only `cmfund_` names.
    for (const txRef of ['cmwd_abc', 'APq2f2…', null]) {
      expect(
        await settleRefundEvent({ txRef, status: 'success' }, deps)
      ).toEqual({ outcome: 'ignored' });
    }
    expect(settleRows).not.toHaveBeenCalled();
  });

  it('settles the charge’s processing rows as refunded on a success event', async () => {
    const { deps, settleRows } = settleDeps(2);

    const result = await settleRefundEvent(
      { txRef: TX_REF, status: 'success' },
      deps
    );

    // count: 2 — several deals can refund against one charge, and the event
    // names the charge, so every in-flight row settles together.
    expect(result).toEqual({ outcome: 'refunded', count: 2 });
    expect(settleRows).toHaveBeenCalledWith(TX_REF, 'refunded', null);
  });

  it('treats an unfamiliar non-failure word as done, not as failure', async () => {
    const { deps } = settleDeps();

    // Payload shapes are thinly documented; only a known failure word may
    // fail a row, because `failed` is the state the admin view retries from.
    const result = await settleRefundEvent(
      { txRef: TX_REF, status: 'completed' },
      deps
    );

    expect(result).toEqual({ outcome: 'refunded', count: 1 });
  });

  it.each(['failed', 'FAILED', 'Cancelled', 'canceled'])(
    'settles as failed on the %s status word, case-insensitively',
    async (status) => {
      const { deps, settleRows } = settleDeps();

      const result = await settleRefundEvent({ txRef: TX_REF, status }, deps);

      expect(result).toEqual({ outcome: 'failed', count: 1 });
      expect(settleRows).toHaveBeenCalledWith(
        TX_REF,
        'failed',
        `refund ${status.toLowerCase()} (webhook)`
      );
    }
  );
});
