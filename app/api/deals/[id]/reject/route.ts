import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { rejectDeliverable } from '@/lib/deals/reject-deliverable';
import type { RejectDeliverableDeps } from '@/lib/deals/reject-deliverable';
import {
  ErrorCode,
  ErrorHttpStatus,
  ErrorMessage,
  UUID_REGEX,
  errorResponse,
  rejectDeliverableSchema,
  validationError,
  zodIssuesToDetails,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  rejectDeliverableDeps?: RejectDeliverableDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/deals/{id}/reject` — the brand sends a delivered video back with
 * a reason; the deal returns to `revision_requested` and the funds stay held
 * (KAN-47, AC-024, Tech Spec §4.4).
 *
 * **The gate runs before the body is read**, for the same reason every
 * owner-scoped route keeps that order: a caller who does not own this deal
 * never gets as far as having their JSON parsed, so a 403 and a 422 cannot be
 * played off each other to learn whether a deal id exists.
 *
 * **The 422 is `REASON_REQUIRED`, not `VALIDATION_ERROR`.** AC-2 and §4.4
 * name the code, and the schema's failure message is the AC's own sentence —
 * \"A rejection reason is required.\" — so the envelope carries that code,
 * that message, and the field-level details the form renders inline. A body
 * that is not JSON at all stays a plain `VALIDATION_ERROR`, as on every other
 * route.
 *
 * The brand is identified by the session, never by the body. `reason` is the
 * only client-supplied value, and it is stored on the deliverable and sent to
 * the creator verbatim — which is why the schema bounds it rather than this
 * route doing anything clever with it.
 */
export async function handleRejectDeliverable(
  request: Request,
  id: string,
  deps?: RouteDeps
): Promise<Response> {
  let brandProfileId: string;
  let actorUserId: string;
  try {
    if (!UUID_REGEX.test(id)) {
      // Shape-checked before the guard reaches the database: Postgres answers
      // a non-uuid compared against a `uuid` column with `22P02`, which would
      // turn a mistyped link into a 500. Denied rather than 404'd for the
      // same reason every owner-scoped route does it.
      throw new ForbiddenError('malformed id');
    }

    const guardFn = deps?.guard ?? guard;
    const ctx = await guardFn({
      roles: ['brand'],
      resource: { kind: 'deal', id },
    });

    // AC-8. The role gate admits brands; the resource check above admits only
    // the one whose campaign this deal belongs to. A brand with no profile row
    // cannot own a campaign at all, so there is nothing left to authorise.
    if (!ctx.brandProfileId) {
      throw new ForbiddenError('missing brand profile');
    }

    brandProfileId = ctx.brandProfileId;
    actorUserId = ctx.user.id;
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

  const parsed = rejectDeliverableSchema.safeParse(body);
  if (!parsed.success) {
    // AC-2. The one code §4.4 gives this endpoint for a missing reason, with
    // the AC's own sentence and the details the form keys its field error on.
    return Response.json(
      {
        error: {
          code: ErrorCode.REASON_REQUIRED,
          message: ErrorMessage[ErrorCode.REASON_REQUIRED],
          details: zodIssuesToDetails(parsed.error),
        },
      },
      { status: ErrorHttpStatus[ErrorCode.REASON_REQUIRED] }
    );
  }

  const result = await rejectDeliverable(
    id,
    {
      brandProfileId,
      actorUserId,
      reason: parsed.data.reason,
    },
    deps?.rejectDeliverableDeps
  );

  if (!result.ok) {
    switch (result.reason) {
      // Collapsed into 403 like every other owner-scoped route. The guard
      // above already denied anyone who does not own this deal, so reaching
      // this means the row went away between the two reads — still not
      // something to answer with a distinct 404.
      case 'not_found':
        return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
          status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
        });
      // AC-5. The code is the state machine's own —
      // `getErrorCodeForInvalidTransition` decides it from both ends of the
      // attempted edge — so rejecting a video that was never delivered
      // reports DEAL_NOT_DELIVERED and a double-reject reports whatever the
      // machine says, without this route guessing at one.
      case 'illegal':
        return Response.json(errorResponse(result.code), {
          status: ErrorHttpStatus[result.code],
        });
    }
  }

  return Response.json(
    {
      deal_id: result.dealId,
      status: result.status,
      // Echoed so the client can confirm what was recorded without re-reading
      // the row. The reason has already been trimmed and bounded by the schema.
      reason: result.reason,
    },
    { status: 200 }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleRejectDeliverable(request, id);
}
