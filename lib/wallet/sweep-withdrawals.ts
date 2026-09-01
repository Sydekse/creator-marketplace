import { and, eq, inArray, lt } from 'drizzle-orm';
import { db } from '@/db';
import { withdrawal } from '@/db/schema';
import type { Job, JobRunOutput } from '@/lib/scheduler/harness';
import { settleWithdrawal } from './settle-withdrawal';
import type { SettleWithdrawalOutcome } from './settle-withdrawal';

/**
 * Sweeps withdrawals the payout webhook never resolved (KAN-70 PR 3).
 *
 * Two kinds of stragglers, two remedies:
 *
 * - `processing` for over an hour — the transfer went to Chapa but no webhook
 *   came back (lost delivery, or the dashboard webhook points at another
 *   deployment). Re-verify via the API and settle on its answer, exactly the
 *   webhook's own path.
 * - `pending` for over a day — the process died between reserving the money
 *   and Chapa accepting the transfer, and verification keeps answering
 *   nothing. Fail the row: failing *is* the re-credit (failed rows do not
 *   count against the balance), and the creator can simply withdraw again.
 *   A day rather than an hour because `settleWithdrawal` is given every
 *   chance first — a transfer that *was* accepted verifies fine from a
 *   `pending` row too.
 *
 * Settlement is idempotent and claims via conditional UPDATEs, so a webhook
 * arriving mid-sweep costs nothing.
 */
export const PROCESSING_RECHECK_MS = 60 * 60 * 1000;
export const PENDING_ABANDON_MS = 24 * 60 * 60 * 1000;

export interface SweepWithdrawalsDeps {
  listStale: (processingCutoff: Date) => Promise<string[]>;
  settle: (txRef: string) => Promise<SettleWithdrawalOutcome>;
  abandonStalePending: (pendingCutoff: Date) => Promise<number>;
  now: () => Date;
}

const defaultDeps: SweepWithdrawalsDeps = {
  listStale: async (processingCutoff) => {
    const rows = await db
      .select({ txRef: withdrawal.txRef })
      .from(withdrawal)
      .where(
        and(
          inArray(withdrawal.status, ['pending', 'processing']),
          lt(withdrawal.createdAt, processingCutoff)
        )
      );
    return rows.map((row) => row.txRef);
  },
  settle: (txRef) => settleWithdrawal(txRef),
  abandonStalePending: async (pendingCutoff) => {
    const rows = await db
      .update(withdrawal)
      .set({
        status: 'failed',
        failureReason: 'transfer never confirmed — re-credited by sweep',
        resolvedAt: new Date(),
      })
      .where(
        and(
          eq(withdrawal.status, 'pending'),
          lt(withdrawal.createdAt, pendingCutoff)
        )
      )
      .returning({ id: withdrawal.id });
    return rows.length;
  },
  now: () => new Date(),
};

export async function sweepWithdrawals(
  deps: SweepWithdrawalsDeps = defaultDeps
): Promise<JobRunOutput> {
  const now = deps.now().getTime();
  const staleTxRefs = await deps.listStale(
    new Date(now - PROCESSING_RECHECK_MS)
  );

  let acted = 0;
  for (const txRef of staleTxRefs) {
    const result = await deps.settle(txRef);
    if (result.outcome === 'paid' || result.outcome === 'failed') acted += 1;
  }

  // After settlement had its chance: anything still `pending` past a day is
  // a transfer that never happened. Fail it so the money comes back.
  acted += await deps.abandonStalePending(new Date(now - PENDING_ABANDON_MS));

  return { examined: staleTxRefs.length, acted };
}

export const sweepWithdrawalsJob: Job = {
  name: 'sweep-withdrawals',
  run: () => sweepWithdrawals(),
};
