import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaign, creatorProfile, user } from '@/db/schema';

/**
 * KAN-59 AC-5 — database constraints exercised end-to-end, not just asserted
 * in validation code. A schema constraint is the last line of defence, and the
 * only way to prove it exists is to hit it.
 */

/** The Postgres error code for a unique-violation. */
const PG_UNIQUE_VIOLATION = '23505';
/** The Postgres error code for a check-violation. */
const PG_CHECK_VIOLATION = '23514';

/**
 * Drizzle wraps driver errors in `DrizzleQueryError` and keeps the pg error
 * (which carries the SQLSTATE `code`) on `.cause`. Some paths surface the
 * driver error directly, so both shapes are checked.
 */
function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.code ?? e.cause?.code;
}

describe('database constraints (KAN-59 AC-5)', () => {
  it('rejects a duplicate TikTok handle at the database (AC-003)', async () => {
    // Two fresh users (no profiles yet), one shared handle — the unique
    // constraint on creator_profile.tiktok_handle must refuse the second row.
    // A user row is enough here: the constraint test is about the handle, not
    // about sign-in credentials.
    const [u1] = await db
      .insert(user)
      .values({
        name: 'Constraint One',
        email: 'constraint.one@test.local',
        role: 'creator',
      })
      .returning({ id: user.id });
    const [u2] = await db
      .insert(user)
      .values({
        name: 'Constraint Two',
        email: 'constraint.two@test.local',
        role: 'creator',
      })
      .returning({ id: user.id });

    await db.insert(creatorProfile).values({
      userId: u1.id,
      tiktokHandle: '@constraint.shared',
      niche: 'fitness',
      audience: { followers: 1000 },
    });

    const duplicate = await db
      .insert(creatorProfile)
      .values({
        userId: u2.id,
        tiktokHandle: '@constraint.shared',
        niche: 'fitness',
        audience: { followers: 1000 },
      })
      .then(() => null)
      .catch((error: unknown) => error);
    expect(duplicate).toBeDefined();
    expect(pgCode(duplicate)).toBe(PG_UNIQUE_VIOLATION);
  });

  it('rejects a non-positive campaign budget at the database (AC-008)', async () => {
    // The CHECK constraint `campaign_budget_positive` must refuse a budget of
    // zero even when a caller bypasses the domain validation entirely.
    const [brand] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, 'brand@demo.com'));
    if (!brand) throw new Error('[integration] seeded brand missing');

    const zeroBudget = await db
      .insert(campaign)
      .values({
        brandId: brand.id,
        name: 'Constraint Budget Zero',
        goal: 'Should never be inserted.',
        budget: 0,
        desiredVideos: 1,
        status: 'draft',
      })
      .then(() => null)
      .catch((error: unknown) => error);
    expect(zeroBudget).toBeDefined();
    expect(pgCode(zeroBudget)).toBe(PG_CHECK_VIOLATION);
  });
});
