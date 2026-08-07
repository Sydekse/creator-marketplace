/**
 * The part of tier assignment that reads a creator's own numbers (KAN-23/KAN-24).
 *
 * A leaf module: it imports nothing, so anything may import it — including client
 * components. That is the whole reason it exists separately from
 * `lib/creators/tier-assignment.ts`, which imports drizzle and `@/db/schema` and
 * would drag the ORM into the browser bundle. Same idiom as `lib/audit/limits.ts`.
 *
 * The tier *ladder* — thresholds, prices, which band wins — deliberately stays in
 * `tier-assignment.ts`, where `__tests__/tier-assignment.test.ts` reads the source
 * to prove no band is hardcoded. Splitting the ladder out would leave that guard
 * reading a file the rule no longer lives in.
 */

/** The half of `creator_profile` the rule reads. */
export interface TierableProfile {
  followerCount: number | null;
  engagementRate: string | null;
}

/**
 * A percentage string → integer basis points. Returns null for anything that is
 * not a finite number.
 *
 * Drizzle maps `numeric` to string, and comparing those strings directly is the
 * bug this exists to prevent: `'3.50' > '10.00'` is true, so a 3.5% creator
 * would clear a 10% floor. Comparing in integer basis points also keeps floats
 * out of the comparison entirely, the same reasoning `lib/config/pricing.ts`
 * gives for the commission rate.
 */
export function toBasisPoints(rate: string): number | null {
  const trimmed = rate.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

/**
 * Both of a creator's numbers in the form the rule compares them in, with either
 * replaced by null when the stored value is not one the rule can act on.
 *
 * "Not usable" is wider than null: a negative follower count or an unparseable
 * rate is not data either, and `selectTier` has always treated those identically
 * to a missing value. Zero is *not* in that set — zero followers is a claim, and
 * a creator who makes it falls below every band rather than being asked to supply
 * the number again.
 *
 * Exists so the eligibility check and the "what is missing" answer are the same
 * judgement rather than two that can drift apart.
 */
export function tierNumbers(profile: TierableProfile): {
  followerCount: number | null;
  engagementBp: number | null;
} {
  const { followerCount, engagementRate } = profile;

  const usableFollowers =
    followerCount !== null &&
    Number.isFinite(followerCount) &&
    followerCount >= 0
      ? followerCount
      : null;

  const bp = engagementRate === null ? null : toBasisPoints(engagementRate);

  return {
    followerCount: usableFollowers,
    engagementBp: bp !== null && bp >= 0 ? bp : null,
  };
}

/**
 * Which of a creator's own numbers is keeping them un-priceable.
 *
 * `selectTier` has always made this judgement; it just collapsed it to a single
 * `missing_data` reason. KAN-24's AC-4 needs the creator told *which* field is
 * missing, and `components/admin/awaiting-tier-list.tsx` needs the same answer
 * for an admin, so it is exported rather than re-derived at each call site — a
 * second hand-written null check is how a screen ends up naming a field the rule
 * is actually happy with.
 *
 * Empty means the rule can act on both numbers. It does *not* mean a tier
 * matched: a creator with complete data below every band gets `[]` here and
 * `no_matching_tier` from `selectTier`, which is a different thing to tell them.
 */
export type MissingTierField = 'followerCount' | 'engagementRate';

export function missingTierFields(
  profile: TierableProfile
): MissingTierField[] {
  const { followerCount, engagementBp } = tierNumbers(profile);
  const missing: MissingTierField[] = [];
  if (followerCount === null) missing.push('followerCount');
  if (engagementBp === null) missing.push('engagementRate');
  return missing;
}

/**
 * The field's name as a creator or an admin reads it.
 *
 * Here rather than in either screen so the creator dashboard and the admin list
 * name the same field the same way — one of them saying "engagement rate" while
 * the other says "engagement" is a small thing that makes two screens look like
 * they are describing two problems.
 */
const FIELD_LABELS: Record<MissingTierField, string> = {
  followerCount: 'follower count',
  engagementRate: 'engagement rate',
};

export function missingFieldLabel(field: MissingTierField): string {
  return FIELD_LABELS[field];
}
