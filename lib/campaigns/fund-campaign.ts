import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaign } from '@/db/schema';
import { ErrorCode } from '@/lib/validation';
import { notify } from '@/lib/notifications/notify';
import { getPaymentProvider, PaymentError } from '@/lib/payment';
import { EscrowLedgerService, LedgerError } from '@/lib/payment/ledger';
import type { HoldForCampaignResult } from '@/lib/payment/ledger';

/**
 * Brand funds a confirmed campaign (KAN-43, US-007, AC-019, AC-021, §4.3 fund).
 *
 * **Almost all of this ticket already exists.** `EscrowLedgerService.holdForCampaign`
 * (KAN-42) is the money path: one serializable transaction that locks the
 * campaign, funds only the `accepted` deals, writes one `hold` per deal with a
 * re-summed `balance_after`, transitions each deal through the state machine, and
 * moves the campaign to `funded` — AC bullets 2, 3, 4 and 7, in a place with 100%
 * coverage (NFR-009). What was missing was everything around it: the ownership
 * gate, the reachable entry point, and telling anyone it happened. That is this
 * module.
 *
 * **Why this does not use `withNotifications`.** Every other action in `lib/`
 * hands its body to it and gets a transaction plus post-commit email. This one
 * cannot: `holdForCampaign` opens its own `serializable` transaction *and retries
 * it*, so wrapping it would nest two transactions on two connections from a
 * `max: 5` pool — the deadlock `remove-from-cart.ts` documents — and each
 * serialization retry would re-queue the same email. So the ledger runs first and
 * the notification is written after it commits, through the unbound `notify`.
 *
 * The honest consequence: a notification insert that fails leaves the money held
 * and the campaign `funded` with nobody told. That is the direction to fail in —
 * the alternative is rolling back a captured hold to save an email — and the
 * brand still sees the funded state on the campaign page, which is where AC-019
 * item 6 is actually satisfied. A `withNotifications` variant that joins an
 * existing transaction would remove the asymmetry; filed as a follow-up rather
 * than built here, because it touches every existing caller.
 */

/**
 * Why a fund attempt did not go through.
 *
 * `not_fundable` covers both "not confirmed" and "already funded", following the
 * single `CAMPAIGN_NOT_FUNDABLE` code — the client's response to either is to
 * re-read the campaign. `payment_failed` is the provider declining or a
 * serialization conflict outliving its retries; both mean nothing was held and
 * trying again is reasonable.
 */
export type FundCampaignResult =
  | {
      ok: true;
      campaignId: string;
      /** Deals moved to `funded`. Never zero — that is `no_accepted_deals`. */
      dealCount: number;
      /** Sum of those deals' `total_price`, in santim (invariant 4). */
      totalHeld: number;
    }
  | {
      ok: false;
      reason:
        'not_found' | 'not_fundable' | 'no_accepted_deals' | 'payment_failed';
    };

export interface FundCampaignDeps {
  /**
   * The ownership-scoped read. Filters on `brandProfileId` itself, so a caller
   * who does not own this campaign gets `not_found` even with the route's gate
   * removed — the ledger locks by id alone and has no notion of who is asking.
   */
  getCampaign: (
    campaignId: string,
    brandProfileId: string
  ) => Promise<{ id: string; name: string } | null>;
  /** Defaults to the real ledger. The seam is what keeps tests off Postgres. */
  hold: (campaignId: string, actorId: string) => Promise<HoldForCampaignResult>;
  notify: typeof notify;
}

