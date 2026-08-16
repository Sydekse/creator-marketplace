import { guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { listWorklistForAdmin } from '@/lib/admin/overview';
import type { AdminOverviewDeps } from '@/lib/admin/overview';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  overviewDeps?: AdminOverviewDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `GET /api/admin/worklist` — deals whose money is held and unresolved
 * (KAN-53 AC-4), shown alongside the verification queue in the admin console.
 *
 * The set is `REFUNDABLE_FROM` — every deal the resolve endpoint can act on —
 * so the worklist and the mutation agree by construction (module header). The
 * route is named `/worklist`, not `/disputes`: these deals are in flight, not
 * necessarily disputed, and a label that overclaims would have an operator act
 * as though every row were one. Read-only here; resolving happens through the
 * audited resolve endpoint (AC-5).
 *
 * Admin gate first; the module re-gates inside `listWorklistForAdmin`.
 */
export async function handleListWorklist(deps?: RouteDeps): Promise<Response> {
  const guardFn = deps?.guard ?? guard;
  try {
    await guardFn({ roles: ['admin'] });
  } catch (error) {
    return toErrorResponse(error);
  }

  const deals = await listWorklistForAdmin(deps?.overviewDeps);

  return Response.json({ deals }, { status: 200 });
}

export async function GET(): Promise<Response> {
  return handleListWorklist();
}
