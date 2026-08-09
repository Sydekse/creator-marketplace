import { addToCart } from '@/lib/campaigns/add-to-cart';
import type { AddToCartDeps } from '@/lib/campaigns/add-to-cart';
import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  addCampaignItemSchema,
  errorResponse,
  fromZodError,
  validationError,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  addToCartDeps?: AddToCartDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/campaigns/{id}/items` — add creator + video count to campaign cart (KAN-30, AC-013).
 */
export async function handleAddCampaignItem(
  request: Request,
  id: string,
  deps?: RouteDeps
): Promise<Response> {
  let brandProfileId: string;
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

  const parsed = addCampaignItemSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await addToCart(
    id,
    brandProfileId,
    parsed.data,
    deps?.addToCartDeps
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
      case 'creator_not_found':
      case 'creator_not_bookable':
        return Response.json(errorResponse(ErrorCode.CREATOR_NOT_BOOKABLE), {
          status: ErrorHttpStatus[ErrorCode.CREATOR_NOT_BOOKABLE],
        });
      case 'creator_already_in_cart':
        return Response.json(errorResponse(ErrorCode.CREATOR_ALREADY_IN_CART), {
          status: ErrorHttpStatus[ErrorCode.CREATOR_ALREADY_IN_CART],
        });
    }
  }

  return Response.json(
    {
      item: { id: result.item.id },
      running_total: result.runningTotal,
      remaining_budget: result.remainingBudget,
    },
    { status: 200 }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleAddCampaignItem(request, id);
}
