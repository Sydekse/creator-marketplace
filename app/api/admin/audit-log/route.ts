import { readAuditLog } from '@/lib/audit/queries';
import type { AuditLogPage, AuditQueryDeps } from '@/lib/audit/queries';
import { guard, toErrorResponse } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  auditLogQuerySchema,
  fromZodError,
  validationError,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * `GET /api/admin/audit-log` — the admin read path (KAN-52, AC-031, FR-008).
 *
 * The admin check runs twice, and both are load-bearing:
 *
 *   - Here, before parsing, because `POST /api/brands` establishes the ordering
 *     for this codebase — authorize first, so a caller with no right to be here
 *     cannot use validation responses to map what the endpoint accepts.
 *   - Again inside `readAuditLog`, because that is what makes the *query* safe
 *     rather than this one route. The console page a later ticket adds will
 *     call it directly, and it inherits the gate instead of having to remember
 *     it.
 *
 * Deleting either one leaves something unprotected. The cost is one extra
 * session lookup on an endpoint only admins reach.
 */

/**
 * Filters are accepted in snake_case because that is how they are *returned* —
 * flagged in the KAN-52 review, where `?actor_id=` was silently dropped and the
 * endpoint answered with the entire log.
 *
 * Listed explicitly rather than derived by a `_x -> X` regex. A closed set means
 * a misspelling stays unknown and is rejected by the schema's `.strict()`, where
 * a general rule would invent a plausible field name for anything underscored
 * and put us back where we started.
 */
const PARAM_ALIASES: Record<string, string> = {
  actor_id: 'actorId',
  target_type: 'targetType',
  target_id: 'targetId',
};

/**
 * Normalises the query string into schema keys.
 *
 * Two things happen here, both about the gap between what a query string can say
 * and what the schema accepts:
 *
 *   - Empty means absent. A UI that renders every filter as an input sends
 *     `?action=&target_id=` when they are untouched; without this those empty
 *     strings reach the schema as values and fail the enum.
 *   - snake_case is folded to camelCase, per `PARAM_ALIASES`.
 *
 * `conflicts` carries any filter given under both spellings with *different*
 * values. That request has no correct answer — one of the two is going to be
 * ignored — and quietly picking a winner is the same class of bug as dropping
 * the key was. The same spelling repeated (`?limit=1&limit=2`) is not a conflict:
 * that is ordinary query-string duplication, and last-wins is what every other
 * reader of a URL does with it.
 */
function readParams(url: URL): {
  params: Record<string, string>;
  conflicts: string[];
} {
  const params: Record<string, string> = {};
  const spelledAs = new Map<string, string>();
  const conflicts = new Set<string>();

  for (const [key, value] of url.searchParams) {
    if (value === '') continue;

    const name = PARAM_ALIASES[key] ?? key;
    const previous = spelledAs.get(name);
    if (previous !== undefined && previous !== key && params[name] !== value) {
      conflicts.add(name);
    }
    spelledAs.set(name, key);
    params[name] = value;
  }

  return { params, conflicts: [...conflicts] };
}

/** snake_case out, matching the response style in tech spec §4.2. */
function serialize(page: AuditLogPage) {
  return {
    rows: page.rows.map((row) => ({
      id: row.id,
      actor_id: row.actorId,
      actor_name: row.actorName,
      actor_email: row.actorEmail,
      action: row.action,
      target_type: row.targetType,
      target_id: row.targetId,
      detail: row.detail,
      created_at: row.createdAt,
    })),
    has_more: page.hasMore,
  };
}

export async function handleReadAuditLog(
  request: Request,
  deps?: AuditQueryDeps
): Promise<Response> {
  try {
    // Same seam the query uses, so a test that injects one admin injects both.
    await (deps?.requireAdmin ?? (() => guard({ roles: ['admin'] })))();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { params, conflicts } = readParams(new URL(request.url));
  if (conflicts.length > 0) {
    return Response.json(
      validationError(
        Object.fromEntries(
          conflicts.map((name) => [
            name,
            ['Given twice with different values.'],
          ])
        )
      ),
      { status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR] }
    );
  }

  const parsed = auditLogQuerySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  try {
    const page = await readAuditLog(parsed.data, deps);
    return Response.json(serialize(page));
  } catch (error) {
    // Re-throws anything that is not a denial, so a database outage is not
    // reported as a permission problem.
    return toErrorResponse(error);
  }
}

/**
 * The exported handler takes no second argument on purpose — Next passes the
 * route context there, which would silently overwrite a dependency seam. Tests
 * call `handleReadAuditLog` directly instead.
 */
export async function GET(request: Request): Promise<Response> {
  return handleReadAuditLog(request);
}
