import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { brandProfile, campaign, fundingSession } from '@/db/schema';
import { ChapaError } from '@/lib/chapa/client';
import { ErrorCode } from '@/lib/validation';
import { notify } from '@/lib/notifications/notify';
import { getPaymentProvider, PaymentError } from '@/lib/payment';
import { getPaymentGateway } from '@/lib/payment/gateway';
import type { PaymentGateway } from '@/lib/payment/gateway';
import { EscrowLedgerService, LedgerError } from '@/lib/payment/ledger';
import type { HoldForCampaignResult } from '@/lib/payment/ledger';
import { logPaymentFailure } from '@/lib/payment/log';

/**
 * Brand deposit, step two: turn a paid Chapa checkout into held escrow
 * (KAN-70).
 *
 * Called from two places for the same tx_ref — the webhook and the return
 * page — because each covers the other's failure mode: webhooks reach only
 * the deployment whose URL is configured in Chapa's dashboard, and the brand
 * may never come back from checkout. Both callers land here, so this function
 * is the single place the money rules live, and it is idempotent the blunt
 * way: a consumed session answers `already_consumed` and touches nothing.
 * Chapa redelivers webhooks every 10 minutes for 72 hours until it sees a
 * 200, so that path is not an edge case, it is the common case.
 *
 * **Never trust the caller, only the verify endpoint.** Whether the trigger
 * was a signed webhook or a page load, value is given only after
 * `GET /transaction/verify/{tx_ref}` confirms status, the exact santim amount
 * quoted at init, the currency, and the test/live mode — Chapa's docs mandate
 * every one of these, and the amount check is what turns "a deal flipped
 * between init and payment" from a silent mis-fund into a loud failure.
 *
 * **Why the claim step exists.** `holdForCampaign` opens its own serializable
 * transaction (and retries it), so this module cannot wrap session + hold in
 * one transaction without nesting two connections from a small pool — the
 * deadlock `fund-campaign.ts` documents. Instead the session row is claimed
 * with a single conditional UPDATE (`initialized|expired → verified`), and
 * the hold runs after. If two settlers race past the claim anyway (a crashed
 * predecessor leaves `verified`, which stays claimable on purpose), the
 * serializable hold resolves it: the loser's `CAMPAIGN_NOT_FUNDABLE` against
 * a now-`funded` campaign is recognised as the winner's success.
 *
 * A paid-but-unfundable session (deal withdrawn in between, admin quarantine)
 * is marked `failed` with the money still at Chapa — logged loudly here;
 * PR 4's admin reconciliation view is where a human refunds it.
 */

export type SettleFundingResult =
  | {
      outcome: 'consumed';
      campaignId: string;
      dealCount: number;
      totalHeld: number;
    }
  | { outcome: 'already_consumed'; campaignId: string }
  /** Charge not confirmed yet (or Chapa unreachable) — try again later. */
  | { outcome: 'pending'; campaignId: string }
  | { outcome: 'failed'; campaignId: string; reason: string }
  | { outcome: 'not_found' };

interface SessionRow {
  id: string;
  campaignId: string;
  amount: number;
  status: string;
  campaignName: string;
  campaignStatus: string;
  /** The brand's user id — the hold's actor and the notification's recipient. */
  brandUserId: string;
}

export interface SettleFundingDeps {
  getSession: (txRef: string) => Promise<SessionRow | null>;
  /**
   * The conditional claim. Returns false when the row is in none of the
   * claimable states — someone else consumed or failed it since we read.
   */
  claimSession: (txRef: string, providerRef: string | null) => Promise<boolean>;
  markConsumed: (txRef: string) => Promise<void>;
  markFailed: (txRef: string, reason: string) => Promise<void>;
  hold: (campaignId: string, actorId: string) => Promise<HoldForCampaignResult>;
  getCampaignStatus: (campaignId: string) => Promise<string | null>;
  gateway: () => PaymentGateway | null;
  notify: typeof notify;
  logFailure: typeof logPaymentFailure;
}

const CLAIMABLE = ['initialized', 'expired', 'verified'] as const;

const defaultDeps: SettleFundingDeps = {
  getSession: async (txRef) => {
    const [row] = await db
      .select({
        id: fundingSession.id,
        campaignId: fundingSession.campaignId,
        amount: fundingSession.amount,
        status: fundingSession.status,
        campaignName: campaign.name,
        campaignStatus: campaign.status,
        brandUserId: brandProfile.userId,
      })
      .from(fundingSession)
      .innerJoin(campaign, eq(campaign.id, fundingSession.campaignId))
      .innerJoin(brandProfile, eq(brandProfile.id, fundingSession.brandId))
      .where(eq(fundingSession.txRef, txRef))
      .limit(1);
    return row ?? null;
  },
  claimSession: async (txRef, providerRef) => {
    const rows = await db
      .update(fundingSession)
      .set({ status: 'verified', verifiedAt: new Date(), providerRef })
      .where(
        and(
          eq(fundingSession.txRef, txRef),
          inArray(fundingSession.status, [...CLAIMABLE])
        )
      )
      .returning({ id: fundingSession.id });
    return rows.length > 0;
  },
  markConsumed: async (txRef) => {
    await db
      .update(fundingSession)
      .set({ status: 'consumed', consumedAt: new Date() })
      .where(eq(fundingSession.txRef, txRef));
  },
  markFailed: async (txRef, reason) => {
    await db
      .update(fundingSession)
      .set({ status: 'failed', failureReason: reason.slice(0, 500) })
      .where(eq(fundingSession.txRef, txRef));
  },
  hold: (campaignId, actorId) =>
    new EscrowLedgerService(db, getPaymentProvider()).holdForCampaign(
      campaignId,
      actorId
    ),
  getCampaignStatus: async (campaignId) => {
    const [row] = await db
      .select({ status: campaign.status })
      .from(campaign)
      .where(eq(campaign.id, campaignId))
      .limit(1);
    return row?.status ?? null;
  },
  gateway: getPaymentGateway,
  notify,
  logFailure: logPaymentFailure,
};