const defaultDeps: FundCampaignDeps = {
  getCampaign: async (campaignId, brandProfileId) => {
    const [row] = await db
      .select({ id: campaign.id, name: campaign.name })
      .from(campaign)
      .where(
        and(eq(campaign.id, campaignId), eq(campaign.brandId, brandProfileId))
      )
      .limit(1);

    return row ?? null;
  },
  // Constructed per call rather than once at module scope, matching `db/seed.ts`.
  // The service holds no state between calls — the idempotency key is generated
  // inside `holdForCampaign` — so there is nothing to share, and a module-level
  // instance would call `getPaymentProvider()` at import time. That would bind
  // the provider before any test could swap it, and Q3's real processor is meant
  // to arrive by changing that one factory.
  hold: (campaignId, actorId) =>
    new EscrowLedgerService(db, getPaymentProvider()).holdForCampaign(
      campaignId,
      actorId
    ),
  notify,
};

/**
 * Holds the accepted total for a campaign and tells the brand (AC-019).
 *
 * `brandProfileId` and `actorUserId` come from `guard()`, never from the client.
 * Deliberately takes no amount: the total is summed from the accepted deals under
 * the campaign lock. A client-supplied figure would be a second source for a
 * number that already has one, and the wrong side of AC-014's server-side
 * ceiling.
 *
 * **Nothing here checks the budget ceiling, on purpose.** The amount held is the
 * sum of deals that were already checked against it at cart time and again at
 * confirm; a deal cannot be added to a non-draft campaign, and `COMMITS_BUDGET`
 * counts `accepted` and `funded` identically, so funding moves `available` by
 * exactly zero. Re-checking here would either restate a satisfied invariant or,
 * worse, refuse to fund deals the brand is already committed to.
 */
export async function fundCampaign(
  campaignId: string,
  brandProfileId: string,
  actorUserId: string,
  deps: FundCampaignDeps = defaultDeps
): Promise<FundCampaignResult> {
  // Ownership before the ledger, and before the notification has a name to use.
  // `holdForCampaign` locks by campaign id alone: without this, any brand with a
  // valid campaign id could fund somebody else's campaign.
  const camp = await deps.getCampaign(campaignId, brandProfileId);
  if (!camp) {
    return { ok: false, reason: 'not_found' };
  }

  let result: HoldForCampaignResult;
  try {
    result = await deps.hold(campaignId, actorUserId);
  } catch (error) {
    const reason = fundFailureReason(error);
    // An unrecognised failure is re-thrown, not reported as a payment problem.
    // Money may or may not have moved, and the caller must not be told "try
    // again" about a state nobody has established.
    if (!reason) throw error;
    return { ok: false, reason };
  }

  // After the ledger transaction committed, so a failure here cannot roll the
  // hold back — see the module header. AC-019 item 6's brand half.
  await deps.notify(actorUserId, 'campaign_funded', {
    campaignId,
    campaignTitle: camp.name,
    dealCount: result.dealCount,
    totalHeld: result.totalHeld,
  });

  return {
    ok: true,
    campaignId,
    dealCount: result.dealCount,
    totalHeld: result.totalHeld,
  };
}

/**
 * Maps a ledger or provider failure onto a result reason, or `null` for anything
 * this action does not recognise.
 *
 * Branches on `LedgerError.code` rather than the message, so rewording a server
 * log line cannot change which HTTP status a brand sees. `PaymentError` is
 * matched separately because the provider throws it *inside* the transaction and
 * `inSerializableTx` re-throws it untouched — it never becomes a `LedgerError`.
 *
 * `VALIDATION_ERROR` is `lockCampaign`'s "campaign not found", which is
 * unreachable here: the ownership read above already found the row. It is mapped
 * anyway, to `not_found`, because the alternative is a 500 if a campaign is
 * deleted between the two reads.
 */
function fundFailureReason(
  error: unknown
): Exclude<FundCampaignResult, { ok: true }>['reason'] | null {
  if (error instanceof PaymentError) return 'payment_failed';

  if (error instanceof LedgerError) {
    switch (error.code) {
      case ErrorCode.NO_ACCEPTED_DEALS:
        return 'no_accepted_deals';
      case ErrorCode.CAMPAIGN_NOT_FUNDABLE:
        return 'not_fundable';
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
