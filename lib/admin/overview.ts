import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  brandProfile,
  campaign,
  creatorProfile,
  deal,
  ledgerEntry,
} from '@/db/schema';
import type { CampaignStatus, DealStatus } from '@/db/schema';
import { ForbiddenError, guard } from '@/lib/authz';
import { UUID_REGEX } from '@/lib/validation';
import { REFUNDABLE_FROM } from '@/lib/payment/ledger';
import type { LedgerEntryType } from '@/db/schema';

/**
 * The admin overview read path (KAN-53, US-010, Tech Spec §4.6).
 *
 * Three questions an operator asks with a database open, answered read-only:
 * "where is every campaign's money", "does this campaign's ledger actually
 * add up", and "which deals need an operator's eyes".
 *
 * **The gate is inside the module, not only on the routes.** The same rule
 * `readAuditLog` documents: a page and a route handler are two call sites
 * today and more later, and a read whose protection lives in its callers is
 * protected exactly as well as the least careful one. Every function here
 * runs the admin role gate first, and the routes run it again — the
 * double-check the audit-log route keeps because each is load-bearing (the
 * route gate stops a non-admin probing the endpoint; the module gate makes
 * the *query* safe for any future caller).
 *
 * **The money figures are ledger-derived, never recomputed from statuses.**
 * AC-026's dashboard rule — "reading from the ledger, not recomputing" — is
 * the same rule here. `held` is `sum(amount)` over the campaign's entries,
 * which is exactly what `sumEscrowedByCampaign` computes and what invariant 7
 * guards, so the number an admin is shown cannot disagree with the number the
 * ledger enforces. `paidOut`, `commission`, and `refunded` are the three ways
 * money left escrow, each a signed `FILTER` sum over the same table. The
 * reconciliation check on the ledger view is the same identity restated: the
 * stored running `balance_after` must equal the sum of the entries that
 * produced it, or the chain is corrupt.
 *
 * **The worklist is the refundable set, defined by the ledger.** There is no
 * `flagged`/`disputed` column — the machine models dispute as the `refunded`
 * edges — so "deals an admin may need to resolve" is exactly the set the
 * resolve endpoint can act on: `REFUNDABLE_FROM` (money held, not yet paid
 * out or refunded). Imported from the ledger rather than typed out, so the
 * worklist and the money path agree by construction the way
 * `LEGAL_TRANSITIONS` and `REFUNDABLE_FROM` already do. The endpoint is named
 * `/worklist`, not `/disputes`: a list labelled "disputes" would read as
 * though every row were disputed, when the deals here are merely in flight.
 *
 * Deal history is deliberately not here: `getDealHistory` in
 * `lib/deals/queries.ts` already serves both parties *and* the admin
 * (`allowAdmin: true`), with its own ordering and actor folding. The endpoint
 * wraps it rather than this module holding a second copy of that read.
 */

export interface AdminCampaignOverview {
  id: string;
  name: string;
  status: CampaignStatus;
  /** `campaign.budget`, integer santim (invariant 4). */
  budget: number;
  /** `sum(amount)` over the campaign's entries — the escrowed view. */
  held: number;
  /** −`sum(amount)` where `release_payout`: what creators were paid. */
  paidOut: number;
  /** −`sum(amount)` where `commission`: the platform's cut. */
  commission: number;
  /** −`sum(amount)` where `refund`: what came back to the brand. */
  refunded: number;
}

/** One campaign list row as the query returns it, before folding. */
export type AdminCampaignRow = AdminCampaignOverview;

export interface AdminLedgerEntry {
  id: string;
  entryType: LedgerEntryType;
  /** Signed santim: + into escrow, − out. */
  amount: number;
  /** The running balance the ledger stored for this entry. */
  balanceAfter: number;
  /**
   * Monotonic write order (bigserial). `created_at` is transaction start, so
   * entries written in one transaction share it and `id` is random — `seq` is
   * the only reliable "which entry came last" answer, which the reconciliation
   * check depends on. Display order follows it, so `at(-1)` is the last write.
   */
  seq: number;
  providerRef: string | null;
  createdAt: Date;
}

