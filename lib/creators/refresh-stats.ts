import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { creatorProfile, pricingTier } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { sessionTiktokHandle } from '@/lib/creators/credentials';
import {
  byHighestFirst,
  selectTier,
  assignTier,
} from '@/lib/creators/tier-assignment';
import type {
  AssignTierDeps,
  TierCandidate,
} from '@/lib/creators/tier-assignment';
import { withNotifications } from '@/lib/notifications/notify';
import type { NotifyDeps } from '@/lib/notifications/notify';
import { fetchTiktokStats } from '@/lib/tiktok/stats';
import type { TiktokStats } from '@/lib/tiktok/stats';

/**
 * Stats refresh + re-tier (phase 3).
 *
 * The one write path that changes a TikTok-linked creator's numbers after
 * onboarding. Two callers, same rules: the creator's "Refresh my stats" button
 * (`POST /api/creators/stats/refresh`) and the weekly pass of the cron
 * scheduler. Both go through `refreshCreatorStats` so the tier consequences
 * cannot differ by entry point.
 *
 * The tier rule after a refresh is deliberately asymmetric:
 *
 *   - **Upgrades apply automatically.** The numbers came from TikTok, the
 *     ladder is the same `selectTier` onboarding uses, and a higher band is
 *     good news nobody needs to approve. The creator is emailed
 *     (`tier_upgraded`).
 *   - **Downgrades only flag.** `tier_review_at` is stamped and the tier kept.
 *     A brand may hold an active deal priced on the current band, follower
 *     counts wobble week to week, and TikTok's numbers can be briefly wrong —
 *     so a *drop* is a human decision on `/admin/tiers`, never a cron's.
 *
 * Rate limit: once per 24 hours, keyed on `stats_refreshed_at` — the same
 * stamp the cron uses to find week-old rows, so a manual refresh naturally
 * pushes the next cron pull out a week. A failed fetch does not stamp: no data
 * was read, and stamping would lock the creator out of retrying for a day.
 */

/** Manual refreshes accepted at most once per this window. */
export const REFRESH_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type RefreshTierChange =
  /** New numbers select a higher band — applied and mailed. */
  | { kind: 'upgraded'; tierId: string; tierName: string }
  /** Same band as before (or still untiered with nothing to flag). */
  | { kind: 'unchanged' }
  /** Lower band or no band while tiered — flagged for admin, tier kept. */
  | { kind: 'flagged' };

export type RefreshStatsResult =
  | {
      ok: true;
      stats: TiktokStats;
      refreshedAt: Date;
      tier: RefreshTierChange;
    }
  | { ok: false; error: 'no_profile' | 'not_linked' | 'fetch_failed' }
  | { ok: false; error: 'rate_limited'; retryAfterMs: number };

/** The slice of `creator_profile` the refresh reads before writing. */
export interface RefreshableProfile {
  id: string;
  tierId: string | null;
  statsRefreshedAt: Date | null;
}

/** Seams for tests; every default is the real thing. */
export interface RefreshStatsDeps {
  loadProfile: (userId: string) => Promise<RefreshableProfile | null>;
  /** Non-null means TikTok-linked — same signal onboarding trusts. */
  linkedHandle: (userId: string) => Promise<string | null>;
  fetchStats: (userId: string) => Promise<TiktokStats | null>;
  now: () => Date;
  /**
   * Skips the 24h check. The cron sets this: its cadence is its own filter
   * (`stats_refreshed_at` older than a week), and the manual limit exists to
   * stop button-mashing, not to stop the scheduler.
   */
  ignoreRateLimit?: boolean;
  notifyDeps?: NotifyDeps;
  assignTierDeps?: AssignTierDeps;
}

const defaultLoadProfile: RefreshStatsDeps['loadProfile'] = async (userId) => {
  const rows = await db
    .select({
      id: creatorProfile.id,
      tierId: creatorProfile.tierId,
      statsRefreshedAt: creatorProfile.statsRefreshedAt,
    })
    .from(creatorProfile)
    .where(eq(creatorProfile.userId, userId))
    .limit(1);
  return rows[0] ?? null;
};

/**
 * Is `next` a strictly higher band than the one currently held?
 *
 * Uses the same ordering that picks a winner in `selectTier`, so "higher" here
 * and "best" there cannot disagree. A current tier that no longer exists in
 * the ladder (deleted or renamed since assignment) ranks below everything —
 * moving off a ghost tier onto a real one is treated as the upgrade it is.
 */
function isHigher(
  tiers: readonly TierCandidate[],
  currentTierId: string,
  next: TierCandidate
): boolean {
  const current = tiers.find((tier) => tier.id === currentTierId);
  if (!current) return true;
  return byHighestFirst(next, current) < 0;
}

