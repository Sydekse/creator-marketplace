import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { creatorProfile, pricingTier } from '@/db/schema';
import { guard } from '@/lib/authz';
import { clampLimit, clampOffset } from '@/lib/paging';

/**
 * Admin-only read of creators flagged for tier review (phase 3).
 *
 * A stats refresh (button or weekly cron) that selected a *lower* band — or no
 * band at all — for a tiered creator does not touch the tier; it stamps
 * `tier_review_at` and stops. This list is where those stamps become visible:
 * without it the flag is a column nobody reads and "downgrades need a human"
 * quietly becomes "downgrades never happen".
 *
 * The row carries the creator's current tier and current numbers; what it does
 * *not* carry is a stored suggestion. The suggested tier is recomputed pure
 * from the current numbers at render (`selectTier` over `listTierCandidates`),
 * so it can never go stale against a later refresh or a re-seeded ladder.
 *
 * Gate lives inside the query, same as `lib/creators/awaiting-tier.ts` — a
 * read path protected only by its callers is protected as well as the least
 * careful one.
 */

export interface FlaggedReviewFilters {
  limit?: number;
  offset?: number;
}

export interface FlaggedReviewCreator {
  id: string;
  tiktokHandle: string;
  niche: string;
  followerCount: number | null;
  engagementRate: string | null;
  tierReviewAt: Date | null;
  currentTier: { name: string; pricePerVideo: number } | null;
}

export interface FlaggedReviewPage {
  creators: FlaggedReviewCreator[];
  /** True when another page exists — derived from an over-fetch, not a COUNT. */
  hasMore: boolean;
}

/**
 * Verified and flagged. Status is part of the predicate so a creator rejected
 * after being flagged does not linger here asking for a pricing decision that
 * no longer applies to them.
 */
const FLAGGED_FOR_REVIEW = and(
  eq(creatorProfile.status, 'verified'),
  isNotNull(creatorProfile.tierReviewAt)
);

/** Seam for tests, matching the shape `lib/authz` uses. */
export interface FlaggedReviewDeps {
  requireAdmin: () => Promise<unknown>;
  select: (limit: number, offset: number) => Promise<FlaggedReviewCreator[]>;
}

async function selectFlagged(
  limit: number,
  offset: number
): Promise<FlaggedReviewCreator[]> {
  const rows = await db
    .select({
      id: creatorProfile.id,
      tiktokHandle: creatorProfile.tiktokHandle,
      niche: creatorProfile.niche,
      followerCount: creatorProfile.followerCount,
      engagementRate: creatorProfile.engagementRate,
      tierReviewAt: creatorProfile.tierReviewAt,
      tierName: pricingTier.name,
      tierPrice: pricingTier.pricePerVideo,
    })
    .from(creatorProfile)
    // Left join: a flagged creator whose band was since deleted still needs
    // the decision — showing them tier-less beats hiding them.
    .leftJoin(pricingTier, eq(creatorProfile.tierId, pricingTier.id))
    .where(FLAGGED_FOR_REVIEW)
    // Oldest flag first: the creator waiting longest is the one most likely
    // to have been forgotten. `id` is the stable tiebreak.
    .orderBy(creatorProfile.tierReviewAt, creatorProfile.id)
    .limit(limit)
    .offset(offset);

  return rows.map(({ tierName, tierPrice, ...row }) => ({
    ...row,
    currentTier:
      tierName !== null && tierPrice !== null
        ? { name: tierName, pricePerVideo: tierPrice }
        : null,
  }));
}

const defaultDeps: FlaggedReviewDeps = {
  requireAdmin: () => guard({ roles: ['admin'] }),
  select: selectFlagged,
};

/**
 * Lists creators whose refreshed stats suggested a downgrade. Throws
 * `ForbiddenError` for every non-admin, including unauthenticated ones.
 */
export async function readFlaggedForReview(
  filters: FlaggedReviewFilters = {},
  deps: FlaggedReviewDeps = defaultDeps
): Promise<FlaggedReviewPage> {
  await deps.requireAdmin();

  const limit = clampLimit(filters.limit);
  const offset = clampOffset(filters.offset);

  const creators = await deps.select(limit + 1, offset);

  return {
    creators: creators.slice(0, limit),
    hasMore: creators.length > limit,
  };
}
