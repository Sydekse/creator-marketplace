import { guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { listCampaignsForAdmin } from '@/lib/admin/overview';
import type { AdminOverviewDeps } from '@/lib/admin/overview';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  overviewDeps?: AdminOverviewDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `GET /api/admin/campaigns` — every campaign with its budget and ledger
 * position (KAN-53 AC-1, Tech Spec §4.6).
 *
 * The admin gate runs here *and* inside `listCampaignsForAdmin` — the
 * double-check every admin read keeps: the route gate stops a non-admin
 * probing the endpoint, the module gate makes the query itself safe for any
 * future caller. There is no body to parse before authorizing, so the gate is
 * simply first.
 *
 * The money figures come from the ledger, not from statuses — `held` is the
 * same `sum(amount)` invariant 7 guards, `paidOut`/`commission`/`refunded`
 * are the three ways money left escrow (see the module header).
 */
export async function handleListCampaigns(deps?: RouteDeps): Promise<Response> {
  const guardFn = deps?.guard ?? guard;
  try {
    await guardFn({ roles: ['admin'] });
  } catch (error) {
    return toErrorResponse(error);
  }

  const campaigns = await listCampaignsForAdmin(deps?.overviewDeps);

  return Response.json({ campaigns }, { status: 200 });
}

export async function GET(): Promise<Response> {
  return handleListCampaigns();
}