/**
 * Fetches fresh TikTok numbers for `userId` and applies the tier rules above.
 *
 * `userId` is the session user for the button and the profile's owner for the
 * cron — both already authorised by their caller; this function does no
 * authorization of its own.
 *
 * The fetch happens *before* the transaction opens (an external API call must
 * never hold a lock), mirroring `createCreatorProfile`. Stats write, tier
 * change and the upgrade notification then share one transaction: a rollback
 * takes all three.
 */
export async function refreshCreatorStats(
  userId: string,
  deps?: Partial<RefreshStatsDeps>
): Promise<RefreshStatsResult> {
  const loadProfile = deps?.loadProfile ?? defaultLoadProfile;
  const linkedHandle = deps?.linkedHandle ?? sessionTiktokHandle;
  const fetchStats = deps?.fetchStats ?? fetchTiktokStats;
  const now = deps?.now ?? (() => new Date());

  const [profile, handle] = await Promise.all([
    loadProfile(userId),
    linkedHandle(userId),
  ]);
  if (!profile) return { ok: false, error: 'no_profile' };
  // Email sign-ups have no TikTok link to pull from; their numbers are the
  // admin's to correct (`PATCH /api/admin/creators/{id}`), not TikTok's.
  if (handle === null) return { ok: false, error: 'not_linked' };

  if (!deps?.ignoreRateLimit && profile.statsRefreshedAt !== null) {
    const elapsed = now().getTime() - profile.statsRefreshedAt.getTime();
    if (elapsed < REFRESH_MIN_INTERVAL_MS) {
      return {
        ok: false,
        error: 'rate_limited',
        retryAfterMs: REFRESH_MIN_INTERVAL_MS - elapsed,
      };
    }
  }

  const stats = await fetchStats(userId);
  // No stamp on failure: nothing was read, and stamping would turn one bad
  // API day into a 24h lockout on the retry.
  if (stats === null) return { ok: false, error: 'fetch_failed' };

  const refreshedAt = now();

  return withNotifications<RefreshStatsResult>(async (tx, notify) => {
    // Tiers loaded once and shared with `assignTier` via a caching loader, so
    // the up/down judgement and the assignment read the same ladder snapshot.
    const loadTiers = deps?.assignTierDeps?.loadTiers;
    const tiers = loadTiers
      ? await loadTiers(tx)
      : await defaultTierLoad(tx);
    const cachedDeps: AssignTierDeps = { loadTiers: async () => tiers };

    const newNumbers = {
      followerCount: stats.followerCount,
      engagementRate: stats.engagementRate,
    };
    const outcome = selectTier(tiers, newNumbers);
    // `selectTier` picked from `tiers`, so an assigned outcome's row is in it.
    const newTier = outcome.assigned
      ? (tiers.find((tier) => tier.id === outcome.tierId) ?? null)
      : null;

    const upgraded =
      outcome.assigned &&
      newTier !== null &&
      outcome.tierId !== profile.tierId &&
      (profile.tierId === null || isHigher(tiers, profile.tierId, newTier));

    // A tiered creator whose new numbers select a lower band — or none at
    // all — is flagged, never dropped. "Same band" clears any standing flag:
    // the numbers support the tier again, so there is nothing left to review.
    const flagged =
      !upgraded &&
      profile.tierId !== null &&
      (!outcome.assigned || outcome.tierId !== profile.tierId);

    await tx
      .update(creatorProfile)
      .set({
        followerCount: stats.followerCount,
        engagementRate: stats.engagementRate,
        statsRefreshedAt: refreshedAt,
        tierReviewAt: flagged ? refreshedAt : null,
      })
      .where(eq(creatorProfile.id, profile.id));

    if (upgraded && outcome.assigned) {
      // Writes tier_id via the same code path onboarding and the admin retry
      // use — the update above deliberately does not touch tier_id.
      await assignTier(tx, { id: profile.id, ...newNumbers }, cachedDeps);
      await notify(userId, 'tier_upgraded', {
        creatorProfileId: profile.id,
        tierName: outcome.tierName,
        pricePerVideo: outcome.pricePerVideo,
      });
      return {
        ok: true,
        stats,
        refreshedAt,
        tier: {
          kind: 'upgraded',
          tierId: outcome.tierId,
          tierName: outcome.tierName,
        },
      };
    }

    return {
      ok: true,
      stats,
      refreshedAt,
      tier: flagged ? { kind: 'flagged' } : { kind: 'unchanged' },
    };
  }, deps?.notifyDeps);
}

/**
 * The same rows `assignTier`'s default loader reads. Duplicated as a private
 * helper rather than exporting that loader, because the column set is already
 * pinned by `TIER_COLUMNS` in tier-assignment.ts — this is just the read.
 */
async function defaultTierLoad(tx: Tx): Promise<TierCandidate[]> {
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
