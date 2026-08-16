import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { brandProfile, campaign, creatorProfile, deal } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import { ErrorCode } from '@/lib/validation/errors';
import { transitionDeal, TransitionError } from '@/lib/deals/state-machine';
import type { DealRow } from '@/lib/deals/state-machine';
import { withAdminAudit } from '@/lib/authz';
import type { AdminAuditDeps, Tx } from '@/lib/authz';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@/lib/audit/actions';
import { withNotifications } from '@/lib/notifications/notify';
import type { NotifyDeps } from '@/lib/notifications/notify';
import { getPaymentProvider, PaymentError } from '@/lib/payment';
import { EscrowLedgerService, LedgerError } from '@/lib/payment/ledger';
import type { PayoutResult } from '@/lib/payment/ledger';
import { logPaymentFailure } from '@/lib/payment/log';
import { extractSafeErrorDetails, toLogString } from '@/lib/logging';

/**
 * Admin resolves a disputed deal: release, refund, or request revision
 * (KAN-51, US-010, AC-030, §4.6 resolve).
 *
 * **The three paths, and why they do not all look alike.** `release` and
 * `refund` are money paths, so they are `EscrowLedgerService` methods —
 * `payoutForDeal` and `refundDeal` — each already a serializable transaction
 * that locks the deal, refuses the wrong status under that lock, writes its
 * ledger entries, and moves the deal through the state machine (AC-2, AC-3,
 * NFR-003). This action invents no parallel money path: "release pays the
 * creator net of commission, exactly as brand approval does" is `payoutForDeal`
 * and nothing else. `revision` moves no money, so it is a plain state-machine
 * transition inside the action's own transaction.
 *
 * **What the ticket demands is already in the machine.** The refunded edges
 * (`funded`/`delivered`/`revision_requested` → `refunded`) and the deliver
 * edge (`delivered` → `revision_requested`) exist, and the ledger guards agree
 * by construction (`REFUNDABLE_FROM`). AC-9 — no second payout, no second
 * refund — falls out of the terminal statuses: `completed` and `refunded` have
 * no outgoing edges, so a re-resolve of either is refused by the ledger before
 * any money moves.
 *
 * **Audit and notifications ride the same transaction as the state change
 * where one exists, and follow the ledger where it does not.** For `revision`
 * the whole resolution is one transaction: state machine + `deal.resolve_dispute`
 * audit row + both parties' `dispute_resolved` rows (AC-030 "both parties are
 * notified", AC-031, NFR-003), with emails flushed only after commit (AC-3/4).
 * For `release`/`refund` the ledger transaction has already committed by the
 * time the audit row could be written — the same shape `approve-deliverable.ts`
 * documents for its notification, and for the same reason: `payoutForDeal` and
 * `refundDeal` open and retry their own serializable transactions, so nesting
 * them would hold two pool connections and re-queue emails per retry. The
 * honest consequence is the one approve accepts: an audit/notification write
 * that fails after the ledger has committed leaves the money moved and the
 * admin resolution unlogged — **traced and swallowed**, not a 500 that would
 * tell the admin their resolution failed when it succeeded. The `deal_event`
 * the ledger wrote still records the state change and the acting admin
 * (`transitionDeal`'s `actorId`), so the trail has an entry even in that
 * failure; the trace line is the operator's evidence that the `audit_log` row
 * is missing.
 *
 * **The route's gate decides who this runs as; this module decides what it
 * runs on.** `withAdminAudit` re-checks the admin role under its own session
 * lookup (the audit-log route's double-check, and what makes the audit row
 * attributable). The deal's own status is judged by the ledger and the state
 * machine, never here: a `release` on an undelivered deal is `payoutForDeal`'s
 * `DEAL_NOT_DELIVERED`, a `refund` on a paid deal is `refundDeal`'s
 * `DEAL_NOT_FUNDED`, a `revision` on a funded deal is the machine's
 * `DEAL_NOT_DELIVERED` — one refusal per path, each the code the spec table
 * names, and none invented by this module.
 */

export type DisputeResolution = 'release' | 'refund' | 'revision';

/** The resolution as the notification vocabulary names it (types.ts). */
const NOTIFICATION_RESOLUTION: Record<
  DisputeResolution,
  'released' | 'refunded' | 'revision_requested'
> = {
  release: 'released',
  refund: 'refunded',
  revision: 'revision_requested',
};

