import { updateCampaign } from '@/lib/campaigns/update-campaign';
import type { UpdateCampaignDeps } from '@/lib/campaigns/update-campaign';
import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  errorResponse,
  fromZodError,
  updateCampaignSchema,
  validationError,
  UUID_REGEX,
} from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * `PATCH /api/campaigns/:id` — update a draft campaign brief (KAN-26).
 */
export async function handleUpdateCampaign(
  request: Request,
  id: string,
  deps?: UpdateCampaignDeps
): Promise<Response> {
  let brandProfileId: string;
  try {
    if (!UUID_REGEX.test(id)) {
      throw new ForbiddenError('malformed id');
    }

    const ctx = await guard({
      roles: ['brand'],
      resource: { kind: 'campaign', id },
    });
    if (!ctx.brandProfileId) {
      return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
        status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
      });
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

  // Non-positive budget returns the dedicated 422 BUDGET_NOT_POSITIVE
  if (
    typeof body === 'object' &&
    body !== null &&
    'budget' in body &&
    typeof (body as { budget?: unknown }).budget === 'number' &&
    (body as { budget: number }).budget <= 0
  ) {
    return Response.json(errorResponse(ErrorCode.BUDGET_NOT_POSITIVE), {
      status: ErrorHttpStatus[ErrorCode.BUDGET_NOT_POSITIVE],
    });
  }

  const parsed = updateCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await updateCampaign(id, brandProfileId, parsed.data, deps);
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
        status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
      });
    }
    if (result.reason === 'not_draft') {
      return Response.json(errorResponse(ErrorCode.CAMPAIGN_NOT_DRAFT), {
        status: ErrorHttpStatus[ErrorCode.CAMPAIGN_NOT_DRAFT],
      });
    }
    return Response.json(errorResponse(ErrorCode.BUDGET_NOT_POSITIVE), {
      status: ErrorHttpStatus[ErrorCode.BUDGET_NOT_POSITIVE],
    });
  }

  return Response.json(
    {
      id: result.campaign.id,
      name: result.campaign.name,
      goal: result.campaign.goal,
      target_audience: result.campaign.targetAudience,
      budget: result.campaign.budget,
      desired_videos: result.campaign.desiredVideos,
      status: result.campaign.status,
    },
    { status: 200 }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleUpdateCampaign(request, id);
}
