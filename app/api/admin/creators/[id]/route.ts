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
import { notify as defaultNotify } from '@/lib/notifications/notify';
import type { Notify } from '@/lib/notifications/notify';
import {
  ErrorCode,
  ErrorHttpStatus,
  errorResponse,
  fromZodError,
  updateCreatorNumbersSchema,
  validationError,
  UUID_REGEX,
} from '@/lib/validation';
// The assign-tier route next door already owns these two typed errors and their
// `ErrorCode` mapping. Reused rather than redeclared so the two admin routes that
// act on a creator profile answer "not found" and "not verified" identically —
// a second copy here could drift to a different status the day one is reworded.
import {
  CreatorNotFoundError,
  CreatorNotVerifiedError,
} from './assign-tier/route';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

export interface UpdateCreatorRouteDeps {
  guard: (options: GuardOptions) => Promise<unknown>;
  adminAuditDeps?: Partial<AdminAuditDeps>;
  assignTierDeps?: AssignTierDeps;
  notify?: Notify;
}

interface UpdateResult {
  id: string;
  userId: string;
  followerCount: number | null;
  engagementRate: string | null;
  tier: TierOutcome;
  before: {
    followerCount: number | null;
    engagementRate: string | null;
    tierId: string | null;
  };
}

/**
 * `PATCH /api/admin/creators/:id` — correct a creator's follower count or
 * engagement rate, then re-run tier assignment (KAN-24, AC-031).
 *
 * The write behind "Save & retry assignment" on `/admin/tiers`. Follower count
 * and engagement rate are optional at onboarding, and there is no self-serve
 * profile edit yet — so a verified creator who skipped them lands on the
 * awaiting-tier list with no way off it, because "Retry assignment" re-runs the
 * same rule against the same missing numbers. This route is the missing half:
 * an admin fills the numbers in, and assignment runs on the corrected values in
 * the same transaction, so a match tiers the creator immediately.
 *
 * The order of steps is the contract, and it mirrors the assign-tier route:
 *
 *   1. Authorize before anything else, so an unauthorized caller cannot use
 *      validation or not-found responses to probe which ids exist.
 *   2. Reject a malformed id as a 404 — a well-formed request naming a row that
 *      cannot exist is not a Postgres `22P02` surfacing as a 500.
 *   3. Parse the body *before* the transaction, so a bad payload never opens one.
 *   4. Inside one audited transaction: lock the row, refuse a pending/rejected
 *      target, write only the columns supplied, then reassign on the merged
 *      numbers.
 *
 * One `creator.edit` audit row, not a second `creator.assign_tier`: the edit is
 * the decision an admin made, and the reassignment it triggers is that
 * decision's effect, recorded in this row's `detail` alongside the before/after
 * — see `AUDIT_ACTIONS.CREATOR_EDIT`.
 */
