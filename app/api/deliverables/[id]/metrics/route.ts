import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { recordMetrics } from '@/lib/deals/record-metrics';
import type { RecordMetricsDeps } from '@/lib/deals/record-metrics';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  errorResponse,
  updateMetricsSchema,
  validationError,
  zodIssuesToDetails,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  recordMetricsDeps?: RecordMetricsDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `PUT /api/deliverables/{id}/metrics` — the creator or an admin records
 * engagement metrics for a delivered video (KAN-48, AC-028, Tech Spec §4.5).
 *
 * **The gate runs before the body is read.** The deliverable route's ordering,
 * and for the same reason: a caller who does not own this deliverable never
 * gets as far as having their JSON parsed, so a 403 and a 422 cannot be
 * played off each other to learn whether a deliverable id exists. The role
 * gate admits the creator (ownership checked by the guard's layer 2) or an
 * admin (`allowAdmin` skips layer 2 — §4.5 names exactly this pair), and
 * everything else is refused before any validation happens.
 *
 * **The 403/404 split is deliberate, and it is the one place this endpoint
 * departs from the ticket's letter.** AC-7 says an unknown id returns 404,
 * but the repo's anti-oracle rule (§6.3, kept by every owner-scoped route)
 * collapses "missing" and "unowned" into one 403 for callers the endpoint
 * does not trust: distinguishing them would let a creator probe deliverable
 * ids. An admin is different — the guard's `allowAdmin` admits them *before*
 * ownership exists, so the action's own existence check is what answers, and
 * a missing row is an admin route's 404 (`lib/validation/schemas.ts`). So:
 * creator + unknown id → 403, admin + unknown id → 404, malformed id → 403.
 *
 * **The 422 is the plain `VALIDATION_ERROR`.** §4.5 gives this endpoint no
 * named code, unlike `/approve`'s `INVALID_TIKTOK_URL` — so schema failures
 * (negatives, non-integers, out-of-range counts, unknown keys, an empty body)
 * all carry the standard code with field-level details. A body that is not
 * JSON at all stays a plain `VALIDATION_ERROR` too, as on every other route:
 * that is a protocol failure, not a bad metric.
 */
export async function handleRecordMetrics(
  request: Request,
  id: string,
  deps?: RouteDeps
): Promise<Response> {
  let role: 'creator' | 'admin';
  try {
    if (!UUID_REGEX.test(id)) {
      // Shape-checked before the guard reaches the database: Postgres answers
      // a non-uuid compared against a `uuid` column with `22P02`, which would
      // turn a mistyped id into a 500. Denied rather than 404'd for the same
      // reason every owner-scoped route does it.
      throw new ForbiddenError('malformed id');
    }

    const guardFn = deps?.guard ?? guard;
    const ctx = await guardFn({
      roles: ['creator', 'admin'],
      resource: { kind: 'deliverable', id },
      allowAdmin: true,
    });

    // The role gate admits only these two, so the mapping is total. `source`
    // is the actor's role — never anything the body supplies.
    role = ctx.user.role === 'admin' ? 'admin' : 'creator';
  } catch (error) {
    return toErrorResponse(error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      validationError({ _root: ['Request body must be valid JSON.'] }),
      { status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR] }
    );
  }

  const parsed = updateMetricsSchema.safeParse(body);
  if (!parsed.success) {
    // KAN-69 (R1): `validationError` produces exactly this envelope — the code
    // is plain VALIDATION_ERROR here (unlike `/reject`, which needs a different
    // code the helper cannot express), so the hand-built copy is gone.
    return Response.json(validationError(zodIssuesToDetails(parsed.error)), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await recordMetrics(
    id,
    { values: parsed.data, source: role },
    deps?.recordMetricsDeps
  );

  if (!result.ok) {
    // See the module header: the same `not_found` answer, split by who is
    // asking — 403 for a creator (anti-oracle collapse, §6.3), 404 for an
    // admin (the action's existence check, and the admin-route convention).
    const code = role === 'admin' ? ErrorCode.NOT_FOUND : ErrorCode.FORBIDDEN;
    return Response.json(errorResponse(code), {
      status: ErrorHttpStatus[code],
    });
  }

  return Response.json(
    {
      deliverable_id: id,
      metric_id: result.metricId,
      views: result.views,
      likes: result.likes,
      shares: result.shares,
      comments: result.comments,
      source: result.source,
      // ISO string, like every timestamp in these envelopes.
      last_updated_at: result.lastUpdatedAt.toISOString(),
    },
    { status: 200 }
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleRecordMetrics(request, id);
}
