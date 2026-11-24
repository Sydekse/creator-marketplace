import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { brandProfile } from '@/db/schema';

/**
 * Read paths for `brand_profile`.
 *
 * There is no brand equivalent of `BOOKABLE_CREATOR`: a brand profile has no
 * status, no tier, and nothing to be eligible for. The only question anyone asks
 * of this table is "does this account have one yet", which is the gate behind
 * every brand route (KAN-27 AC-1, AC-4).
 */

/**
 * The signed-in brand's own profile, or null if they have not onboarded yet.
 *
 * Null rather than a throw, for the same reason as the creator side: "has not
 * onboarded" is an ordinary state on the way in, not an error. The layout at
 * `app/(brand)/(onboarded)/layout.tsx` turns it into a redirect.
 */
// `cache()` dedupes the read per request — the onboarded layout and pages both
// ask for it. In route handlers (outside a React render) the cache is a no-op
// and the call falls through harmlessly.
export const getBrandProfileByUserId = cache(async (userId: string) => {
  const [row] = await db
    .select()
    .from(brandProfile)
    .where(eq(brandProfile.userId, userId))
    .limit(1);

  return row ?? null;
});

export type BrandProfileRow = NonNullable<
  Awaited<ReturnType<typeof getBrandProfileByUserId>>
>;
