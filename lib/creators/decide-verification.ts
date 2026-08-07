import { eq } from 'drizzle-orm';
import { creatorProfile } from '@/db/schema';
import type { CreatorStatus } from '@/db/schema';
import { withNotifications } from '@/lib/notifications/notify';
import type { NotifyDeps } from '@/lib/notifications/notify';
import { withAdminAudit } from '@/lib/authz';
import type { AdminAuditDeps, Tx } from '@/lib/authz';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@/lib/audit/actions';
import { assignTier } from '@/lib/creators/tier-assignment';
import type {
  AssignTierDeps,
  TierOutcome,
} from '@/lib/creators/tier-assignment';
import { ErrorCode } from '@/lib/validation/errors';

/**
 * Creator verification decision (KAN-22).
 *
 * Composes `withNotifications` (outer, owns real transaction) around
 * `withAdminAudit` (inner, injected via `transaction: (fn) => fn(tx)` seam) so
 * profile UPDATE + audit insert + notification row all share one transaction;
 * email flushes only after commit (satisfies AC-3/AC-4).
 *
 * The `SELECT ... FOR UPDATE` lock serializes concurrent admin decisions —
 * second sees already-changed status and throws `CreatorNotPendingError`.
 *
 * KAN-23 adds tier assignment to the approve branch, inside the same
 * transaction — see step 4.
 */

export class CreatorNotPendingError extends Error {
  code = ErrorCode.CREATOR_NOT_PENDING;
  constructor() {
    super('This creator has already been reviewed.');
    this.name = 'CreatorNotPendingError';
  }
}

/** Typed rather than message-matched, so the route's 404 mapping cannot break on a reworded string. */
export class CreatorNotFoundError extends Error {
  code = ErrorCode.NOT_FOUND;
  constructor() {
    super('Creator not found.');
    this.name = 'CreatorNotFoundError';
  }
}

export interface DecisionInput {
  decision: 'verified' | 'rejected';
  note?: string;
}

export interface DecisionResult {
  id: string;
  status: CreatorStatus;
  /**
   * The tier outcome for an approval, null for a rejection (KAN-23).
   *
   * Null and `{ assigned: false }` are different answers and the caller shows
   * different things for each: null is "we never tried", `assigned: false` is
   * "we tried and they do not fit a band, so they are verified but not bookable".
   */
  tier: TierOutcome | null;
  before: { status: CreatorStatus };
  after: { status: CreatorStatus };
}

/** Seam for tests — matches the shape `withAdminAudit` and `withNotifications` use. */
export interface DecisionDeps {
  notifyDeps: NotifyDeps;
  adminAuditDeps: Omit<AdminAuditDeps, 'transaction'>;
  assignTierDeps?: AssignTierDeps;
}

async function selectForUpdate(
  tx: Tx,
  creatorProfileId: string
): Promise<typeof creatorProfile.$inferSelect | undefined> {
  const rows = await tx
    .select()
    .from(creatorProfile)
    .where(eq(creatorProfile.id, creatorProfileId))
    .for('update')
    .limit(1);
  return rows[0];
}

/**
 * Decides a creator's verification (approve or reject).
 *
 * Composes `withNotifications` (outer) around `withAdminAudit` (inner) so that
 * profile UPDATE + audit insert + notification row all share one transaction,
 * and email flushes only after commit (AC-3/AC-4).
 *
 * The `SELECT ... FOR UPDATE` lock serializes concurrent admin decisions —
 * second sees already-changed status and throws `CreatorNotPendingError`.
 */
export async function decideVerification(
  creatorProfileId: string,
  input: DecisionInput,
  deps?: DecisionDeps
): Promise<Omit<DecisionResult, 'before' | 'after'>> {
  return withNotifications(async (tx, notify) => {
    return withAdminAudit<DecisionResult>(
      {
        action:
          input.decision === 'verified'
            ? AUDIT_ACTIONS.CREATOR_VERIFY
            : AUDIT_ACTIONS.CREATOR_REJECT,
        targetType: AUDIT_TARGET_TYPES.CREATOR_PROFILE,
        targetId: creatorProfileId,
        detail: (result) => ({
          before: result.before,
          after: result.after,
          note: input.note,
          // The un-tiered case has to survive the request that produced it
          // (AC-5). A toast is gone on the next click; this row is not, and it
          // is already the thing an admin reads back through KAN-52's read path.
          tier: result.tier,
        }),
      },
      async (auditTx) => {
        // 1. SELECT ... FOR UPDATE to lock row (serialize concurrent decisions)
        const creator = await selectForUpdate(auditTx, creatorProfileId);

        if (!creator) {
          throw new CreatorNotFoundError();
        }

        // 2. Guard state: must be 'pending_verification'
        if (creator.status !== 'pending_verification') {
          throw new CreatorNotPendingError();
        }

        const before = { status: creator.status };

        // 3. UPDATE status (+ verifiedAt on approve)
        const updates =
          input.decision === 'verified'
            ? { status: 'verified' as const, verifiedAt: new Date() }
            : { status: 'rejected' as const };

        await auditTx
          .update(creatorProfile)
          .set(updates)
          .where(eq(creatorProfile.id, creatorProfileId));

        // 4. Assign a tier, on approval only (KAN-23, AC-004).
        //
        // Same transaction as the status change, so the two halves of "bookable"
        // can never disagree: a rollback takes the tier with it, and there is no
        // window in which a creator is verified but pending a separate write
        // that might not arrive.
        //
        // No match is not an error — it leaves `tier_id` null and the creator
        // non-bookable (AC-006), which is exactly what the state means.
        const tier =
          input.decision === 'verified'
            ? await assignTier(
                auditTx,
                {
                  id: creatorProfileId,
                  followerCount: creator.followerCount,
                  engagementRate: creator.engagementRate,
                },
                deps?.assignTierDeps
              )
            : null;

        // 5. Notify creator (writes notification row via tx)
        // Map 'verified' decision -> 'approved' outcome for notification payload
        await notify(creator.userId, 'verification_result', {
          creatorProfileId,
          outcome: input.decision === 'verified' ? 'approved' : 'rejected',
          reason: input.note,
        });

        return {
          id: creatorProfileId,
          status: updates.status,
          tier,
          before,
          after: { status: updates.status },
        };
      },
      // The transaction seam is injected unconditionally — this is the hinge of
      // the whole composition. Without it, `withAdminAudit` falls back to
      // `db.transaction`, opening a *second* transaction on a separate pool
      // connection: the profile UPDATE and audit row would commit there while
      // the notification row rides the outer one, and the two could diverge.
      // The auth loaders default to the real ones inside `withAdminAudit`.
      { ...deps?.adminAuditDeps, transaction: (fn) => fn(tx) }
    );
  }, deps?.notifyDeps);
}
