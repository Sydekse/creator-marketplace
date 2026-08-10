import { confirmCampaign } from '@/lib/campaigns/confirm-campaign';
import type { ConfirmCampaignDeps } from '@/lib/campaigns/confirm-campaign';
import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  errorResponse,
  validationError,
} from '@/lib/validation';
import { CONFIRM_EMPTY_CART_MESSAGE } from '@/lib/campaigns/constants';
import { formatEtb } from '@/lib/money';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  confirmCampaignDeps?: ConfirmCampaignDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/campaigns/{id}/confirm` — send a pending offer to every creator in
 * the cart (KAN-33, AC-016, Tech Spec §4.3).
 *
 * Takes no request body. The offers are entirely determined by what is already
 * in `campaign_item`, and accepting a body would invite a client to send a
 * different set of creators or prices than the one the brand reviewed.
 */
export async function handleConfirmCampaign(
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

  const result = await confirmCampaign(
    id,
    brandProfileId,
    actorUserId,
    deps?.confirmCampaignDeps
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
      case 'not_draft':
        return Response.json(errorResponse(ErrorCode.CAMPAIGN_NOT_DRAFT), {
          status: ErrorHttpStatus[ErrorCode.CAMPAIGN_NOT_DRAFT],
        });
      case 'empty_cart':
        return Response.json(
          validationError({ _root: [CONFIRM_EMPTY_CART_MESSAGE] }),
          { status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR] }
        );
      case 'budget_exceeded': {
        const excess = result.excess;
        return Response.json(
          errorResponse(ErrorCode.BUDGET_EXCEEDED, {
            // No trailing ` ETB` — `formatEtb` already ends in it, the KAN-32
            // fix that stopped this rendering as "by 0.01 ETB ETB.".
            excess: [
              `This exceeds your remaining budget by ${formatEtb(excess)}.`,
            ],
          }),
          { status: ErrorHttpStatus[ErrorCode.BUDGET_EXCEEDED] }
        );
      }
    }
  }

  return Response.json(
    {
      campaign_id: result.campaignId,
      deal_ids: result.dealIds,
      offers_sent: result.dealIds.length,
      total_committed: result.totalCommitted,
      offer_expires_at: result.offerExpiresAt.toISOString(),
    },
    { status: 200 }
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleConfirmCampaign(id);
}
