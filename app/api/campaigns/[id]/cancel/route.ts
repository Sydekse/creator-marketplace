import { cancelCampaign } from '@/lib/campaigns/cancel';
import { guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  errorResponse,
} from '@/lib/validation';

export const runtime = 'nodejs';

export interface RouteDeps {
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/campaigns/{id}/cancel` — cancel a draft or confirmed campaign
 * (KAN-99 §5).
 *
 * Takes no body. Only the brand that owns the campaign can cancel it, and only
 * before funding (draft or confirmed). A funded campaign is on the money path
 * and cannot be cancelled here.
 */
export async function handleCancelCampaign(
  id: string,
  deps?: RouteDeps
): Promise<Response> {
  let brandProfileId: string;
  try {
    if (!UUID_REGEX.test(id)) {
      return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
        status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
      });
    }

    const guardFn = deps?.guard ?? guard;
    const ctx = await guardFn({ roles: ['brand'] });
    brandProfileId = ctx.brandProfileId!;
  } catch (error) {
    return toErrorResponse(error);
  }

  const result = await cancelCampaign(id, brandProfileId);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
        status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
      });
    }
    // not_cancellable → the campaign is funded or already terminal.
    return Response.json(errorResponse(ErrorCode.VALIDATION_ERROR), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  return Response.json({ status: result.status });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleCancelCampaign(id);
}
