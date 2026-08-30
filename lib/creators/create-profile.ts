import { creatorProfile } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { assignTier } from '@/lib/creators/tier-assignment';
import type {
  AssignTierDeps,
  TierOutcome,
} from '@/lib/creators/tier-assignment';
import { withNotifications } from '@/lib/notifications/notify';
import type { NotifyDeps } from '@/lib/notifications/notify';
import type { TiktokStats } from '@/lib/tiktok/stats';
import type { CreateCreatorInput } from '@/lib/validation';

/**
 * Creator profile insert — AC-001 and the load-bearing half of AC-003.
 *
 * Phase 2 (KAN-39): onboarding is the whole pipeline. The insert lands already
 * `verified`, tier assignment runs in the same transaction, and the "profile
 * live" notification rides it too — there is no admin review step. OAuth
 * already proves the creator owns the TikTok account, and brands vet profiles
 * before booking; a human approval queue added latency, not safety.
 *
 * The design constraint from the original ticket still holds: uniqueness is
 * enforced by the database constraint, **not** by an application-level
 * pre-check. There is deliberately no `SELECT ... WHERE tiktok_handle = ?` in
 * this module.
 *
 * A check-then-insert would read like it works and would pass a single-threaded
 * test, but two creators submitting the same handle at once both see "not
 * taken" between their SELECT and their INSERT, and the second one still hits
 * the constraint — so the pre-check buys nothing and the code has to handle
 * `23505` regardless. Handling only `23505` is strictly stronger and one query
 * shorter. `__tests__/creator-onboarding.test.ts` asserts no select precedes
 * the insert, so this cannot regress into the pre-check version.
 */

/** Postgres unique-violation. See https://www.postgresql.org/docs/current/errcodes-appendix.html */
const UNIQUE_VIOLATION = '23505';

/** Constraint names from `drizzle/0000_serious_ender_wiggin.sql:45-46`. */
export const HANDLE_CONSTRAINT = 'creator_profile_tiktok_handle_unique';
export const USER_CONSTRAINT = 'creator_profile_user_id_unique';

export type CreateProfileResult =
  | {
      ok: true;
      profile: { id: string; status: string; tiktokHandle: string };
      /**
       * The tier decision made inside the same transaction as the insert.
       * `assigned: false` still means a live profile — verified but invisible
       * to discovery until an admin assigns a tier or the numbers change.
       */
      tier: TierOutcome;
    }
  | { ok: false; conflict: 'handle' | 'profile' }
  /**
   * Neither the session nor the body supplied a handle. Only reachable for
   * email sign-ups that omit the (now optional) `tiktokHandle` field — a
   * validation problem, not a conflict, so the route maps it to a 400.
   */
  | { ok: false; missingHandle: true };

/** What the profile insert writes; the seam below receives exactly this. */
export interface ProfileInsertValues {
  userId: string;
  tiktokHandle: string;
  niche: string;
  audience: unknown;
  followerCount: number | null;
  engagementRate: string | null;
  status: 'verified';
  verifiedAt: Date;
  /** When the numbers above came from the TikTok API; null otherwise. */
  statsRefreshedAt: Date | null;
}

/** The seams, so the route's conflict mapping is testable without Postgres. */
export interface CreateProfileDeps {
  /**
   * The insert, given the live transaction. Tests inject a fake and a fake
   * `notifyDeps.db.transaction` together — the tx handed here is whatever that
   * runner produced, so the pair cannot disagree.
   */
  insert: (
    tx: Tx,
    values: ProfileInsertValues
  ) => Promise<{ id: string; status: string; tiktokHandle: string }>;
  /**
   * The handle the session itself carries (Login Kit, phase 1). Read here so
   * tests can inject it without standing up the `user` table. The route wires
   * `sessionTiktokHandle` in as the default, so the module stays free of the
   * DB read. An explicit `null` means "no Login Kit handle", not "unset".
   */
  sessionHandle?: (userId: string) => Promise<string | null>;
  /**
   * Live TikTok numbers for the session user (phase 2). Fetched *before* the
   * transaction opens — an external API call must never ride inside one. For a
   * TikTok-linked user this is the *only* source of stats (phase 3): a null
   * here leaves the numbers null. Typed values are used solely on the email
   * sign-up path, where no TikTok link exists to trust.
   */
  sessionStats?: (userId: string) => Promise<TiktokStats | null>;
  notifyDeps?: NotifyDeps;
  assignTierDeps?: AssignTierDeps;
}

const defaultInsert: CreateProfileDeps['insert'] = async (tx, values) => {
  const [row] = await tx.insert(creatorProfile).values(values).returning({
    id: creatorProfile.id,
    status: creatorProfile.status,
    tiktokHandle: creatorProfile.tiktokHandle,
  });
  return row;
};

