import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { submitDeliverable } from '@/lib/deals/submit-deliverable';
import type { SubmitDeliverableDeps } from '@/lib/deals/submit-deliverable';
import {
  ErrorCode,
  ErrorHttpStatus,
  ErrorMessage,
  UUID_REGEX,
  errorResponse,
  submitDeliverableSchema,
  validationError,
  zodIssuesToDetails,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  submitDeliverableDeps?: SubmitDeliverableDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/deals/{id}/deliverable` — the creator submits the live TikTok
 * post URL (KAN-46, AC-022, AC-025, Tech Spec §4.4).
 *
 * **The gate runs before the body is read.** A caller who does not own this
 * deal never gets as far as having their JSON parsed, so a 403 and a 422
 * cannot be played off each other to learn whether a deal id exists — the
 * same ordering the accept route keeps, and for the same reason.
 *
 * **The 422 is `INVALID_TIKTOK_URL`, not `VALIDATION_ERROR`.** AC-025 names
 * the code, and §4.4 lists exactly one 422 for this endpoint. The schema
 * failure message is the AC's own sentence — \"Enter a valid public TikTok
 * video link.\" — so the envelope carries that code, that message, and the
 * field-level details the form renders inline. A body that is not JSON at all
 * stays a plain `VALIDATION_ERROR`, as on every other route: that is a
 * protocol failure, not a bad link.
 */
export async function handleSubmitDeliverable(
  request: Request,
  id: string,
  deps?: RouteDeps
): Promise<Response> {
  let creatorProfileId: string;
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
      roles: ['creator'],
      resource: { kind: 'deal', id },
    });

    // AC-7. The role gate admits creators; the resource check above admits
    // only the one this deal belongs to. A creator with no profile row cannot
    // own a deal at all, so there is nothing left to authorise.
    if (!ctx.creatorProfileId) {
      throw new ForbiddenError('missing creator profile');
    }

    creatorProfileId = ctx.creatorProfileId;
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

  const parsed = submitDeliverableSchema.safeParse(body);
  if (!parsed.success) {
    // AC-025. The one code §4.4 gives this endpoint for a bad link, with the
    // AC's own sentence and the details the form keys its field error on.
    return Response.json(
      {
        error: {
          code: ErrorCode.INVALID_TIKTOK_URL,
          message: ErrorMessage[ErrorCode.INVALID_TIKTOK_URL],
          details: zodIssuesToDetails(parsed.error),
        },
      },
      { status: ErrorHttpStatus[ErrorCode.INVALID_TIKTOK_URL] }
    );
  }

  const result = await submitDeliverable(
    id,
    {
      creatorProfileId,
      actorUserId,
      tiktokUrl: parsed.data.tiktokUrl,
    },
    deps?.submitDeliverableDeps
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
      // AC-4, and the idempotency answer. The code is the state machine's
      // own — `getErrorCodeForInvalidTransition` decides it from both ends of
      // the attempted edge — so submitting before funding reports
      // DEAL_NOT_FUNDED and a double-tap reports whatever the machine says,
      // without this route guessing at one.
      case 'illegal':
        return Response.json(errorResponse(result.code), {
          status: ErrorHttpStatus[result.code],
        });
    }
  }

  return Response.json(
    {
      deal_id: result.dealId,
      deliverable_id: result.deliverableId,
      status: result.status,
      // ISO string, like every timestamp in these envelopes.
      submitted_at: result.submittedAt.toISOString(),
    },
    { status: 200 }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleSubmitDeliverable(request, id);
}
