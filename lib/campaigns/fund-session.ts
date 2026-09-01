import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { campaign, deal, fundingSession } from '@/db/schema';
import { ChapaError } from '@/lib/chapa/client';
import { getPaymentGateway } from '@/lib/payment/gateway';
import type { PaymentGateway } from '@/lib/payment/gateway';
import { logPaymentFailure } from '@/lib/payment/log';

/**
 * Brand deposit, step one: open a Chapa hosted-checkout session (KAN-70).
 *
 * The mock flow funds a campaign in one POST because its "provider" is an
 * in-process table. Real money arrives by redirect: the brand leaves for
 * Chapa's checkout, pays there, and comes back — so the state between
 * "decided to pay" and "money confirmed" needs a row, and that row is
 * `funding_session`. This module owns its creation and cancellation;
 * `settle-funding.ts` owns everything after the money moves.
 *
 * Same shape as `fund-campaign.ts` deliberately: ownership-scoped read first
 * (the session is the brand's, not whoever holds a campaign id), a deps seam
 * for tests, reasons instead of thrown errors for everything the client can
 * cause.
 *
 * **The amount is summed server-side under no lock, and that is fine.** The
 * figure quoted at checkout is a snapshot; the money is only ever *applied*
 * by `holdForCampaign`, which re-sums the accepted set inside a serializable
 * transaction. If a deal flips between init and payment, settlement notices
 * the amount mismatch and refuses — the session fails loudly rather than
 * funding a different total than the brand paid.
 *
 * **One open session per campaign** — enforced twice: the early return that
 * resumes an existing session (that is the "Resume payment" banner), and the
 * partial unique index `funding_session_open_unique` for the race the read
 * cannot see. Losing that race means Chapa holds an orphan checkout that
 * nobody will ever pay; harmless, it just expires.
 */

export type CreateFundingSessionResult =
  | {
      ok: true;
      txRef: string;
      checkoutUrl: string;
      /** Santim quoted at checkout — settlement insists Chapa confirms exactly this. */
      amount: number;
      /** True when an already-open session was returned instead of a new one. */
      resumed: boolean;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_fundable'
        | 'no_accepted_deals'
        | 'gateway_unavailable';
    };

export interface FundingSessionDeps {
  /** Ownership-scoped read, like `fund-campaign.ts` — filters on the brand itself. */
  getCampaign: (
    campaignId: string,
    brandProfileId: string
  ) => Promise<{ id: string; name: string; status: string } | null>;
  /** Sum and count of the campaign's `accepted` deals, in santim. */
  sumAcceptedDeals: (
    campaignId: string
  ) => Promise<{ total: number; count: number }>;
  getOpenSession: (
    campaignId: string
  ) => Promise<{ txRef: string; checkoutUrl: string; amount: number } | null>;
  insertSession: (row: {
    campaignId: string;
    brandId: string;
    txRef: string;
    amount: number;
    checkoutUrl: string;
  }) => Promise<'inserted' | 'conflict'>;
  gateway: () => PaymentGateway | null;
  logFailure: typeof logPaymentFailure;
}

