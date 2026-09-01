import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { fundingSession, refund } from '@/db/schema';
import { ChapaError } from '@/lib/chapa/client';
import { getPaymentGateway } from '@/lib/payment/gateway';
import type { PaymentGateway } from '@/lib/payment/gateway';
import { logPaymentFailure } from '@/lib/payment/log';

/**
 * The external leg of a dispute refund (KAN-70 PR 4).
 *
 * When an admin refunds a disputed deal, the escrow ledger's `refundDeal` has
 * already returned the money on our books — status, ledger entries, audit row,
 * all committed. In mock mode that is the whole story. In Chapa mode the
 * brand's money is actually sitting in the platform's Chapa balance, so this
 * module asks Chapa for a **partial refund against the original funding
 * charge**, sized to the one deal being refunded.
 *
 * Deliberately post-ledger and non-blocking: a Chapa failure here must not
 * roll back or veto the resolution (the books are correct either way), it
 * must leave a `failed` refund row loud enough for the admin payments view to
 * show and retry. This is the same books-first posture as the withdrawal
 * flow, mirrored: there the row exists before the transfer, here the ledger
 * entry exists before the refund request.
 *
 * Idempotency: one row per deal (unique `deal_id`). A retry finds the
 * existing row, refuses if it is already `processing`/`refunded`, and
 * re-requests only from `failed`/`pending` — so a double-click cannot ask
 * Chapa to refund the same deal twice.
 */

export type IssueRefundResult =
  | { ok: true; refundId: string; status: 'processing' }
  /** Mock mode — no external money to move; no row written. */
  | { ok: true; status: 'mock' }
  | {
      ok: false;
      reason:
        // The campaign was funded before Chapa mode (or by seed) — there is
        // no charge to refund against. Logged; no row written.
        | 'no_funding_charge'
        // Chapa refused or was unreachable; row is `failed`, retry from admin.
        | 'gateway_rejected'
        // Another attempt is already in flight or done.
        | 'already_settled';
    };

export interface RefundInput {
  dealId: string;
  campaignId: string;
  /** The deal's totalPrice — the partial-refund amount, in santim. */
  amount: number;
  /** Shown on Chapa's side and kept in our failure log context. */
  reason: string;
}

export interface ExternalRefundDeps {
  gateway: () => PaymentGateway | null;
  /** The consumed funding session's tx_ref for this campaign, newest first. */
  findFundingTxRef: (campaignId: string) => Promise<string | null>;
  /**
   * Insert-or-reclaim the deal's refund row and answer its id — or null when
   * the row is already `processing`/`refunded` (nothing left to do). The
   * claim is a conditional write, so two concurrent retries cannot both
   * proceed to the gateway call.
   */
  claimRow: (
    dealId: string,
    campaignId: string,
    fundingTxRef: string,
    amount: number
  ) => Promise<string | null>;
  markProcessing: (refundId: string) => Promise<void>;
  markFailed: (refundId: string, reason: string) => Promise<void>;
  logFailure: typeof logPaymentFailure;
}

const defaultDeps: ExternalRefundDeps = {
  gateway: getPaymentGateway,
  findFundingTxRef: async (campaignId) => {
    const [row] = await db
      .select({ txRef: fundingSession.txRef })
      .from(fundingSession)
      .where(
        and(
          eq(fundingSession.campaignId, campaignId),
          eq(fundingSession.status, 'consumed')
        )
      )
      .orderBy(desc(fundingSession.consumedAt))
      .limit(1);
    return row?.txRef ?? null;
  },
  claimRow: async (dealId, campaignId, fundingTxRef, amount) => {
    // Fresh deal: insert wins. Retried deal: the conditional UPDATE reclaims
    // the row only from a retryable status.
    const inserted = await db
      .insert(refund)
      .values({ dealId, campaignId, fundingTxRef, amount })
      .onConflictDoNothing({ target: refund.dealId })
      .returning({ id: refund.id });
    if (inserted.length > 0) return inserted[0].id;

    const reclaimed = await db
      .update(refund)
      .set({ status: 'pending', failureReason: null, resolvedAt: null })
      .where(
        and(
          eq(refund.dealId, dealId),
          inArray(refund.status, ['pending', 'failed'])
        )
      )
      .returning({ id: refund.id });
    return reclaimed[0]?.id ?? null;
  },
  markProcessing: async (refundId) => {
    await db
      .update(refund)
      .set({ status: 'processing' })
      .where(eq(refund.id, refundId));
  },
  markFailed: async (refundId, reason) => {
    await db
      .update(refund)
      .set({ status: 'failed', failureReason: reason.slice(0, 500) })
      .where(eq(refund.id, refundId));
  },
  logFailure: logPaymentFailure,
};