export interface AdminLedgerTotals {
  /** `sum(amount)` — equals the final `balance_after` when reconciled. */
  held: number;
  paidOut: number;
  commission: number;
  refunded: number;
}

export interface AdminCampaignLedger {
  campaign: {
    id: string;
    name: string;
    status: CampaignStatus;
    budget: number;
  };
  entries: AdminLedgerEntry[];
  totals: AdminLedgerTotals;
  /**
   * True when the stored running balance agrees with the entries that
   * produced it: `sum(amount)` equals the last entry's `balance_after` — "the
   * last entry" meaning the one with the highest `seq`, the write order
   * (both 0 for a campaign with no entries). The ledger writes `balance_after`
   * as a running sum inside its own transaction, so a `false` here means
   * corrupted data, not a normal state.
   */
  reconciled: boolean;
}

export interface AdminWorklistRow {
  id: string;
  /**
   * One of `REFUNDABLE_FROM` at runtime — the query filters the worklist to
   * exactly that set — but typed as the full `DealStatus` because drizzle
   * cannot narrow a column through `inArray`. The where-clause is the
   * guarantee, and a source-level test pins it.
   */
  status: DealStatus;
  totalPrice: number;
  videoCount: number;
  campaignId: string;
  campaignName: string;
  brandCompanyName: string;
  creatorHandle: string;
  createdAt: Date;
}

/** Seam for tests, matching the shape the rest of `lib/` uses. */
export interface AdminOverviewDeps {
  /** Both layers of NFR-005: the role gate, deny-by-default. */
  requireAdmin: () => Promise<unknown>;
  listCampaigns: () => Promise<AdminCampaignRow[]>;
  getCampaign: (campaignId: string) => Promise<{
    id: string;
    name: string;
    status: CampaignStatus;
    budget: number;
  } | null>;
  ledgerFor: (campaignId: string) => Promise<AdminLedgerEntry[]>;
  listWorklist: () => Promise<AdminWorklistRow[]>;
}

const defaultDeps: AdminOverviewDeps = {
  requireAdmin: () => guard({ roles: ['admin'] }),
  listCampaigns: async () => {
    // Grouped FILTER sums keep the whole list one query instead of N
    // `sumEscrowedByCampaign` calls, while computing `held` exactly the way
    // that leaf does — `sum(amount)` over the same entries, so the number
    // shown and the number invariant 7 guards are one definition.
    return db
      .select({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        budget: campaign.budget,
        held: sql<number>`coalesce(sum(${ledgerEntry.amount}) filter (where ${ledgerEntry.campaignId} = ${campaign.id}), 0)::int`,
        paidOut: sql<number>`coalesce(-sum(${ledgerEntry.amount}) filter (where ${ledgerEntry.campaignId} = ${campaign.id} and ${ledgerEntry.entryType} = 'release_payout'), 0)::int`,
        commission: sql<number>`coalesce(-sum(${ledgerEntry.amount}) filter (where ${ledgerEntry.campaignId} = ${campaign.id} and ${ledgerEntry.entryType} = 'commission'), 0)::int`,
        refunded: sql<number>`coalesce(-sum(${ledgerEntry.amount}) filter (where ${ledgerEntry.campaignId} = ${campaign.id} and ${ledgerEntry.entryType} = 'refund'), 0)::int`,
      })
      .from(campaign)
      .leftJoin(ledgerEntry, eq(ledgerEntry.campaignId, campaign.id))
      .groupBy(campaign.id)
      .orderBy(desc(campaign.createdAt));
  },
  getCampaign: async (campaignId) => {
    const [row] = await db
      .select({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        budget: campaign.budget,
      })
      .from(campaign)
      .where(eq(campaign.id, campaignId))
      .limit(1);
    return row ?? null;
  },
  ledgerFor: async (campaignId) => {
    // Oldest-first is the audit order, and within a transaction it is the
    // *write* order: `created_at` is transaction start (shared by every entry
    // written together) and `id` is random, so ordering by `seq` — the
    // bigserial insertion order — is the only ordering that makes "last
    // entry" well-defined. The reconciliation check depends on it; a display
    // tiebreak would make `reconciled` a coin flip on a clean ledger.
    return db
      .select({
        id: ledgerEntry.id,
        entryType: ledgerEntry.entryType,
        amount: ledgerEntry.amount,
        balanceAfter: ledgerEntry.balanceAfter,
        seq: ledgerEntry.seq,
        providerRef: ledgerEntry.providerRef,
        createdAt: ledgerEntry.createdAt,
      })
      .from(ledgerEntry)
      .where(eq(ledgerEntry.campaignId, campaignId))
      .orderBy(asc(ledgerEntry.seq));
  },
  listWorklist: async () => {
    return (
      db
        .select({
          id: deal.id,
          status: deal.status,
          totalPrice: deal.totalPrice,
          videoCount: deal.videoCount,
          campaignId: campaign.id,
          campaignName: campaign.name,
          brandCompanyName: brandProfile.companyName,
          creatorHandle: creatorProfile.tiktokHandle,
          createdAt: deal.createdAt,
        })
        .from(deal)
        .innerJoin(campaign, eq(deal.campaignId, campaign.id))
        .innerJoin(brandProfile, eq(campaign.brandId, brandProfile.id))
        .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
        .where(inArray(deal.status, REFUNDABLE_FROM))
        // Oldest unresolved first: the worklist is an age-ordered queue.
        .orderBy(asc(deal.createdAt))
    );
  },
};

