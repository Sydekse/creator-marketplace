import { describe, expect, it, vi } from 'vitest';
import { requestWithdrawal } from '@/lib/wallet/withdraw';
import type { WithdrawDeps } from '@/lib/wallet/withdraw';
import { MIN_WITHDRAWAL_SANTIM } from '@/lib/wallet/constants';
import { ChapaError } from '@/lib/chapa/client';
import type { PaymentGateway } from '@/lib/payment/gateway';

/**
 * Withdrawal request tests (KAN-70 PR 3).
 *
 * The invariants a wallet lives or dies by: money is reserved before Chapa
 * hears anything, a rejected transfer re-credits by failing the row, an
 * unknown throw leaves the row for the sweep rather than guessing, and no
 * request below the floor or above the balance gets anywhere near a transfer.
 */

const METHOD = {
  kind: 'bank' as const,
  bankCode: '946',
  bankName: 'Awash Bank',
  accountNumber: '01320811436100',
  accountName: 'Abebe Bikila',
};

function gatewayWith(
  sendTransfer: PaymentGateway['sendTransfer']
): PaymentGateway {
  return { sendTransfer } as unknown as PaymentGateway;
}

function makeDeps(overrides: Partial<WithdrawDeps> = {}): WithdrawDeps {
  return {
    gateway: () =>
      gatewayWith(vi.fn().mockResolvedValue({ providerRef: 'tr-1' })),
    getMethod: vi.fn().mockResolvedValue(METHOD),
    reserve: vi.fn().mockResolvedValue({ ok: true, id: 'w-1' }),
    markProcessing: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    logFailure: vi.fn(),
    ...overrides,
  };
}

describe('requestWithdrawal', () => {
  it('answers gateway_unavailable in mock mode without touching anything', async () => {
    const deps = makeDeps({ gateway: () => null });
    const result = await requestWithdrawal('c1', 50_000, deps);
    expect(result).toEqual({ ok: false, reason: 'gateway_unavailable' });
    expect(deps.reserve).not.toHaveBeenCalled();
  });

  it.each([
    [0, 'invalid_amount'],
    [-100, 'invalid_amount'],
    [10.5, 'invalid_amount'],
    [Number.MAX_SAFE_INTEGER + 1, 'invalid_amount'],
    [MIN_WITHDRAWAL_SANTIM - 1, 'below_minimum'],
  ] as const)('rejects amount %s as %s', async (amount, reason) => {
    const deps = makeDeps();
    const result = await requestWithdrawal('c1', amount, deps);
    expect(result).toEqual({ ok: false, reason });
    expect(deps.reserve).not.toHaveBeenCalled();
  });

  it('accepts exactly the minimum', async () => {
    const deps = makeDeps();
    const result = await requestWithdrawal('c1', MIN_WITHDRAWAL_SANTIM, deps);
    expect(result.ok).toBe(true);
  });

  it('requires a payout method before reserving anything', async () => {
    const deps = makeDeps({ getMethod: vi.fn().mockResolvedValue(null) });
    const result = await requestWithdrawal('c1', 50_000, deps);
    expect(result).toEqual({ ok: false, reason: 'no_payout_method' });
    expect(deps.reserve).not.toHaveBeenCalled();
  });

  it.each(['insufficient_balance', 'conflict'] as const)(
    'passes the reserve refusal %s through untouched',
    async (reason) => {
      const deps = makeDeps({
        reserve: vi.fn().mockResolvedValue({ ok: false, reason }),
      });
      const result = await requestWithdrawal('c1', 50_000, deps);
      expect(result).toEqual({ ok: false, reason });
    }
  );

  it('reserves before transferring, with a single-use cmwd_ reference within the 36-char transfer limit', async () => {
    const sendTransfer = vi.fn().mockResolvedValue({ providerRef: 'tr-9' });
    const reserve = vi.fn().mockResolvedValue({ ok: true, id: 'w-1' });
    const deps = makeDeps({
      gateway: () => gatewayWith(sendTransfer),
      reserve,
    });

    const result = await requestWithdrawal('c1', 50_000, deps);

    expect(result.ok).toBe(true);
    const txRef = reserve.mock.calls[0][2] as string;
    // Chapa's /transfers rejects references over 36 characters — seen live.
    expect(txRef).toMatch(/^cmwd_[0-9a-f]{31}$/);
    expect(txRef).toHaveLength(36);
    // The transfer used the reserved reference and the *full* account number.
    expect(sendTransfer).toHaveBeenCalledWith({
      txRef,
      amountSantim: 50_000,
      accountName: METHOD.accountName,
      accountNumber: METHOD.accountNumber,
      bankCode: METHOD.bankCode,
    });
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(
      sendTransfer.mock.invocationCallOrder[0]
    );
    expect(deps.markProcessing).toHaveBeenCalledWith(txRef, 'tr-9');
  });

  it('answers a masked receipt, never the full account number', async () => {
    const result = await requestWithdrawal('c1', 50_000, makeDeps());
    if (!result.ok) throw new Error('expected ok');
    expect(result.withdrawal.accountNumberMasked).toBe('••••6100');
    expect(JSON.stringify(result)).not.toContain(METHOD.accountNumber);
    expect(result.withdrawal.status).toBe('processing');
  });

  it('fails the row when Chapa rejects the transfer — failing is the re-credit', async () => {
    const deps = makeDeps({
      gateway: () =>
        gatewayWith(
          vi
            .fn()
            .mockRejectedValue(
              new ChapaError('insufficient merchant balance', 'REJECTED', 400)
            )
        ),
    });
    const result = await requestWithdrawal('c1', 50_000, deps);
    expect(result).toEqual({ ok: false, reason: 'transfer_rejected' });
    expect(deps.markFailed).toHaveBeenCalledWith(
      expect.stringMatching(/^cmwd_/),
      expect.stringContaining('REJECTED')
    );
    expect(deps.markProcessing).not.toHaveBeenCalled();
    expect(deps.logFailure).toHaveBeenCalled();
  });

  it('leaves the row pending on an unknown throw — the sweep decides, not a guess', async () => {
    const deps = makeDeps({
      gateway: () =>
        gatewayWith(vi.fn().mockRejectedValue(new Error('socket hang up'))),
    });
    await expect(requestWithdrawal('c1', 50_000, deps)).rejects.toThrow(
      'socket hang up'
    );
    expect(deps.markFailed).not.toHaveBeenCalled();
    expect(deps.markProcessing).not.toHaveBeenCalled();
  });
});
