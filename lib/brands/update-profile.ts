import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { brandProfile } from '@/db/schema';
import type { UpdateBrandInput } from '@/lib/validation';

/**
 * Brand profile edit — KAN-27 AC-5, "the brand can edit their company name
 * later".
 *
 * `company_name` is the only column here a brand owns. `user_id` is ownership
 * and `id` is identity, so neither is editable by anyone: the update names one
 * column explicitly rather than spreading the parsed input, which is what stops
 * a future field on the schema from becoming writable by accident.
 */

export type UpdateBrandProfileResult =
  | { ok: true; profile: { id: string; companyName: string } }
  | { ok: false; reason: 'not_found' };

/** The update seam, so the route is testable without Postgres. */
export interface UpdateBrandProfileDeps {
  update: (args: {
    id: string;
    userId: string;
    companyName: string;
  }) => Promise<{ id: string; companyName: string } | null>;
}

const defaultDeps: UpdateBrandProfileDeps = {
  update: async ({ id, userId, companyName }) => {
    const [row] = await db
      .update(brandProfile)
      .set({ companyName })
      // Scoped by owner as well as by id. `guard()` in the route has already
      // established ownership, so this is a second lock rather than the control
      // — but it means no caller of this function can write across accounts
      // even if it is ever reached from a path that forgot to guard.
      .where(and(eq(brandProfile.id, id), eq(brandProfile.userId, userId)))
      .returning({
        id: brandProfile.id,
        companyName: brandProfile.companyName,
      });

    return row ?? null;
  },
};

/**
 * Renames an **already-authorised** brand's profile.
 *
 * `userId` comes from the session, `id` from the route. A miss returns
 * `not_found` rather than throwing: it means the row was deleted between the
 * guard and the write, which is a race, not a bug.
 */
export async function updateBrandProfile(
  id: string,
  userId: string,
  input: UpdateBrandInput,
  deps: UpdateBrandProfileDeps = defaultDeps
): Promise<UpdateBrandProfileResult> {
  const profile = await deps.update({
    id,
    userId,
    // Already trimmed by `updateBrandSchema`.
    companyName: input.companyName,
  });

  return profile ? { ok: true, profile } : { ok: false, reason: 'not_found' };
}
