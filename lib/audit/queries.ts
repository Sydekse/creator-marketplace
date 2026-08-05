import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, user } from '@/db/schema';
import { guard } from '@/lib/authz';
import type { AuditAction, AuditTargetType } from './actions';
import { DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT } from './limits';

/**
 * The read side of the audit log (KAN-52).
 *
 * Two acceptance criteria meet here: "admins can read the audit log; no other
 * role can read it at all", and "the log is filterable by actor, action type,
 * target, and date range".
 *
 * The gate is inside `readAuditLog` rather than only on the route that calls it.
 * A page and a route handler are two call sites today and more later, and a read
 * path whose protection lives in its callers is protected exactly as well as the
 * least careful one. Putting it here means there is no way to query this table
 * from application code without passing the admin check first.
 *
 * Note this module never imports from a `lib/audit` barrel and no barrel
 * re-exports it: `lib/authz` imports the redactor, so a barrel would close the
 * loop authz -> audit -> authz.
 */

export interface AuditLogFilters {
  actorId?: string;
  action?: AuditAction;
  targetType?: AuditTargetType;
  targetId?: string;
  /** Inclusive lower bound on `created_at`. */
  from?: Date;
  /** Inclusive upper bound on `created_at`. */
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogRow {
  id: string;
  actorId: string;
  /** Joined so the log reads as people rather than uuids. */
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  detail: unknown;
  createdAt: Date;
}

export interface AuditLogPage {
  rows: AuditLogRow[];
  /** True when another page exists — derived from an over-fetch, not a COUNT. */
  hasMore: boolean;
}

export { DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT } from './limits';

/** Seam for tests, matching the shape `lib/authz` uses. */
export interface AuditQueryDeps {
  requireAdmin: () => Promise<unknown>;
  select: (
    where: SQL | undefined,
    limit: number,
    offset: number
  ) => Promise<AuditLogRow[]>;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit))
    return DEFAULT_AUDIT_LIMIT;
  const floored = Math.floor(limit);
  if (floored < 1) return 1;
  return Math.min(floored, MAX_AUDIT_LIMIT);
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}

/**
 * Translates filters into a `where` clause. Exported for tests: asserting that
 * an absent filter contributes no condition is easier here than through a
 * database.
 *
 * Returns `undefined` when nothing is filtered, which Drizzle reads as "no
 * WHERE" rather than as an empty conjunction.
 */
export function buildAuditWhere(filters: AuditLogFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.actorId) conditions.push(eq(auditLog.actorId, filters.actorId));
  if (filters.action) conditions.push(eq(auditLog.action, filters.action));
  if (filters.targetType) {
    conditions.push(eq(auditLog.targetType, filters.targetType));
  }
  if (filters.targetId) {
    conditions.push(eq(auditLog.targetId, filters.targetId));
  }
  if (filters.from) conditions.push(gte(auditLog.createdAt, filters.from));
  if (filters.to) conditions.push(lte(auditLog.createdAt, filters.to));

  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function selectRows(
  where: SQL | undefined,
  limit: number,
  offset: number
): Promise<AuditLogRow[]> {
  return (
    db
      .select({
        id: auditLog.id,
        actorId: auditLog.actorId,
        actorName: user.name,
        actorEmail: user.email,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        detail: auditLog.detail,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      // Left, not inner: the audit row is the record of authority, not the user
      // row. If an actor's `user` row ever disappears, the entry it left behind
      // must still be readable — an inner join would silently drop exactly the
      // history an audit log exists to keep. `actorName`/`actorEmail` are already
      // nullable, so a missing actor reads as null rather than vanishing.
      .leftJoin(user, eq(auditLog.actorId, user.id))
      .where(where)
      // `id` is not a meaningful second sort — uuids are random — but it is a
      // stable one, and stability is what pagination needs. `created_at` alone
      // cannot provide it: it defaults to `now()`, which is constant within a
      // transaction, so rows written together share a timestamp exactly.
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(limit)
      .offset(offset)
  );
}

const defaultDeps: AuditQueryDeps = {
  requireAdmin: () => guard({ roles: ['admin'] }),
  select: selectRows,
};

/**
 * Reads the audit log. Throws `ForbiddenError` for every non-admin caller,
 * including unauthenticated ones — `guard` fails closed.
 *
 * The admin check runs before the query is built, so a denied caller never
 * reaches the database and cannot use response timing to learn whether rows
 * matching their filter exist.
 */
export async function readAuditLog(
  filters: AuditLogFilters = {},
  deps: AuditQueryDeps = defaultDeps
): Promise<AuditLogPage> {
  await deps.requireAdmin();

  const limit = clampLimit(filters.limit);
  const offset = clampOffset(filters.offset);

  // One row past the page, to answer `hasMore` without a second COUNT query
  // over a table that only ever grows.
  const rows = await deps.select(buildAuditWhere(filters), limit + 1, offset);

  return {
    rows: rows.slice(0, limit),
    hasMore: rows.length > limit,
  };
}
