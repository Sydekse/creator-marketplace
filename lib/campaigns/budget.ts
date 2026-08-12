import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaign, deal } from '@/db/schema';
import type { CampaignStatus, DealStatus } from '@/db/schema';
import { guard } from '@/lib/authz';
import type { Tx } from '@/lib/authz';
import { UUID_REGEX } from '@/lib/validation';
import { sumCartTotal } from './cart-queries';

/**
 * What a campaign's budget is committed to, and what is left (KAN-37, AC-018).
 *
 * **Available budget is derived, never stored.** There is no `held_balance`
 * column and there is deliberately not going to be one — the KAN-40 spike §6
 * fixes `budget = available + escrowed + spent` as three views of one number,
 * each summed on demand. This module is the `available` view; `escrowed` is
 * `EscrowLedgerService`'s.
 *
 * **Why this exists rather than the arithmetic that was on the campaign page.**
 * That page computed `budget - sumCartTotal(...)`, and confirmation does not
 * delete `campaign_item` rows — `confirm-campaign.ts` copies them into deals and
 * leaves them in place, because they are the brand's record of what was carted
 * and at what price. So a declined deal moved that figure by exactly nothing,
 * and AC-018's "the creator's cost is released back to the brand's available
 * budget" was false. The cart stops being the authority the moment offers exist;
 * from then on the deals are.
 *
 * **Why a decline needs no ledger call, and no budget write at all.** A deal is
 * only declinable from `pending`, and money first moves at funding (KAN-43), so
 * there is no `hold` entry to reverse — `refundDeal` would refuse it, and
 * `REFUNDABLE_FROM` says why. The status change *is* the release: a declined
 * deal drops out of `COMMITS_BUDGET` and `available` rises by exactly its
 * `total_price`. Nothing is kept in step, so nothing can fall out of step. The
 * tech spec §4.4's "budget-release on decline/expire call the Escrow ledger" is
 * loose on this point; the spike is the authority and this is what it says.
 */

/**
 * Does a deal in this status still lay claim to the campaign's budget?
 *
 * `satisfies Record<DealStatus, boolean>` rather than a list of the exclusions,
 * for the reason `PRECONDITION_FAILED_CODE` in `lib/deals/state-machine.ts`
 * gives: a tenth status added to the union becomes a compile error here, where
 * someone has to decide which side of the money it falls on. A list of
 * exclusions would silently default it to "committed" — the side that
 * understates what a brand can spend, which is the failure nobody reports.
 *
 * The three `false` entries are the three ways a cost stops being claimed:
 *
 * - `declined`, `expired` — the money never entered escrow. AC-018's two
 *   branches, and the whole reason this map exists.
 * - `refunded` — it entered and came back (the dispute path, KAN-51).
 *
 * `completed` is `true`, which reads oddly for a finished deal: that money is
 * gone, not available. That is the point — it moved from `escrowed` to `spent`,
 * and both are "not available". A brand cannot re-spend what it already paid.
 */
export const COMMITS_BUDGET = {
  pending: true,
  accepted: true,
  funded: true,
  delivered: true,
  revision_requested: true,
  completed: true,
  declined: false,
  expired: false,
  refunded: false,
} satisfies Record<DealStatus, boolean>;

/**
 * The statuses that count against the budget, derived from the map above rather
 * than typed out a second time. An `IN (...)` list and the map cannot disagree,
 * because there is only one of them.
 */
export const COMMITTING_STATUSES: DealStatus[] = (
  Object.keys(COMMITS_BUDGET) as DealStatus[]
).filter((status) => COMMITS_BUDGET[status]);

/**
 * What a campaign's live deals commit, in integer santim (invariant 4).
 *
 * Un-guarded and `client`-parameterised, matching `sumCartTotal`: a caller
 * already inside a transaction passes its `tx`, because a query issued on the
 * global `db` while that transaction holds a row lock waits on a connection the
 * pool has already lent out — the deadlock `remove-from-cart.ts` documents. The
 * guarded entry point is `readCampaignBudget` below.
 */
