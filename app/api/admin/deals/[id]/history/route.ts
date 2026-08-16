import { guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { getDealHistory } from '@/lib/deals/queries';
import type { DealHistoryDeps } from '@/lib/deals/queries';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  errorResponse,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  dealHistoryDeps?: DealHistoryDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `GET /api/admin/deals/{id}/history` — one deal's full `deal_event` history
 * in order (KAN-53 AC-2, FR-007, NFR-012).
 *
 * A thin surface over `getDealHistory`, deliberately: that read already serves
 * both parties *and* the admin (`allowAdmin: true`, `requireDealAccess`), with
 * its own ordering and actor folding — this route adds only the admin-first
 * gate (the double-check) and the admin-route 404 for a malformed id, then
 * hands the id straight to the existing read. No second copy of the history
 * query exists here.
 */
export async function handleDealHistory(
  id: string,
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

  const events = await getDealHistory(id, deps?.dealHistoryDeps);

  return Response.json({ events }, { status: 200 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleDealHistory(id);
}
