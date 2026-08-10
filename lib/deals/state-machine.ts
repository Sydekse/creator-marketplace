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
 *
 * The three `refunded` edges are the admin dispute path, and they match
 * `REFUNDABLE_FROM` in `lib/payment/ledger.ts` exactly — the ledger refuses to
 * refund from anywhere else, so the two guards agree by construction rather
 * than by coincidence.
 *
 * Annotated `Record<DealStatus, ...>` rather than `satisfies`: the annotation
 * gives the same exhaustiveness (a tenth status is a missing-property error
 * here) while keeping the values widened, so `.includes(toStatus)` below type
 * checks against the union instead of against each literal tuple.
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
 * Why the deal's current status makes a requested target illegal.
 *
 * Keyed on the target because every target has exactly one precondition: you
 * cannot fund what was never accepted, cannot approve what was never
 * delivered. The code names the precondition that failed, which is what the
 * client needs in order to say something true to the user.
 *
 * `satisfies Record<DealStatus, ErrorCode>` rather than a chain of `if`s, for
 * the reason `lib/deals/groups.ts` gives: a tenth status added to the union
 * becomes a compile error here, instead of falling through to a 422 on a path
 * the PRD assigns a 409.
 */
const PRECONDITION_FAILED_CODE = {
  // Acting on an offer at all requires it to still be pending.
  accepted: ErrorCode.OFFER_NOT_PENDING,
  declined: ErrorCode.OFFER_NOT_PENDING,
  expired: ErrorCode.OFFER_NOT_PENDING,
  // Funding requires acceptance.
  funded: ErrorCode.NO_ACCEPTED_DEALS,
  // Delivering and refunding both require the money to be held first.
  delivered: ErrorCode.DEAL_NOT_FUNDED,
  refunded: ErrorCode.DEAL_NOT_FUNDED,
  // Approving or rejecting requires a delivery to judge.
  completed: ErrorCode.DEAL_NOT_DELIVERED,
  revision_requested: ErrorCode.DEAL_NOT_DELIVERED,
  // Nothing transitions *to* pending — a deal is created there. Reaching this
  // means the caller invented a target, which is a validation failure rather
  // than a lifecycle one.
  pending: ErrorCode.VALIDATION_ERROR,
} satisfies Record<DealStatus, ErrorCode>;

/** What a creator does to a live offer, and only while it is still live. */
const OFFER_ACTIONS: readonly DealStatus[] = ['accepted', 'declined'];

/**
 * Maps an invalid transition attempt to the domain error code for it.
 *
 * Takes both ends deliberately. `OFFER_EXPIRED` is the one code the target
 * alone cannot reach: a creator tapping Accept on an offer that lapsed needs
 * to be told it expired, not to "refresh deal state", and only `fromStatus`
 * distinguishes that from any other non-pending offer.
 */
export function getErrorCodeForInvalidTransition(
  fromStatus: DealStatus,
  toStatus: DealStatus
): ErrorCode {
  if (fromStatus === 'expired' && OFFER_ACTIONS.includes(toStatus)) {
    return ErrorCode.OFFER_EXPIRED;
  }
  return PRECONDITION_FAILED_CODE[toStatus];
}

/**
 * The single, guarded transition function for all deal status changes (KAN-34).
 *
 * It enforces FR-007, re-reads the row under a `FOR UPDATE` lock before judging
 * legality, and appends the `deal_event` in the same transaction as the status
 * write (NFR-003, NFR-012). A ledger failure after this call rolls the event
 * back with everything else, so the audit trail cannot outlive the money.
 *
 * This is a domain primitive, **not** a security boundary. It authenticates
 * nothing and authorises nothing: `actorId` is recorded, never checked. Every
 * calling action still owes its own two-layer `guard()` (NFR-005).
 *
 * @param tx An open transaction. The type is the enforcement — `db` itself is
 *   not assignable to `Tx`, so the `FOR UPDATE` below cannot be issued outside
 *   a transaction where it would take a lock and drop it immediately.
 * @param dealId The deal to transition
 * @param toStatus The target status
 * @param actorId The user acting, or null/undefined for system actions
 * @param opts Optional human-readable reason, recorded on the event
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

  const isAllowed = LEGAL_TRANSITIONS[row.status].includes(toStatus);

  if (!isAllowed) {
    // Also the idempotency guard (AC-008). A retry of an already-applied
    // transition arrives as `accepted -> accepted`, which is not in the table,
    // so it is rejected here rather than double-applied — no second
    // `deal_event`, no second row touched.
    throw new TransitionError(
      `Cannot transition deal from ${row.status} to ${toStatus}`,
      getErrorCodeForInvalidTransition(row.status, toStatus)
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

/**
 * The opening `deal_event` for deals that have just been created (KAN-33).
 *
 * Creation is the one point in a deal's life that `transitionDeal` cannot
 * express. `LEGAL_TRANSITIONS` has no inbound edge to `pending` — it is listed
 * only as a source, and `PRECONDITION_FAILED_CODE` maps a `pending` target to
 * `VALIDATION_ERROR` on the grounds that a caller asking for it invented the
 * target. A deal does not *arrive* at `pending`; it *begins* there.
 *
 * So it lives here rather than at the call site. Invariant 6 says every deal
 * transition writes a `deal_event`, and the suite enforces that structurally by
 * refusing any `insert(dealEvent)` outside this module — a rule worth keeping
 * exactly because an event written next to some other business logic is how an
 * audit row with no status change behind it gets created. Creation events are
 * the legitimate exception, and this is where they are written.
 *
 * `fromStatus` is null: there is no status the deal came from. That is the same
 * convention the schema documents for `actor_id`, where null means the system
 * acted rather than a person — here the null is about history, not agency, and
 * `actorId` is still the person who confirmed the campaign.
 *
 * @param tx An open transaction — the same one the deals were inserted in, so
 *   the history cannot commit without the deals or the deals without it.
 * @param dealIds The deals that were just created, each at `pending`
 * @param actorId The user whose action created them, or null for the system
 */
export async function recordDealsCreated(
  tx: Tx,
  dealIds: string[],
  actorId?: string | null
): Promise<void> {
  if (dealIds.length === 0) return;

  // One multi-row insert rather than one per deal: they are a single event in
  // the domain, and they share a transaction regardless.
  await tx.insert(dealEvent).values(
    dealIds.map((dealId) => ({
      dealId,
      fromStatus: null,
      toStatus: 'pending' as const,
      actorId: actorId ?? null,
    }))
  );
}
