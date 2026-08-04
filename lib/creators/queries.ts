import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { creatorProfile } from '@/db/schema';
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
