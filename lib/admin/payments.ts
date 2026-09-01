import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  brandProfile,
  campaign,
  creatorProfile,
  deal,
  fundingSession,
  ledgerEntry,
  refund,
  withdrawal,
} from '@/db/schema';
import type {
  FundingSessionStatus,
  RefundStatus,
  WithdrawalStatus,
} from '@/db/schema';
import { guard } from '@/lib/authz';
import { issueExternalRefund } from '@/lib/refunds/external-refund';
import type { IssueRefundResult } from '@/lib/refunds/external-refund';

/**
 * The admin payments & reconciliation read (KAN-70 PR 4).
 *
 * One page answering "where is the external money": every Chapa checkout a
 * brand opened, every transfer a creator asked for, every refund we owe a
 * brand's card — each with its status — plus the totals line that lets an
 * operator sanity-check our books against the Chapa dashboard balance:
 *
 *     deposited − withdrawn − refunded − commission ≈ escrow held + wallets
 *
 * Not an equation the page enforces (mock-funded campaigns, in-flight rows
 * and test-mode noise all move it), but the figures to check it with, each
 * a single-purpose sum over the table that owns it.
 *
 * Same gate rule as `lib/admin/overview.ts`: the admin check runs inside the
 * module before any query, and the page runs it again via the layout.
 */

export interface PaymentsTotals {
  /** Σ `consumed` funding sessions — money that entered escrow via Chapa. */
  deposited: number;
  /** Σ `paid` withdrawals — money that left to creators' accounts. */
  withdrawn: number;
  /** Σ `refunded` external refunds — money returned to brands' cards. */
  refunded: number;
  /** −Σ commission ledger entries — the platform's cut, still at Chapa. */
  commission: number;
  /** Σ signed ledger amounts across all campaigns — money held in escrow. */
  escrowHeld: number;
}

export interface AdminFundingSessionRow {
  id: string;
  txRef: string;
  amount: number;
  status: FundingSessionStatus;
  campaignName: string;
  brandCompanyName: string;
  failureReason: string | null;
  createdAt: Date;
}

export interface AdminWithdrawalRow {
  id: string;
  txRef: string;
  amount: number;
  status: WithdrawalStatus;
  creatorHandle: string;
  bankName: string;
  failureReason: string | null;
  createdAt: Date;
}

export interface AdminRefundRow {
  id: string;
  fundingTxRef: string;
  amount: number;
  status: RefundStatus;
  campaignName: string;
  brandCompanyName: string;
  failureReason: string | null;
  createdAt: Date;
}

export interface AdminPaymentsView {
  totals: PaymentsTotals;
  sessions: AdminFundingSessionRow[];
  withdrawals: AdminWithdrawalRow[];
  refunds: AdminRefundRow[];
}

/** Recent-rows cap: the page is a reconciliation view, not an archive. */
const LIST_LIMIT = 50;

export interface AdminPaymentsDeps {
  requireAdmin: () => Promise<unknown>;
  totals: () => Promise<PaymentsTotals>;
  listSessions: () => Promise<AdminFundingSessionRow[]>;
  listWithdrawals: () => Promise<AdminWithdrawalRow[]>;
  listRefunds: () => Promise<AdminRefundRow[]>;
}

