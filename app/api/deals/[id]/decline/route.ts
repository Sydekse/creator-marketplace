import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { declineOffer } from '@/lib/deals/decline-offer';
import type { DeclineOfferDeps } from '@/lib/deals/decline-offer';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  errorResponse,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  declineOfferDeps?: DeclineOfferDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/deals/{id}/decline` — the creator declines an offer and the cost
 * goes back to the brand's available budget (KAN-37, AC-018, Tech Spec §4.4).
 *
 * **No request body.** §4.4 specifies none, and there is nothing a decline could
 * carry: the deal is in the path, the creator is in the session, and no reason is
 * asked for. So this route has no `request.json()`, no schema, and no 422 — the
 * three responses §4.4 lists (200, 409, 403) are the three it can produce.
 *
 * Everything else mirrors the accept route, deliberately. The shape check runs
 * before the guard because Postgres answers a non-uuid against a `uuid` column
 * with `22P02`; `not_found` collapses into 403 so the URL is not an existence
 * oracle; and the 409's code comes from the state machine rather than being
 * chosen here.
 */
export async function handleDeclineDeal(
  id: string,
  deps?: RouteDeps
): Promise<Response> {
  let creatorProfileId: string;
  let actorUserId: string;
  try {
    if (!UUID_REGEX.test(id)) {
      // Denied rather than 404'd, for the reason every owner-scoped route gives:
      // an id nobody owns is not an id anyone gets told about.
      throw new ForbiddenError('malformed id');
    }

    const guardFn = deps?.guard ?? guard;
    const ctx = await guardFn({
      roles: ['creator'],
      resource: { kind: 'deal', id },
    });

    // "Only the creator on the deal can decline." The role gate admits creators;
    // the resource check above admits only the one this deal belongs to. A
    // creator with no profile row cannot own a deal at all, so there is nothing
    // left to authorise.
    if (!ctx.creatorProfileId) {
      throw new ForbiddenError('missing creator profile');
    }

    creatorProfileId = ctx.creatorProfileId;
    actorUserId = ctx.user.id;
  } catch (error) {
    return toErrorResponse(error);
  }

  // Both ids come from the session, never from the request. The actor written to
  // the `deal_event` is therefore whoever is signed in, which is what makes the
  // audit trail worth having.
  const result = await declineOffer(
    id,
    { creatorProfileId, actorUserId },
    deps?.declineOfferDeps
  );

  if (!result.ok) {
    switch (result.reason) {
      // The guard already denied anyone who does not own this deal, so reaching
      // this means the row went away between the two reads — still not something
      // to answer with a distinct 404.
      case 'not_found':
        return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
          status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
        });
      // "Declining is only legal from `pending`; any other status returns 409
      // `OFFER_NOT_PENDING`." The code is the state machine's own —
      // `getErrorCodeForInvalidTransition` decides it from both ends of the
      // attempted edge, which is also how an already-swept `expired` deal gets
      // `OFFER_EXPIRED` here without this route knowing about expiry.
      case 'illegal':
        return Response.json(errorResponse(result.code), {
          status: ErrorHttpStatus[result.code],
        });
    }
  }

  return Response.json(
    {
      deal_id: result.dealId,
      status: 'declined',
      // Snake case like every other field in this envelope, and integer santim
      // (invariant 4) — the client formats it, the API does not.
      released_amount: result.releasedAmount,
    },
    { status: 200 }
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleDeclineDeal(id);
}
