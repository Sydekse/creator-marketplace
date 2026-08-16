import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaign, deal, deliverable, ledgerEntry } from '@/db/schema';
import { EscrowLedgerService } from '@/lib/payment/ledger';
import { getPaymentProvider, MockPaymentProvider } from '@/lib/payment';
import { computeSplit } from '@/lib/payment/ledger';
import { seededDeal } from './helpers';

/**
 * KAN-59 AC-2/AC-3 — the money guarantees, proven against a real Postgres.
 *
 * Unit tests prove the logic (escrow-ledger.test.ts); these prove the
 * guarantees survive a real database and real transaction boundaries
 * (NFR-003). Every test runs inside the seeded database and asserts on
 * committed rows, so a rollback bug that unit fakes could mask shows here.
 *
 * The provider is the real `MockPaymentProvider` — the same singleton the
 * running app uses — with `setFailNext` arming the one failure each test
 * needs (the same hook the seed and the e2e payment-failure flow use).
 */

async function entriesFor(campaignId: string) {
  return db
    .select({ type: ledgerEntry.entryType, amount: ledgerEntry.amount })
    .from(ledgerEntry)
    .where(eq(ledgerEntry.campaignId, campaignId));
}

async function escrowed(campaignId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(amount), 0)` })
    .from(ledgerEntry)
    .where(
      sql`${ledgerEntry.campaignId} = ${campaignId} and ${ledgerEntry.entryType} = 'hold'`
    );
  return Number(row?.total ?? 0);
}

describe('money-path atomicity (NFR-003)', () => {
  it('a payout that fails mid-transaction leaves deal, ledger and balance unchanged', async () => {
    // The seeded dispute fixture: delivered, money held, nothing released. The
    // walker does not create a deliverable row, and the payout's approval write
    // (KAN-55) is only observable with one — so the test adds the row the real
    // submit flow would have created, making the "not approved" assertion
    // non-vacuous.
    const { dealId, campaignId } = await seededDeal('Fitness January');
    await db.insert(deliverable).values({
      dealId,
      tiktokUrl: 'https://www.tiktok.com/@creator.demo/video/integration-1',
      reviewStatus: 'pending',
    });

    const beforeDeal = await db
      .select({ status: deal.status })
      .from(deal)
      .where(eq(deal.id, dealId));
    const beforeEntries = await entriesFor(campaignId);
    const beforeEscrow = await escrowed(campaignId);

    const provider = getPaymentProvider() as MockPaymentProvider;
    provider.setFailNext('capturePayout');

    const ledger = new EscrowLedgerService(db, provider);
    await expect(ledger.payoutForDeal(dealId)).rejects.toThrow();

    // Deal untouched — still delivered, not completed.
    const afterDeal = await db
      .select({ status: deal.status })
      .from(deal)
      .where(eq(deal.id, dealId));
    expect(afterDeal[0].status).toBe('delivered');
    expect(afterDeal[0].status).toBe(beforeDeal[0].status);

    // No release_payout/commission rows appeared.
    const afterEntries = await entriesFor(campaignId);
    expect(afterEntries).toEqual(beforeEntries);
    expect(afterEntries.filter((e) => e.type !== 'hold')).toHaveLength(0);

    // The campaign's escrowed total is exactly what it was.
    expect(await escrowed(campaignId)).toBe(beforeEscrow);

    // And the deliverable was not marked approved (KAN-55 write shares the tx).
    const [deliv] = await db
      .select({ reviewStatus: deliverable.reviewStatus })
      .from(deliverable)
      .innerJoin(deal, eq(deliverable.dealId, deal.id))
      .where(eq(deal.id, dealId));
    expect(deliv?.reviewStatus).not.toBe('approved');
  });

  it('a funding hold that fails leaves the campaign unfunded', async () => {
    const { campaignId } = await seededDeal('Ramadan Beauty Push');

    const provider = getPaymentProvider() as MockPaymentProvider;
    provider.setFailNext('hold');

    const ledger = new EscrowLedgerService(db, provider);
    await expect(ledger.holdForCampaign(campaignId)).rejects.toThrow();

    const [row] = await db
      .select({ status: campaign.status })
      .from(campaign)
      .where(eq(campaign.id, campaignId));
    expect(row.status).toBe('confirmed');
    expect(await escrowed(campaignId)).toBe(0);
  });
});

describe('money paths (KAN-59 AC-3, §4.3–4.4)', () => {
  it('hold: funding a confirmed campaign writes a hold and moves it to funded', async () => {
    const { campaignId } = await seededDeal('Ramadan Beauty Push');

    const ledger = new EscrowLedgerService(db, getPaymentProvider());
    await ledger.holdForCampaign(campaignId);

    const [row] = await db
      .select({ status: campaign.status })
      .from(campaign)
      .where(eq(campaign.id, campaignId));
    expect(row.status).toBe('funded');
    expect(await escrowed(campaignId)).toBeGreaterThan(0);
  });

  it('release: payout writes release_payout + commission and completes the deal', async () => {
    const { dealId, campaignId } = await seededDeal('Fitness January');

    const [dealRow] = await db
      .select({ totalPrice: deal.totalPrice, commissionRate: deal.commissionRate })
      .from(deal)
      .where(eq(deal.id, dealId));
    const { commission, payout } = computeSplit(
      dealRow.totalPrice,
      dealRow.commissionRate
    );

    const ledger = new EscrowLedgerService(db, getPaymentProvider());
    await ledger.payoutForDeal(dealId);

    const entries = await entriesFor(campaignId);
    const release = entries.find((e) => e.type === 'release_payout');
    const comm = entries.find((e) => e.type === 'commission');

    // Payout + commission reconcile exactly with the deal total (invariant 4).
    expect(release?.amount).toBe(payout);
    expect(comm?.amount).toBe(commission);
    expect((release?.amount ?? 0) + (comm?.amount ?? 0)).toBe(dealRow.totalPrice);

    const [after] = await db
      .select({ status: deal.status })
      .from(deal)
      .where(eq(deal.id, dealId));
    expect(after.status).toBe('completed');

    // The hold is fully consumed: escrowed goes to zero once released.
    expect(await escrowed(campaignId)).toBe(0);
  });

  it('refund: refunding a funded deal writes a refund entry and returns the hold', async () => {
    const { dealId, campaignId } = await seededDeal('Tech Review Series');

    const [dealRow] = await db
      .select({ totalPrice: deal.totalPrice })
      .from(deal)
      .where(eq(deal.id, dealId));

    const ledger = new EscrowLedgerService(db, getPaymentProvider());
    await ledger.refundDeal(dealId);

    const entries = await entriesFor(campaignId);
    const refund = entries.find((e) => e.type === 'refund');
    expect(refund?.amount).toBe(dealRow.totalPrice);

    const [after] = await db
      .select({ status: deal.status })
      .from(deal)
      .where(eq(deal.id, dealId));
    expect(after.status).toBe('refunded');
    expect(await escrowed(campaignId)).toBe(0);
  });
});
