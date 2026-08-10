import { desc, lte } from 'drizzle-orm';
import { db } from '@/db';
import { rightsTerms } from '@/db/schema';
import type { Tx } from '@/lib/authz';

/**
 * The row for the terms version that is current *now*.
 */
export type CurrentRightsTerms = typeof rightsTerms.$inferSelect;

/**
 * The current-terms query as a builder, so a test can read the SQL it emits
 * without a database — the `dealHistoryQuery` and `creatorDetailQuery`
 * precedents. `pg` opens no socket until a query actually runs.
 *
 * Current means effective at or before now (AC-1): a version dated in the
 * future has not taken effect, however many later than today it is. Among the
 * rows that have taken effect, the most recently effective wins.
 *
 * `id` breaks the tie. `effective_at` is a timestamp with microsecond
 * precision, so two rows would have to be stamped byte-identically to collide
 * — but if they do, "whichever the planner returns" decides, and the version a
 * creator is asked to agree to must not be a coin flip. The AC says exactly one
 * is current; the order is what makes that true rather than assumed.
 *
 * `client` defaults to the global `db` and is overridden with a transaction by
 * callers that already hold one — the shape `sumCartTotal` uses, and for the
 * same reason: the pool is `max: 5`, so a query issued on `db` while `tx` holds
 * a connection open with `FOR UPDATE` can wait on a connection that only the
 * caller's own transaction could release. See the comment in
 * `lib/campaigns/remove-from-cart.ts` for the full shape of that deadlock.
 */
export function currentRightsTermsQuery(client: typeof db | Tx = db) {
  return client
    .select()
    .from(rightsTerms)
    .where(lte(rightsTerms.effectiveAt, new Date()))
    .orderBy(desc(rightsTerms.effectiveAt), desc(rightsTerms.id))
    .limit(1);
}

/**
 * Resolves the terms version that is current right now.
 *
 * Returns null when nothing has taken effect yet — an environment that has not
 * been seeded. The caller decides what to show a creator then; inventing terms
 * here would let a deal record agreement to a version that does not exist.
 */
export async function getCurrentRightsTerms(
  client: typeof db | Tx = db
): Promise<CurrentRightsTerms | null> {
  const [terms] = await currentRightsTermsQuery(client);

  return terms ?? null;
}
