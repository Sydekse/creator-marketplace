import { requestWithdrawal } from '@/lib/wallet/withdraw';
import type { WithdrawDeps } from '@/lib/wallet/withdraw';
import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { ErrorCode, ErrorHttpStatus, errorResponse } from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  withdrawDeps?: WithdrawDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/creator/withdrawals` (KAN-70 PR 3) — move wallet money out.
 *
 * The route needs no resource in its guard: the wallet is the session's own,
 * resolved from `creatorProfileId`, so there is no id in the URL to get wrong
 * and no existence oracle to avoid. Everything after the gate is
 * `requestWithdrawal`'s problem — the serializable reserve is what stops a
 * double-spend, not anything here.
 */
export async function handleCreateWithdrawal(
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

  let amount: unknown;
  try {
    const body = (await request.json()) as { amount?: unknown };
    amount = body.amount;
  } catch {
    return Response.json(errorResponse(ErrorCode.VALIDATION_ERROR), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }
  if (typeof amount !== 'number') {
    return Response.json(errorResponse(ErrorCode.VALIDATION_ERROR), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await requestWithdrawal(
    creatorProfileId,
    amount,
    deps?.withdrawDeps
  );

  if (!result.ok) {
    switch (result.reason) {
      case 'invalid_amount':
        return Response.json(errorResponse(ErrorCode.VALIDATION_ERROR), {
          status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
        });
      case 'below_minimum':
        return Response.json(
          errorResponse(ErrorCode.WITHDRAWAL_BELOW_MINIMUM),
          { status: ErrorHttpStatus[ErrorCode.WITHDRAWAL_BELOW_MINIMUM] }
        );
      case 'no_payout_method':
        return Response.json(errorResponse(ErrorCode.NO_PAYOUT_METHOD), {
          status: ErrorHttpStatus[ErrorCode.NO_PAYOUT_METHOD],
        });
      // `conflict` is a concurrent withdrawal winning the serializable race —
      // by the time the creator retries, the balance reflects it, so the two
      // reasons earn the same sentence.
      case 'insufficient_balance':
      case 'conflict':
        return Response.json(errorResponse(ErrorCode.INSUFFICIENT_BALANCE), {
          status: ErrorHttpStatus[ErrorCode.INSUFFICIENT_BALANCE],
        });
      // Chapa down or refusing (`gateway_unavailable` before any write,
      // `transfer_rejected` after the row already failed-and-re-credited).
      // Both answer PAYMENT_FAILED: nothing is lost, trying again is the move.
      case 'gateway_unavailable':
      case 'transfer_rejected':
        return Response.json(errorResponse(ErrorCode.PAYMENT_FAILED), {
          status: ErrorHttpStatus[ErrorCode.PAYMENT_FAILED],
        });
    }
  }

  return Response.json(
    {
      id: result.withdrawal.id,
      tx_ref: result.withdrawal.txRef,
      amount: result.withdrawal.amount,
      status: result.withdrawal.status,
      bank_name: result.withdrawal.bankName,
      account_number_masked: result.withdrawal.accountNumberMasked,
    },
    { status: 201 }
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleCreateWithdrawal(request);
}
