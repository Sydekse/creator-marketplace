import { describe, expect, it, vi } from 'vitest';
import { settleWithdrawal } from '@/lib/wallet/settle-withdrawal';
import type { SettleWithdrawalDeps } from '@/lib/wallet/settle-withdrawal';
import { ChapaError } from '@/lib/chapa/client';
import type { PaymentGateway } from '@/lib/payment/gateway';

/**
 * Withdrawal settlement tests (KAN-70 PR 3).
 *
 * The same discipline as funding settlement: the webhook's word is never
 * enough (the transfer is re-verified via the API), terminal rows are never
 * reopened, and every outcome is idempotent under Chapa's 10-retries-over-72h
 * delivery schedule.
 */

const ROW = {
  id: 'w-1',
  amount: 50_000,
  status: 'processing',
  bankName: 'Awash Bank',
  accountNumberMasked: '••••6100',
  creatorUserId: 'user-1',
};

function gatewayVerifying(
  verified:
    | {
        status: string;
        txRef: string | null;
        providerRef: string | null;
        amountSantim: number | null;
      }
    | Error
): PaymentGateway {
  return {
    verifyTransfer:
      verified instanceof Error
        ? vi.fn().mockRejectedValue(verified)
        : vi.fn().mockResolvedValue(verified),
  } as unknown as PaymentGateway;
}

function makeDeps(
  overrides: Partial<SettleWithdrawalDeps> = {}
): SettleWithdrawalDeps {
  return {
    getWithdrawal: vi.fn().mockResolvedValue({ ...ROW }),
    gateway: () =>
      gatewayVerifying({
        status: 'success',
        txRef: 'cmwd_1',
        providerRef: 'tr-1',
        amountSantim: 50_000,
      }),
    markPaid: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    notify: vi.fn().mockResolvedValue(undefined),
    logFailure: vi.fn(),
    ...overrides,
  };
}

describe('settleWithdrawal', () => {
  it('answers not_found for a reference that is not ours', async () => {
    const deps = makeDeps({ getWithdrawal: vi.fn().mockResolvedValue(null) });
    expect(await settleWithdrawal('cmwd_x', deps)).toEqual({
      outcome: 'not_found',
    });
  });

  it.each(['paid', 'failed'])(
    'never reopens a %s row (idempotent under webhook retries)',
    async (status) => {
      const deps = makeDeps({
        getWithdrawal: vi.fn().mockResolvedValue({ ...ROW, status }),
      });
      expect(await settleWithdrawal('cmwd_1', deps)).toEqual({
        outcome: 'already_settled',
      });
      expect(deps.markPaid).not.toHaveBeenCalled();
      expect(deps.markFailed).not.toHaveBeenCalled();
      expect(deps.notify).not.toHaveBeenCalled();
    }
  );

  it('stays pending with no gateway rather than guessing', async () => {
    const deps = makeDeps({ gateway: () => null });
    expect(await settleWithdrawal('cmwd_1', deps)).toEqual({
      outcome: 'pending',
    });
  });

  it('stays pending when verification is unreachable, and logs it', async () => {
    const deps = makeDeps({
      gateway: () => gatewayVerifying(new ChapaError('down', 'UNAVAILABLE')),
    });
    expect(await settleWithdrawal('cmwd_1', deps)).toEqual({
      outcome: 'pending',
    });
    expect(deps.logFailure).toHaveBeenCalled();
    expect(deps.markPaid).not.toHaveBeenCalled();
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it('rethrows a non-Chapa verification throw', async () => {
    const deps = makeDeps({
      gateway: () => gatewayVerifying(new Error('boom')),
    });
    await expect(settleWithdrawal('cmwd_1', deps)).rejects.toThrow('boom');
  });

  it('marks paid and tells the creator where the money went', async () => {
    const deps = makeDeps();
    expect(await settleWithdrawal('cmwd_1', deps)).toEqual({
      outcome: 'paid',
    });
    expect(deps.markPaid).toHaveBeenCalledWith('cmwd_1', 'tr-1');
    expect(deps.notify).toHaveBeenCalledWith('user-1', 'withdrawal_paid', {
      withdrawalId: 'w-1',
      amount: 50_000,
      bankName: 'Awash Bank',
      accountNumberMasked: '••••6100',
    });
  });

  it('answers already_settled when the paid claim loses the race, without a duplicate email', async () => {
    const deps = makeDeps({ markPaid: vi.fn().mockResolvedValue(false) });
    expect(await settleWithdrawal('cmwd_1', deps)).toEqual({
      outcome: 'already_settled',
    });
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it.each(['failed', 'reversed', 'cancelled', 'canceled'])(
    'fails the row on transfer status %s — the re-credit — and notifies',
    async (status) => {
      const deps = makeDeps({
        gateway: () =>
          gatewayVerifying({
            status,
            txRef: 'cmwd_1',
            providerRef: null,
            amountSantim: null,
          }),
      });
      expect(await settleWithdrawal('cmwd_1', deps)).toEqual({
        outcome: 'failed',
      });
      expect(deps.markFailed).toHaveBeenCalledWith(
        'cmwd_1',
        `transfer ${status}`
      );
      expect(deps.notify).toHaveBeenCalledWith('user-1', 'withdrawal_failed', {
        withdrawalId: 'w-1',
        amount: 50_000,
      });
    }
  );

  it('answers already_settled when the failed claim loses the race', async () => {
    const deps = makeDeps({
      gateway: () =>
        gatewayVerifying({
          status: 'failed',
          txRef: 'cmwd_1',
          providerRef: null,
          amountSantim: null,
        }),
      markFailed: vi.fn().mockResolvedValue(false),
    });
    expect(await settleWithdrawal('cmwd_1', deps)).toEqual({
      outcome: 'already_settled',
    });
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it.each(['queued', 'pending', 'new-word-from-chapa'])(
    'leaves a %s transfer alone for the sweep',
    async (status) => {
      const deps = makeDeps({
        gateway: () =>
          gatewayVerifying({
            status,
            txRef: 'cmwd_1',
            providerRef: null,
            amountSantim: null,
          }),
      });
      expect(await settleWithdrawal('cmwd_1', deps)).toEqual({
        outcome: 'pending',
      });
      expect(deps.markPaid).not.toHaveBeenCalled();
      expect(deps.markFailed).not.toHaveBeenCalled();
    }
  );
});