export type ResolveDisputeResult =
  | {
      ok: true;
      dealId: string;
      status: DealStatus;
      resolution: 'release';
      /** Integer santim paid to the creator (AC-2). */
      payout: number;
      /** Integer santim kept as commission (AC-2). */
      commission: number;
    }
  | {
      ok: true;
      dealId: string;
      status: DealStatus;
      resolution: 'refund' | 'revision';
    }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'illegal'; code: ErrorCode }
  | { ok: false; reason: 'payment_failed' };

/** The deal row this action needs: identities for both notifications. */
export interface ResolveDeal {
  id: string;
  status: DealStatus;
  campaignName: string;
  brandUserId: string;
  creatorUserId: string;
}

export interface ResolveDisputeDeps {
  /**
   * Existence check and the names both parties are notified under. Not
   * ownership-scoped: an admin resolves any deal, so the route's `admin` gate
   * is the only authorisation, and this load just answers "does it exist and
   * who are the people on it". Resolves the *user* ids (the two-hop rule from
   * `lib/authz.ts`) because notifications address a user, never a profile id.
   */
  loadDeal: (dealId: string) => Promise<ResolveDeal | null>;
  /** `EscrowLedgerService.payoutForDeal` — the same money path brand approval uses. */
  pay: (dealId: string, actorId: string) => Promise<PayoutResult>;
  /** `EscrowLedgerService.refundDeal` — the decline/expire money path. */
  refund: (dealId: string, actorId: string) => Promise<void>;
  /**
   * The state-machine transition for the `revision` path, run inside the audit
   * transaction. A seam because tests must stay off Postgres; the default is
   * `transitionDeal` itself.
   */
  transition: (
    tx: Tx,
    dealId: string,
    toStatus: DealStatus,
    actorId?: string | null,
    opts?: { reason?: string }
  ) => Promise<DealRow>;
  /** Passed through to `withNotifications`; undefined means its lazy defaults. */
  notifyDeps?: NotifyDeps;
  /** Passed through to `withAdminAudit`; undefined means its lazy defaults. */
  adminAuditDeps?: Omit<AdminAuditDeps, 'transaction'>;
  /** The KAN-44 rule: a money-path failure must leave a trace. */
  logFailure: typeof logPaymentFailure;
  /**
   * Trace for an audit/notification write that failed after the ledger
   * committed. The action swallows that failure — money and status are already
   * final (see the module header) — but a swallowed failure must still leave a
   * line for the operator who has to explain an unlogged admin resolution.
   */
  logPostLedgerFailure: (
    error: unknown,
    context: { dealId: string; actorId: string; resolution: DisputeResolution }
  ) => void;
}

