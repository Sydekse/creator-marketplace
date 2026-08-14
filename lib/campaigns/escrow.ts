import { ForbiddenError, guard } from '@/lib/authz';
import { sumEscrowedByCampaign } from '@/lib/payment/escrow';
import { UUID_REGEX } from '@/lib/validation';

/**
 * What a brand may see about their campaign's escrow (KAN-43, AC-019 item 6:
 * "both parties can see that the campaign is funded and that money is held").
 *
 * The guarded, request-scoped counterpart to `readCampaignBudget` — the same
 * shape for the other half of the spike §6 identity. `budget.ts` answers *what is
 * committed*, from deal statuses; this answers *what is actually held*, from
 * ledger entries. Deliberately two modules and two sums, which is what
 * `campaign-budget.test.ts` is asserting when it refuses any mention of the
 * ledger over there.
 *
 * The sum itself is `lib/payment/escrow.ts`, un-guarded and shared with the
 * ledger service, so the number shown to a brand is the number invariant 7
 * enforces. It cannot live here: `lib/payment/ledger.ts` needs it, and
 * `db/seed.ts` imports the ledger — pulling `guard` (and therefore Better Auth)
 * into a plain seed script.
 */

/** Seam for tests, matching the shape the rest of `lib/campaigns` uses. */
export interface CampaignEscrowDeps {
  requireOwnership: (campaignId: string) => Promise<unknown>;
  sumEscrowed: (campaignId: string) => Promise<number>;
}

const defaultDeps: CampaignEscrowDeps = {
  // Both layers of NFR-005 in one call: the role gate, then `guard` resolving
  // `campaign.brand_id` itself and throwing for a brand that does not own this
  // campaign. Takes the id rather than closing over it, because these defaults
  // are one module-level object shared by every call — the `budget.ts` shape.
  requireOwnership: (campaignId) =>
    guard({
      roles: ['brand'],
      resource: { kind: 'campaign', id: campaignId },
    }),
  sumEscrowed: (campaignId) => sumEscrowedByCampaign(campaignId),
};

/**
 * How much is held in escrow for one campaign, in integer santim (invariant 4).
 *
 * Gated **inside the module**, before it looks at its argument, following
 * `readCampaignBudget` and `readCreatorDetail`: a read protected only by its
 * callers is protected as well as its least careful caller. The `deps` seam is
 * what lets a test prove no query ran for a denied caller, rather than only that
 * it threw.
 *
 * Brand-only, with no creator branch. A creator sees the escrow that concerns
 * them on their own deal — one deal's `total_price`, a figure they already know —
 * and a campaign-wide total would tell them what every other creator on the
 * campaign is being paid, in aggregate.
 *
 * **Why this one throws where `readCampaignBudget` returns `null`.** That one has
 * a genuine miss to report — it reads the campaign row, so "no such campaign" is
 * an answer it can distinguish. This never reads the campaign at all; a sum over
 * an unknown id is `0`, indistinguishable from a real campaign holding nothing.
 * The only place that distinction exists here is the guard, and it already
 * collapses unknown into unowned on purpose (`assertOwnership`, §6.3). So there
 * is nothing left for a `null` to mean, and a nullable return would invite a
 * caller to render `0` for a denial.
 */
export async function readCampaignEscrow(
  campaignId: string,
  deps: CampaignEscrowDeps = defaultDeps
): Promise<number> {
  // Shape-checked before it reaches a `uuid` column, which Postgres answers with
  // `22P02` — a 500 for what is really a mistyped link (F16). `guard` would run
  // that query itself, so this has to be ahead of it, and a malformed id belongs
  // to nobody: the same denial the guard would give, without the round trip.
  if (!UUID_REGEX.test(campaignId)) {
    throw new ForbiddenError('malformed campaign id');
  }

  await deps.requireOwnership(campaignId);

  return deps.sumEscrowed(campaignId);
}
