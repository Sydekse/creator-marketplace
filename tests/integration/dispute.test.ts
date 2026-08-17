import { describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, deal, dealEvent, ledgerEntry } from '@/db/schema';
import { AUDIT_ACTIONS } from '@/lib/audit/actions';
import { handleResolveDispute } from '@/app/api/admin/deals/[id]/resolve/route';
import {
  createMoneyFixture,
  guardForCookie,
  realResolveDeps,
  signInCookie,
} from './helpers';

/**
 * KAN-60 flow 6 — admin dispute resolution (AC-030, AC-031): the refund path
 * returns the funds and writes the audit log.
 *
 * The fixture is created by `createMoneyFixture` — delivered, money held
 * IN-PROCESS (the mock provider's holds are per-process, so a seeded hold
 * would be invisible here), and flagged. This file touches nothing seeded, so
 * the suite stays order-independent regardless of which file runs first.
 * There is no admin dispute *UI* yet (that is KAN-78), so the flow is
 * exercised through the real resolve endpoint with a real admin session,
 * which is where the money and the audit trail live.
 */
describe('admin dispute resolution (AC-030, AC-031)', () => {
  it('refund path returns the funds, writes the audit log, and clears the flag', async () => {
    const { dealId, campaignId } = await createMoneyFixture({
      kind: 'delivered',
      flagged: true,
      label: 'KAN-59 dispute',
    });
    const adminCookie = await signInCookie('admin@demo.com');

    const [dealRow] = await db
      .select({ totalPrice: deal.totalPrice, flagged: deal.flagged })
      .from(deal)
      .where(eq(deal.id, dealId));
    if (!dealRow.flagged) {
      throw new Error(
        '[integration] expected the dispute fixture to be flagged'
      );
    }

    const response = await handleResolveDispute(
      new Request(`http://localhost/api/admin/deals/${dealId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolution: 'refund',
          note: 'Brand and creator agreed to cancel (integration).',
        }),
      }),
      dealId,
      {
        guard: guardForCookie(adminCookie),
        // The audit re-check inside `withAdminAudit` must resolve the session
        // through the real session table, not `headers()` (see realResolveDeps).
        resolveDisputeDeps: realResolveDeps(adminCookie),
      }
    );
    expect(response.status).toBe(200);

    // Money: a refund entry equal to the held total (negative — money out of
    // escrow, spike §3.5), escrow back to zero.
    const [refund] = await db
      .select({ amount: ledgerEntry.amount })
      .from(ledgerEntry)
      .where(
        sql`${ledgerEntry.campaignId} = ${campaignId} and ${ledgerEntry.entryType} = 'refund'`
      );
    expect(refund?.amount).toBe(-dealRow.totalPrice);

    // State: the deal is refunded, the flag cleared (F40).
    const [after] = await db
      .select({ status: deal.status, flagged: deal.flagged })
      .from(deal)
      .where(eq(deal.id, dealId));
    expect(after.status).toBe('refunded');
    expect(after.flagged).toBe(false);

    // Audit (AC-031): the resolution is recorded, targeting the deal.
    const [audit] = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(eq(auditLog.targetType, 'deal'), eq(auditLog.targetId, dealId))
      )
      .limit(1);
    expect(audit?.action).toBe(AUDIT_ACTIONS.DEAL_RESOLVE_DISPUTE);

    // The event history reads the resolution back.
    const [event] = await db
      .select({ toStatus: dealEvent.toStatus })
      .from(dealEvent)
      .where(eq(dealEvent.dealId, dealId))
      .orderBy(sql`"created_at" desc`)
      .limit(1);
    expect(event?.toStatus).toBe('refunded');
  });
});
