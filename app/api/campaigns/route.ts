import { createCampaign } from '@/lib/campaigns/create-campaign';
import type { CreateCampaignDeps } from '@/lib/campaigns/create-campaign';
import { listDraftCampaignsByBrand } from '@/lib/campaigns/queries';
import type { CampaignRow } from '@/lib/campaigns/queries';
import { guard, toErrorResponse } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  createCampaignSchema,
  errorResponse,
  fromZodError,
  validationError,
} from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * `POST /api/campaigns` — create a campaign brief in draft (KAN-26, US-003, AC-007, AC-008).
 *
 * Contract order:
 *   1. Authorize via guard({ roles: ['brand'] }). Caller must have an onboarded brand profile.
 *   2. Parse JSON.
 *   3. Special-case budget <= 0 -> 422 BUDGET_NOT_POSITIVE.
 *   4. Validate schema with createCampaignSchema.
 *   5. Insert campaign in 'draft' status.
 */
export async function handleCreateCampaign(
  request: Request,
  deps?: CreateCampaignDeps
): Promise<Response> {
  let brandProfileId: string;
  try {
    const ctx = await guard({ roles: ['brand'] });
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

  const parsed = createCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await createCampaign(brandProfileId, parsed.data, deps);
  if (!result.ok) {
    return Response.json(errorResponse(ErrorCode.BUDGET_NOT_POSITIVE), {
      status: ErrorHttpStatus[ErrorCode.BUDGET_NOT_POSITIVE],
    });
  }

  return Response.json(
    { id: result.campaign.id, status: result.campaign.status },
    { status: 201 }
  );
}

export interface ListCampaignsDeps {
  listDrafts: (brandProfileId: string) => Promise<CampaignRow[]>;
}

/**
 * `GET /api/campaigns` — list the signed-in brand's draft campaigns.
 */
export async function handleListCampaigns(
  request: Request,
  deps?: ListCampaignsDeps
): Promise<Response> {
  let brandProfileId: string;
  try {
    const ctx = await guard({ roles: ['brand'] });
    if (!ctx.brandProfileId) {
      return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
        status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
      });
    }
    brandProfileId = ctx.brandProfileId;
  } catch (error) {
    return toErrorResponse(error);
  }

  const listFn = deps?.listDrafts ?? listDraftCampaignsByBrand;
  const rows = await listFn(brandProfileId);

  const serialized = rows.map((row) => ({
    id: row.id,
    name: row.name,
    goal: row.goal,
    target_audience: row.targetAudience,
    budget: row.budget,
    desired_videos: row.desiredVideos,
    status: row.status,
    created_at:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
  }));

  return Response.json(serialized, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateCampaign(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleListCampaigns(request);
}
