import { db } from '@/db';
import { brandProfile } from '@/db/schema';
import type { CreateBrandInput } from '@/lib/validation';

/**
 * Brand profile insert — KAN-27 AC-1 and AC-2.
 *
 * Same shape as `lib/creators/create-profile.ts`, and for the same reason:
 * "exactly one brand profile per user account" is a uniqueness rule, and a
 * uniqueness rule enforced by an application-level `SELECT` before the `INSERT`
 * is not enforced at all. Two tabs submitting the onboarding form at once both
 * read "no profile yet" between their select and their insert; the second still
 * hits the constraint, so the pre-check buys nothing and the `23505` branch has
 * to exist regardless.
 *
 * There is deliberately no select in this module, and the test suite reads the
 * source to keep it that way.
 *
 * The brand side is the simpler half of the mirror: `brand_profile` carries one
 * unique constraint where `creator_profile` carries two, so there is no
 * conflict to disambiguate and no equivalent of AC-003's handle normalisation.
 */

/** Postgres unique-violation. See https://www.postgresql.org/docs/current/errcodes-appendix.html */
const UNIQUE_VIOLATION = '23505';

/** Constraint name from `drizzle/0000_serious_ender_wiggin.sql:16`. */
export const USER_CONSTRAINT = 'brand_profile_user_id_unique';

export type CreateBrandProfileResult =
  | { ok: true; profile: { id: string; companyName: string } }
  | { ok: false; conflict: 'profile' };

/** The insert seam, so the route's conflict mapping is testable without Postgres. */
export interface CreateBrandProfileDeps {
  insert: (values: {
    userId: string;
    companyName: string;
  }) => Promise<{ id: string; companyName: string }>;
}

const defaultDeps: CreateBrandProfileDeps = {
  insert: async (values) => {
    const [row] = await db.insert(brandProfile).values(values).returning({
      id: brandProfile.id,
      companyName: brandProfile.companyName,
    });
    return row;
  },
};

/**
 * Narrows an unknown thrown value to a Postgres unique violation.
 *
 * `pg` errors are plain objects with `code` and `constraint`, not a class we can
 * `instanceof`. Anything not matching this shape is somebody else's problem and
 * is re-thrown — a connection failure must not be reported to a brand as "you
 * already have a profile", which would send them looking for a profile that
 * does not exist.
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
 * request body, which would let any brand create a profile owned by someone
 * else. This function does no authorization of its own.
 */
export async function createBrandProfile(
  userId: string,
  input: CreateBrandInput,
  deps: CreateBrandProfileDeps = defaultDeps
): Promise<CreateBrandProfileResult> {
  try {
    const profile = await deps.insert({
      userId,
      // Already trimmed by `createBrandSchema` — the only way to hold a
      // `CreateBrandInput` is to have parsed one.
      companyName: input.companyName,
    });

    return { ok: true, profile };
  } catch (error) {
    const constraint = uniqueViolationConstraint(error);
    if (constraint === null) throw error;

    if (constraint === USER_CONSTRAINT)
      return { ok: false, conflict: 'profile' };

    // A unique violation on a constraint this module has not been taught about
    // is a schema change, not a known conflict. Re-throw to a 500 rather than
    // guessing that "you already have a profile" describes it.
    throw error;
  }
}
