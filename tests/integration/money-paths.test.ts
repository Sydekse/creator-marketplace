import { describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaign, deal, deliverable, ledgerEntry } from '@/db/schema';
import { EscrowLedgerService } from '@/lib/payment/ledger';
import { getPaymentProvider, MockPaymentProvider } from '@/lib/payment';
import { PgHoldStore } from '@/lib/payment/pg-hold-store';
import { computeSplit } from '@/lib/payment/ledger';
import { createMoneyFixture } from './helpers';

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
 * needs. Each test builds its own campaign and walks it through the real
 * ledger with `createMoneyFixture`, so a test never depends on another's rows.
 *
 * Since KAN-200 the mock's holds live in `provider_hold` rather than in a
 * per-process `Map`, which is what makes the cross-instance test at the bottom
 * of this file possible — and is why holds placed by the seed process are now
 * visible here rather than being dead references.
 */

async function entriesFor(campaignId: string) {
  return db
    .select({ type: ledgerEntry.entryType, amount: ledgerEntry.amount })
    .from(ledgerEntry)
    .where(eq(ledgerEntry.campaignId, campaignId));
}

/**
 * The campaign's ledger balance — the sum of **every** entry (hold in,
 * release/refund out). Only the full sum answers "is all the money back?":
 * the ledger is append-only, so the `hold` row never disappears — a refund or
 * payout offsets it with a negative entry, and the balance returning to zero
 * is the invariant that proves the money round-tripped.
 */