export async function handleUpdateCreatorNumbers(
  creatorProfileId: string,
  request: Request,
  deps?: UpdateCreatorRouteDeps
): Promise<Response> {
  try {
    // Role gate first, for the same reason the assign-tier route gates first:
    // `withAdminAudit` gates again inside, but this check means the id shape and
    // the body are never even parsed for a caller with no right to be here.
    await (deps?.guard ?? guard)({ roles: ['admin'] });
  } catch (error) {
    return toErrorResponse(error);
  }

  // Shape checked before the body: a well-formed request naming a row that
  // cannot exist is a 404, not a 500 from a `22P02` on the id comparison.
  if (!UUID_REGEX.test(creatorProfileId)) {
    return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
      status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
    });
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

  const parsed = updateCreatorNumbersSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  try {
    const result = await withAdminAudit<UpdateResult>(
      {
        action: AUDIT_ACTIONS.CREATOR_EDIT,
        targetType: AUDIT_TARGET_TYPES.CREATOR_PROFILE,
        targetId: creatorProfileId,
        // Before *and* after in one row: "who changed this creator's numbers, from
        // what to what, and did it tier them" is answerable from this detail alone.
        detail: (r) => ({
          before: {
            followerCount: r.before.followerCount,
            engagementRate: r.before.engagementRate,
          },
          after: {
            followerCount: r.followerCount,
            engagementRate: r.engagementRate,
          },
          tier: r.tier,
        }),
      },
      async (tx) => {
        // Locked for the same reason assignment locks: two admins editing the
        // same creator at once would otherwise both read the pre-edit row and
        // the second write would silently clobber the first.
        const [creator] = await tx
          .select({
            id: creatorProfile.id,
            userId: creatorProfile.userId,
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

        // Only verified creators are edited here. A pending creator's numbers are
        // theirs to enter at onboarding, and pricing a rejected creator would tier
        // somebody who was turned down — the same status gate assign-tier keeps.
        if (creator.status !== 'verified') throw new CreatorNotVerifiedError();

        // Merge: an omitted field keeps its stored value, so an admin can fix one
        // number without restating the other. `numeric(5,2)` round-trips as a
        // string in node-postgres, so the rate is fixed to two decimals on the way
        // in — matching what the column stores and what onboarding writes.
        const nextFollowerCount =
          parsed.data.followerCount ?? creator.followerCount;
        const nextEngagementRate =
          parsed.data.engagementRate !== undefined
            ? parsed.data.engagementRate.toFixed(2)
            : creator.engagementRate;

        // Only the supplied columns are written; the `.refine` on the schema has
        // already guaranteed at least one is present, so this is never empty.
        const updates: { followerCount?: number; engagementRate?: string } = {};
        if (parsed.data.followerCount !== undefined) {
          updates.followerCount = parsed.data.followerCount;
        }
        if (parsed.data.engagementRate !== undefined) {
          updates.engagementRate = parsed.data.engagementRate.toFixed(2);
        }

        await tx
          .update(creatorProfile)
          .set(updates)
          .where(eq(creatorProfile.id, creator.id));

        // Reassign on the *merged* numbers, in this transaction, so correcting
        // the data and re-pricing the creator commit or roll back together.
        // `assignTier` takes the numbers rather than re-reading the row, so it
        // sees the values just written even though the update above has not
        // been read back.
        const tier = await assignTier(
          tx,
          {
            id: creator.id,
            followerCount: nextFollowerCount,
            engagementRate: nextEngagementRate,
          },
          deps?.assignTierDeps
        );

        return {
          id: creator.id,
          userId: creator.userId,
          followerCount: nextFollowerCount,
          engagementRate: nextEngagementRate,
          tier,
          before: {
            followerCount: creator.followerCount,
            engagementRate: creator.engagementRate,
            tierId: creator.tierId,
          },
        };
      },
      deps?.adminAuditDeps ?? {}
    );

    // Tell the creator only when the corrected numbers actually changed their
    // band. After the audit transaction, same as the assign-tier route: an
    // email failure must never roll back an admin decision, and the standalone
    // `notify` writes its own in-app row (AC-1).
    if (result.tier.assigned && result.tier.tierId !== result.before.tierId) {
      try {
        await (deps?.notify ?? defaultNotify)(result.userId, 'tier_assigned', {
          creatorProfileId: result.id,
          tierName: result.tier.tierName,
          pricePerVideo: result.tier.pricePerVideo,
        });
      } catch (error) {
        console.error(
          `[admin-creators] tier_assigned notification failed: ${
            error instanceof Error ? error.message : 'unknown'
          }`
        );
      }
    }

    // snake_case out, echoing the stored numbers so the client shows what the
    // database now holds rather than what was typed, and the tier outcome so the
    // caller can toast "assigned"/"still stuck" without a second request.
    return Response.json(
      {
        id: result.id,
        follower_count: result.followerCount,
        engagement_rate: result.engagementRate,
        tier: tierOutcomeToResponse(result.tier),
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
 * are read — mirrors the assign-tier route next door. The second argument is the
 * route context, so the dependency seam lives on `handleUpdateCreatorNumbers`,
 * which tests call directly.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleUpdateCreatorNumbers(id, request);
}
