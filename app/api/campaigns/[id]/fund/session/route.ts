import {
  cancelFundingSession,
  createFundingSession,
} from '@/lib/campaigns/fund-session';
import type {
  CancelFundingSessionDeps,
  FundingSessionDeps,
} from '@/lib/campaigns/fund-session';
import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  errorResponse,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  createDeps?: FundingSessionDeps;
  cancelDeps?: CancelFundingSessionDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * The Chapa-mode counterpart of `POST /fund` (KAN-70).
 *
 * `POST /api/campaigns/{id}/fund/session` — open (or resume) a hosted
 * checkout and answer its URL; the client's next move is a redirect, not a
 * refresh. `DELETE` — dismiss the open session so the fund button returns.
 *
 * The same double gate as the fund route, for the same reason: the session
 * write and the eventual settlement are keyed by campaign id alone, so this
 * gate plus the action's own `brandProfileId` filter are what stand between a
 * valid campaign id and opening checkouts against somebody else's campaign.
 */
async function guardBrand(
  id: string,
  deps?: RouteDeps
): Promise<
  | { ok: true; brandProfileId: string; email: string; name: string | null }
  | { ok: false; response: Response }
> {
  try {
    if (!UUID_REGEX.test(id)) throw new ForbiddenError('malformed id');
    const guardFn = deps?.guard ?? guard;
    const ctx = await guardFn({
      roles: ['brand'],
      resource: { kind: 'campaign', id },
    });
    if (!ctx.brandProfileId) throw new ForbiddenError('missing brand profile');
    return {
      ok: true,
      brandProfileId: ctx.brandProfileId,
      email: ctx.user.email,
      name: ctx.user.name,
    };
  } catch (error) {
    return { ok: false, response: toErrorResponse(error) };
  }
}

export async function handleCreateFundingSession(
  id: string,
  origin: string,
  deps?: RouteDeps
): Promise<Response> {
  const gate = await guardBrand(id, deps);
  if (!gate.ok) return gate.response;

  const result = await createFundingSession(
    id,
    gate.brandProfileId,
    { email: gate.email, name: gate.name },
    origin,
    deps?.createDeps
  );

  if (!result.ok) {
    switch (result.reason) {
      // Collapsed into 403 like the fund route: a distinct 404 would make
      // this endpoint an existence oracle for other brands' campaign ids.
      case 'not_found':
        return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
          status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
        });
      case 'not_fundable':
        return Response.json(errorResponse(ErrorCode.CAMPAIGN_NOT_FUNDABLE), {
          status: ErrorHttpStatus[ErrorCode.CAMPAIGN_NOT_FUNDABLE],
        });
      case 'no_accepted_deals':
        return Response.json(errorResponse(ErrorCode.NO_ACCEPTED_DEALS), {
          status: ErrorHttpStatus[ErrorCode.NO_ACCEPTED_DEALS],
        });
      // Chapa unreachable or refusing. Nothing was written; the brand's next
      // move is simply to try again, which PAYMENT_FAILED's sentence says.
      case 'gateway_unavailable':
        return Response.json(errorResponse(ErrorCode.PAYMENT_FAILED), {
          status: ErrorHttpStatus[ErrorCode.PAYMENT_FAILED],
        });
    }
  }

  return Response.json(
    {
      tx_ref: result.txRef,
      checkout_url: result.checkoutUrl,
      amount: result.amount,
      resumed: result.resumed,
    },
    { status: result.resumed ? 200 : 201 }
  );
}

export async function handleCancelFundingSession(
  id: string,
  deps?: RouteDeps
): Promise<Response> {
  const gate = await guardBrand(id, deps);
  if (!gate.ok) return gate.response;

  const result = await cancelFundingSession(
    id,
    gate.brandProfileId,
    deps?.cancelDeps
  );

  if (!result.ok) {
    return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
      status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
    });
  }

  // Idempotent by design: cancelling twice, or cancelling a session that just
  // settled, both answer the same "nothing is open now".
  return Response.json({ cancelled: result.cancelled }, { status: 200 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleCreateFundingSession(id, new URL(request.url).origin);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleCancelFundingSession(id);
}
