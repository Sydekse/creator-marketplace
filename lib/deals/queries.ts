import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { dealEvent, user } from '@/db/schema';
import { ForbiddenError, guard } from '@/lib/authz';
import { UUID_REGEX } from '@/lib/validation/schemas';

export interface DealHistoryEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  createdAt: Date;
  /** Null when the system acted — the expiry sweep has no user behind it. */
  actor: { id: string; name: string } | null;
}

export interface DealHistoryDeps {
  /**
   * Takes the deal id because layer 2 needs it. A `requireAccess()` that closed
   * over nothing could only check the role, which is the half of the guard that
   * lets any signed-in brand read any other brand's deal.
   */
  requireAccess: (dealId: string) => Promise<unknown>;
  select: (dealId: string) => Promise<DealHistoryEvent[]>;
}

/**
 * The query as a builder rather than a promise, so a test can read the SQL it
 * emits without a database (the `creatorDetailQuery` precedent). `pg` opens no
 * socket until a query actually runs.
 *
 * Ordered ascending: an audit trail is read oldest-first, which is what AC-009
 * means by "in order" and what the docstring below promises.
 *
 * `id` is a tiebreaker of last resort. `deal_event.created_at` defaults to
 * `now()`, and Postgres `now()` is *transaction start* time — two events
 * written for one deal inside a single transaction carry byte-identical
 * timestamps, and without a second key their relative order is whatever the
 * planner happens to return. No current path writes two events for one deal in
 * one transaction; dispute resolution (KAN-51) is the first that plausibly
 * will, and it wants a monotonic sequence column rather than this.
 */
export function dealHistoryQuery(dealId: string) {
  return (
    db
      .select({
        id: dealEvent.id,
        fromStatus: dealEvent.fromStatus,
        toStatus: dealEvent.toStatus,
        reason: dealEvent.reason,
        createdAt: dealEvent.createdAt,
        actorId: dealEvent.actorId,
        actorName: user.name,
      })
      .from(dealEvent)
      // Left, not inner: a system transition has a null `actor_id`, and an inner
      // join would drop the expiry sweep's events out of the history entirely.
      .leftJoin(user, eq(dealEvent.actorId, user.id))
      .where(eq(dealEvent.dealId, dealId))
      .orderBy(asc(dealEvent.createdAt), asc(dealEvent.id))
  );
}

/** One joined row, before the actor columns are folded together. */
export interface DealHistoryJoinRow extends Omit<DealHistoryEvent, 'actor'> {
  actorId: string | null;
  actorName: string | null;
}

/**
 * Folds the two joined actor columns into one nullable object.
 *
 * Exported and pure for the reason `readAudience` is: it is the only part of
 * this read with a decision in it, and testing it directly is cheaper and more
 * honest than reaching it through a database. The `select` around it stays
 * private.
 *
 * Collapsed to a single null rather than `{ id: null, name: null }`, so a caller
 * cannot render a blank name where the honest answer is "the system did this" —
 * the same reasoning as `Not provided` for an absent optional number. `name` is
 * `not null` on `user`, so a row with an `actorId` and no name means the left
 * join missed; that is a deleted account, and attributing the action to a blank
 * is worse than attributing it to nobody.
 */
export function toHistoryEvent({
  actorId,
  actorName,
  ...event
}: DealHistoryJoinRow): DealHistoryEvent {
  return {
    ...event,
    actor: actorId && actorName ? { id: actorId, name: actorName } : null,
  };
}

/**
 * Runs the query and folds each row.
 *
 * `run` is defaulted rather than closed over so a test can prove the mapping is
 * applied to *every* row — a `rows[0]`-shaped bug reads identically from the
 * outside when the fixture has one row, and the histories this serves are the
 * opposite of one row long.
 */
export async function selectDealHistory(
  dealId: string,
  run: (id: string) => Promise<DealHistoryJoinRow[]> = dealHistoryQuery
): Promise<DealHistoryEvent[]> {
  const rows = await run(dealId);

  return rows.map(toHistoryEvent);
}

/**
 * Full, ordered audit history for one deal (AC-009, FR-007, NFR-012).
 *
 * Gated inside the module, before the id is used for anything, following
 * `readDiscovery` and `readCreatorDetail`: a read path protected only by its
 * callers is protected as well as its least careful caller. Both sides of a
 * deal may read it — the brand running the campaign and the creator on it —
 * plus an admin resolving a dispute, and `guard` picks whichever of the two
 * ownership refs matches the session (NFR-005, invariant 2).
 *
 * Every denial is the same 403: malformed id, unknown deal, and someone else's
 * deal are indistinguishable to the caller, so this cannot be walked as an
 * existence oracle for deal ids (Tech Spec §6.3).
 */
export async function getDealHistory(
  dealId: string,
  deps: DealHistoryDeps = defaultDeps
): Promise<DealHistoryEvent[]> {
  // Shape-checked before the guard, not after: `loadOwnerRefs` compares this
  // against a `uuid` column, and Postgres answers a non-uuid with `22P02`,
  // turning a mistyped link into a 500. A malformed id cannot be owned by
  // anyone, so 403 is both the honest answer and the same one "not yours"
  // gets.
  if (!UUID_REGEX.test(dealId)) {
    throw new ForbiddenError('malformed deal id');
  }

  await deps.requireAccess(dealId);

  return deps.select(dealId);
}

/**
 * The real gate, named and exported so the guard options are assertable without
 * a session. Both parties to a deal may read its history, and the two-layer
 * check is what keeps that from meaning "any brand may read any deal".
 */
export function requireDealAccess(dealId: string): Promise<unknown> {
  return guard({
    roles: ['brand', 'creator', 'admin'],
    // Layer 2. `loadOwnerRefs('deal', id)` resolves both sides — the campaign's
    // brand and the deal's creator — and `ownsResource` admits whichever the
    // session matches, so one call serves both parties without either being
    // able to read the other's deals.
    resource: { kind: 'deal', id: dealId },
    // An admin reading a disputed deal's history owns nothing on it. §4.5
    // treats allowed-role and must-own as independent axes for exactly this.
    allowAdmin: true,
  });
}

const defaultDeps: DealHistoryDeps = {
  requireAccess: requireDealAccess,
  // Both referenced, not wrapped: a wrapper here is a line no test can reach
  // without a database, and it is exactly the line where the shipped path would
  // drift from the gate and the mapper the tests do cover.
  select: selectDealHistory,
};

export type DealHistoryRow = DealHistoryEvent;
