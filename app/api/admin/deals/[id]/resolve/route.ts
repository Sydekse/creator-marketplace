import { guard, toErrorResponse } from '@/lib/authz';
import type { AuthzContext, GuardOptions } from '@/lib/authz';
import { resolveDispute } from '@/lib/deals/resolve-dispute';
import type { ResolveDisputeDeps } from '@/lib/deals/resolve-dispute';
import {
  ErrorCode,
  ErrorHttpStatus,
  UUID_REGEX,
  errorResponse,
  fromZodError,
  resolveDisputeSchema,
  validationError,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface RouteDeps {
  resolveDisputeDeps?: ResolveDisputeDeps;
  guard?: (opts: GuardOptions) => Promise<AuthzContext>;
}

/**
 * `POST /api/admin/deals/{id}/resolve` — an admin resolves a disputed deal:
 * release funds to the creator, refund the brand, or request a revision
 * (KAN-51, AC-030, Tech Spec §4.6 resolve).
 *
 * **Admin-only, and the gate runs before the body is read** — the ordering
 * `POST /api/brands` established and every admin route keeps: a caller who is
 * not an admin never gets as far as having their JSON parsed, so a 403 and a
 * 422 cannot be played off each other to probe the endpoint. The action itself
 * re-checks the role inside `withAdminAudit`, so the audit row is attributable
 * and the double-check is the audit-log route's documented one.
 *
 * **A missing or malformed deal is a 404, not an oracle.** This is an admin
 * route: there is no owner to protect, so the admin-route convention applies —
 * a well-formed request naming a row that cannot exist answers `NOT_FOUND`
 * (the same call `verify/route.ts` makes), and a mistyped id is caught here
 * before it reaches a `uuid` column and becomes a Postgres `22P02` → 500.
 *
 * **The 409s are the machine's and the ledger's own codes.** The action maps
 * what it refuses without inventing a code: `release` on an undelivered deal
 * is `DEAL_NOT_DELIVERED`, `refund` from a non-refundable status is
 * `DEAL_NOT_FUNDED`, `revision` on a funded deal is `DEAL_NOT_DELIVERED`, and
 * a provider decline is `PAYMENT_FAILED`. An empty `note` — including a body
 * that is all whitespace, trimmed by the schema — is a plain
 * `VALIDATION_ERROR` 422 and resolves nothing (AC-5).
 */
export async function handleResolveDispute(
  request: Request,
  id: string,
  deps?: RouteDeps
): Promise<Response> {
  let actorUserId: string;
  try {
    const guardFn = deps?.guard ?? guard;
    const ctx = await guardFn({ roles: ['admin'] });
    actorUserId = ctx.user.id;
  } catch (error) {
    return toErrorResponse(error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      validationError({ _root: ['Request body must be valid JSON.'] }),
      { status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR] }
    );
  }

  const parsed = resolveDisputeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  // Malformed id after auth + validation, following `verify/route.ts`: a
  // well-formed request naming a row that cannot exist is a 404, not a 500.
  if (!UUID_REGEX.test(id)) {
    return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
      status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
    });
  }

  const result = await resolveDispute(
    id,
    { resolution: parsed.data.resolution, note: parsed.data.note },
    actorUserId,
    deps?.resolveDisputeDeps
  );

  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
          status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
        });
      case 'illegal':
        // The code is the ledger's or the machine's own refusal (see the
        // module header) — never guessed by this route.
        return Response.json(errorResponse(result.code), {
          status: ErrorHttpStatus[result.code],
        });
      case 'payment_failed':
        return Response.json(errorResponse(ErrorCode.PAYMENT_FAILED), {
          status: ErrorHttpStatus[ErrorCode.PAYMENT_FAILED],
        });
    }
  }

  // Echoed so the client can confirm what actually resolved without re-reading
  // the row — the figures the ledger wrote from on `release`, absent otherwise.
  return Response.json(
    {
      deal_id: result.dealId,
      status: result.status,
      resolution: result.resolution,
      ...(result.resolution === 'release'
        ? { payout: result.payout, commission: result.commission }
        : {}),
    },
    { status: 200 }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleResolveDispute(request, id);
}