/**
 * Narrows an unknown thrown value to a Postgres unique violation.
 *
 * `pg` errors are plain objects with `code` and `constraint`, not a class we can
 * `instanceof`, and drizzle passes them through untouched. Anything that does
 * not match this shape is somebody else's problem and gets re-thrown — a
 * connection failure must not be reported to the creator as "handle taken".
 */
function uniqueViolationConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as {
    code?: unknown;
    constraint?: unknown;
  };
  if (code !== UNIQUE_VIOLATION) return null;
  return typeof constraint === 'string' ? constraint : '';
}

/**
 * Inserts the profile for an **already-authorised** user, verified and tiered
 * in one transaction.
 *
 * `userId` comes from the session via `guard()` in the route — never from the
 * request body, which would let any creator create a profile owned by someone
 * else. This function does no authorization of its own; it is not exported to
 * any path that has not already passed the guard.
 *
 * Session-sourced values win over the body, for the same reason in both cases:
 * the handle because a Login Kit user must not rename themselves into someone
 * else's TikTok, and the stats because a number TikTok reported is not one the
 * creator gets to improve in DevTools. For a TikTok-linked user (phase 3) the
 * body stats are ignored *entirely* — a failed fetch leaves the numbers null
 * (no tier; the refresh path or an admin recovers), never typed. Typed values
 * exist only on the email sign-up path.
 *
 * Insert + tier + notification share one transaction, the exact composition
 * verification used to have: a rollback takes all three, and there is no
 * window in which a creator is verified but pending a separate write.
 */
export async function createCreatorProfile(
  userId: string,
  input: CreateCreatorInput,
  deps?: Partial<CreateProfileDeps>
): Promise<CreateProfileResult> {
  const insert = deps?.insert ?? defaultInsert;

  // Both reads happen before the transaction opens: one is a DB read that
  // does not need the lock, the other is an external API call that must not
  // hold one.
  const [sessionHandle, stats] = await Promise.all([
    deps?.sessionHandle ? deps.sessionHandle(userId) : Promise.resolve(null),
    deps?.sessionStats ? deps.sessionStats(userId) : Promise.resolve(null),
  ]);

  // A non-null session handle is the "TikTok-linked" signal: OAuth proved the
  // account, so TikTok's numbers are the only ones trusted — body stats are
  // ignored outright rather than used as a fallback, otherwise DevTools could
  // supply the "gap-filler". Email sign-ups have no link and type both.
  const linked = sessionHandle !== null;
  const tiktokHandle = sessionHandle ?? input.tiktokHandle ?? null;
  if (tiktokHandle === null) return { ok: false, missingHandle: true };

  const followerCount = linked
    ? (stats?.followerCount ?? null)
    : (input.followerCount ?? null);
  // `numeric(5,2)` round-trips as a string in node-postgres; sending a JS
  // number would work by coercion today and silently lose precision the day
  // the column widens. The API path already produces the fixed form.
  const engagementRate = linked
    ? (stats?.engagementRate ?? null)
    : (input.engagementRate?.toFixed(2) ?? null);
  // Stamped only when the numbers actually came from the API — the refresh
  // rate limit and the weekly cron both key off this.
  const statsRefreshedAt = linked && stats !== null ? new Date() : null;

  try {
    return await withNotifications<CreateProfileResult>(async (tx, notify) => {
      const profile = await insert(tx, {
        userId,
        // Already canonicalised by `createCreatorSchema`'s transform — the
        // type says `string`, but the only way to obtain a
        // `CreateCreatorInput` is to parse, and parsing normalises.
        // `sessionTiktokHandle` returns the same canonical form (the
        // `user.create.before` hook in `lib/auth.ts` runs it through
        // `normalizeTiktokHandle`).
        tiktokHandle,
        niche: input.niche,
        audience: input.audience,
        followerCount,
        engagementRate,
        status: 'verified',
        verifiedAt: new Date(),
        statsRefreshedAt,
      });

      // No match is not an error — it leaves `tier_id` null and the creator
      // non-bookable (AC-006), which is exactly what the state means. The
      // admin tier page remains the manual override for that case.
      const tier = await assignTier(
        tx,
        { id: profile.id, followerCount, engagementRate },
        deps?.assignTierDeps
      );

      // The same notification type verification used, with the only outcome
      // onboarding can produce. Row rides the transaction; email flushes
      // after commit.
      await notify(userId, 'verification_result', {
        creatorProfileId: profile.id,
        outcome: 'approved',
      });

      return { ok: true, profile, tier };
    }, deps?.notifyDeps);
  } catch (error) {
    const constraint = uniqueViolationConstraint(error);
    if (constraint === null) throw error;

    if (constraint === USER_CONSTRAINT)
      return { ok: false, conflict: 'profile' };
    if (constraint === HANDLE_CONSTRAINT)
      return { ok: false, conflict: 'handle' };

    // A unique violation on a constraint we did not name is a schema change
    // this module has not been taught about. Re-throw to a 500 rather than
    // guessing which conflict message to show.
    throw error;
  }
}
