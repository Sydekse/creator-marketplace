import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { creatorProfile, withdrawal } from '@/db/schema';
import { ChapaError } from '@/lib/chapa/client';
import { getPaymentGateway } from '@/lib/payment/gateway';
import type { PaymentGateway } from '@/lib/payment/gateway';
import { logPaymentFailure } from '@/lib/payment/log';
import { notify } from '@/lib/notifications';

/**
 * Decides what became of one withdrawal's transfer (KAN-70 PR 3).
 *
 * Called from two directions with the same idempotent answer: the Chapa
 * payout webhook when a transfer event arrives, and the cron sweep for
 * `processing` rows the webhook never told us about. Like the funding
 * settlement, the webhook's word is never enough — the transfer is re-verified
 * against Chapa's API, and the API's status decides.
 *
 * Transitions only ever leave `pending`/`processing`. A `paid` or `failed` row
 * answers `already_settled` without touching anything, which is what makes
 * Chapa's 10-retries-over-72h delivery schedule harmless.
 *
 * `failed` *is* the re-credit: the balance query excludes failed rows, so the
 * money reappears as available the moment the row flips. No compensating entry
 * to forget, nothing to reverse by hand.
 */

export type SettleWithdrawalOutcome =
  | { outcome: 'paid' }
  | { outcome: 'failed' }
  | { outcome: 'pending' }
  | { outcome: 'already_settled' }
  | { outcome: 'not_found' };

interface WithdrawalRow {
  id: string;
  amount: number;
  status: string;
  bankName: string;
  accountNumberMasked: string;
  creatorUserId: string;
}

export interface SettleWithdrawalDeps {
  getWithdrawal: (txRef: string) => Promise<WithdrawalRow | null>;
  gateway: () => PaymentGateway | null;
  /** Flip pending|processing → paid; answers false when nothing was claimable. */
  markPaid: (txRef: string, providerRef: string | null) => Promise<boolean>;
  markFailed: (txRef: string, reason: string) => Promise<boolean>;
  notify: typeof notify;
  logFailure: typeof logPaymentFailure;
}

/** The statuses a settlement may move; everything else is history. */
const SETTLEABLE = ['pending', 'processing'] as const;

const defaultDeps: SettleWithdrawalDeps = {
  getWithdrawal: async (txRef) => {
    const [row] = await db
      .select({
        id: withdrawal.id,
        amount: withdrawal.amount,
        status: withdrawal.status,
        bankName: withdrawal.bankName,
        accountNumberMasked: withdrawal.accountNumberMasked,
        creatorUserId: creatorProfile.userId,
      })
      .from(withdrawal)
      .innerJoin(creatorProfile, eq(creatorProfile.id, withdrawal.creatorId))
      .where(eq(withdrawal.txRef, txRef))
      .limit(1);
    return row ?? null;
  },
  gateway: getPaymentGateway,
  markPaid: async (txRef, providerRef) => {
    const rows = await db
      .update(withdrawal)
      .set({
        status: 'paid',
        resolvedAt: new Date(),
        ...(providerRef ? { providerRef } : {}),
      })
      .where(
        and(
          eq(withdrawal.txRef, txRef),
          inArray(withdrawal.status, [...SETTLEABLE])
        )
      )
      .returning({ id: withdrawal.id });
    return rows.length > 0;
  },
  markFailed: async (txRef, reason) => {
    const rows = await db
      .update(withdrawal)
      .set({
        status: 'failed',
        failureReason: reason.slice(0, 500),
        resolvedAt: new Date(),
      })
      .where(
        and(
          eq(withdrawal.txRef, txRef),
          inArray(withdrawal.status, [...SETTLEABLE])
        )
      )
      .returning({ id: withdrawal.id });
    return rows.length > 0;
  },
  notify,
  logFailure: logPaymentFailure,
};

/** Chapa's terminal failure words for a transfer, lowercased. */
const FAILED_STATUSES = new Set([
  'failed',
  'reversed',
  'cancelled',
  'canceled',
]);

export async function settleWithdrawal(
  txRef: string,
  deps: SettleWithdrawalDeps = defaultDeps
): Promise<SettleWithdrawalOutcome> {
  const row = await deps.getWithdrawal(txRef);
  if (!row) return { outcome: 'not_found' };
  if (row.status === 'paid' || row.status === 'failed') {
    return { outcome: 'already_settled' };
  }

  const gateway = deps.gateway();
  if (!gateway) return { outcome: 'pending' };

  let verified;
  try {
    verified = await gateway.verifyTransfer(txRef);
  } catch (error) {
    if (error instanceof ChapaError) {
      // Unreachable or malformed — say nothing rather than guess. The sweep
      // or the next webhook retry asks again.
      deps.logFailure(error, { operation: 'withdrawal_verify' });
      return { outcome: 'pending' };
    }
    throw error;
  }

  if (verified.status === 'success') {
    const claimed = await deps.markPaid(txRef, verified.providerRef);
    if (!claimed) return { outcome: 'already_settled' };
    await deps.notify(row.creatorUserId, 'withdrawal_paid', {
      withdrawalId: row.id,
      amount: row.amount,
      bankName: row.bankName,
      accountNumberMasked: row.accountNumberMasked,
    });
    return { outcome: 'paid' };
  }

  if (FAILED_STATUSES.has(verified.status)) {
    const claimed = await deps.markFailed(txRef, `transfer ${verified.status}`);
    if (!claimed) return { outcome: 'already_settled' };
    await deps.notify(row.creatorUserId, 'withdrawal_failed', {
      withdrawalId: row.id,
      amount: row.amount,
    });
    return { outcome: 'failed' };
  }

  // Queued, pending, or a word we do not know: the transfer is still Chapa's
  // problem. Leave the row alone and let the sweep ask again later.
  return { outcome: 'pending' };
}
