import {
  decideVerification,
  CreatorNotPendingError,
  CreatorNotFoundError,
} from '@/lib/creators/decide-verification';
import type { DecisionDeps } from '@/lib/creators/decide-verification';
import { tierOutcomeToResponse } from '@/lib/creators/tier-assignment';
import { guard, toErrorResponse } from '@/lib/authz';
import type { GuardOptions } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  errorResponse,
  fromZodError,
  validationError,
  verifyCreatorSchema,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Canonical uuid shape, checked before the id reaches a query.
 *
 * `creator_profile.id` is a `uuid` column, so Postgres answers a non-uuid
 * comparison with `22P02 invalid_text_representation` — a 500 on a request that
 * is merely malformed. Rejecting the shape first keeps that out of the logs.
 * This is an admin-only endpoint, so a malformed id is honestly a 404 rather
 * than the FORBIDDEN the owner-scoped routes return to avoid being an oracle.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VerifyCreatorDeps extends DecisionDeps {
  guard: (options: GuardOptions) => Promise<unknown>;
}

/**
 * `POST /api/admin/creators/:id/verify` — admin verification decision (KAN-22, Tech Spec §4.6).
 *
 * Approve or reject a creator in `pending_verification` status. On success,
 * creator receives a notification email and an audit row is written.
 *
 * Ordering follows the contract from `app/api/brands/route.ts`:
 *   1. Authorize — before parsing, so an unauthorized caller cannot probe the endpoint
 *   2. Parse and validate body
 *   3. Execute decision with transaction composition (profile update + audit + notification)
 */
export async function handleVerifyCreator(
  request: Request,
  creatorProfileId: string,
  deps?: VerifyCreatorDeps
): Promise<Response> {
  const guardFn = deps?.guard ?? guard;

  try {
    // Admin-only gate — no creator can verify themselves or others
    await guardFn({ roles: ['admin'] });
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

  const parsed = verifyCreatorSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  // Malformed id after auth + validation: a well-formed request naming a row
  // that cannot exist. 404, not a Postgres 22P02 → 500.
  if (!UUID_PATTERN.test(creatorProfileId)) {
    return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
      status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
    });
  }

  try {
    const result = await decideVerification(
      creatorProfileId,
      parsed.data,
      deps
    );

    // snake_case body, matching Tech Spec §4.6 response style.
    //
    // `tier` is additive (KAN-23): null on a rejection, and on an approval
    // either the assigned band or the reason none was. The admin UI needs the
    // reason in the same response that reports the approval — telling somebody
    // "approved" and leaving out "…and still not bookable" is the failure AC-5
    // names.
    return Response.json(
      {
        id: result.id,
        status: result.status,
        tier: tierOutcomeToResponse(result.tier),
      },
      { status: 200 }
    );
  } catch (error) {
    // AC-029: only pending_verification creators can be decided
    if (error instanceof CreatorNotPendingError) {
      return Response.json(errorResponse(ErrorCode.CREATOR_NOT_PENDING), {
        status: ErrorHttpStatus[ErrorCode.CREATOR_NOT_PENDING],
      });
    }

    // Creator not found — typed, so this mapping cannot break on a reworded
    // message. Uses the standard envelope + status table like every other code.
    if (error instanceof CreatorNotFoundError) {
      return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
        status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
      });
    }

    throw error;
  }
}

/**
 * The exported handler reads `id` from Next's route context.
 *
 * In the App Router (Next 15) `params` is a Promise and must be awaited before
 * its fields are read — mirrors `app/api/brands/[id]/route.ts`. Next passes the
 * route context as the second parameter, so the deps seam is the third
 * parameter of the testable inner handler and never collides with it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleVerifyCreator(request, id);
}
