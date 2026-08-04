import { readAuditLog } from '@/lib/audit/queries';
import type { AuditLogPage, AuditQueryDeps } from '@/lib/audit/queries';
import { guard, toErrorResponse } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  auditLogQuerySchema,
  fromZodError,
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
 * Query strings cannot express "absent", only "empty". A UI that renders every
 * filter as an input sends `?action=&target_id=` when they are untouched, and
 * without this those empty strings reach the schema as values and fail the
 * enum. Dropping them makes an empty filter mean the same thing as an omitted
 * one.
 */
function readParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (value !== '') params[key] = value;
  }
  return params;
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

  const parsed = auditLogQuerySchema.safeParse(
    readParams(new URL(request.url))
  );
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