const defaultDeps: FundingSessionDeps = {
  getCampaign: async (campaignId, brandProfileId) => {
    const [row] = await db
      .select({ id: campaign.id, name: campaign.name, status: campaign.status })
      .from(campaign)
      .where(
        and(eq(campaign.id, campaignId), eq(campaign.brandId, brandProfileId))
      )
      .limit(1);
    return row ?? null;
  },
  sumAcceptedDeals: async (campaignId) => {
    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(${deal.totalPrice}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(deal)
      .where(and(eq(deal.campaignId, campaignId), eq(deal.status, 'accepted')));
    return { total: Number(row?.total ?? 0), count: Number(row?.count ?? 0) };
  },
  getOpenSession: async (campaignId) => {
    const [row] = await db
      .select({
        txRef: fundingSession.txRef,
        checkoutUrl: fundingSession.checkoutUrl,
        amount: fundingSession.amount,
      })
      .from(fundingSession)
      .where(
        and(
          eq(fundingSession.campaignId, campaignId),
          eq(fundingSession.status, 'initialized')
        )
      )
      .limit(1);
    return row ?? null;
  },
  insertSession: async (row) => {
    try {
      await db.insert(fundingSession).values(row);
      return 'inserted';
    } catch (error) {
      // 23505 on `funding_session_open_unique`: a concurrent request opened a
      // session between our read and this insert. The caller re-reads and
      // resumes that one — the checkout we initialized is abandoned unpaid.
      if (
        error instanceof Error &&
        (error as { code?: string }).code === '23505'
      ) {
        return 'conflict';
      }
      throw error;
    }
  },
  gateway: getPaymentGateway,
  logFailure: logPaymentFailure,
};

/**
 * Opens (or resumes) the hosted checkout for a confirmed campaign.
 *
 * `payer` comes from `guard()`'s session, never from the client — Chapa wants
 * an email and a name on the charge and those belong to the authenticated
 * brand. `origin` is the deployment's own origin (derived from the request
 * URL by the route), used to build the return URL Chapa redirects back to.
 */
export async function createFundingSession(
  campaignId: string,
  brandProfileId: string,
  payer: { email: string; name: string | null },
  origin: string,
  deps: FundingSessionDeps = defaultDeps
): Promise<CreateFundingSessionResult> {
  const gateway = deps.gateway();
  if (!gateway) {
    // Mock mode has no redirect flow at all; the client should never have
    // called this route. Answering `gateway_unavailable` (503) keeps the
    // misroute diagnosable without pretending money can move.
    return { ok: false, reason: 'gateway_unavailable' };
  }

  const camp = await deps.getCampaign(campaignId, brandProfileId);
  if (!camp) return { ok: false, reason: 'not_found' };
  if (camp.status !== 'confirmed') return { ok: false, reason: 'not_fundable' };

  // Resume before create: an abandoned checkout is still payable (Chapa lets
  // the customer retry within its window), and a second live session would
  // race the first at settlement for the same accepted set.
  const open = await deps.getOpenSession(campaignId);
  if (open) {
    return {
      ok: true,
      txRef: open.txRef,
      checkoutUrl: open.checkoutUrl,
      amount: open.amount,
      resumed: true,
    };
  }

  const accepted = await deps.sumAcceptedDeals(campaignId);
  if (accepted.count === 0) return { ok: false, reason: 'no_accepted_deals' };

  const txRef = `cmfund_${randomUUID()}`;
  const returnUrl = `${origin}/campaigns/${campaignId}/funding/${txRef}`;

  let checkoutUrl: string;
  try {
    const checkout = await gateway.createFundingCheckout({
      txRef,
      amountSantim: accepted.total,
      email: payer.email,
      firstName: payer.name ?? 'Brand',
      returnUrl,
      campaignName: camp.name,
    });
    checkoutUrl = checkout.checkoutUrl;
  } catch (error) {
    // Initialize moves no money, so every gateway failure here maps to "try
    // again" — logged with the detail the brand's one fixed sentence lacks.
    deps.logFailure(error, {
      operation: 'create_funding_session',
      campaignId,
    });
    if (error instanceof ChapaError) {
      return { ok: false, reason: 'gateway_unavailable' };
    }
    throw error;
  }

  const inserted = await deps.insertSession({
    campaignId,
    brandId: brandProfileId,
    txRef,
    amount: accepted.total,
    checkoutUrl,
  });

  if (inserted === 'conflict') {
    const winner = await deps.getOpenSession(campaignId);
    if (winner) {
      return {
        ok: true,
        txRef: winner.txRef,
        checkoutUrl: winner.checkoutUrl,
        amount: winner.amount,
        resumed: true,
      };
    }
    // The concurrent session already left `initialized` (paid or cancelled
    // in the same instant). Whatever the campaign's new truth is, this
    // request's premise is stale.
    return { ok: false, reason: 'not_fundable' };
  }

  return {
    ok: true,
    txRef,
    checkoutUrl,
    amount: accepted.total,
    resumed: false,
  };
}

/**
 * The campaign page's read: is a checkout open, and where does Resume go.
 * Same query as `defaultDeps.getOpenSession`, exported for server components.
 */
export async function getOpenFundingSession(
  campaignId: string
): Promise<{ txRef: string; checkoutUrl: string; amount: number } | null> {
  return defaultDeps.getOpenSession(campaignId);
}

/**
 * The return page's read — scoped to the owning brand *and* the campaign in
 * the URL, so a tx_ref pasted under someone else's campaign path answers
 * nothing rather than leaking a session's existence.
 */
export async function getFundingSessionForBrand(
  txRef: string,
  campaignId: string,
  brandProfileId: string
): Promise<{
  txRef: string;
  status: string;
  amount: number;
  providerRef: string | null;
  checkoutUrl: string;
  createdAt: Date;
  campaignName: string;
} | null> {
  const [row] = await db
    .select({
      txRef: fundingSession.txRef,
      status: fundingSession.status,
      amount: fundingSession.amount,
      providerRef: fundingSession.providerRef,
      checkoutUrl: fundingSession.checkoutUrl,
      createdAt: fundingSession.createdAt,
      campaignName: campaign.name,
    })
    .from(fundingSession)
    .innerJoin(campaign, eq(campaign.id, fundingSession.campaignId))
    .where(
      and(
        eq(fundingSession.txRef, txRef),
        eq(fundingSession.campaignId, campaignId),
        eq(fundingSession.brandId, brandProfileId)
      )
    )
    .limit(1);
  return row ?? null;
}

export interface CancelFundingSessionDeps {
  getCampaign: FundingSessionDeps['getCampaign'];
  expireOpenSession: (campaignId: string) => Promise<boolean>;
}

const defaultCancelDeps: CancelFundingSessionDeps = {
  getCampaign: defaultDeps.getCampaign,
  expireOpenSession: async (campaignId) => {
    const rows = await db
      .update(fundingSession)
      .set({ status: 'expired' })
      .where(
        and(
          eq(fundingSession.campaignId, campaignId),
          eq(fundingSession.status, 'initialized')
        )
      )
      .returning({ id: fundingSession.id });
    return rows.length > 0;
  },
};

/**
 * Cancels the open session so the fund button comes back.
 *
 * Cancelling is a UI convenience, not a revocation — Chapa does not know and
 * the checkout may still be paid afterwards. That is why `settle-funding.ts`
 * honours a paid `expired` session: money that moved is never ignored because
 * a banner was dismissed first.
 */
export async function cancelFundingSession(
  campaignId: string,
  brandProfileId: string,
  deps: CancelFundingSessionDeps = defaultCancelDeps
): Promise<
  { ok: true; cancelled: boolean } | { ok: false; reason: 'not_found' }
> {
  const camp = await deps.getCampaign(campaignId, brandProfileId);
  if (!camp) return { ok: false, reason: 'not_found' };
  const cancelled = await deps.expireOpenSession(campaignId);
  return { ok: true, cancelled };
}
