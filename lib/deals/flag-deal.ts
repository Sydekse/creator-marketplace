import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { deal } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import { withAdminAudit } from '@/lib/authz';
import type { AdminAuditDeps, Tx } from '@/lib/authz';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@/lib/audit/actions';

/**
 * Admin marks a deal flagged — or unflags it (KAN-69, F40; AC-030's
 * "disputed or flagged" precondition).
 *
 * **The flag is attention metadata, deliberately not a status.** The machine's
 * statuses drive legal transitions and the terminal-state guarantee AC-9
 * depends on, so a `disputed` status would have to be threaded through every
 * transition table and the ledger's `REFUNDABLE_FROM` guards. A boolean
 * column is additive: nothing in the machine has to know it exists, the
 * resolve endpoint can still refuse the wrong status under the lock, and
 * "flagged" means "an admin decided this deal needs eyes on it" rather than
 * "the state machine says something about it".
 *
 * **The lifecycle is set here, cleared by resolution.** Flagging raises the
 * attention state; `resolve-dispute.ts` clears it in the same transaction as
 * the resolution, because a resolution is the attention the flag asked for.
 * The KAN-53 worklist surfaces `flagged OR refundable`, so a flagged deal is
 * seen before anyone resolves it (KAN-53 AC-4).
 *
 * **Audited like every admin action (AC-031).** `withAdminAudit` gates the
 * role *inside* this module and writes `deal.flag` — the route re-gates as
 * the double-check, the pattern every other admin module keeps. The audit row
 * shares the flag's transaction, so an unlogged flag cannot exist.
 */
export interface FlagDealResult {
  id: string;
  flagged: boolean;
  status: DealStatus;
}

export interface FlagDealDeps {
  /** Existence check. Not ownership-scoped: an admin flags any deal. */
  loadDeal: (dealId: string) => Promise<{ status: DealStatus } | null>;
  /** The mutation, inside the audit transaction. */
  setFlag: (tx: Tx, dealId: string, flagged: boolean) => Promise<void>;
  /**
   * Passed through to `withAdminAudit`. Full deps, not the omit the resolve
   * action uses: this module owns its own transaction (there is no outer one
   * to share), so the seam must be overridable for tests just like every
   * standalone admin module's.
   */
  adminAuditDeps?: AdminAuditDeps;
}

const defaultDeps: FlagDealDeps = {
  loadDeal: async (dealId) => {
    const [row] = await db
      .select({ status: deal.status })
      .from(deal)
      .where(eq(deal.id, dealId))
      .limit(1);
    return row ?? null;
  },
  setFlag: async (tx, dealId, flagged) => {
    await tx.update(deal).set({ flagged }).where(eq(deal.id, dealId));
  },
};

/**
 * Flags or unflags one deal. `null` when the deal does not exist — the admin
 * route maps that to its 404. The role gate runs inside `withAdminAudit`
 * before the transaction opens (NFR-005), and the audit row commits with the
 * flag (AC-031, invariant 9).
 */
export async function setDealFlagged(
  dealId: string,
  input: { flagged: boolean; note?: string },
  deps: FlagDealDeps = defaultDeps
): Promise<FlagDealResult | null> {
  const row = await deps.loadDeal(dealId);
  if (!row) return null;

  return withAdminAudit<FlagDealResult>(
    {
      action: AUDIT_ACTIONS.DEAL_FLAG,
      targetType: AUDIT_TARGET_TYPES.DEAL,
      targetId: dealId,
      detail: {
        flagged: input.flagged,
        note: input.note ?? null,
        status: row.status,
      },
    },
    async (tx) => {
      await deps.setFlag(tx, dealId, input.flagged);
      return { id: dealId, flagged: input.flagged, status: row.status };
    },
    deps?.adminAuditDeps
  );
}