const defaultDeps: ResolveDisputeDeps = {
  loadDeal: async (dealId) => {
    const [row] = await db
      .select({
        id: deal.id,
        status: deal.status,
        campaignName: campaign.name,
        brandUserId: brandProfile.userId,
        creatorUserId: creatorProfile.userId,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(brandProfile, eq(campaign.brandId, brandProfile.id))
      .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
      .where(eq(deal.id, dealId))
      .limit(1);

    return row ?? null;
  },
  // Constructed per call, matching `approve-deliverable.ts`: the service holds
  // no state between calls, and a module-level instance would call
  // `getPaymentProvider()` at import time, binding the provider before any test
  // could swap it.
  pay: (dealId, actorId) =>
    new EscrowLedgerService(db, getPaymentProvider()).payoutForDeal(
      dealId,
      actorId
    ),
  refund: (dealId, actorId) =>
    new EscrowLedgerService(db, getPaymentProvider()).refundDeal(
      dealId,
      actorId
    ),
  transition: (tx, dealId, toStatus, actorId, opts) =>
    transitionDeal(tx, dealId, toStatus, actorId, opts),
  logFailure: logPaymentFailure,
  logPostLedgerFailure: (error, context) => {
    const { name, code, message } = extractSafeErrorDetails(error);
    // The event names the failure; the deal id is the join key back to the
    // resolved deal. No PII reaches this line: `extractSafeErrorDetails`
    // scrubs emails (NFR-010), and the payload carries no row content.
    console.error(
      toLogString({
        level: 'error',
        event: 'resolve_dispute.post_ledger_failed',
        message: `[Resolve] audit/notification could not be written after ${context.resolution} for deal ${context.dealId}: [${name}] ${code} - ${message}`,
        dealId: context.dealId,
        actorId: context.actorId,
      })
    );
  },
};

/**
 * Resolves a dispute on one deal (AC-030). `actorUserId` comes from the
 * route's `guard()`, never from the body; `resolution` and `note` are the only
 * client-supplied values, and `note` has already been trimmed and bounded by
 * `resolveDisputeSchema`.
 */
export async function resolveDispute(
  dealId: string,
  input: { resolution: DisputeResolution; note: string },
  actorUserId: string,
  deps: ResolveDisputeDeps = defaultDeps
): Promise<ResolveDisputeResult> {
  const row = await deps.loadDeal(dealId);
  if (!row) {
    return { ok: false, reason: 'not_found' };
  }

  if (input.resolution === 'revision') {
    return resolveRevision(row, input, actorUserId, deps);
  }
  // Rebuilt as a literal so the narrowing the guard established — `revision`
  // is gone — reaches the money path's parameter type.
  return resolveWithLedger(
    row,
    { resolution: input.resolution, note: input.note },
    actorUserId,
    deps
  );
}

/** The `revision` path: one transaction for transition + audit + notifications. */
async function resolveRevision(
  row: ResolveDeal,
  input: { resolution: DisputeResolution; note: string },
  actorUserId: string,
  deps: ResolveDisputeDeps
): Promise<ResolveDisputeResult> {
  const success = {
    ok: true as const,
    dealId: row.id,
    status: 'revision_requested' as DealStatus,
    resolution: 'revision' as const,
  };

  try {
    return await withNotifications(async (tx, notify) => {
      return withAdminAudit<typeof success>(
        {
          action: AUDIT_ACTIONS.DEAL_RESOLVE_DISPUTE,
          targetType: AUDIT_TARGET_TYPES.DEAL,
          targetId: row.id,
          detail: (result) => ({
            resolution: input.resolution,
            note: input.note,
            before: row.status,
            after: result.status,
          }),
        },
        async (auditTx) => {
          // The machine judges legality under the lock — a `revision` on a
          // funded or completed deal is refused with its own code, exactly
          // like the ledger guards the other two paths.
          await deps.transition(
            auditTx,
            row.id,
            'revision_requested',
            actorUserId,
            { reason: input.note }
          );

          // AC-030: both parties are told, in the same transaction as the
          // state change; the emails go out only after it commits (AC-3/4).
          const payload = {
            dealId: row.id,
            campaignTitle: row.campaignName,
            resolution: NOTIFICATION_RESOLUTION.revision,
          } as const;
          await notify(row.brandUserId, 'dispute_resolved', payload);
          await notify(row.creatorUserId, 'dispute_resolved', payload);

          return success;
        },
        // The transaction seam: `withNotifications` owns the real
        // transaction, and `withAdminAudit` must run inside it rather than
        // opening a second one — the same hinge `decide-verification.ts`
        // uses.
        { ...deps?.adminAuditDeps, transaction: (fn) => fn(tx) }
      );
    }, deps?.notifyDeps);
  } catch (error) {
    const failure = revisionFailureReason(error);
    if (!failure) throw error;
    return failure;
  }
}

/** The `release`/`refund` paths: the ledger runs first, audit + notify follow. */
async function resolveWithLedger(
  row: ResolveDeal,
  input: { resolution: 'release' | 'refund'; note: string },
  actorUserId: string,
  deps: ResolveDisputeDeps
): Promise<ResolveDisputeResult> {
  let success: Extract<ResolveDisputeResult, { ok: true }>;

  try {
    if (input.resolution === 'release') {
      // The same money path brand approval uses (AC-2), guarded by the ledger's
      // own `delivered` requirement — no parallel payout exists.
      const result = await deps.pay(row.id, actorUserId);
      success = {
        ok: true,
        dealId: row.id,
        status: 'completed',
        resolution: 'release',
        payout: result.payout,
        commission: result.commission,
      };
    } else {
      await deps.refund(row.id, actorUserId);
      success = {
        ok: true,
        dealId: row.id,
        status: 'refunded',
        resolution: 'refund',
      };
    }
  } catch (error) {
    const failure = ledgerFailureReason(error);

    // The KAN-44 rule: every money-path failure leaves a trace, and the
    // unrecognised error that becomes a 500 is the one that must not go
    // unlogged. Same policy `approve-deliverable.ts` documents.
    if (!failure || failure.reason === 'payment_failed') {
      deps.logFailure(error, {
        operation: 'resolve_dispute',
        dealId: row.id,
        actorId: actorUserId,
      });
    }

    if (!failure) throw error;
    return failure;
  }

  // The ledger has committed: status and money are final. The audit row and
  // both notification rows go in one post-ledger transaction, and a failure
  // there is traced and swallowed rather than reported as a failed resolution
  // — see the module header for the failure direction.
  try {
    await withNotifications(async (tx, notify) => {
      return withAdminAudit<Extract<ResolveDisputeResult, { ok: true }>>(
        {
          action: AUDIT_ACTIONS.DEAL_RESOLVE_DISPUTE,
          targetType: AUDIT_TARGET_TYPES.DEAL,
          targetId: row.id,
          detail: (result) => ({
            resolution: input.resolution,
            note: input.note,
            before: row.status,
            after: result.status,
            ...(result.resolution === 'release'
              ? { payout: result.payout, commission: result.commission }
              : {}),
          }),
        },
        // No `auditTx` here: the ledger has already committed this resolution,
        // so these rows land in a fresh transaction — the trace-and-swallow
        // tradeoff the module header documents.
        async () => {
          const payload = {
            dealId: row.id,
            campaignTitle: row.campaignName,
            resolution: NOTIFICATION_RESOLUTION[input.resolution],
          } as const;
          await notify(row.brandUserId, 'dispute_resolved', payload);
          await notify(row.creatorUserId, 'dispute_resolved', payload);
          return success;
        },
        { ...deps?.adminAuditDeps, transaction: (fn) => fn(tx) }
      );
    }, deps?.notifyDeps);
  } catch (error) {
    deps.logPostLedgerFailure(error, {
      dealId: row.id,
      actorId: actorUserId,
      resolution: input.resolution,
    });
  }

  return success;
}

/**
 * Maps a ledger or provider failure onto a result reason, or `null` for
 * anything this action does not recognise — the mirror of
 * `approveFailureReason` in `approve-deliverable.ts`, with the one extra
 * refusal this endpoint has (`DEAL_NOT_FUNDED` from `refundDeal`).
 *
 * The two `illegal` codes are the machine's own answers, carried through so
 * the route reports exactly what the ledger refused: `release` on anything
 * but `delivered` is `DEAL_NOT_DELIVERED`, `refund` from anything but
 * `REFUNDABLE_FROM` is `DEAL_NOT_FUNDED`. `VALIDATION_ERROR` is the ledger's
 * "row gone under the lock" answer, mapped to the admin route's 404.
 * `BUDGET_EXCEEDED` — a balance that went negative can only mean corrupted
 * data — is deliberately not surfaced as retryable; re-thrown so it reaches
 * the server log as a 500.
 */
function ledgerFailureReason(
  error: unknown
): Extract<ResolveDisputeResult, { ok: false }> | null {
  if (error instanceof PaymentError) {
    return { ok: false, reason: 'payment_failed' };
  }

  if (error instanceof LedgerError) {
    switch (error.code) {
      case ErrorCode.DEAL_NOT_DELIVERED:
        return {
          ok: false,
          reason: 'illegal',
          code: ErrorCode.DEAL_NOT_DELIVERED,
        };
      case ErrorCode.DEAL_NOT_FUNDED:
        return {
          ok: false,
          reason: 'illegal',
          code: ErrorCode.DEAL_NOT_FUNDED,
        };
      case ErrorCode.PAYMENT_FAILED:
        return { ok: false, reason: 'payment_failed' };
      case ErrorCode.VALIDATION_ERROR:
        return { ok: false, reason: 'not_found' };
      default:
        return null;
    }
  }

  return null;
}

/**
 * Maps a `TransitionError` from the revision path. `NOT_FOUND` is the machine's
 * "row gone under the lock" answer (unreachable after the load above, but the
 * lock is the authoritative read), and every other code is the machine's own
 * refusal for the current status — `DEAL_NOT_DELIVERED` for a funded deal, for
 * example. Anything else re-thrown.
 */
function revisionFailureReason(
  error: unknown
): Extract<ResolveDisputeResult, { ok: false }> | null {
  if (error instanceof TransitionError) {
    if (error.code === ErrorCode.NOT_FOUND) {
      return { ok: false, reason: 'not_found' };
    }
    return { ok: false, reason: 'illegal', code: error.code };
  }
  return null;
}
