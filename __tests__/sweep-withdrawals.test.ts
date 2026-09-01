import { describe, expect, it, vi } from 'vitest';
import {
  PENDING_ABANDON_MS,
  PROCESSING_RECHECK_MS,
  sweepWithdrawals,
  sweepWithdrawalsJob,
} from '@/lib/wallet/sweep-withdrawals';
import type { SweepWithdrawalsDeps } from '@/lib/wallet/sweep-withdrawals';

/**
 * Withdrawal sweep tests (KAN-70 PR 3) — the webhook-loss safety net.
 */

const NOW = new Date('2026-09-01T12:00:00Z');

function makeDeps(
  overrides: Partial<SweepWithdrawalsDeps> = {}
): SweepWithdrawalsDeps {
  return {
    listStale: vi.fn().mockResolvedValue([]),
    settle: vi.fn().mockResolvedValue({ outcome: 'pending' }),
    abandonStalePending: vi.fn().mockResolvedValue(0),
    now: () => NOW,
    ...overrides,
  };
}

describe('sweepWithdrawals', () => {
  it('is registered under a stable name', () => {
    expect(sweepWithdrawalsJob.name).toBe('sweep-withdrawals');
  });

  it('asks for rows older than an hour and abandons pending older than a day', async () => {
    const deps = makeDeps();
    await sweepWithdrawals(deps);
    expect(deps.listStale).toHaveBeenCalledWith(
      new Date(NOW.getTime() - PROCESSING_RECHECK_MS)
    );
    expect(deps.abandonStalePending).toHaveBeenCalledWith(
      new Date(NOW.getTime() - PENDING_ABANDON_MS)
    );
  });

  it('settles each stale reference and counts only state changes as acted', async () => {
    const settle = vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'paid' })
      .mockResolvedValueOnce({ outcome: 'pending' })
      .mockResolvedValueOnce({ outcome: 'failed' })
      .mockResolvedValueOnce({ outcome: 'already_settled' });
    const deps = makeDeps({
      listStale: vi
        .fn()
        .mockResolvedValue(['cmwd_a', 'cmwd_b', 'cmwd_c', 'cmwd_d']),
      settle,
      abandonStalePending: vi.fn().mockResolvedValue(2),
    });

    const result = await sweepWithdrawals(deps);

    expect(settle).toHaveBeenCalledTimes(4);
    // paid + failed from settlement, plus the two abandoned pendings.
    expect(result).toEqual({ examined: 4, acted: 4 });
  });

  it('settlement gets its chance before abandonment', async () => {
    const settle = vi.fn().mockResolvedValue({ outcome: 'pending' });
    const abandonStalePending = vi.fn().mockResolvedValue(0);
    const deps = makeDeps({
      listStale: vi.fn().mockResolvedValue(['cmwd_a']),
      settle,
      abandonStalePending,
    });
    await sweepWithdrawals(deps);
    expect(settle.mock.invocationCallOrder[0]).toBeLessThan(
      abandonStalePending.mock.invocationCallOrder[0]
    );
  });
});