export async function issueExternalRefund(
  input: RefundInput,
  deps: ExternalRefundDeps = defaultDeps
): Promise<IssueRefundResult> {
  const gateway = deps.gateway();
  if (!gateway) return { ok: true, status: 'mock' };

  const fundingTxRef = await deps.findFundingTxRef(input.campaignId);
  if (!fundingTxRef) {
    // Internally refunded, externally nothing to do — the campaign was never
    // funded through Chapa. Logged so a reconciliation can tell this apart
    // from a failure.
    deps.logFailure(
      new Error('no consumed funding session to refund against'),
      {
        operation: 'external_refund',
        dealId: input.dealId,
      }
    );
    return { ok: false, reason: 'no_funding_charge' };
  }

  const refundId = await deps.claimRow(
    input.dealId,
    input.campaignId,
    fundingTxRef,
    input.amount
  );
  if (!refundId) return { ok: false, reason: 'already_settled' };

  try {
    await gateway.refund({
      txRef: fundingTxRef,
      amountSantim: input.amount,
      reason: input.reason,
    });
  } catch (error) {
    // ChapaError or not, the remedy is the same: fail the row — unlike a
    // withdrawal there is no sweep for refunds, and `failed` is precisely
    // the retryable state the admin view acts on.
    deps.logFailure(error, {
      operation: 'external_refund',
      dealId: input.dealId,
    });
    await deps.markFailed(
      refundId,
      error instanceof ChapaError
        ? `${error.code}: ${error.message}`
        : 'unexpected error during refund request'
    );
    return { ok: false, reason: 'gateway_rejected' };
  }

  await deps.markProcessing(refundId);
  return { ok: true, refundId, status: 'processing' };
}

// -- Webhook confirmation -----------------------------------------------------

export type SettleRefundOutcome =
  | { outcome: 'refunded'; count: number }
  | { outcome: 'failed'; count: number }
  | { outcome: 'ignored' };

export interface SettleRefundDeps {
  /** Flip this funding charge's `processing` rows to a terminal status. */
  settleRows: (
    fundingTxRef: string,
    to: 'refunded' | 'failed',
    reason: string | null
  ) => Promise<number>;
}

const defaultSettleDeps: SettleRefundDeps = {
  settleRows: async (fundingTxRef, to, reason) => {
    const rows = await db
      .update(refund)
      .set({
        status: to,
        resolvedAt: new Date(),
        ...(reason ? { failureReason: reason.slice(0, 500) } : {}),
      })
      .where(
        and(
          eq(refund.fundingTxRef, fundingTxRef),
          eq(refund.status, 'processing')
        )
      )
      .returning({ id: refund.id });
    return rows.length;
  },
};

/** Chapa's failure words for a refund event, lowercased. */
const FAILED_STATUSES = new Set(['failed', 'cancelled', 'canceled']);

/**
 * The refund webhook leg: a signed refund event naming one of our funding
 * charges settles that charge's `processing` refund rows. Multiple deals can
 * refund against one charge; the event does not say which, so all in-flight
 * rows for the charge settle together — Chapa acknowledged the charge-level
 * refund, and per-deal amounts were ours to begin with.
 *
 * Tolerant on shape (payloads are thinly documented): the discriminator is
 * our own `cmfund_` reference plus the event's status word. An event with no
 * word we know is ignored and logged by the route.
 */
export async function settleRefundEvent(
  event: { txRef: string | null; status: string | null },
  deps: SettleRefundDeps = defaultSettleDeps
): Promise<SettleRefundOutcome> {
  if (!event.txRef?.startsWith('cmfund_')) return { outcome: 'ignored' };

  const status = event.status?.toLowerCase() ?? null;
  if (status && FAILED_STATUSES.has(status)) {
    const count = await deps.settleRows(
      event.txRef,
      'failed',
      `refund ${status} (webhook)`
    );
    return { outcome: 'failed', count };
  }

  // 'success', 'refunded', or an unfamiliar-but-not-failed word: Chapa sends
  // refund events on completion, so absence of a failure word means done.
  const count = await deps.settleRows(event.txRef, 'refunded', null);
  return { outcome: 'refunded', count };
}
