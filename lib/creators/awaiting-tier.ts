import { and, count, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { creatorProfile } from '@/db/schema';
import { guard } from '@/lib/authz';
import { clampLimit, clampOffset } from '@/lib/paging';

/**
 * Admin-only read of verified-but-untiered creators (KAN-23, AC-5).
 *
 * The acceptance criterion is that a creator who matched no tier is "surfaced to
 * the admin rather than failing silently". The verify response says so once, at
 * the moment of approval — but the admin who needs to act on it may not be the
 * admin who saw that toast, and there is no other screen on which such a creator
 * appears at all: they are past the verification queue and excluded from
 * discovery. Without this list they are invisible.
 *
 * `verified AND tier_id IS NULL` is the exact complement of `BOOKABLE_CREATOR`
 * within the verified set, which is why the two belong to the same rule: every
 * verified creator is on one list or the other.
 *
 * Gate lives inside the query for the same reason it does in
 * `lib/creators/verification-queue.ts` — a read path protected only by its
 * callers is protected as well as the least careful one.
 */

export interface AwaitingTierFilters {
  limit?: number;
  offset?: number;
}

export interface AwaitingTierCreator {
  id: string;
  tiktokHandle: string;
  niche: string;
  followerCount: number | null;
  engagementRate: string | null;
  verifiedAt: Date | null;
}

export interface AwaitingTierPage {
  creators: AwaitingTierCreator[];
  /** True when another page exists — derived from an over-fetch, not a COUNT. */
  hasMore: boolean;
}

/** Verified, and with no tier — the pair, never one half of it. */
const AWAITING_TIER = and(
  eq(creatorProfile.status, 'verified'),
  isNull(creatorProfile.tierId)
);

/** Seam for tests, matching the shape `lib/authz` uses. */
export interface AwaitingTierDeps {
  requireAdmin: () => Promise<unknown>;
  select: (limit: number, offset: number) => Promise<AwaitingTierCreator[]>;
  count: () => Promise<number>;
}

async function selectCreators(
  limit: number,
  offset: number
): Promise<AwaitingTierCreator[]> {
  return (
    db
      .select({
        id: creatorProfile.id,
        tiktokHandle: creatorProfile.tiktokHandle,
        niche: creatorProfile.niche,
        followerCount: creatorProfile.followerCount,
        engagementRate: creatorProfile.engagementRate,
        verifiedAt: creatorProfile.verifiedAt,
      })
      .from(creatorProfile)
      .where(AWAITING_TIER)
      // Oldest verification first: a creator who has been stuck longest is the
      // one most likely to have been forgotten. `id` is the stable tiebreak, as
      // in the verification queue.
      .orderBy(creatorProfile.verifiedAt, creatorProfile.id)
      .limit(limit)
      .offset(offset)
  );
}

async function countCreators(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(creatorProfile)
    .where(AWAITING_TIER);
  return row?.value ?? 0;
}

const defaultDeps: AwaitingTierDeps = {
  requireAdmin: () => guard({ roles: ['admin'] }),
  select: selectCreators,
  count: countCreators,
};

/**
 * Lists creators who cleared verification but hold no tier. Throws
 * `ForbiddenError` for every non-admin, including unauthenticated ones.
 */
export async function readAwaitingTier(
  filters: AwaitingTierFilters = {},
  deps: AwaitingTierDeps = defaultDeps
): Promise<AwaitingTierPage> {
  await deps.requireAdmin();

  const limit = clampLimit(filters.limit);
  const offset = clampOffset(filters.offset);

  const creators = await deps.select(limit + 1, offset);

  return {
    creators: creators.slice(0, limit),
    hasMore: creators.length > limit,
  };
}

/**
 * How many creators are stuck, for the admin console badge.
 *
 * A separate COUNT rather than a number derived from `readAwaitingTier`: the
 * console shows the figure without listing anybody, and paging a list to find
 * out how long it is would be the more expensive of the two.
 */
export async function countAwaitingTier(
  deps: AwaitingTierDeps = defaultDeps
): Promise<number> {
  await deps.requireAdmin();
  return deps.count();
}
