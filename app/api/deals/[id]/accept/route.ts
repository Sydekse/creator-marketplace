import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { acceptOffer } from '@/lib/deals/accept-offer';
import type { AcceptOfferDeps } from '@/lib/deals/accept-offer';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  acceptDealSchema,
  errorResponse,
  fromZodError,
  validationError,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  acceptOfferDeps?: AcceptOfferDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/deals/{id}/accept` — the creator accepts an offer and agrees to the
 * usage-rights terms (KAN-36, AC-017, Tech Spec §4.4).
 *
 * **The gate runs before the body is read.** A caller who does not own this deal
 * never gets as far as having their JSON parsed, so a 403 and a 422 cannot be
 * played off each other to learn whether a deal id exists. That ordering is the
 * whole reason the `guard` block sits above `request.json()` rather than beside
 * the action call.
 *
 * The body carries exactly one field, `rights_terms_id`. It is not trusted as
 * the value to record — `acceptOffer` stamps the version it reads itself — it is
 * only compared, which is what turns "the creator agreed to text that has since
 * been replaced" into a 409 instead of a silent mis-recorded agreement.
 */
export async function handleAcceptDeal(
  request: Request,
  id: string,
  deps?: RouteDeps
): Promise<Response> {
  let creatorProfileId: string;
  let actorUserId: string;
  try {
    if (!UUID_REGEX.test(id)) {
      // Shape-checked before the guard reaches the database: Postgres answers a
      // non-uuid compared against a `uuid` column with `22P02`, which would turn
      // a mistyped link into a 500. Denied rather than 404'd for the same reason
      // every owner-scoped route does it.
      throw new ForbiddenError('malformed id');
    }

    const guardFn = deps?.guard ?? guard;
    const ctx = await guardFn({
      roles: ['creator'],
      resource: { kind: 'deal', id },
    });

    // AC-6. The role gate admits creators; the resource check above admits only
    // the one this deal belongs to. A creator with no profile row cannot own a
    // deal at all, so there is nothing left to authorise.
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

  // AC-3's "the API rejects an accept call that omits `rights_terms_id`". A
  // missing field is a 422 here, before any query runs — accepting without
  // naming a terms version is not a thing the endpoint can do.
  const parsed = acceptDealSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await acceptOffer(
    id,
    {
      creatorProfileId,
      actorUserId,
      submittedRightsTermsId: parsed.data.rightsTermsId,
    },
    deps?.acceptOfferDeps
  );

  if (!result.ok) {
    switch (result.reason) {
      // Collapsed into 403 like every other owner-scoped route. The guard above
      // already denied anyone who does not own this deal, so reaching this means
      // the row went away between the two reads — still not something to answer
      // with a distinct 404.
      case 'not_found':
        return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
          status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
        });
      // AC-3. The one code whose client behaviour is a reload rather than just a
      // message: the offer screen renders the current terms for a pending deal,
      // so re-reading the page shows the version now in effect.
      case 'stale_terms':
        return Response.json(errorResponse(ErrorCode.RIGHTS_TERMS_STALE), {
          status: ErrorHttpStatus[ErrorCode.RIGHTS_TERMS_STALE],
        });
      // AC-4. The deal is still `pending` in the database — KAN-38's sweep has
      // not run — so this code comes from the deadline, not from the status.
      case 'expired':
        return Response.json(errorResponse(ErrorCode.OFFER_EXPIRED), {
          status: ErrorHttpStatus[ErrorCode.OFFER_EXPIRED],
        });
      // AC-4's other half, and the idempotency answer. The code is the state
      // machine's own — `getErrorCodeForInvalidTransition` decides it from both
      // ends of the attempted edge, so a second accept reports
      // OFFER_NOT_PENDING rather than this route guessing at one.
      case 'illegal':
        return Response.json(errorResponse(result.code), {
          status: ErrorHttpStatus[result.code],
        });
    }
  }

  return Response.json(
    {
      deal_id: result.dealId,
      status: 'accepted',
      rights_terms_id: result.rightsTermsId,
      rights_accepted_at: result.rightsAcceptedAt.toISOString(),
    },
    { status: 200 }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleAcceptDeal(request, id);
}
