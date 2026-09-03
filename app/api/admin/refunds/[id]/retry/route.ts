import { toErrorResponse } from '@/lib/authz';
import { retryRefundForAdmin } from '@/lib/admin/payments';
import type { RetryRefundDeps } from '@/lib/admin/payments';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  errorResponse,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  retryDeps?: RetryRefundDeps;
}

/**
 * `POST /api/admin/refunds/{id}/retry` — an admin retries a failed external
 * (Chapa) refund from the payments view (KAN-70 PR 4).
 *
 * The books are already correct — the internal escrow refund committed when
 * the dispute resolved — so this route only re-asks the gateway to move the
 * external money. Idempotency lives in `issueExternalRefund`'s claim: a row
 * already `processing` or `refunded` answers `REFUND_ALREADY_SETTLED` (409),
 * so a double-click cannot ask Chapa twice.
 *
 * Admin-only via the gate inside `retryRefundForAdmin` (there is no body to
 * parse, so the gate-before-body ordering is trivially satisfied); a
 * malformed id is a 404 before it can reach a `uuid` column and become a
 * Postgres `22P02` → 500, following `resolve/route.ts`.
 */
export async function handleRetryRefund(
  id: string,
  deps?: RouteDeps
): Promise<Response> {
  if (!UUID_REGEX.test(id)) {
    return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
      status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
    });
  }

  let result: Awaited<ReturnType<typeof retryRefundForAdmin>>;
  try {
    result = await retryRefundForAdmin(id, deps?.retryDeps);
  } catch (error) {
    return toErrorResponse(error);
  }

  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
          status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
        });
      case 'already_settled':
        return Response.json(errorResponse(ErrorCode.REFUND_ALREADY_SETTLED), {
          status: ErrorHttpStatus[ErrorCode.REFUND_ALREADY_SETTLED],
        });
      case 'gateway_rejected':
        return Response.json(errorResponse(ErrorCode.PAYMENT_FAILED), {
          status: ErrorHttpStatus[ErrorCode.PAYMENT_FAILED],
        });
    }
  }

  return Response.json(
    { refund_id: id, status: result.status },
    { status: 200 }
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleRetryRefund(id);
}
