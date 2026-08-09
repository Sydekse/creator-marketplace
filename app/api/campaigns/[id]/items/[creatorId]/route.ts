import { removeFromCart } from '@/lib/campaigns/remove-from-cart';
import type { RemoveFromCartDeps } from '@/lib/campaigns/remove-from-cart';
import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  errorResponse,
} from '@/lib/validation';

export const runtime = 'nodejs';

export interface RouteDeps {
  removeFromCartDeps?: RemoveFromCartDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `DELETE /api/campaigns/{id}/items/{creatorId}`
 */
export async function handleDeleteCampaignItem(
  request: Request,
  id: string,
  creatorId: string,
  deps?: RouteDeps
): Promise<Response> {
  let brandProfileId: string;
  try {
    if (!UUID_REGEX.test(id)) {
      throw new ForbiddenError('malformed id');
    }
    if (!UUID_REGEX.test(creatorId)) {
      throw new ForbiddenError('malformed creatorId');
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
  } catch (error) {
    return toErrorResponse(error);
  }

  const result = await removeFromCart(
    id,
    brandProfileId,
    creatorId,
    deps?.removeFromCartDeps
  );

  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
          status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
        });
      case 'not_draft':
        return Response.json(errorResponse(ErrorCode.CAMPAIGN_NOT_DRAFT), {
          status: ErrorHttpStatus[ErrorCode.CAMPAIGN_NOT_DRAFT],
        });
      case 'item_not_found':
        return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
          status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
        });
    }
  }

  return Response.json(
    {
      running_total: result.runningTotal,
      remaining_budget: result.remainingBudget,
    },
    { status: 200 }
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; creatorId: string }> }
): Promise<Response> {
  const { id, creatorId } = await params;
  return handleDeleteCampaignItem(request, id, creatorId);
}
