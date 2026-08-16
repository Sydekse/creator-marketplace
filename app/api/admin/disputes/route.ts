import { guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { listDisputedDealsForAdmin } from '@/lib/admin/overview';
import type { AdminOverviewDeps } from '@/lib/admin/overview';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  overviewDeps?: AdminOverviewDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `GET /api/admin/disputes` — the disputed-deals worklist (KAN-53 AC-4), shown
 * alongside the verification queue in the admin console.
 *
 * The set is `REFUNDABLE_FROM` — every deal whose money is held and unresolved,
 * which is exactly what `POST /api/admin/deals/{id}/resolve` can act on — so
 * the worklist and the mutation agree by construction (module header). Read-only
 * here; resolving happens through the audited resolve endpoint (AC-5).
 *
 * Admin gate first; the module re-gates inside `listDisputedDealsForAdmin`.
 */
export async function handleListDisputes(deps?: RouteDeps): Promise<Response> {
  const guardFn = deps?.guard ?? guard;
  try {
    await guardFn({ roles: ['admin'] });
  } catch (error) {
    return toErrorResponse(error);
  }

  const deals = await listDisputedDealsForAdmin(deps?.overviewDeps);

  return Response.json({ deals }, { status: 200 });
}

export async function GET(): Promise<Response> {
  return handleListDisputes();
}