/**
 * Every campaign with its budget and ledger position, newest first.
 *
 * Gated inside the module before the query runs — the same rule the other
 * admin reads keep. `null` cannot occur: an admin lists campaigns, not a
 * campaign.
 */
export async function listCampaignsForAdmin(
  deps: AdminOverviewDeps = defaultDeps
): Promise<AdminCampaignOverview[]> {
  await deps.requireAdmin();
  return deps.listCampaigns();
}

/**
 * One campaign's full ledger with running balance and a reconciliation check,
 * or `null` when no such campaign exists.
 *
 * `reconciled` is computed here, from the entries, not fetched: it is the
 * check an operator performs, and keeping it in the read means the answer
 * cannot drift from the rows it reports.
 */
export async function getCampaignLedgerForAdmin(
  campaignId: string,
  deps: AdminOverviewDeps = defaultDeps
): Promise<AdminCampaignLedger | null> {
  // Shape-checked ahead of the gate, following `getDealHistory`: `guard` would
  // compare this against a `uuid` column and Postgres would answer `22P02` —
  // a 500 for a mistyped link. A malformed id belongs to nobody.
  if (!UUID_REGEX.test(campaignId)) {
    throw new ForbiddenError('malformed campaign id');
  }

  await deps.requireAdmin();

  const header = await deps.getCampaign(campaignId);
  if (!header) return null;

  const entries = await deps.ledgerFor(campaignId);

  // Negating an empty sum yields `-0`, which is a different value than `0`
  // under `Object.is` and would leak into the contract; normalize it.
  const spent = (entryType: LedgerEntryType): number => {
    const sum = entries
      .filter((e) => e.entryType === entryType)
      .reduce((total, e) => total + e.amount, 0);
    return sum === 0 ? 0 : -sum;
  };

  const totals = {
    held: entries.reduce((sum, e) => sum + e.amount, 0),
    paidOut: spent('release_payout'),
    commission: spent('commission'),
    refunded: spent('refund'),
  };

  return {
    campaign: header,
    entries,
    totals,
    reconciled: totals.held === (entries.at(-1)?.balanceAfter ?? 0),
  };
}

/**
 * The worklist: every deal the resolve endpoint could act on, oldest first,
 * with the names an operator recognises. Named for what it is — deals whose
 * money is held and unresolved — not for a dispute, because none of them
 * necessarily are.
 *
 * `REFUNDABLE_FROM` is the definition of "money held and not resolved" — the
 * same set the ledger's `refundDeal` accepts and the machine's `refunded`
 * edges reach, so the worklist and the action agree by construction.
 */
export async function listWorklistForAdmin(
  deps: AdminOverviewDeps = defaultDeps
): Promise<AdminWorklistRow[]> {
  await deps.requireAdmin();
  return deps.listWorklist();
}
