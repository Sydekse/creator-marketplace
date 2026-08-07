import { eq } from 'drizzle-orm';
import { creatorProfile } from '@/db/schema';
import { guard, withAdminAudit, toErrorResponse } from '@/lib/authz';
import type { AdminAuditDeps, GuardOptions } from '@/lib/authz';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@/lib/audit/actions';
import {
  assignTier,
  tierOutcomeToResponse,
} from '@/lib/creators/tier-assignment';
import type {
  AssignTierDeps,
  TierOutcome,
} from '@/lib/creators/tier-assignment';
import { ErrorCode, ErrorHttpStatus, errorResponse } from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Canonical uuid shape, checked before the id reaches a query — same reasoning
 * as the verify route: `creator_profile.id` is a `uuid` column, so Postgres
 * answers a non-uuid comparison with `22P02` and turns a merely malformed
 * request into a 500.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown when the target is not `verified`. Typed, so the mapping below cannot break on a reworded string. */
export class CreatorNotVerifiedError extends Error {
  code = ErrorCode.CREATOR_NOT_VERIFIED;
  constructor() {
    super('This creator is not verified yet.');
    this.name = 'CreatorNotVerifiedError';
  }
}

export class CreatorNotFoundError extends Error {
  code = ErrorCode.NOT_FOUND;
  constructor() {
    super('Creator not found.');
    this.name = 'CreatorNotFoundError';
  }
}

export interface AssignTierRouteDeps {
  guard: (options: GuardOptions) => Promise<unknown>;
  adminAuditDeps?: Partial<AdminAuditDeps>;
  assignTierDeps?: AssignTierDeps;
}

interface AssignResult {
  id: string;
  tier: TierOutcome;
  before: { tierId: string | null };
}

/**
 * `POST /api/admin/creators/:id/assign-tier` — re-run tier assignment (KAN-23).
 *
 * The action behind "Retry assignment" on `/admin/tiers`. Assignment normally
 * happens once, on activation; this is what an admin uses after correcting a
 * creator's follower count or after a new band is seeded, so that fixing the
 * data does not require un-verifying and re-verifying somebody.
 *
 * Safe to press twice. `selectTier` is a pure function of the tiers and the
 * profile, so a second run selects the same tier as the first (AC-3) — the only
 * thing that accumulates is audit rows, which is the point of an append-only log.
 *
 * With one asymmetry worth stating, because it is the source of a misreading
 * (KAN-24, F12): a run that matches a tier *writes* it, but a run that matches
 * none never *clears* one. So an already-tiered creator whose numbers have since
 * fallen below every band gets `assigned: false` while keeping their existing
 * `tier_id` — and therefore staying bookable. That is deliberate. Clearing it
 * would silently un-book a creator who may hold live deals, and the alternative
 * of refusing to re-run on a tiered creator would break the case this route
 * exists for: re-seeding the ladder and upgrading somebody into a higher band.
 * The response carries `before.tier_id` so a caller can tell the two apart
 * rather than reading `assigned: false` as "this creator has no tier".
 *
 * `withAdminAudit` supplies both the admin role gate and the `audit_log` write
 * inside one transaction (invariant 9, AC-031).
 */
export async function handleAssignTier(
  creatorProfileId: string,
  deps?: AssignTierRouteDeps
): Promise<Response> {
  try {
    // Authorize before anything else, so an unauthorized caller cannot probe
    // which ids exist — the same ordering the verify route uses. `withAdminAudit`
    // gates again inside; this one exists so the check does not depend on that.
    await (deps?.guard ?? guard)({ roles: ['admin'] });
  } catch (error) {
    return toErrorResponse(error);
  }

  // Shape checked before any work: a well-formed request naming a row that
  // cannot exist is a 404, not a Postgres `22P02` surfacing as a 500. This
  // route takes no body, so there is nothing to validate ahead of it.
  if (!UUID_PATTERN.test(creatorProfileId)) {
    return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
      status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
    });
  }

  try {
    const result = await withAdminAudit<AssignResult>(
      {
        action: AUDIT_ACTIONS.CREATOR_ASSIGN_TIER,
        targetType: AUDIT_TARGET_TYPES.CREATOR_PROFILE,
        targetId: creatorProfileId,
        detail: (r) => ({ before: r.before, tier: r.tier }),
      },
      async (tx) => {
        // Locked for the same reason the verification decision locks: two
        // admins pressing Retry at once would otherwise both read the old row.
        const [creator] = await tx
          .select({
            id: creatorProfile.id,
            status: creatorProfile.status,
            tierId: creatorProfile.tierId,
            followerCount: creatorProfile.followerCount,
            engagementRate: creatorProfile.engagementRate,
          })
          .from(creatorProfile)
          .where(eq(creatorProfile.id, creatorProfileId))
          .for('update')
          .limit(1);

        if (!creator) throw new CreatorNotFoundError();

        // Assignment is an activation step. Running it on a pending creator
        // would price somebody nobody has checked yet, and on a rejected one it
        // would price somebody who was turned down.
        if (creator.status !== 'verified') throw new CreatorNotVerifiedError();

        const tier = await assignTier(
          tx,
          {
            id: creator.id,
            followerCount: creator.followerCount,
            engagementRate: creator.engagementRate,
          },
          deps?.assignTierDeps
        );

        return { id: creator.id, tier, before: { tierId: creator.tierId } };
      },
      deps?.adminAuditDeps ?? {}
    );

    // `before` is the tier the creator held when the transaction opened, already
    // computed for the audit detail. Surfacing it is what makes a no-match
    // response unambiguous: `assigned: false` with `before.tier_id` set means
    // "no band matches their current numbers, and their existing price stands",
    // which is a different situation from an untiered creator still waiting for
    // one — and the response and the audit row now agree on which it was (F12).
    return Response.json(
      {
        id: result.id,
        tier: tierOutcomeToResponse(result.tier),
        before: { tier_id: result.before.tierId },
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof CreatorNotVerifiedError) {
      return Response.json(errorResponse(ErrorCode.CREATOR_NOT_VERIFIED), {
        status: ErrorHttpStatus[ErrorCode.CREATOR_NOT_VERIFIED],
      });
    }
    if (error instanceof CreatorNotFoundError) {
      return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
        status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
      });
    }
    // Non-admins land here as ForbiddenError, thrown by the guard inside
    // `withAdminAudit` before the transaction opens.
    return toErrorResponse(error);
  }
}

/**
 * `params` is a Promise in the App Router and must be awaited before its fields
 * are read — mirrors the verify route next door.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleAssignTier(id);
}
