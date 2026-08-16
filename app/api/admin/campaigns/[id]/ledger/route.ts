import { guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { getCampaignLedgerForAdmin } from '@/lib/admin/overview';
import type { AdminOverviewDeps } from '@/lib/admin/overview';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  errorResponse,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  overviewDeps?: AdminOverviewDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `GET /api/admin/campaigns/{id}/ledger` — one campaign's ledger entries with
 * their running balances and a reconciliation answer (KAN-53 AC-3, Tech Spec
 * §3.2 `ledger_entry`).
 *
 * Admin gate first, then the shape check: a malformed id is a 404 on an admin
 * route (the `verify`/`resolve` convention — a well-formed request naming a
 * row that cannot exist), never a Postgres `22P02` → 500. The module gate
 * re-runs inside `getCampaignLedgerForAdmin`, so the query is safe regardless
 * of which caller reaches it.
 *
 * `reconciled` is the answer to AC-3's "confirm the balance reconciles":
 * `sum(amount)` equals the stored final `balance_after`.
 */
export async function handleCampaignLedger(
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

  const result = await getCampaignLedgerForAdmin(id, deps?.overviewDeps);

  if (!result) {
    return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
      status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
    });
  }

  return Response.json(result, { status: 200 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleCampaignLedger(id);
}
