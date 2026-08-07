import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { creatorProfile } from '@/db/schema';
import { guard } from '@/lib/authz';

/**
 * Admin-only read of the creator verification queue (KAN-22).
 *
 * The gate is inside the query rather than only at call sites. A page and a
 * route handler are two callers today and more later, and a read path whose
 * protection lives in its callers is protected exactly as well as the least
 * careful one. Putting it here means there is no way to query pending creators
 * from application code without passing the admin check first.
 *
 * Note this is NOT a REST endpoint — Tech Spec §4.6 defines only the POST
 * verify route. The admin page calls this function directly server-side (Tech
 * Spec §5, §1.2 client-side rendering constraints).
 */

export interface QueueFilters {
  limit?: number;
  offset?: number;
}

export interface QueueCreator {
  id: string;
  tiktokHandle: string;
  niche: string;
  followerCount: number | null;
  engagementRate: string | null;
  createdAt: Date;
}

export interface QueuePage {
  creators: QueueCreator[];
  /** True when another page exists — derived from an over-fetch, not a COUNT. */
  hasMore: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** Rows per page in the admin UI. */
export const PAGE_SIZE = DEFAULT_LIMIT;

/**
 * The `?page=` value, normalised.
 *
 * Everything unusable — absent, zero, negative, `abc`, `Infinity`, or the array
 * Next hands back when the key appears twice — collapses to page 1 rather than
 * erroring. A bad page number in a URL is a typo or a stale bookmark, and the
 * queue has nothing to hide behind an error page.
 */
export function pageFromParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  if (value === undefined || value.trim() === '') return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

/** Where page `n` starts. Page 1 is offset 0. */
export function offsetForPage(page: number): number {
  return (page - 1) * PAGE_SIZE;
}

/** Seam for tests, matching the shape `lib/authz` uses. */
export interface QueueDeps {
  requireAdmin: () => Promise<unknown>;
  select: (limit: number, offset: number) => Promise<QueueCreator[]>;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  const floored = Math.floor(limit);
  if (floored < 1) return 1;
  return Math.min(floored, MAX_LIMIT);
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}

async function selectCreators(
  limit: number,
  offset: number
): Promise<QueueCreator[]> {
  return (
    db
      .select({
        id: creatorProfile.id,
        tiktokHandle: creatorProfile.tiktokHandle,
        niche: creatorProfile.niche,
        followerCount: creatorProfile.followerCount,
        engagementRate: creatorProfile.engagementRate,
        createdAt: creatorProfile.createdAt,
      })
      .from(creatorProfile)
      .where(eq(creatorProfile.status, 'pending_verification'))
      // FIFO queue: oldest submission first. `id` stable tiebreak since `createdAt`
      // defaults to `now()`, which is constant within a transaction, so rows written
      // together share a timestamp exactly.
      .orderBy(creatorProfile.createdAt, creatorProfile.id)
      .limit(limit)
      .offset(offset)
  );
}

const defaultDeps: QueueDeps = {
  requireAdmin: () => guard({ roles: ['admin'] }),
  select: selectCreators,
};

/**
 * Reads the verification queue. Throws `ForbiddenError` for every non-admin
 * caller, including unauthenticated ones — `guard` fails closed.
 *
 * The admin check runs before the query is built, so a denied caller never
 * reaches the database and cannot use response timing to learn whether pending
 * creators exist.
 */
export async function readVerificationQueue(
  filters: QueueFilters = {},
  deps: QueueDeps = defaultDeps
): Promise<QueuePage> {
  await deps.requireAdmin();

  const limit = clampLimit(filters.limit);
  const offset = clampOffset(filters.offset);

  // One row past the page, to answer `hasMore` without a second COUNT query
  // over a table that only ever grows.
  const creators = await deps.select(limit + 1, offset);

  return {
    creators: creators.slice(0, limit),
    hasMore: creators.length > limit,
  };
}
