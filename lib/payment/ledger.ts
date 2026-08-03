import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/db/schema';
import type { PaymentProvider } from './types';
import { PaymentError } from './types';

export class EscrowLedgerService {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly provider: PaymentProvider
  ) {}

  async holdForCampaign(campaignId: string): Promise<void> {
    const acceptedDeals = await this.db
      .select()
      .from(schema.deal)
      .where(
        and(
          eq(schema.deal.campaignId, campaignId),
          eq(schema.deal.status, 'accepted')
        )
      );

    if (acceptedDeals.length === 0) {
      throw new PaymentError('No accepted deals to hold', 'INVALID_REFERENCE');
    }

    const totalAmount = acceptedDeals.reduce((sum, d) => sum + d.totalPrice, 0);

    const idempotencyKey = crypto.randomUUID();
    const holdResult = await this.provider.hold(totalAmount, idempotencyKey);

    await this.db.transaction(async (tx) => {
      const lastEntry = await tx
        .select({ balanceAfter: schema.ledgerEntry.balanceAfter })
        .from(schema.ledgerEntry)
        .where(eq(schema.ledgerEntry.campaignId, campaignId))
        .orderBy(sql`${schema.ledgerEntry.createdAt} DESC`)
        .limit(1);

      let currentBalance = lastEntry.length > 0 ? lastEntry[0].balanceAfter : 0;

      const entries: (typeof schema.ledgerEntry.$inferInsert)[] = [];

      for (const d of acceptedDeals) {
        currentBalance += d.totalPrice;
        entries.push({
          campaignId,
          dealId: d.id,
          entryType: 'hold',
          amount: d.totalPrice,
          balanceAfter: currentBalance,
          providerRef: holdResult.providerRef,
        });
      }

      await tx.insert(schema.ledgerEntry).values(entries);
      await tx
        .update(schema.campaign)
        .set({ status: 'funded' })
        .where(eq(schema.campaign.id, campaignId));
    });
  }

  async payoutForDeal(dealId: string): Promise<void> {
    const [d] = await this.db
      .select()
      .from(schema.deal)
      .where(eq(schema.deal.id, dealId))
      .limit(1);

    if (!d) {
      throw new PaymentError('Deal not found', 'INVALID_REFERENCE');
    }

    const rateBp = Math.round(Number(d.commissionRate) * 100);
    const commission = Math.round((d.totalPrice * rateBp) / 10_000);
    const creatorPayout = d.totalPrice - commission;

    const [holdEntry] = await this.db
      .select()
      .from(schema.ledgerEntry)
      .where(
        and(
          eq(schema.ledgerEntry.dealId, dealId),
          eq(schema.ledgerEntry.entryType, 'hold')
        )
      )
      .limit(1);

    if (!holdEntry?.providerRef) {
      throw new PaymentError(
        'No hold reference found for this deal',
        'INVALID_REFERENCE'
      );
    }

    const idempotencyKey = crypto.randomUUID();
    await this.provider.capturePayout(
      creatorPayout,
      d.creatorId,
      holdEntry.providerRef,
      idempotencyKey
    );

    await this.db.transaction(async (tx) => {
      const lastEntry = await tx
        .select({ balanceAfter: schema.ledgerEntry.balanceAfter })
        .from(schema.ledgerEntry)
        .where(eq(schema.ledgerEntry.campaignId, d.campaignId))
        .orderBy(sql`${schema.ledgerEntry.createdAt} DESC`)
        .limit(1);

      let currentBalance = lastEntry.length > 0 ? lastEntry[0].balanceAfter : 0;

      currentBalance -= creatorPayout;
      const payoutEntry: typeof schema.ledgerEntry.$inferInsert = {
        campaignId: d.campaignId,
        dealId: d.id,
        entryType: 'release_payout',
        amount: -creatorPayout,
        balanceAfter: currentBalance,
      };

      currentBalance -= commission;
      const commissionEntry: typeof schema.ledgerEntry.$inferInsert = {
        campaignId: d.campaignId,
        dealId: d.id,
        entryType: 'commission',
        amount: -commission,
        balanceAfter: currentBalance,
      };

      if (currentBalance < 0) {
        throw new PaymentError('Campaign balance would go negative', 'UNKNOWN');
      }

      await tx
        .insert(schema.ledgerEntry)
        .values([payoutEntry, commissionEntry]);
      await tx
        .update(schema.deal)
        .set({ status: 'completed' })
        .where(eq(schema.deal.id, dealId));
    });
  }

  async refundDeal(dealId: string): Promise<void> {
    const [d] = await this.db
      .select()
      .from(schema.deal)
      .where(eq(schema.deal.id, dealId))
      .limit(1);

    if (!d) {
      throw new PaymentError('Deal not found', 'INVALID_REFERENCE');
    }

    const [holdEntry] = await this.db
      .select()
      .from(schema.ledgerEntry)
      .where(
        and(
          eq(schema.ledgerEntry.dealId, dealId),
          eq(schema.ledgerEntry.entryType, 'hold')
        )
      )
      .limit(1);

    if (!holdEntry?.providerRef) {
      throw new PaymentError(
        'No hold reference found for this deal',
        'INVALID_REFERENCE'
      );
    }

    const idempotencyKey = crypto.randomUUID();
    await this.provider.releaseHold(holdEntry.providerRef, idempotencyKey);

    await this.db.transaction(async (tx) => {
      const lastEntry = await tx
        .select({ balanceAfter: schema.ledgerEntry.balanceAfter })
        .from(schema.ledgerEntry)
        .where(eq(schema.ledgerEntry.campaignId, d.campaignId))
        .orderBy(sql`${schema.ledgerEntry.createdAt} DESC`)
        .limit(1);

      const currentBalance =
        (lastEntry.length > 0 ? lastEntry[0].balanceAfter : 0) + d.totalPrice;

      await tx.insert(schema.ledgerEntry).values({
        campaignId: d.campaignId,
        dealId: d.id,
        entryType: 'refund',
        amount: d.totalPrice,
        balanceAfter: currentBalance,
      });
    });
  }
}