export async function sumCommittedByDeals(
  campaignId: string,
  client: typeof db | Tx = db
): Promise<number> {
  const [row] = await client
    .select({
      total: sql<number>`coalesce(sum(${deal.totalPrice}), 0)::int`,
    })
    .from(deal)
    .where(
      and(
        eq(deal.campaignId, campaignId),
        inArray(deal.status, COMMITTING_STATUSES)
      )
    );

  return row?.total ?? 0;
}

/**
 * What the brand has committed and what is left to spend.
 *
 * `committed` is returned alongside `available` rather than only the difference,
 * so a screen can show the breakdown without re-deriving either half — KAN-49's
 * brand campaign dashboard is the caller that will want it.
 */
export interface CampaignBudget {
  /** `campaign.budget`, the ceiling. Integer santim. */
  budget: number;
  /** Claimed by cart rows (draft) or by live deals (after confirmation). */
  committed: number;
  /** `budget - committed`. What AC-014's ceiling is measured against. */
  available: number;
}

/** Seam for tests, matching the shape the rest of `lib/` uses. */
export interface CampaignBudgetDeps {
  requireOwnership: (campaignId: string) => Promise<unknown>;
  getCampaign: (
    campaignId: string
  ) => Promise<{ budget: number; status: CampaignStatus } | null>;
  sumCart: (campaignId: string) => Promise<number>;
  sumDeals: (campaignId: string) => Promise<number>;
}

const defaultDeps: CampaignBudgetDeps = {
  // Both layers of NFR-005 in one call: the role gate, then `guard` resolving
  // `campaign.brand_id` itself and throwing for a brand that does not own this
  // campaign. `requireOwnership` takes the id rather than closing over it
  // because these defaults are one module-level object shared by every call.
  requireOwnership: (campaignId) =>
    guard({
      roles: ['brand'],
      resource: { kind: 'campaign', id: campaignId },
    }),
  getCampaign: async (campaignId) => {
    const [row] = await db
      .select({ budget: campaign.budget, status: campaign.status })
      .from(campaign)
      .where(eq(campaign.id, campaignId))
      .limit(1);

    return row ?? null;
  },
  sumCart: (campaignId) => sumCartTotal(campaignId),
  sumDeals: (campaignId) => sumCommittedByDeals(campaignId),
};

/**
 * A campaign's budget position, or `null` if there is no such campaign.
 *
 * Gated **inside the module**, before anything is read, following
 * `readDiscovery` and `readCreatorDetail`: a read protected only by its callers
 * is protected as well as its least careful caller. The `deps` seam is what lets
 * a test prove no query ran for a denied caller, rather than only that it threw.
 *
 * **The two sources are never summed together.** Before confirmation there are
 * no deals and the cart is the only record of intent; after it, every cart row
 * has a deal, and adding both would double-count every creator. So the
 * campaign's own status picks one — and `draft` is the only status on the cart
 * side, which is also exactly the window in which `addToCart` and
 * `confirmCampaign` enforce AC-014, so their ceiling and this figure agree by
 * construction.
 */
export async function readCampaignBudget(
  campaignId: string,
  deps: CampaignBudgetDeps = defaultDeps
): Promise<CampaignBudget | null> {
  // Shape-checked before it reaches a `uuid` column, which Postgres answers with
  // `22P02` — a 500 for what is really a mistyped link (F16). Ahead of the guard
  // only because `guard` would itself run that query; a malformed id belongs to
  // nobody, so refusing it early tells a denied caller nothing.
  if (!UUID_REGEX.test(campaignId)) return null;

  await deps.requireOwnership(campaignId);

  const row = await deps.getCampaign(campaignId);
  if (!row) return null;

  const committed =
    row.status === 'draft'
      ? await deps.sumCart(campaignId)
      : await deps.sumDeals(campaignId);

  return {
    budget: row.budget,
    committed,
    available: row.budget - committed,
  };
}