async function balance(campaignId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(amount), 0)` })
    .from(ledgerEntry)
    .where(eq(ledgerEntry.campaignId, campaignId));
  return Number(row?.total ?? 0);
}

/**
 * The provider reference for a deal's hold.
 *
 * Read off the `hold` ledger row rather than tracked by the test, because that
 * column is the only mapping between our books and the processor's — and since
 * KAN-68 there is exactly one hold row per deal, each with its own ref
 * (invariant 12).
 */
async function providerRefForHold(dealId: string): Promise<string> {
  const [row] = await db
    .select({ providerRef: ledgerEntry.providerRef })
    .from(ledgerEntry)
    .where(
      and(eq(ledgerEntry.dealId, dealId), eq(ledgerEntry.entryType, 'hold'))
    )
    .limit(1);
  if (!row?.providerRef) {
    throw new Error(`[integration] no hold ledger row for deal ${dealId}`);
  }
  return row.providerRef;
}

describe('money-path atomicity (NFR-003)', () => {
  it('a payout that fails mid-transaction leaves deal, ledger and balance unchanged', async () => {
    // A delivered deal with a hold placed by THIS process — so the only thing
    // that can fail below is the induced `capturePayout` fault. The payout's
    // approval write (KAN-55) is only observable with a deliverable row, which
    // the real submit flow would have created, so the test adds it — making
    // the "not approved" assertion non-vacuous.
    const { dealId, campaignId } = await createMoneyFixture({
      kind: 'delivered',
      label: 'KAN-59 payout-fail',
    });
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
    const beforeBalance = await balance(campaignId);

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

    // The campaign's ledger balance is exactly what it was.
    expect(await balance(campaignId)).toBe(beforeBalance);

    // And the deliverable was not marked approved (KAN-55 write shares the tx).
    const [deliv] = await db
      .select({ reviewStatus: deliverable.reviewStatus })
      .from(deliverable)
      .innerJoin(deal, eq(deliverable.dealId, deal.id))
      .where(eq(deal.id, dealId));
    expect(deliv?.reviewStatus).not.toBe('approved');
  });

  it('a funding hold that fails leaves the campaign unfunded', async () => {
    // The deal starts `accepted` — reachable by `holdForCampaign`, so the
    // induced `hold` fault is what actually throws (not "no accepted deals").
    const { dealId, campaignId } = await createMoneyFixture({
      kind: 'accepted',
      label: 'KAN-59 hold-fail',
    });

    const provider = getPaymentProvider() as MockPaymentProvider;
    provider.setFailNext('hold');

    const ledger = new EscrowLedgerService(db, provider);
    await expect(ledger.holdForCampaign(campaignId)).rejects.toThrow();

    const [row] = await db
      .select({ status: campaign.status })
      .from(campaign)
      .where(eq(campaign.id, campaignId));
    expect(row.status).toBe('confirmed');

    // The deal is untouched too — still accepted, never funded.
    const [dealRow] = await db
      .select({ status: deal.status })
      .from(deal)
      .where(eq(deal.id, dealId));
    expect(dealRow.status).toBe('accepted');

    expect(await balance(campaignId)).toBe(0);
  });

  it('a refund that fails mid-transaction leaves deal, ledger and balance unchanged', async () => {
    // A funded deal with a live in-process hold — the refund's `releaseHold`
    // is the only thing that can fail, so the rejection is genuinely the
    // induced fault, and the rollback is what keeps every row untouched.
    const { dealId, campaignId } = await createMoneyFixture({
      kind: 'funded',
      label: 'KAN-59 refund-fail',
    });

    const beforeDeal = await db
      .select({ status: deal.status })
      .from(deal)
      .where(eq(deal.id, dealId));
    const beforeEntries = await entriesFor(campaignId);
    const beforeBalance = await balance(campaignId);

    const provider = getPaymentProvider() as MockPaymentProvider;
    provider.setFailNext('releaseHold');

    const ledger = new EscrowLedgerService(db, provider);
    await expect(ledger.refundDeal(dealId)).rejects.toThrow();

    // Deal untouched — still funded, not refunded.
    const afterDeal = await db
      .select({ status: deal.status })
      .from(deal)
      .where(eq(deal.id, dealId));
    expect(afterDeal[0].status).toBe('funded');
    expect(afterDeal[0].status).toBe(beforeDeal[0].status);

    // No refund entry appeared.
    const afterEntries = await entriesFor(campaignId);
    expect(afterEntries).toEqual(beforeEntries);
    expect(afterEntries.filter((e) => e.type !== 'hold')).toHaveLength(0);

    // The campaign's ledger balance is exactly what it was.
    expect(await balance(campaignId)).toBe(beforeBalance);
  });
});

describe('money paths (KAN-59 AC-3, §4.3–4.4)', () => {
  it('hold: funding a confirmed campaign writes a hold and moves it to funded', async () => {
    const { campaignId } = await createMoneyFixture({
      kind: 'accepted',
      label: 'KAN-59 hold',
    });

    const ledger = new EscrowLedgerService(db, getPaymentProvider());
    await ledger.holdForCampaign(campaignId);

    const [row] = await db
      .select({ status: campaign.status })
      .from(campaign)
      .where(eq(campaign.id, campaignId));
    expect(row.status).toBe('funded');
    expect(await balance(campaignId)).toBeGreaterThan(0);
  });

  it('release: payout writes release_payout + commission and completes the deal', async () => {
    const { dealId, campaignId } = await createMoneyFixture({
      kind: 'delivered',
      label: 'KAN-59 release',
    });

    const [dealRow] = await db
      .select({
        totalPrice: deal.totalPrice,
        commissionRate: deal.commissionRate,
      })
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

    // Both entries are negative — money out of escrow (spike §3.5) — and
    // reconcile exactly with the deal total (invariant 4): the two legs draw
    // the hold down to zero.
    expect(release?.amount).toBe(-payout);
    expect(comm?.amount).toBe(-commission);
    expect((release?.amount ?? 0) + (comm?.amount ?? 0)).toBe(
      -dealRow.totalPrice
    );

    const [after] = await db
      .select({ status: deal.status })
      .from(deal)
      .where(eq(deal.id, dealId));
    expect(after.status).toBe('completed');

    // The hold is fully consumed: the ledger balance goes to zero once
    // released (the hold's positive entry offsets the two negative legs).
    expect(await balance(campaignId)).toBe(0);
  });

  it('refund: refunding a funded deal writes a refund entry and returns the hold', async () => {
    const { dealId, campaignId } = await createMoneyFixture({
      kind: 'funded',
      label: 'KAN-59 refund',
    });

    const [dealRow] = await db
      .select({ totalPrice: deal.totalPrice })
      .from(deal)
      .where(eq(deal.id, dealId));

    const ledger = new EscrowLedgerService(db, getPaymentProvider());
    await ledger.refundDeal(dealId);

    const entries = await entriesFor(campaignId);
    const refund = entries.find((e) => e.type === 'refund');
    // The refund entry is negative — money out of escrow (spike §3.5).
    expect(refund?.amount).toBe(-dealRow.totalPrice);

    const [after] = await db
      .select({ status: deal.status })
      .from(deal)
      .where(eq(deal.id, dealId));
    expect(after.status).toBe('refunded');

    // The hold's positive entry is offset by the refund: all money is back.
    expect(await balance(campaignId)).toBe(0);
  });
});

/**
 * The KAN-200 regression, and the only test in the repo that reproduces what
 * Nate actually hit on 2026-08-20.
 *
 * Funding and approval are two HTTP requests, and on Vercel there is no promise
 * they run on the same instance. While the mock kept holds in a module-level
 * `Map`, the approving instance simply had none: `capturePayout` threw
 * `INVALID_REFERENCE`, `payoutForDeal` rolled its transaction back, and the brand
 * saw "Payment failed — please try again." on every attempt with no way past it.
 *
 * A fresh `MockPaymentProvider` over a fresh `PgHoldStore` is the closest a
 * single process can get to that boundary: it shares nothing with the instance
 * that placed the hold except the database. Before this change the assertion
 * below fails; after it, the hold is found and drawn down by both legs.
 */
describe('holds survive the request boundary (KAN-200)', () => {
  it('a provider instance that never placed the hold can still pay out against it', async () => {
    const { dealId, campaignId } = await createMoneyFixture({
      kind: 'delivered',
      label: 'KAN-200 cross-instance',
    });

    // Nothing is carried over from the funding call — not the provider, not the
    // store, not the ledger service.
    const freshProvider = new MockPaymentProvider(new PgHoldStore());
    const freshLedger = new EscrowLedgerService(db, freshProvider);
    await freshLedger.payoutForDeal(dealId);

    const [after] = await db
      .select({ status: deal.status })
      .from(deal)
      .where(eq(deal.id, dealId));
    expect(after.status).toBe('completed');

    // Both legs reached the provider and drained the hold (invariant 13), so the
    // campaign's escrow balance is back to zero.
    expect(await balance(campaignId)).toBe(0);

    // And the processor's own record agrees: nothing left to draw. This is the
    // read that used to throw `INVALID_REFERENCE`.
    const holdRef = await providerRefForHold(dealId);
    expect(await freshProvider.getStatus(holdRef)).toMatchObject({
      state: 'captured',
      amount: 0,
    });
  });

  it('a fresh instance can release a hold it never placed', async () => {
    const { dealId, campaignId } = await createMoneyFixture({
      kind: 'funded',
      label: 'KAN-200 cross-instance refund',
    });

    const freshLedger = new EscrowLedgerService(
      db,
      new MockPaymentProvider(new PgHoldStore())
    );
    await freshLedger.refundDeal(dealId);

    const [after] = await db
      .select({ status: deal.status })
      .from(deal)
      .where(eq(deal.id, dealId));
    expect(after.status).toBe('refunded');
    expect(await balance(campaignId)).toBe(0);
  });
});
