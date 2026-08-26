import { bulkAddToCart } from '@/lib/campaigns/bulk-add-to-cart';
import type { BulkAddToCartDeps } from '@/lib/campaigns/bulk-add-to-cart';
import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  bulkAddCampaignItemsSchema,
  errorResponse,
  fromZodError,
  validationError,
} from '@/lib/validation';
import { formatEtb } from '@/lib/money';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  bulkAddToCartDeps?: BulkAddToCartDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/campaigns/{id}/items/bulk` — add several marked creators to the
 * cart in one transaction (the discover grid's mark-and-add flow).
 *
 * Same contract as the single-item route, plus `added`/`updated` counts so the
 * client can say what the batch did. The batch is atomic: one bad creator or a
 * broken budget ceiling refuses all of it.
 */
export async function handleBulkAddCampaignItems(
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

  const parsed = bulkAddCampaignItemsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await bulkAddToCart(
    id,
    brandProfileId,
    parsed.data,
    deps?.bulkAddToCartDeps
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
        return Response.json(
          errorResponse(ErrorCode.CREATOR_NOT_BOOKABLE, {
            // The batch names the creator it stopped on, so the brand can
            // unmark them rather than guess which tile broke the add.
            creator: [result.creatorId ?? 'unknown'],
          }),
          { status: ErrorHttpStatus[ErrorCode.CREATOR_NOT_BOOKABLE] }
        );
      case 'budget_exceeded': {
        const excess = result.excess;
        return Response.json(
          errorResponse(ErrorCode.BUDGET_EXCEEDED, {
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
      added: result.added,
      updated: result.updated,
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
  return handleBulkAddCampaignItems(request, id);
}
