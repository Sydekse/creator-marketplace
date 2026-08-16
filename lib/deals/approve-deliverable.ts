import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaign, creatorProfile, deal } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import { ErrorCode } from '@/lib/validation/errors';
import { notify } from '@/lib/notifications/notify';
import { getPaymentProvider, PaymentError } from '@/lib/payment';
import { EscrowLedgerService, LedgerError } from '@/lib/payment/ledger';
import type { PayoutResult } from '@/lib/payment/ledger';
import { logPaymentFailure } from '@/lib/payment/log';
import { extractSafeErrorDetails, toLogString } from '@/lib/logging';

/**
 * Brand approves a delivered video; the creator is paid net of commission
 * (KAN-45, US-008, AC-023, §4.4 approve).
 *
 * **Almost all of this ticket already exists.** `EscrowLedgerService.payoutForDeal`
 * is the money path: one serializable transaction that locks the deal and the
 * campaign, refuses anything but `delivered` with `DEAL_NOT_DELIVERED`, splits
 * the total from the deal's snapshotted `commission_rate` (invariant 8), checks
 * the escrow balance stays non-negative *before* paying the provider, calls
 * `provider.capturePayout`, writes the paired `release_payout`/`commission`
 * entries, and moves the deal to `completed` — AC bullets 2, 3, 4, 6 and 8, in
 * a place with exhaustive coverage (see `escrow-ledger.test.ts`). What was
 * missing was everything around it: the ownership gate, the reachable entry
 * point, and telling the creator it happened. That is this module.
 *
 * **Why this does not use `withNotifications`.** The same reason
 * `fund-campaign.ts` documents: `payoutForDeal` opens its own `serializable`
 * transaction *and retries it*, so wrapping it would nest two transactions on
 * two connections from a `max: 5` pool, and each serialization retry would
 * re-queue the same email. So the ledger runs first and the notification is
 * written after it commits, through the unbound `notify`.
 *
 * The honest consequence: a notification insert that fails leaves the creator
 * paid and the deal `completed` with nobody told. That is the direction to
 * fail in — the alternative is rolling back a captured payout to save an
 * email — and the creator still sees the completed state and the payout on
 * their deal page, which is where AC-7's substance lives.
 *
 * Because the money and the status are already final, that failure is
 * **traced and swallowed**: the response still reports the completed payout
 * rather than a 500 that would tell the brand their approval failed when it
 * succeeded. The trace is the operator's only evidence that a paid creator
 * was never told, so it is a seam (`logNotifyFailure`), not a console.log.
 */

/**
 * Why an approval did not go through.
 *
 * `not_delivered` is the state machine's own answer (via `payoutForDeal`'s
 * status guard) for anything that is not `delivered` — an unfunded, an
 * already-approved, or a revision-requested deal all mean "nothing to approve
 * right now", and the ledger's `DEAL_NOT_DELIVERED` is what the AC names.
 * `payment_failed` is the provider declining or a serialization conflict
 * outliving its retries; both mean nothing was paid and trying again is
 * reasonable.
 */
export type ApproveDeliverableResult =
  | {
      ok: true;
      dealId: string;
      status: 'completed';
      /** Integer santim the creator receives, net of commission (invariant 4). */
      payout: number;
      /** Integer santim the platform keeps (invariant 4). */
      commission: number;
    }
  | {
      ok: false;
      reason: 'not_found' | 'not_delivered' | 'payment_failed';
    };

export interface ApproveDeliverableDeps {
  /**
   * The ownership-scoped read. Filters on `brandProfileId` itself (through
   * `campaign.brand_id`), so a caller who does not own this deal's campaign
   * gets `not_found` even with the route's gate removed — `payoutForDeal`
   * locks by deal id alone and has no notion of who is asking. Also resolves
   * the creator's `user.id` (the two-hop rule from `lib/authz.ts`), because
   * notifications address a user, never a profile id.
   */
  getDeal: (
    dealId: string,
    brandProfileId: string
  ) => Promise<{
    id: string;
    status: DealStatus;
    campaignName: string;
    creatorUserId: string;
  } | null>;
  /** Defaults to the real ledger. The seam is what keeps tests off Postgres. */
  pay: (dealId: string, actorId: string) => Promise<PayoutResult>;
  notify: typeof notify;
  /** A seam, so a test can assert *what* was logged — see `fund-campaign.ts`. */
  logFailure: typeof logPaymentFailure;
  /**
   * Trace for a notification that could not be written after the payout
   * committed. The action swallows that failure (money and status are already
   * final — see the module header), but a swallowed failure must still leave a
   * line for the operator who has to explain a paid creator who was never
   * told.
   */
  logNotifyFailure: (
    error: unknown,
    context: { dealId: string; actorId: string }
  ) => void;
}

