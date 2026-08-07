import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { creatorProfile, pricingTier } from '@/db/schema';
import type { CreatorStatus } from '@/db/schema';

/**
 * Read paths for `creator_profile`.
 *
 * The reason `BOOKABLE_CREATOR` lives here rather than in the discovery ticket
 * that will use it: KAN-21 has an acceptance criterion that a
 * `pending_verification` creator "does not appear anywhere in brand-facing
 * discovery", and discovery (KAN-28, Wave 6) does not exist yet. The only way
 * to make that criterion true *and* keep it true is to ship the predicate now
 * and have discovery import it, so the rule has exactly one definition instead
 * of being re-derived by hand in a later wave.
 */

/**
 * A creator is bookable only when verified **and** tiered (AC-006).
 *
 * Both halves matter and they fail for different reasons: an unverified creator
 * has not had their handle confirmed by a human (AC-002), and an untiered one
 * has no price for a brand to add to a cart (AC-004). Either alone would let a
 * row through that the campaign cart cannot price.
 *
 * Use this as the `where` clause of every brand-facing creator query. Do not
 * hand-write `eq(creatorProfile.status, 'verified')` at a call site — that is
 * the version that quietly forgets the tier check.
 */
export const BOOKABLE_CREATOR = and(
  eq(creatorProfile.status, 'verified'),
  isNotNull(creatorProfile.tierId)
);

/**
 * The same rule as a pure predicate, for tests and for filtering rows already
 * in memory. Kept beside `BOOKABLE_CREATOR` deliberately: if one changes and
 * the other does not, the test that asserts they agree is the thing that fails.
 */
export function isBookable(row: {
  status: CreatorStatus;
  tierId: string | null;
}): boolean {
  return row.status === 'verified' && row.tierId !== null;
}

/**
 * The signed-in creator's own profile, or null if they have not onboarded yet.
 *
 * Both `/creator` and `/creator/onboarding` branch on this: no row means send
 * them to onboarding, a row means send them to their status page. Returning
 * null rather than throwing is what makes "has not onboarded" an ordinary state
 * rather than an error.
 */
export async function getCreatorProfileByUserId(userId: string) {
  const [row] = await db
    .select()
    .from(creatorProfile)
    .where(eq(creatorProfile.userId, userId))
    .limit(1);

  return row ?? null;
}

export type CreatorProfileRow = NonNullable<
  Awaited<ReturnType<typeof getCreatorProfileByUserId>>
>;

/** The tier row as the creator's own screens need it, or null when untiered. */
export interface CreatorTier {
  id: string;
  name: string;
  /** Integer ETB santim — the gross a brand pays per video (invariant 4). */
  pricePerVideo: number;
}

export interface CreatorProfileWithTier {
  profile: CreatorProfileRow;
  tier: CreatorTier | null;
}

/**
 * The creator's profile together with the tier it points at (KAN-24, AC-005).
 *
 * A sibling of `getCreatorProfileByUserId` rather than a change to it. That one
 * is also what `/creator/onboarding` calls, and onboarding only branches on
 * whether a row exists — making it join would buy that route nothing and cost it
 * a join on every visit.
 *
 * **Left** join, not inner. An untiered creator must still reach their dashboard:
 * an inner join would return no row for exactly the creator AC-4 is about, and
 * `/creator` would bounce them to onboarding as though they had never signed up.
 *
 * Reads `price_per_video` straight off the tier row rather than recomputing
 * anything, which is what lets `lib/creators/pricing.ts` be the only place a
 * price is derived and keeps the creator's number identical to the brand's.
 */
export async function getCreatorProfileWithTier(
  userId: string
): Promise<CreatorProfileWithTier | null> {
  // The tier columns are selected flat rather than as a nested object so that
  // drizzle's per-column nullability from the left join is what TypeScript sees.
  // Nesting them would type the group as one possibly-null object and force a
  // cast on each field, which is the kind of cast that outlives the reason for it.
  const [row] = await db
    .select({
      profile: creatorProfile,
      tierId: pricingTier.id,
      tierName: pricingTier.name,
      tierPricePerVideo: pricingTier.pricePerVideo,
    })
    .from(creatorProfile)
    .leftJoin(pricingTier, eq(creatorProfile.tierId, pricingTier.id))
    .where(eq(creatorProfile.userId, userId))
    .limit(1);

  if (!row) return null;

  // Collapsed to one nullable object so callers branch on a single thing rather
  // than each screen picking a different field to null-check. All three are
  // checked, not just the id: a `tier_id` pointing at a row that has since been
  // deleted is the case a single-field check would turn into a tier named
  // `undefined` on the creator's dashboard.
  const tier =
    row.tierId === null ||
    row.tierName === null ||
    row.tierPricePerVideo === null
      ? null
      : {
          id: row.tierId,
          name: row.tierName,
          pricePerVideo: row.tierPricePerVideo,
        };

  return { profile: row.profile, tier };
}