export async function settleFundingSession(
  txRef: string,
  deps: SettleFundingDeps = defaultDeps
): Promise<SettleFundingResult> {
  const gateway = deps.gateway();
  if (!gateway) return { outcome: 'not_found' };

  const session = await deps.getSession(txRef);
  if (!session) return { outcome: 'not_found' };
  const { campaignId } = session;

  if (session.status === 'consumed') {
    return { outcome: 'already_consumed', campaignId };
  }
  if (session.status === 'failed') {
    return { outcome: 'failed', campaignId, reason: 'session already failed' };
  }

  // -- The truth, from the verify endpoint --------------------------------
  let verified;
  try {
    verified = await gateway.verifyFunding(txRef);
  } catch (error) {
    if (error instanceof ChapaError && error.code === 'REJECTED') {
      // Chapa knows this tx_ref and answers "no such payment": the checkout
      // was never paid. That is still `pending` — it may yet be paid within
      // Chapa's retry window, and expiry is the cron's call, not ours.
      return { outcome: 'pending', campaignId };
    }
    deps.logFailure(error, {
      operation: 'settle_funding_verify',
      campaignId,
    });
    return { outcome: 'pending', campaignId };
  }

  if (verified.status === 'pending') {
    return { outcome: 'pending', campaignId };
  }

  if (verified.status !== 'success') {
    await deps.markFailed(txRef, `charge ${verified.status}`);
    return {
      outcome: 'failed',
      campaignId,
      reason: `charge ${verified.status}`,
    };
  }

  // -- The four checks the docs mandate before value ------------------------
  const expectedMode = gateway.mode === 'chapa-test' ? 'test' : 'live';
  const mismatch =
    verified.amountSantim !== session.amount
      ? `amount mismatch: chapa says ${verified.amountSantim}, session quoted ${session.amount}`
      : verified.currency !== 'ETB'
        ? `currency mismatch: ${verified.currency}`
        : verified.txRef !== txRef
          ? `tx_ref mismatch: ${verified.txRef}`
          : verified.mode !== null && verified.mode !== expectedMode
            ? `mode mismatch: charge is ${verified.mode}, gateway is ${expectedMode}`
            : null;
  if (mismatch) {
    // Money moved at Chapa but not the money we asked for. Never credited;
    // failed loudly for a human (PR 4's reconciliation view) to refund.
    deps.logFailure(new Error(mismatch), {
      operation: 'settle_funding_mismatch',
      campaignId,
    });
    await deps.markFailed(txRef, mismatch);
    return { outcome: 'failed', campaignId, reason: mismatch };
  }

  // -- Claim, then hold ------------------------------------------------------
  const claimed = await deps.claimSession(txRef, verified.providerRef);
  if (!claimed) {
    // Left the claimable set since our read — consumed or failed by a
    // concurrent settler. Re-read for the honest answer.
    const now = await deps.getSession(txRef);
    return now?.status === 'consumed'
      ? { outcome: 'already_consumed', campaignId }
      : {
          outcome: 'failed',
          campaignId,
          reason: 'session concurrently failed',
        };
  }

  let held: HoldForCampaignResult;
  try {
    held = await deps.hold(campaignId, session.brandUserId);
  } catch (error) {
    if (
      error instanceof LedgerError &&
      error.code === ErrorCode.CAMPAIGN_NOT_FUNDABLE &&
      (await deps.getCampaignStatus(campaignId)) === 'funded'
    ) {
      // The race's other settler already funded it. This session's money is
      // the same money (same single-use tx_ref), so this is success arriving
      // second, not a failure.
      await deps.markConsumed(txRef);
      return { outcome: 'already_consumed', campaignId };
    }

    const reason =
      error instanceof LedgerError || error instanceof PaymentError
        ? `hold failed: ${error.code}`
        : 'hold failed';
    // The expensive case: Chapa confirmed the money and the escrow refused
    // it. Nothing is credited; the session keeps the paid amount and the
    // failure for reconciliation.
    deps.logFailure(error, {
      operation: 'settle_funding_hold',
      campaignId,
    });
    await deps.markFailed(txRef, reason);
    if (!(error instanceof LedgerError || error instanceof PaymentError)) {
      throw error;
    }
    return { outcome: 'failed', campaignId, reason };
  }

  await deps.markConsumed(txRef);

  // Post-commit like `fund-campaign.ts`: a notification failure must not
  // unwind held money.
  await deps.notify(session.brandUserId, 'campaign_funded', {
    campaignId,
    campaignTitle: session.campaignName,
    dealCount: held.dealCount,
    totalHeld: held.totalHeld,
  });

  return {
    outcome: 'consumed',
    campaignId,
    dealCount: held.dealCount,
    totalHeld: held.totalHeld,
  };
}
