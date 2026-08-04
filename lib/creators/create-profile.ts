import { db } from '@/db';
import { creatorProfile } from '@/db/schema';
import type { CreateCreatorInput } from '@/lib/validation';

/**
 * Creator profile insert — AC-001 and the load-bearing half of AC-003.
 *
 * The design constraint from the ticket: uniqueness is enforced by the database
 * constraint, **not** by an application-level pre-check. There is deliberately
 * no `SELECT ... WHERE tiktok_handle = ?` in this module.
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
  | { ok: true; profile: { id: string; status: string; tiktokHandle: string } }
  | { ok: false; conflict: 'handle' | 'profile' };

/** The insert seam, so the route's conflict mapping is testable without Postgres. */
export interface CreateProfileDeps {
  insert: (values: {
    userId: string;
    tiktokHandle: string;
    niche: string;
    audience: unknown;
    followerCount: number | null;
    engagementRate: string | null;
  }) => Promise<{ id: string; status: string; tiktokHandle: string }>;
}

const defaultDeps: CreateProfileDeps = {
  insert: async (values) => {
    const [row] = await db.insert(creatorProfile).values(values).returning({
      id: creatorProfile.id,
      status: creatorProfile.status,
      tiktokHandle: creatorProfile.tiktokHandle,
    });
    return row;
  },
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
 * Inserts the profile for an **already-authorised** user.
 *
 * `userId` comes from the session via `guard()` in the route — never from the
 * request body, which would let any creator create a profile owned by someone
 * else. This function does no authorization of its own; it is not exported to
 * any path that has not already passed the guard.
 *
 * `status` is left to the column default (`'pending_verification'`), so the
 * "lands in pending" acceptance criterion cannot be broken by a caller passing
 * something else. Promotion to `verified` is KAN-22's admin action.
 */
export async function createCreatorProfile(
  userId: string,
  input: CreateCreatorInput,
  deps: CreateProfileDeps = defaultDeps
): Promise<CreateProfileResult> {
  try {
    const profile = await deps.insert({
      userId,
      // Already canonicalised by `createCreatorSchema`'s transform — the type
      // says `string`, but the only way to obtain a `CreateCreatorInput` is to
      // parse, and parsing normalises.
      tiktokHandle: input.tiktokHandle,
      niche: input.niche,
      audience: input.audience,
      followerCount: input.followerCount ?? null,
      // `numeric(5,2)` round-trips as a string in node-postgres; sending a JS
      // number would work by coercion today and silently lose precision the day
      // the column widens. Fixing the scale here matches what Postgres stores.
      engagementRate: input.engagementRate?.toFixed(2) ?? null,
    });

    return { ok: true, profile };
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
