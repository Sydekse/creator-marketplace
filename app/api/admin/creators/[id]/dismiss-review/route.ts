import { eq } from 'drizzle-orm';
import { creatorProfile } from '@/db/schema';
import { guard, withAdminAudit, toErrorResponse } from '@/lib/authz';
import type { AdminAuditDeps, GuardOptions } from '@/lib/authz';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@/lib/audit/actions';
import {
  ErrorCode,
  ErrorHttpStatus,
  errorResponse,
  UUID_REGEX,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/** Thrown when the target carries no flag — nothing here to dismiss. */
export class NoReviewPendingError extends Error {
  code = ErrorCode.NOT_FOUND;
  constructor() {
    super('No pending tier review for this creator.');
    this.name = 'NoReviewPendingError';
  }
}

export class CreatorNotFoundError extends Error {
  code = ErrorCode.NOT_FOUND;
  constructor() {
    super('Creator not found.');
    this.name = 'CreatorNotFoundError';
  }
}

export interface DismissReviewRouteDeps {
  guard: (options: GuardOptions) => Promise<unknown>;
  adminAuditDeps?: Partial<AdminAuditDeps>;
}

/**
 * `POST /api/admin/creators/:id/dismiss-review` — keep the tier, clear the
 * flag (phase 3).
 *
 * The other half of the flagged-review decision on `/admin/tiers`. A stats
 * refresh that selected a *lower* band (or none) stamped `tier_review_at` and
 * left the tier alone; the admin either applies the change (the existing
 * assign-tier route, which now clears the flag itself) or presses Dismiss —
 * this — recording "reviewed, band stands" without touching the price.
 *
 * The flag is only cleared, never the tier: TikTok numbers wobble, and a
 * one-week dip is exactly the case dismissal exists for. If the dip persists,
 * next week's cron re-flags and the question is asked again.
 *
 * Dismissing an unflagged creator is a 404, not a no-op: the flag another
 * admin already resolved is a decision this admin believes they are making —
 * failing loudly is what stops two people thinking they each decided.
 *
 * `withAdminAudit` supplies both the admin role gate and the `audit_log` write
 * inside one transaction (invariant 9, AC-031).
 */
export async function handleDismissReview(
  creatorProfileId: string,
  deps?: DismissReviewRouteDeps
): Promise<Response> {
  try {
    // Authorize before anything else, so an unauthorized caller cannot probe
    // which ids exist. `withAdminAudit` gates again inside.
    await (deps?.guard ?? guard)({ roles: ['admin'] });
  } catch (error) {
    return toErrorResponse(error);
  }

  // A well-formed request naming a row that cannot exist is a 404, not a
  // Postgres `22P02` surfacing as a 500.
  if (!UUID_REGEX.test(creatorProfileId)) {
    return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
      status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
    });
  }

  try {
    const result = await withAdminAudit<{
      id: string;
      dismissed: { tierReviewAt: Date };
    }>(
      {
        action: AUDIT_ACTIONS.CREATOR_DISMISS_REVIEW,
        targetType: AUDIT_TARGET_TYPES.CREATOR_PROFILE,
        targetId: creatorProfileId,
        detail: (r) => ({ dismissed: r.dismissed }),
      },
      async (tx) => {
        // Locked so two admins dismissing at once both read the same flag —
        // the second one gets the 404 below instead of a silent double-decide.
        const [creator] = await tx
          .select({
            id: creatorProfile.id,
            tierReviewAt: creatorProfile.tierReviewAt,
          })
          .from(creatorProfile)
          .where(eq(creatorProfile.id, creatorProfileId))
          .for('update')
          .limit(1);

        if (!creator) throw new CreatorNotFoundError();
        if (creator.tierReviewAt === null) throw new NoReviewPendingError();

        await tx
          .update(creatorProfile)
          .set({ tierReviewAt: null })
          .where(eq(creatorProfile.id, creator.id));

        return {
          id: creator.id,
          dismissed: { tierReviewAt: creator.tierReviewAt },
        };
      },
      deps?.adminAuditDeps ?? {}
    );

    return Response.json({ id: result.id, dismissed: true }, { status: 200 });
  } catch (error) {
    if (
      error instanceof CreatorNotFoundError ||
      error instanceof NoReviewPendingError
    ) {
      return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
        status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
      });
    }
    return toErrorResponse(error);
  }
}

/** `params` is a Promise in the App Router — mirrors assign-tier next door. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleDismissReview(id);
}