const defaultDeps: AdminPaymentsDeps = {
  requireAdmin: () => guard({ roles: ['admin'] }),
  totals: async () => {
    const [moneyIn] = await db
      .select({
        deposited: sql<number>`COALESCE(SUM(${fundingSession.amount}) FILTER (WHERE ${fundingSession.status} = 'consumed'), 0)::int`,
      })
      .from(fundingSession);
    const [moneyOut] = await db
      .select({
        withdrawn: sql<number>`COALESCE(SUM(${withdrawal.amount}) FILTER (WHERE ${withdrawal.status} = 'paid'), 0)::int`,
      })
      .from(withdrawal);
    const [moneyBack] = await db
      .select({
        refunded: sql<number>`COALESCE(SUM(${refund.amount}) FILTER (WHERE ${refund.status} = 'refunded'), 0)::int`,
      })
      .from(refund);
    const [ledger] = await db
      .select({
        commission: sql<number>`COALESCE(-SUM(${ledgerEntry.amount}) FILTER (WHERE ${ledgerEntry.entryType} = 'commission'), 0)::int`,
        escrowHeld: sql<number>`COALESCE(SUM(${ledgerEntry.amount}), 0)::int`,
      })
      .from(ledgerEntry);
    return {
      deposited: moneyIn?.deposited ?? 0,
      withdrawn: moneyOut?.withdrawn ?? 0,
      refunded: moneyBack?.refunded ?? 0,
      commission: ledger?.commission ?? 0,
      escrowHeld: ledger?.escrowHeld ?? 0,
    };
  },
  listSessions: async () => {
    return db
      .select({
        id: fundingSession.id,
        txRef: fundingSession.txRef,
        amount: fundingSession.amount,
        status: fundingSession.status,
        campaignName: campaign.name,
        brandCompanyName: brandProfile.companyName,
        failureReason: fundingSession.failureReason,
        createdAt: fundingSession.createdAt,
      })
      .from(fundingSession)
      .innerJoin(campaign, eq(fundingSession.campaignId, campaign.id))
      .innerJoin(brandProfile, eq(fundingSession.brandId, brandProfile.id))
      .orderBy(desc(fundingSession.createdAt))
      .limit(LIST_LIMIT);
  },
  listWithdrawals: async () => {
    return db
      .select({
        id: withdrawal.id,
        txRef: withdrawal.txRef,
        amount: withdrawal.amount,
        status: withdrawal.status,
        creatorHandle: creatorProfile.tiktokHandle,
        bankName: withdrawal.bankName,
        failureReason: withdrawal.failureReason,
        createdAt: withdrawal.createdAt,
      })
      .from(withdrawal)
      .innerJoin(creatorProfile, eq(withdrawal.creatorId, creatorProfile.id))
      .orderBy(desc(withdrawal.createdAt))
      .limit(LIST_LIMIT);
  },
  listRefunds: async () => {
    return db
      .select({
        id: refund.id,
        fundingTxRef: refund.fundingTxRef,
        amount: refund.amount,
        status: refund.status,
        campaignName: campaign.name,
        brandCompanyName: brandProfile.companyName,
        failureReason: refund.failureReason,
        createdAt: refund.createdAt,
      })
      .from(refund)
      .innerJoin(campaign, eq(refund.campaignId, campaign.id))
      .innerJoin(brandProfile, eq(campaign.brandId, brandProfile.id))
      .orderBy(desc(refund.createdAt))
      .limit(LIST_LIMIT);
  },
};

export async function readPaymentsForAdmin(
  deps: AdminPaymentsDeps = defaultDeps
): Promise<AdminPaymentsView> {
  await deps.requireAdmin();
  const [totals, sessions, withdrawals, refunds] = await Promise.all([
    deps.totals(),
    deps.listSessions(),
    deps.listWithdrawals(),
    deps.listRefunds(),
  ]);
  return { totals, sessions, withdrawals, refunds };
}

// -- Refund retry --------------------------------------------------------------

export type RetryRefundResult =
  | { ok: true; status: 'processing' | 'mock' }
  | { ok: false; reason: 'not_found' | 'already_settled' | 'gateway_rejected' };

export interface RetryRefundDeps {
  requireAdmin: () => Promise<unknown>;
  loadRefund: (refundId: string) => Promise<{
    dealId: string;
    campaignId: string;
    amount: number;
  } | null>;
  issue: typeof issueExternalRefund;
}

const defaultRetryDeps: RetryRefundDeps = {
  requireAdmin: () => guard({ roles: ['admin'] }),
  loadRefund: async (refundId) => {
    const [row] = await db
      .select({
        dealId: refund.dealId,
        campaignId: refund.campaignId,
        amount: refund.amount,
      })
      .from(refund)
      .innerJoin(deal, eq(refund.dealId, deal.id))
      .where(eq(refund.id, refundId))
      .limit(1);
    return row ?? null;
  },
  issue: issueExternalRefund,
};

/**
 * Retry a failed external refund from the payments view. The idempotency
 * lives in `issueExternalRefund`'s claim: a row already `processing` or
 * `refunded` answers `already_settled`, so a double-click cannot ask Chapa
 * twice. `no_funding_charge` cannot occur here — the row exists, so the
 * charge reference was found once already — but maps to `gateway_rejected`
 * defensively rather than widening the result type.
 */
export async function retryRefundForAdmin(
  refundId: string,
  deps: RetryRefundDeps = defaultRetryDeps
): Promise<RetryRefundResult> {
  await deps.requireAdmin();

  const row = await deps.loadRefund(refundId);
  if (!row) return { ok: false, reason: 'not_found' };

  const result: IssueRefundResult = await deps.issue({
    dealId: row.dealId,
    campaignId: row.campaignId,
    amount: row.amount,
    reason: 'Dispute resolved: refunded to brand (admin retry)',
  });

  if (result.ok) return { ok: true, status: result.status };
  if (result.reason === 'already_settled') {
    return { ok: false, reason: 'already_settled' };
  }
  return { ok: false, reason: 'gateway_rejected' };
}
