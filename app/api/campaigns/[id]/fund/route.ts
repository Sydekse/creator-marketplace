import { fundCampaign } from '@/lib/campaigns/fund-campaign';
import type { FundCampaignDeps } from '@/lib/campaigns/fund-campaign';
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
  fundCampaignDeps?: FundCampaignDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/campaigns/{id}/fund` — hold the accepted total in escrow (KAN-43,
 * AC-019, Tech Spec §4.3).
 *
 * Takes no request body, for the reason the confirm route gives and one more: the
 * amount is summed from the accepted deals under a row lock, so a client-supplied
 * total would be a second source for a number that already has an authoritative
 * one. There is nothing about this request for a client to vary except which
 * campaign, which is in the path.
 *
 * Not idempotent, and deliberately not pretending to be: a second call is a 409,
 * not a 200 with the first call's figures. AC bullet 7 asks that funding twice be
 * *rejected*, and answering 200 would tell a brand a second capture succeeded.
 */
export async function handleFundCampaign(
  id: string,
  deps?: RouteDeps
): Promise<Response> {
  let brandProfileId: string;
  let actorUserId: string;
  try {
    if (!UUID_REGEX.test(id)) {
      throw new ForbiddenError('malformed id');
    }

    const guardFn = deps?.guard ?? guard;
    // Both layers, before any money moves (NFR-005): brand-only, and this
    // brand's own campaign. `holdForCampaign` locks by id alone, so this gate and
    // the action's own `brandProfileId` filter are the only things standing
    // between a valid campaign id and somebody else's escrow.
    const ctx = await guardFn({
      roles: ['brand'],
      resource: { kind: 'campaign', id },
    });

    if (!ctx.brandProfileId) {
      throw new ForbiddenError('missing brand profile');
    }

    brandProfileId = ctx.brandProfileId;
    actorUserId = ctx.user.id;
  } catch (error) {
    return toErrorResponse(error);
  }

  const result = await fundCampaign(
    id,
    brandProfileId,
    actorUserId,
    deps?.fundCampaignDeps
  );

  if (!result.ok) {
    switch (result.reason) {
      // Collapsed into 403 like every other owner-scoped route: a distinct 404
      // would make this endpoint an existence oracle for other brands' campaign
      // ids.
      case 'not_found':
        return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
          status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
        });
      // AC bullet 2. The one failure with a specific cause worth naming: the
      // brand's next move is to wait for acceptances, not to reload and retry.
      case 'no_accepted_deals':
        return Response.json(errorResponse(ErrorCode.NO_ACCEPTED_DEALS), {
          status: ErrorHttpStatus[ErrorCode.NO_ACCEPTED_DEALS],
        });
      // AC bullet 7, and the not-yet-confirmed case. One code for both, because
      // the client's response to either is to re-read the campaign.
      case 'not_fundable':
        return Response.json(errorResponse(ErrorCode.CAMPAIGN_NOT_FUNDABLE), {
          status: ErrorHttpStatus[ErrorCode.CAMPAIGN_NOT_FUNDABLE],
        });
      case 'payment_failed':
        return Response.json(errorResponse(ErrorCode.PAYMENT_FAILED), {
          status: ErrorHttpStatus[ErrorCode.PAYMENT_FAILED],
        });
    }
  }

  return Response.json(
    {
      campaign_id: result.campaignId,
      deals_funded: result.dealCount,
      total_held: result.totalHeld,
    },
    { status: 200 }
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleFundCampaign(id);
}
