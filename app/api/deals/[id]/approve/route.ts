import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { approveDeliverable } from '@/lib/deals/approve-deliverable';
import type { ApproveDeliverableDeps } from '@/lib/deals/approve-deliverable';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  errorResponse,
  expectedVersionsSchema,
  validationError,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  approveDeliverableDeps?: ApproveDeliverableDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/deals/{id}/approve` — the brand approves a delivered video; the
 * held funds are released to the creator minus commission and the deal moves
 * to `completed` (KAN-45, AC-023, Tech Spec §4.4 approve).
 *
 * The body echoes the versions the brand reviewed. The ledger compares the
 * entire set under its deal lock before contacting the provider. Payment
 * amounts still come exclusively from the stored deal, never the request.
 *
 * Not idempotent, and deliberately not pretending to be: a second approval
 * is a 409, not a 200 with the first call's figures. AC-6 asks that paying
 * twice be *impossible*, and answering 200 would tell a brand a second
 * capture succeeded.
 */
export async function handleApproveDeliverable(
  id: string,
  deps?: RouteDeps,
  request?: Request
): Promise<Response> {
  let brandProfileId: string;
  let actorUserId: string;
  try {
    if (!UUID_REGEX.test(id)) {
      // Shape-checked before the guard reaches the database: Postgres answers
      // a non-uuid compared against a `uuid` column with `22P02`, which would
      // turn a mistyped link into a 500. Denied rather than 404'd for the
      // same reason every owner-scoped route does it.
      throw new ForbiddenError('malformed id');
    }

    const guardFn = deps?.guard ?? guard;
    // Both layers, before any money moves (NFR-005): brand-only, and this
    // brand's own deal. `payoutForDeal` locks by deal id alone, so this gate
    // and the action's own `brandProfileId` filter are the only things
    // standing between a valid deal id and somebody else's payout.
    const ctx = await guardFn({
      roles: ['brand'],
      resource: { kind: 'deal', id },
    });

    if (!ctx.brandProfileId) {
      throw new ForbiddenError('missing brand profile');
    }

    brandProfileId = ctx.brandProfileId;
    actorUserId = ctx.user.id;
  } catch (error) {
    return toErrorResponse(error);
  }

  const body = await request?.json().catch(() => null);
  const versions = expectedVersionsSchema.safeParse(body?.expectedVersions);
  if (!versions.success)
    return Response.json(
      validationError({
        _root: ['Reload the page before approving the current videos.'],
      }),
      { status: 422 }
    );
  const result = await approveDeliverable(
    id,
    brandProfileId,
    actorUserId,
    deps?.approveDeliverableDeps,
    versions.data
  );

  if (!result.ok) {
    switch (result.reason) {
      case 'conflict':
        return Response.json(
          errorResponse(ErrorCode.DELIVERABLE_VERSION_STALE),
          { status: 409 }
        );
      // Collapsed into 403 like every other owner-scoped route: a distinct
      // 404 would make this endpoint an existence oracle for other brands'
      // deal ids.
      case 'not_found':
        return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
          status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
        });
      // AC bullet 4. The code is the ledger's own — `payoutForDeal` re-reads
      // the row under its lock and answers with DEAL_NOT_DELIVERED — so an
      // unfunded, an already-completed, or a revision-requested deal all
      // surface the same refusal, and a double-approval pays nothing twice.
      case 'not_delivered':
        return Response.json(errorResponse(ErrorCode.DEAL_NOT_DELIVERED), {
          status: ErrorHttpStatus[ErrorCode.DEAL_NOT_DELIVERED],
        });
      // Nothing was paid and the deal is untouched (the provider call is
      // inside the ledger's transaction), so retrying is reasonable.
      case 'payment_failed':
        return Response.json(errorResponse(ErrorCode.PAYMENT_FAILED), {
          status: ErrorHttpStatus[ErrorCode.PAYMENT_FAILED],
        });
    }
  }

  // Echoed so the client can confirm what actually moved without re-reading
  // the ledger — the same figures the entries were written from, split from
  // the deal's snapshotted commission_rate inside the transaction.
  return Response.json(
    {
      deal_id: result.dealId,
      status: result.status,
      payout: result.payout,
      commission: result.commission,
    },
    { status: 200 }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleApproveDeliverable(id, undefined, request);
}
