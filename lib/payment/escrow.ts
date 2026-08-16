import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { ledgerEntry } from '@/db/schema';
import type { Tx } from '@/lib/authz';

/**
 * Campaign-level reads over `ledger_entry` — the `escrowed` and `spent` views of
 * the spike §6 identity `budget = available + escrowed + spent` (KAN-43, KAN-49).
 *
 * `sumEscrowedByCampaign` answers what is *held*; `sumSettledByCampaign` answers
 * what has *left*, split into the creator's payout and the platform's commission.
 * Both are un-guarded leaves; their guarded, request-scoped counterparts live in
 * `lib/campaigns/`.
 *
 * **Why this is its own module rather than a private method on the service.** It
 * was `EscrowLedgerService.sumBalance`, and it is the number the non-negativity
 * guard (invariant 7) checks before releasing or refunding anything. AC-019 item
 * 6 needs a *screen* to show that same figure, and a screen that summed it its own
 * way could disagree with the number the guard enforces — which would surface as
 * a brand being shown escrow the ledger will not spend. So there is one
 * definition and the service delegates to it: the "extract at the second caller"
 * rule that produced `lib/money.ts` and `lib/dates.ts`.
 *
 * **Why the guarded read is not here.** `lib/campaigns/escrow.ts` holds it,
 * because `guard` reaches `lib/auth.ts` and therefore Better Auth, and this
 * module is imported by `lib/payment/ledger.ts`, which `db/seed.ts` imports. A
 * seed script has no session and must not have to construct an auth instance to
 * run. Same forcing reason as `lib/deals/copy.ts`: a dependency boundary sits
 * between the two callers, so the shared part is a leaf.
 *
 * **Why not `lib/campaigns/budget.ts`.** That module is the `available` view and
 * derives its figure from deal *statuses*; this is derived from ledger *entries*.
 * `campaign-budget.test.ts` asserts that module never mentions the ledger, so the
 * two questions cannot be quietly merged into one sum that answers neither.
 */

/**
 * Everything currently held for a campaign, in integer santim (invariant 4).
 *
 * Un-guarded and `client`-parameterised, matching `sumCommittedByDeals` and
 * `sumCartTotal`: a caller already inside a transaction passes its `tx`, because
 * a query issued on the global `db` while that transaction holds a row lock waits
 * on a connection the `max: 5` pool has already lent out — the deadlock
 * `remove-from-cart.ts` documents. `readCampaignEscrow` in
 * `lib/campaigns/escrow.ts` is the guarded entry point for request-scoped
 * callers.
 *
 * Re-summed from every entry rather than read off the newest row (spike §5.4).
 * `created_at` defaults to `now()`, which is constant within a transaction, so
 * every entry one `holdForCampaign` writes shares a timestamp and `ORDER BY
 * created_at DESC LIMIT 1` would pick an arbitrary one of them.
 *
 * A campaign with no entries sums to 0, not null — `coalesce` is in the query, so
 * the "nothing held yet" case needs no branch at any call site.
 */
export async function sumEscrowedByCampaign(
  campaignId: string,
  client: typeof db | Tx = db
): Promise<number> {
  const [row] = await client
    .select({
      balance: sql<number>`coalesce(sum(${ledgerEntry.amount}), 0)::int`,
    })
    .from(ledgerEntry)
    .where(eq(ledgerEntry.campaignId, campaignId));

  // SUM() is bigint, which node-postgres hands back as a string. `Number` is what
  // keeps invariant 4's integers integers rather than letting a string reach
  // `formatEtb` or the arithmetic in `holdForCampaign`.
  return Number(row?.balance ?? 0);
}

/**
 * What has *left* escrow for a campaign, split by where it went (KAN-49).
 *
 * The `spent` half of the spike §6 identity `budget = available + escrowed +
 * spent`, which nothing read until the campaign dashboard needed it. Both
 * figures are integer santim (invariant 4), and both are non-negative.
 *
 * **Summed from the ledger, never recomputed.** AC-026 asks the dashboard to show
 * what was paid out and what commission was taken, and the honest source is the
 * rows the payout transaction actually wrote — `computeSplit` is deliberately not
 * imported here. Re-deriving `total × rate` on the read side would be a second
 * implementation of the arithmetic that pays people, and the two would disagree
 * the first time a rate changed or a rounding rule moved. `lib/creators/dashboard.ts`
 * makes the same argument for the creator's side of the same numbers.
 *
 * **Both sums negate.** `release_payout` and `commission` are written negative —
 * positive is into escrow, negative is out (`db/schema.ts`) — so a raw `SUM`
 * returns a negative and would render as `−12,750.00 ETB` paid out. The `CASE
 * WHEN … THEN -amount` shape is `earningsQuery`'s, for the same reason.
 *
 * **One query, two aggregates.** They come off the same index scan of the same
 * rows, so two round trips would read `ledger_entry_campaign_created_idx` twice to
 * answer one question (NFR-001).
 *
 * `::int` is not optional — see the note above. A campaign with no settled deals
 * sums to 0 rather than null, so no call site needs a branch.
 */
export async function sumSettledByCampaign(
  campaignId: string,
  client: typeof db | Tx = db
): Promise<{ paidOut: number; commission: number }> {
  const [row] = await client
    .select({
      paidOut: sql<number>`coalesce(sum(case when ${ledgerEntry.entryType} = 'release_payout' then -${ledgerEntry.amount} else 0 end), 0)::int`,
      commission: sql<number>`coalesce(sum(case when ${ledgerEntry.entryType} = 'commission' then -${ledgerEntry.amount} else 0 end), 0)::int`,
    })
    .from(ledgerEntry)
    .where(eq(ledgerEntry.campaignId, campaignId));

  return {
    paidOut: Number(row?.paidOut ?? 0),
    commission: Number(row?.commission ?? 0),
  };
}
