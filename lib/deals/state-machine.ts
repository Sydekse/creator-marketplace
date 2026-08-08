import { eq } from 'drizzle-orm';
import { deal, dealEvent } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import { ErrorCode } from '@/lib/validation/errors';
import type { Tx } from '@/lib/authz';

export type DealRow = typeof deal.$inferSelect;

export class TransitionError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode
  ) {
    super(message);
    this.name = 'TransitionError';
  }
}

/**
 * FR-007 legal transition rules for deal status.
 */
export const LEGAL_TRANSITIONS: Record<DealStatus, readonly DealStatus[]> = {
  pending: ['accepted', 'declined', 'expired'],
  accepted: ['funded'],
  funded: ['delivered', 'refunded'],
  delivered: ['completed', 'revision_requested', 'refunded'],
  revision_requested: ['delivered', 'refunded'],
  declined: [],
  expired: [],
  completed: [],
  refunded: [],
};

/**
 * Maps an invalid transition attempt to the appropriate domain error code.
 */
export function getErrorCodeForInvalidTransition(
  toStatus: DealStatus
): ErrorCode {
  if (
    toStatus === 'accepted' ||
    toStatus === 'declined' ||
    toStatus === 'expired'
  ) {
    return ErrorCode.OFFER_NOT_PENDING;
  }
  if (toStatus === 'funded') {
    return ErrorCode.NO_ACCEPTED_DEALS;
  }
  if (toStatus === 'delivered' || toStatus === 'refunded') {
    return ErrorCode.DEAL_NOT_FUNDED;
  }
  if (toStatus === 'completed' || toStatus === 'revision_requested') {
    return ErrorCode.DEAL_NOT_DELIVERED;
  }
  return ErrorCode.VALIDATION_ERROR;
}

/**
 * The single, guarded transition function for all deal status changes (KAN-34).
 *
 * It enforces that every transition adheres to FR-007, executes under a row-level
 * FOR UPDATE lock to prevent race conditions, and inserts a `deal_event` audit row
 * synchronously within the same transaction.
 *
 * @param tx A serializable transaction client
 * @param dealId The ID of the deal to transition
 * @param toStatus The target status
 * @param actorId The user initiating the transition (null for system actions)
 * @param opts Optional reason for the transition
 */
export async function transitionDeal(
  tx: Tx,
  dealId: string,
  toStatus: DealStatus,
  actorId?: string | null,
  opts?: { reason?: string }
): Promise<DealRow> {
  const [row] = await tx
    .select()
    .from(deal)
    .where(eq(deal.id, dealId))
    .for('update')
    .limit(1);

  if (!row) {
    throw new TransitionError('Deal not found', ErrorCode.NOT_FOUND);
  }

  const allowedPaths = LEGAL_TRANSITIONS[row.status];
  const isAllowed = allowedPaths && allowedPaths.includes(toStatus);

  if (!isAllowed) {
    // Idempotent retry rejection: replaying an already-applied transition is
    // rejected by the status guard instead of being double-applied.
    const code = getErrorCodeForInvalidTransition(toStatus);
    throw new TransitionError(
      `Cannot transition deal from ${row.status} to ${toStatus}`,
      code
    );
  }

  await tx.update(deal).set({ status: toStatus }).where(eq(deal.id, dealId));

  await tx.insert(dealEvent).values({
    dealId,
    fromStatus: row.status,
    toStatus,
    actorId: actorId ?? null,
    reason: opts?.reason,
  });

  return { ...row, status: toStatus };
}
