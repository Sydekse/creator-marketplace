import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaign, deal, ledgerEntry } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import { guard } from '@/lib/authz';
import { groupDeals } from '@/lib/deals/groups';
import type { DealGroup } from '@/lib/deals/groups';

/**
 * Everything the creator dashboard reads (KAN-25, US-001, AC-2 – AC-6).
 *
 * Two properties are structural here rather than observed, and both are the
 * reason this module exists instead of the queries living in the page.
 *
 * **AC-6, ownership.** `readCreatorDashboard` takes no creator id. The gate runs
 * inside the module and `guard` hands back the caller's own `creatorProfileId`
 * (`lib/authz.ts`), which is the only thing any `where` is built from. There is
 * no argument a caller could pass to read somebody else's deals, which is a
 * stronger guarantee than checking an argument against the session — the check
 * cannot be forgotten because there is nothing to check.
 *
 * Note the two hops: `deal.creator_id` references `creator_profile.id`, **not**
 * `user.id`. Filtering on the session user's id would match no rows and read on
 * screen as "you have no deals", which is the quiet version of this bug.
 *
 * **AC-4, the ledger is the source.** Neither earnings figure is computed. The
 * ledger already applied the commission split when it wrote the rows, so both
 * numbers fall out of summing entries — `computeSplit` is not imported here and
 * must not be. See `earningsQuery` for why the sums say what they say.
 */

/** Both figures are integer ETB santim (invariant 4). */
export interface CreatorEarnings {
  /** Released to this creator to date, net of commission. Never negative. */
  paidOut: number;
  /** Still held against this creator's deals. Zero once every deal settles. */
  inEscrow: number;
}

export interface CreatorDealRow {
  id: string;
  status: DealStatus;
  campaignName: string;
  videoCount: number;
  /**
   * `unit_price × video_count`, snapshotted onto the deal at offer time — the
   * gross the brand pays, not the creator's net. Displayed as the deal's value
   * and never turned into a payout estimate; see the note on `CreatorDashboard`.
   */
  totalPrice: number;
  offerExpiresAt: Date | null;
}

export interface CreatorDealGroup {
  group: DealGroup;
  deals: CreatorDealRow[];
  count: number;
}

export interface CreatorDashboard {
  earnings: CreatorEarnings;
  /** All five groups, always, in `DEAL_GROUPS` order — empty ones included. */
  groups: CreatorDealGroup[];
  /** True when this creator has no deals at all, in any group (AC-5). */
  isEmpty: boolean;
}

/**
 * The two earnings figures, as one query over the ledger.
 *
 * Exported so a test can read the emitted SQL: AC-4 is a claim about *which
 * rows are summed*, and that is checkable here without a database.
 *
 * The sign convention is `lib/payment/ledger.ts`'s: `hold` is `+total_price`,
 * `release_payout` is `−payout`, `commission` is `−commission`, `refund` is
 * `−total_price`. Payout is derived by subtraction (KAN-40 spike §3.3), so per
 * deal `hold + release_payout + commission === 0` exactly, and `hold + refund
 * === 0`. Which gives both figures for free:
 *
 * - **paidOut** negates the `release_payout` rows. It is net of commission *by
 *   construction* — the split was applied when the row was written, and the
 *   `commission` row is a separate entry this sum never touches. Recomputing
 *   `total × rate` here would be a second implementation of the arithmetic that
 *   pays people, and the two would drift on the first rounding disagreement.
 * - **inEscrow** sums every entry. It is positive exactly while money is held
 *   and returns to zero the moment a deal is released or refunded, because the
 *   entries were written to cancel.
 *
 * `::int` is not optional. `SUM()` returns bigint, which node-postgres hands
 * back as a **string** — without the cast `paidOut` is a string that
 * concatenates instead of adding. `sumBalance` in `lib/payment/ledger.ts`
 * records the same trap.
 *
 * The join is inner. `ledger_entry.deal_id` is nullable for campaign-level
 * funding, and those rows are not attributable to any one creator, so dropping
 * them is the correct reading rather than an omission.
 */
