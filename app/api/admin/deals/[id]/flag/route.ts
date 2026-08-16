import { guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { setDealFlagged } from '@/lib/deals/flag-deal';
import type { FlagDealDeps } from '@/lib/deals/flag-deal';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  errorResponse,
  flagDealSchema,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  flagDeps?: FlagDealDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/admin/deals/{id}/flag` — mark a deal flagged (or clear the flag),
 * the F40 state AC-030 and KAN-53 AC-4 presuppose (KAN-69).
 *
 * **The flag is attention metadata, not a status** — see `lib/deals/flag-deal.ts`
 * for why. This endpoint is the *setter*: flagging raises the attention state,
 * the disputed-deals worklist surfaces it, and the resolve endpoint clears it
 * in the same transaction as the resolution.
 *
 * Admin gate first, then the shape check: a malformed id is a 404 on an admin
 * route (the `verify`/`resolve` convention — a well-formed request naming a
 * row that cannot exist), never a Postgres `22P02` → 500. The module re-gates
 * inside `withAdminAudit`, so the mutation is safe regardless of caller
 * (the double-check every admin module keeps). Missing deal → 404; body
 * failure → 422 `VALIDATION_ERROR`.
 */
export async function handleFlagDeal(
  id: string,
  request: Request,
  deps?: RouteDeps
): Promise<Response> {
  const guardFn = deps?.guard ?? guard;
  try {
    await guardFn({ roles: ['admin'] });
  } catch (error) {
    return toErrorResponse(error);
  }

  if (!UUID_REGEX.test(id)) {
    return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
      status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(errorResponse(ErrorCode.VALIDATION_ERROR), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const parsed = flagDealSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(errorResponse(ErrorCode.VALIDATION_ERROR), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await setDealFlagged(id, parsed.data, deps?.flagDeps);

  if (!result) {
    return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
      status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
    });
  }

  return Response.json(
    {
      deal_id: result.id,
      flagged: result.flagged,
      status: result.status,
    },
    { status: 200 }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleFlagDeal(id, request);
}
