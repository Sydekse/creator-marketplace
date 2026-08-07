import { eq } from 'drizzle-orm';
import { creatorProfile, pricingTier } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { tierNumbers, toBasisPoints } from '@/lib/creators/tier-rules';
import type { TierableProfile } from '@/lib/creators/tier-rules';

/**
 * Tier assignment service (KAN-23, AC-004/AC-006, Tech Spec §5).
 *
 * A creator is bookable only when verified *and* tiered
 * (`lib/creators/queries.ts`). Verification is a human decision; this module is
 * the other half — given a creator's recorded follower count and engagement
 * rate, pick exactly one `pricing_tier` row and record it.
 *
 * Split into a pure `selectTier` and a transactional `assignTier` on purpose.
 * The rule ("highest tier whose thresholds are both met") is the part worth
 * testing exhaustively, and it needs no database to test — while the write is
 * three lines that must ride inside somebody else's transaction.
 *
 * Nothing here knows what a Micro tier is. Thresholds and prices come from the
 * rows, which come from the seed, which comes from `lib/config/pricing.ts`
 * (invariant 8) — so answering Q2 never means editing this file.
 *
 * The half of the rule that reads the *creator's* numbers rather than the tier
 * rows lives in `lib/creators/tier-rules.ts` and is re-exported below. That file
 * imports nothing, so a client component can call it without pulling drizzle and
 * the schema into the browser bundle (KAN-24).
 */

/** A `pricing_tier` row, as much of it as the rule needs. */
export interface TierCandidate {
  id: string;
  name: string;
  pricePerVideo: number;
  minFollowers: number;
  /** Nullable in the schema: a tier may legitimately have no engagement floor. */
  minEngagement: string | null;
  active: boolean;
}

/**
 * Re-exported so this module keeps the surface its callers already import, while
 * the definitions live in a leaf module a client component can also reach. See
 * `lib/creators/tier-rules.ts` for why the split exists.
 */
export type {
  TierableProfile,
  MissingTierField,
} from '@/lib/creators/tier-rules';
export { missingTierFields } from '@/lib/creators/tier-rules';

/**
 * Why no tier was assigned. Both leave the creator non-bookable (AC-006) but
 * they are different problems: `missing_data` is a creator who has not supplied
 * the numbers, `no_matching_tier` is a creator who has and falls below every
 * band. An admin can act on the first and can only escalate the second.
 */
export type TierSkipReason = 'missing_data' | 'no_matching_tier';

export type TierOutcome =
  | { assigned: true; tierId: string; tierName: string; pricePerVideo: number }
  | { assigned: false; reason: TierSkipReason };

/**
 * Ranks two eligible tiers, highest first.
 *
 * `minFollowers` is the ladder's real ordering. The price and name tiebreaks
 * exist so that two bands seeded with the same follower floor resolve the same
 * way on every run — otherwise the "exactly one tier" guarantee would quietly
 * depend on the order Postgres happened to return rows in.
 */
function byHighestFirst(a: TierCandidate, b: TierCandidate): number {
  if (a.minFollowers !== b.minFollowers) return b.minFollowers - a.minFollowers;
  if (a.pricePerVideo !== b.pricePerVideo) {
    return b.pricePerVideo - a.pricePerVideo;
  }
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

/**
 * The tier a creator qualifies for, or why they qualify for none.
 *
 * Pure and total: same inputs, same answer, no exceptions. That is what makes
 * re-running assignment idempotent (AC-3) — there is no state to accumulate and
 * no order-dependence, so the second run selects the same tier as the first.
 */
export function selectTier(
  tiers: readonly TierCandidate[],
  profile: TierableProfile
): TierOutcome {
  // Missing data is checked before anything else so that a creator with no
  // numbers can never be matched by a tier whose thresholds happen to be zero or
  // null. `tierNumbers` is the whole of that judgement, shared with
  // `missingTierFields` so the screens that name the missing field cannot
  // disagree with the rule that rejected it.
  const { followerCount, engagementBp } = tierNumbers(profile);
  if (followerCount === null || engagementBp === null) {
    return { assigned: false, reason: 'missing_data' };
  }

  const eligible = tiers.filter((tier) => {
    if (!tier.active) return false;
    // Thresholds are inclusive — a creator on exactly the floor is in the band.
    if (followerCount < tier.minFollowers) return false;
    if (tier.minEngagement === null) return true;
    const floorBp = toBasisPoints(tier.minEngagement);
    // An unparseable threshold denies rather than admits: a tier nobody can be
    // priced into is a visible problem, a tier everybody matches is not.
    if (floorBp === null) return false;
    return engagementBp >= floorBp;
  });

  if (eligible.length === 0) {
    return { assigned: false, reason: 'no_matching_tier' };
  }

  const [best] = [...eligible].sort(byHighestFirst);

  return {
    assigned: true,
    tierId: best.id,
    tierName: best.name,
    pricePerVideo: best.pricePerVideo,
  };
}

/** Seam for tests, matching the shape the rest of `lib/` uses. */
export interface AssignTierDeps {
  loadTiers: (tx: Tx) => Promise<TierCandidate[]>;
}

/**
 * Every tier, active or not — the `active` filter lives in `selectTier` so that
 * eligibility has exactly one definition rather than one in SQL and one in
 * TypeScript that can drift apart.
 */
async function loadTiers(tx: Tx): Promise<TierCandidate[]> {
  return tx
    .select({
      id: pricingTier.id,
      name: pricingTier.name,
      pricePerVideo: pricingTier.pricePerVideo,
      minFollowers: pricingTier.minFollowers,
      minEngagement: pricingTier.minEngagement,
      active: pricingTier.active,
    })
    .from(pricingTier);
}

const defaultDeps: AssignTierDeps = { loadTiers };

/**
 * Assigns the creator's tier inside the caller's transaction.
 *
 * Takes the profile's numbers rather than re-reading the row: the only caller
 * that assigns on activation has already selected it `FOR UPDATE`, and a second
 * read would be both wasted and a chance to act on a different snapshot.
 *
 * No match leaves `tier_id` null and returns the reason — this never throws for
 * an un-tierable creator, because "we verified them and they do not fit a band"
 * is a real state the marketplace has to hold, not an error. Surfacing it is the
 * caller's job (the verify response and `/admin/tiers`).
 *
 * Does not check status. Callers own that: `decideVerification` calls this on
 * the branch that just set `verified`, and the retry route checks explicitly.
 */
export async function assignTier(
  tx: Tx,
  profile: TierableProfile & { id: string },
  deps: AssignTierDeps = defaultDeps
): Promise<TierOutcome> {
  const tiers = await deps.loadTiers(tx);
  const outcome = selectTier(tiers, profile);

  if (!outcome.assigned) return outcome;

  await tx
    .update(creatorProfile)
    .set({ tierId: outcome.tierId })
    .where(eq(creatorProfile.id, profile.id));

  return outcome;
}

/**
 * The outcome as it appears in a response body — snake_case, matching the
 * Tech Spec §4.6 style the verify route already answers in.
 */
export function tierOutcomeToResponse(outcome: TierOutcome | null) {
  if (outcome === null) return null;
  return outcome.assigned
    ? {
        assigned: true as const,
        id: outcome.tierId,
        name: outcome.tierName,
        price_per_video: outcome.pricePerVideo,
      }
    : { assigned: false as const, reason: outcome.reason };
}

export type TierResponse = ReturnType<typeof tierOutcomeToResponse>;