export function earningsQuery(creatorProfileId: string) {
  return db
    .select({
      paidOut: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntry.entryType} = 'release_payout' THEN -${ledgerEntry.amount} ELSE 0 END), 0)::int`,
      inEscrow: sql<number>`COALESCE(SUM(${ledgerEntry.amount}), 0)::int`,
    })
    .from(ledgerEntry)
    .innerJoin(deal, eq(ledgerEntry.dealId, deal.id))
    .where(eq(deal.creatorId, creatorProfileId));
}

/**
 * Every deal for one creator, newest first, with the campaign it belongs to.
 *
 * One query for all five groups rather than five queries: the grouping is a
 * partition of the same rows, so five round trips would read the same index
 * five times to produce the same set (AC-7, NFR-001). Served by
 * `deal_creator_status_idx`.
 *
 * Selects `total_price` and not a payout. The dashboard's payout figures come
 * from the ledger; putting a computed per-row estimate beside them is exactly
 * the drift AC-4 forbids, and `lib/creators/pricing.ts` already records why an
 * estimate must not be dressed up as a promise.
 */
export function dealsQuery(creatorProfileId: string) {
  return db
    .select({
      id: deal.id,
      status: deal.status,
      campaignName: campaign.name,
      videoCount: deal.videoCount,
      totalPrice: deal.totalPrice,
      offerExpiresAt: deal.offerExpiresAt,
    })
    .from(deal)
    .innerJoin(campaign, eq(deal.campaignId, campaign.id))
    .where(eq(deal.creatorId, creatorProfileId))
    .orderBy(desc(deal.createdAt));
}

/**
 * Partitions rows into all five groups, in `DEAL_GROUPS` order.
 *
 * Re-exported rather than defined here since KAN-39: the deal inbox partitions
 * the same nine statuses, so this arrived at its second caller and moved to
 * `lib/deals/groups.ts` beside the mapping it is built on. Kept exported from
 * this module because it is part of the dashboard's surface and its callers
 * have no reason to learn where the implementation went.
 */
export { groupDeals };

/** Seam for tests, matching the shape the rest of `lib/` uses. */
export interface CreatorDashboardDeps {
  requireCreator: () => Promise<{ creatorProfileId: string | null }>;
  selectEarnings: (creatorProfileId: string) => Promise<CreatorEarnings>;
  selectDeals: (creatorProfileId: string) => Promise<CreatorDealRow[]>;
}

async function selectEarnings(
  creatorProfileId: string
): Promise<CreatorEarnings> {
  const [row] = await earningsQuery(creatorProfileId);

  // Belt and braces on the bigint-as-string trap above: the cast makes these
  // numbers, and `Number` keeps them numbers if the cast is ever edited away.
  return {
    paidOut: Number(row?.paidOut ?? 0),
    inEscrow: Number(row?.inEscrow ?? 0),
  };
}

async function selectDeals(
  creatorProfileId: string
): Promise<CreatorDealRow[]> {
  return dealsQuery(creatorProfileId);
}

const defaultDeps: CreatorDashboardDeps = {
  requireCreator: () => guard({ roles: ['creator'] }),
  selectEarnings,
  selectDeals,
};

/**
 * The creator's own dashboard data. Throws `ForbiddenError` for every non-
 * creator caller, including unauthenticated ones — `guard` fails closed.
 *
 * Returns `null` when the caller is a creator with no profile row yet. That is
 * the pre-onboarding state, and it is the page's cue to redirect to the form
 * rather than render an empty dashboard — the same thing `/creator` already
 * does when `getCreatorProfileWithTier` misses.
 *
 * The two reads are issued together. They touch different tables and neither
 * feeds the other, so awaiting them in sequence would add a round trip to a
 * page with a 3-second budget (AC-7).
 */
export async function readCreatorDashboard(
  deps: CreatorDashboardDeps = defaultDeps
): Promise<CreatorDashboard | null> {
  const { creatorProfileId } = await deps.requireCreator();
  if (!creatorProfileId) return null;

  const [earnings, rows] = await Promise.all([
    deps.selectEarnings(creatorProfileId),
    deps.selectDeals(creatorProfileId),
  ]);

  return {
    earnings,
    groups: groupDeals(rows),
    isEmpty: rows.length === 0,
  };
}

/**
 * Dashboard copy, held here for the reason `NO_MATCHES_TITLE` is held beside
 * discovery's query: a string that exists in exactly one place cannot be
 * paraphrased apart from itself by a later edit to a page.
 *
 * AC-5 asks for a useful empty state rather than a blank page, and "no offers
 * yet" is the wrong sentence for a creator who is not bookable — they are not
 * waiting on a brand, they are waiting on verification or a tier. So there are
 * two, and the page picks by whether the creator can actually be booked.
 */
export const EARNINGS_PAID_OUT_LABEL = 'Paid out to date';
export const EARNINGS_IN_ESCROW_LABEL = 'Held in escrow';
export const EARNINGS_NET_NOTE =
  'Payouts are shown net of the commission agreed on each deal.';

export const NO_DEALS_TITLE = 'No deals yet.';
export const NO_DEALS_DESCRIPTION =
  'When a brand adds you to a campaign, their offer appears here for you to accept or decline.';

export const NOT_BOOKABLE_TITLE = 'No deals yet.';
export const NOT_BOOKABLE_DESCRIPTION =
  'Brands can send you offers once your profile is verified and priced. Nothing is needed from you in the meantime.';
