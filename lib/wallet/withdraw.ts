import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { payoutMethod, withdrawal } from '@/db/schema';
import type { PayoutMethodKind } from '@/db/schema';
import { ChapaError } from '@/lib/chapa/client';
import { getPaymentGateway } from '@/lib/payment/gateway';
import type { PaymentGateway } from '@/lib/payment/gateway';
import { logPaymentFailure } from '@/lib/payment/log';
import { readWalletBalance } from './balance';
import { MIN_WITHDRAWAL_SANTIM } from './constants';

/**
 * Wallet withdrawal (KAN-70 PR 3): reserve first, transfer second.
 *
 * The reservation is a serializable transaction that recomputes the balance
 * and inserts the `pending` row in one breath. Two concurrent requests both
 * read the same withdrawal history, both try to append — serializable means
 * one commits and the other aborts with a serialization failure, which this
 * module answers as `conflict` rather than letting the wallet go negative.
 *
 * Only after the reservation committed does Chapa hear about it. The transfer
 * call has three outcomes:
 *
 * - accepted → `processing`, and the webhook/sweep decides `paid`/`failed`;
 * - rejected by Chapa (a `ChapaError`) → the row goes `failed` immediately,
 *   which *is* the re-credit — failed rows do not count against the balance;
 * - the process dies between commit and call → the row stays `pending` and
 *   the sweep fails it after a day. Money is spoken for, never lost.
 */

export interface WithdrawalReceipt {
  id: string;
  txRef: string;
  amount: number;
  status: 'processing';
  bankName: string;
  accountNumberMasked: string;
}

export type RequestWithdrawalResult =
  | { ok: true; withdrawal: WithdrawalReceipt }
  | {
      ok: false;
      reason:
        | 'gateway_unavailable'
        | 'invalid_amount'
        | 'below_minimum'
        | 'no_payout_method'
        | 'insufficient_balance'
        | 'conflict'
        | 'transfer_rejected';
    };

interface MethodRow {
  kind: PayoutMethodKind;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export interface WithdrawDeps {
  gateway: () => PaymentGateway | null;
  getMethod: (creatorProfileId: string) => Promise<MethodRow | null>;
  /**
   * The serializable reserve: recompute balance, insert `pending`, one tx.
   * Answers the new row's id, or the shortfall, or `conflict` on a
   * serialization abort.
   */
  reserve: (
    creatorProfileId: string,
    amount: number,
    txRef: string,
    method: MethodRow
  ) => Promise<
    | { ok: true; id: string }
    | { ok: false; reason: 'insufficient_balance' | 'conflict' }
  >;
  markProcessing: (txRef: string, providerRef: string | null) => Promise<void>;
  markFailed: (txRef: string, reason: string) => Promise<void>;
  logFailure: typeof logPaymentFailure;
}

/** Postgres serialization failure — the losing side of a write race. */
const SERIALIZATION_FAILURE = '40001';

function maskAccount(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

const defaultDeps: WithdrawDeps = {
  gateway: getPaymentGateway,
  getMethod: async (creatorProfileId) => {
    const [row] = await db
      .select({
        kind: payoutMethod.kind,
        bankCode: payoutMethod.bankCode,
        bankName: payoutMethod.bankName,
        accountNumber: payoutMethod.accountNumber,
        accountName: payoutMethod.accountName,
      })
      .from(payoutMethod)
      .where(eq(payoutMethod.creatorId, creatorProfileId))
      .limit(1);
    return row ?? null;
  },
  reserve: async (creatorProfileId, amount, txRef, method) => {
    try {
      return await db.transaction(
        async (tx) => {
          const balance = await readWalletBalance(creatorProfileId, tx);
          if (amount > balance.available) {
            return {
              ok: false as const,
              reason: 'insufficient_balance' as const,
            };
          }
          const [row] = await tx
            .insert(withdrawal)
            .values({
              creatorId: creatorProfileId,
              amount,
              status: 'pending',
              txRef,
              methodKind: method.kind,
              bankName: method.bankName,
              accountNumberMasked: maskAccount(method.accountNumber),
              accountName: method.accountName,
            })
            .returning({ id: withdrawal.id });
          return { ok: true as const, id: row.id };
        },
        { isolationLevel: 'serializable' }
      );
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code?: string }).code === SERIALIZATION_FAILURE
      ) {
        return { ok: false, reason: 'conflict' };
      }
      throw error;
    }
  },
  markProcessing: async (txRef, providerRef) => {
    await db
      .update(withdrawal)
      .set({ status: 'processing', providerRef })
      .where(eq(withdrawal.txRef, txRef));
  },
  markFailed: async (txRef, reason) => {
    await db
      .update(withdrawal)
      .set({
        status: 'failed',
        failureReason: reason.slice(0, 500),
        resolvedAt: new Date(),
      })
      .where(eq(withdrawal.txRef, txRef));
  },
  logFailure: logPaymentFailure,
};

export async function requestWithdrawal(
  creatorProfileId: string,
  amount: number,
  deps: WithdrawDeps = defaultDeps
): Promise<RequestWithdrawalResult> {
  const gateway = deps.gateway();
  if (!gateway) return { ok: false, reason: 'gateway_unavailable' };

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }
  if (amount < MIN_WITHDRAWAL_SANTIM) {
    return { ok: false, reason: 'below_minimum' };
  }

  const method = await deps.getMethod(creatorProfileId);
  if (!method) return { ok: false, reason: 'no_payout_method' };

  // Chapa's `/transfers` endpoint caps `reference` at 36 characters — learnt
  // live, not from the docs (`cmwd_` + a hyphenated UUID is 41 and the whole
  // transfer is rejected). A dashless UUID sliced to 31 hex chars keeps the
  // webhook's `cmwd_` discriminator and 124 bits of entropy, at exactly 36.
  const txRef = `cmwd_${randomUUID().replace(/-/g, '').slice(0, 31)}`;
  const reserved = await deps.reserve(creatorProfileId, amount, txRef, method);
  if (!reserved.ok) return { ok: false, reason: reserved.reason };

  try {
    const { providerRef } = await gateway.sendTransfer({
      txRef,
      amountSantim: amount,
      accountName: method.accountName,
      accountNumber: method.accountNumber,
      bankCode: method.bankCode,
    });
    await deps.markProcessing(txRef, providerRef);
    return {
      ok: true,
      withdrawal: {
        id: reserved.id,
        txRef,
        amount,
        status: 'processing',
        bankName: method.bankName,
        accountNumberMasked: maskAccount(method.accountNumber),
      },
    };
  } catch (error) {
    if (error instanceof ChapaError) {
      // Chapa said no before taking the transfer. Failing the row is the
      // re-credit: failed withdrawals do not count against the balance.
      deps.logFailure(error, { operation: 'withdrawal_transfer' });
      await deps.markFailed(txRef, `${error.code}: ${error.message}`);
      return { ok: false, reason: 'transfer_rejected' };
    }
    // An unknown throw: leave the row `pending` for the sweep rather than
    // guessing — the transfer may or may not have been accepted.
    deps.logFailure(error, { operation: 'withdrawal_transfer_unknown' });
    throw error;
  }
}
