import { savePayoutMethod } from '@/lib/wallet/payout-method';
import type { PayoutMethodDeps } from '@/lib/wallet/payout-method';
import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { ErrorCode, ErrorHttpStatus, errorResponse } from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  methodDeps?: PayoutMethodDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `PUT /api/creator/payout-method` (KAN-70 PR 3) — set where withdrawals go.
 *
 * PUT because it is an upsert of the creator's single method: sending the
 * same body twice leaves the same row. The bank code is re-validated against
 * Chapa's own list inside `savePayoutMethod` — the form was fed from that
 * list, but a request is not a form.
 */
export async function handleSavePayoutMethod(
  request: Request,
  deps?: RouteDeps
): Promise<Response> {
  let creatorProfileId: string;
  try {
    const guardFn = deps?.guard ?? guard;
    const ctx = await guardFn({ roles: ['creator'] });
    if (!ctx.creatorProfileId) {
      throw new ForbiddenError('missing creator profile');
    }
    creatorProfileId = ctx.creatorProfileId;
  } catch (error) {
    return toErrorResponse(error);
  }

  let body: {
    bankCode?: unknown;
    accountNumber?: unknown;
    accountName?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(errorResponse(ErrorCode.VALIDATION_ERROR), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }
  if (
    typeof body.bankCode !== 'string' ||
    typeof body.accountNumber !== 'string' ||
    typeof body.accountName !== 'string'
  ) {
    return Response.json(errorResponse(ErrorCode.VALIDATION_ERROR), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await savePayoutMethod(
    creatorProfileId,
    {
      bankCode: body.bankCode,
      accountNumber: body.accountNumber,
      accountName: body.accountName,
    },
    deps?.methodDeps
  );

  if (!result.ok) {
    if (result.reason === 'gateway_unavailable') {
      return Response.json(errorResponse(ErrorCode.PAYMENT_FAILED), {
        status: ErrorHttpStatus[ErrorCode.PAYMENT_FAILED],
      });
    }
    return Response.json(
      errorResponse(ErrorCode.VALIDATION_ERROR, result.fieldErrors),
      { status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR] }
    );
  }

  return Response.json(
    {
      kind: result.method.kind,
      bank_code: result.method.bankCode,
      bank_name: result.method.bankName,
      account_number_masked: result.method.accountNumberMasked,
      account_name: result.method.accountName,
    },
    { status: 200 }
  );
}

export async function PUT(request: Request): Promise<Response> {
  return handleSavePayoutMethod(request);
}