const defaultDeps: ApproveDeliverableDeps = {
  getDeal: async (dealId, brandProfileId) => {
    const [row] = await db
      .select({
        id: deal.id,
        status: deal.status,
        campaignName: campaign.name,
        creatorUserId: creatorProfile.userId,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
      .where(and(eq(deal.id, dealId), eq(campaign.brandId, brandProfileId)))
      .limit(1);

    return row ?? null;
  },
  // Constructed per call rather than once at module scope, matching
  // `fund-campaign.ts`: the service holds no state between calls, and a
  // module-level instance would call `getPaymentProvider()` at import time,
  // binding the provider before any test could swap it.
  pay: (dealId, actorId) =>
    new EscrowLedgerService(db, getPaymentProvider()).payoutForDeal(
      dealId,
      actorId
    ),
  notify,
  logFailure: logPaymentFailure,
  logNotifyFailure: (error, context) => {
    const { name, code, message } = extractSafeErrorDetails(error);
    // The event names the failure; the deal id is the join key back to the
    // completed payout. No PII reaches this line: `extractSafeErrorDetails`
    // scrubs emails (NFR-010), and the payload carries no row content.
    console.error(
      toLogString({
        level: 'error',
        event: 'approve_deliverable.notify_failed',
        message: `[Approve] notification could not be written for paid deal ${context.dealId}: [${name}] ${code} - ${message}`,
        dealId: context.dealId,
        actorId: context.actorId,
      })
    );
  },
};

/**
 * Approves a delivered deliverable on behalf of the brand that owns its
 * campaign, paying the creator net of commission (AC-023).
 *
 * `brandProfileId` and `actorUserId` come from `guard()`, never from the
 * client. There is no request body at all: the amounts are derived from the
 * deal under the ledger's own lock, so a client-supplied figure would be a
 * second source for money that already has one authoritative source.
 *
 * **The status guard lives in the ledger, not here.** `payoutForDeal` refuses
 * anything but `delivered` under its own lock, so this action invents no
 * status of its own — a double-approval arrives at the ledger as
 * `completed → completed` and is refused with the machine's own code, which
 * is what makes paying twice structurally impossible (AC-6) rather than
 * merely discouraged.
 */
export async function approveDeliverable(
  dealId: string,
  brandProfileId: string,
  actorUserId: string,
  deps: ApproveDeliverableDeps = defaultDeps
): Promise<ApproveDeliverableResult> {
  // Ownership before the money moves, and before the notification has a name
  // to use. `payoutForDeal` locks by deal id alone: without this, any brand
  // with a valid deal id could pay out somebody else's campaign.
  const row = await deps.getDeal(dealId, brandProfileId);
  if (!row) {
    return { ok: false, reason: 'not_found' };
  }

  let result: PayoutResult;
  try {
    result = await deps.pay(dealId, actorUserId);
  } catch (error) {
    const reason = approveFailureReason(error);

    // The KAN-44 rule: a money-path failure must leave a trace. Logged for
    // every failure, not only the payment ones — the unrecognised error on
    // the next line becomes a 500 with no envelope, and would otherwise be
    // the one payout failure that left nothing behind to debug.
    if (reason === 'payment_failed' || !reason) {
      deps.logFailure(error, {
        operation: 'approve_deliverable',
        dealId,
        actorId: actorUserId,
      });
    }

    // An unrecognised failure is re-thrown, not reported as a payment
    // problem — the caller must not be told "try again" about a state nobody
    // has established.
    if (!reason) throw error;
    return { ok: false, reason };
  }

  // After the ledger transaction committed, so a failure here cannot roll the
  // payout back — see the module header. The creator is told what actually
  // moved, not a figure re-derived outside the transaction.
  //
  // All three figures (KAN-55 AC-4). The email states the gross, the commission
  // deducted and the net, and every one of them comes from `PayoutResult` — the
  // values the ledger entries were written from. Computing any of them here
  // would make this a second source for a split `computeSplit` already owns.
  try {
    await deps.notify(row.creatorUserId, 'deliverable_approved', {
      dealId,
      campaignTitle: row.campaignName,
      payout: result.payout,
      totalPrice: result.totalPrice,
      commission: result.commission,
    });
  } catch (error) {
    // The payout and the `completed` status are final at this point, so the
    // failure is traced and swallowed: a 500 here would tell the brand their
    // approval failed when it succeeded (F2).
    deps.logNotifyFailure(error, { dealId, actorId: actorUserId });
  }

  return {
    ok: true,
    dealId,
    status: 'completed',
    payout: result.payout,
    commission: result.commission,
  };
}

/**
 * Maps a ledger or provider failure onto a result reason, or `null` for
 * anything this action does not recognise. The mirror of `fundFailureReason`
 * in `fund-campaign.ts`, with the one refusal this endpoint has.
 *
 * `DEAL_NOT_DELIVERED` covers the whole non-`delivered` set, including a
 * double-approval: `payoutForDeal` re-reads the row under its own lock and
 * the machine answers `completed → completed` with the same code.
 * `BUDGET_EXCEEDED` is a ledger-integrity trip (a balance that went negative
 * can only mean corrupted data), deliberately not surfaced as a retryable
 * payment failure — re-thrown so it reaches the server log as a 500.
 */
function approveFailureReason(
  error: unknown
): Exclude<ApproveDeliverableResult, { ok: true }>['reason'] | null {
  if (error instanceof PaymentError) return 'payment_failed';

  if (error instanceof LedgerError) {
    switch (error.code) {
      case ErrorCode.DEAL_NOT_DELIVERED:
        return 'not_delivered';
      case ErrorCode.PAYMENT_FAILED:
        return 'payment_failed';
      case ErrorCode.VALIDATION_ERROR:
        return 'not_found';
      default:
        return null;
    }
  }

  return null;
}
