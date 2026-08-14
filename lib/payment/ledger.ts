import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import { ErrorCode } from '@/lib/validation/errors';
import type { PaymentProvider } from './types';
import { PaymentError } from './types';
import { transitionDeal } from '@/lib/deals/state-machine';
import { sumEscrowedByCampaign } from './escrow';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * A refused state transition or a guard trip. Distinct from `PaymentError`,
 * which means the provider itself failed: this one is our own rule saying no.
 *
 * It carries an `ErrorCode` so the calling route handler (KAN-43, KAN-45,
 * KAN-51) maps it straight onto the standard envelope without a translation
 * table in between.
 */
export class LedgerError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Deal states a refund may legally start from — every state where money is
 * held for the deal and has not already been paid out. Reached by decline
 * after funding (KAN-37), expiry (KAN-38) and dispute resolution (KAN-51).
 */
export const REFUNDABLE_FROM: readonly DealStatus[] = [
  'funded',
  'delivered',
  'revision_requested',
];

/** The only state an approval may pay out from (`delivered --approve--> completed`). */
export const PAYABLE_FROM: DealStatus = 'delivered';

/**
 * Is this deal's money sitting in escrow right now (KAN-43 AC-019 item 6)?
 *
 * Derived from `REFUNDABLE_FROM` rather than written out as `=== 'funded'`,
 * because the two are the same question: a refund is only possible where a hold
 * exists and has not been paid out, which is exactly when money is held. A
 * screen with its own list of statuses would be free to drift from the one the
 * ledger enforces, and the drift would surface as a creator being told their
 * money is held when the ledger would refuse to release it.
 *
 * Defined here rather than in `lib/payment/escrow.ts` so that module needs
 * nothing from this one — it is imported *by* this one, and a cycle between them
 * would leave `REFUNDABLE_FROM` undefined at its point of use.
 *
 * `completed` is deliberately false: that money has left escrow for the creator
 * (spike §6 calls it `spent`), so a screen calling it "held" would tell a paid
 * creator they have not been paid.
 */
export function isMoneyHeld(status: DealStatus): boolean {
  return REFUNDABLE_FROM.includes(status);
}

/**
 * Split a deal's total into platform commission and creator payout (spike §3.3).
 *
 * Exported and pure because this is the ledger math NFR-009 wants at 100%
 * coverage — it is worth testing without a database in the way.
 *
 * `payout` is derived by **subtraction**, never by a second independent
 * multiplication: `round(total × rate) + round(total × (1 - rate))` disagrees
 * with `total` on roughly one deal in ten. Basis points keep the intermediate
 * an integer, so the only float that ever exists is inside `rateBp`.
 *
 * @param totalPrice integer ETB santim
 * @param commissionRate `numeric(5, 2)` as drizzle returns it — a string
 */
export function computeSplit(
  totalPrice: number,
  commissionRate: string
): { commission: number; payout: number } {
  const rateBp = Math.round(Number(commissionRate) * 100);
  const commission = Math.round((totalPrice * rateBp) / 10_000);
  return { commission, payout: totalPrice - commission };
}

/**
 * What one funding run put into escrow (KAN-43).
 *
 * The figures the `campaign_funded` notification states, taken from the
 * transaction that wrote the entries rather than re-derived afterwards.
 */
export interface HoldForCampaignResult {
  /** How many deals moved `accepted -> funded`. */
  dealCount: number;
  /** The sum held, in integer santim (invariant 4). */
  totalHeld: number;
  /** The provider's reference for the hold, shared by every entry in the run. */
  providerRef: string;
}

/** Spike §5.3: 3 retries on serialization failure, exponential backoff. */
const RETRY_BACKOFF_MS = [50, 100, 200] as const;

/** Postgres `serialization_failure`. */
const SERIALIZATION_FAILURE = '40001';

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === SERIALIZATION_FAILURE
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Escrow ledger service (KAN-42, spike KAN-40).
 *
 * Every method here moves money, so every method obeys the same shape — the one
 * §5.1 mandates and invariant 1 depends on:
 *
 *     serializable tx
 *       -> lock the deal and campaign rows FOR UPDATE
 *       -> assert the transition is legal
 *       -> re-sum balance_after and check it stays non-negative
 *       -> call the provider
 *       -> write ledger_entry + deal_event, update status
 *       -> commit
 *
 * The provider call is *inside* the transaction on purpose. A provider failure
 * then rolls back every row we would have written, so there is no state in which
 * the ledger records money the PSP never moved.
 */
export class EscrowLedgerService {
  constructor(
    private readonly db: Db,
    private readonly provider: PaymentProvider
  ) {}

  /**
   * Hold funds for every accepted deal in a confirmed campaign (KAN-43, AC-019).
   *
   * One `provider.hold()` for the campaign total, then one `hold` ledger entry
   * per deal so each deal's escrow can be released or refunded independently.
   *
   * Returns what it held rather than `void`, so the caller can say so without
   * asking the database a second question after the transaction has closed. A
   * re-read outside the lock could also answer with a *different* campaign's
   * worth of activity if anything moved in between; these figures are the ones
   * the entries were actually written from.
   */
  async holdForCampaign(
    campaignId: string,
    actorId?: string
  ): Promise<HoldForCampaignResult> {
    // Generated once, deliberately outside the retry loop. Every retry reuses
    // it, so a serialization retry replays the provider's cached result instead
    // of placing a second hold (spike §4.2). A fresh UUID per attempt — what
    // this method used to do — would double-charge on the first conflict.
    const idempotencyKey = crypto.randomUUID();

    return this.inSerializableTx(async (tx) => {
      const campaign = await this.lockCampaign(tx, campaignId);

      if (campaign.status !== 'confirmed') {
        throw new LedgerError(
          `Campaign ${campaignId} is ${campaign.status}, expected confirmed.`,
          ErrorCode.CAMPAIGN_NOT_FUNDABLE
        );
      }

      const deals = await tx
        .select()
        .from(schema.deal)
        .where(
          and(
            eq(schema.deal.campaignId, campaignId),
            eq(schema.deal.status, 'accepted')
          )
        )
        .for('update');

      if (deals.length === 0) {
        throw new LedgerError(
          'Campaign has no accepted deals to fund.',
          ErrorCode.NO_ACCEPTED_DEALS
        );
      }

      // Invariant 4 — one hold per deal. Without this, calling the fund action
      // twice holds the money twice and writes a second set of entries.
      const alreadyHeld = await tx
        .select({ dealId: schema.ledgerEntry.dealId })
        .from(schema.ledgerEntry)
        .where(
          and(
            inArray(
              schema.ledgerEntry.dealId,
              deals.map((d) => d.id)
            ),
            eq(schema.ledgerEntry.entryType, 'hold')
          )
        )
        .limit(1);

      if (alreadyHeld.length > 0) {
        throw new LedgerError(
          'Campaign has already been funded.',
          ErrorCode.CAMPAIGN_NOT_FUNDABLE
        );
      }

      const total = deals.reduce((sum, d) => sum + d.totalPrice, 0);

      const held = await this.provider.hold(total, idempotencyKey);

      let balance = await this.sumBalance(tx, campaignId);

      for (const d of deals) {
        balance += d.totalPrice;

        await tx.insert(schema.ledgerEntry).values({
          campaignId,
          dealId: d.id,
          entryType: 'hold',
          amount: d.totalPrice,
          balanceAfter: balance,
          providerRef: held.providerRef,
        });

        await transitionDeal(tx, d.id, 'funded', actorId, {
          reason: 'Campaign funded',
        });
      }

      await tx
        .update(schema.campaign)
        .set({ status: 'funded' })
        .where(eq(schema.campaign.id, campaignId));

      // Returned from inside the transaction, so a serialization retry returns
      // the winning attempt's figures rather than a stale closure's.
      return {
        dealCount: deals.length,
        totalHeld: total,
        providerRef: held.providerRef,
      };
    });
  }

  /**
   * Release payout and commission for one approved deliverable (KAN-45).
   *
   * `payout` is derived by subtraction from integer basis points (spike §3.3),
   * which is what guarantees `release_payout + commission === total_price`
   * exactly rather than to within a rounding error.
   */
  async payoutForDeal(dealId: string, actorId?: string): Promise<void> {
    const idempotencyKey = crypto.randomUUID();

    await this.inSerializableTx(async (tx) => {
      const deal = await this.lockDeal(tx, dealId);

      if (deal.status !== PAYABLE_FROM) {
        throw new LedgerError(
          `Deal ${dealId} is ${deal.status}, expected ${PAYABLE_FROM}.`,
          ErrorCode.DEAL_NOT_DELIVERED
        );
      }

      await this.lockCampaign(tx, deal.campaignId);

      const holdRef = await this.requireHoldRef(tx, dealId);

      const { commission, payout } = computeSplit(
        deal.totalPrice,
        deal.commissionRate
      );

      const balance = await this.sumBalance(tx, deal.campaignId);
      const afterPayout = balance - payout;
      const afterCommission = afterPayout - commission;

      // Invariant 7, checked *before* the provider call. Checking afterwards —
      // what this used to do — means the PSP has already transferred money by
      // the time we decide the campaign cannot afford it.
      if (afterCommission < 0) {
        throw new LedgerError(
          'Campaign escrow balance would go negative.',
          ErrorCode.BUDGET_EXCEEDED
        );
      }

      await this.provider.capturePayout(
        payout,
        deal.creatorId,
        holdRef,
        idempotencyKey
      );

      await tx.insert(schema.ledgerEntry).values([
        {
          campaignId: deal.campaignId,
          dealId: deal.id,
          entryType: 'release_payout',
          amount: -payout,
          balanceAfter: afterPayout,
          providerRef: holdRef,
        },
        {
          campaignId: deal.campaignId,
          dealId: deal.id,
          entryType: 'commission',
          amount: -commission,
          balanceAfter: afterCommission,
          providerRef: holdRef,
        },
      ]);

      await transitionDeal(tx, deal.id, 'completed', actorId, {
        reason: 'Deliverable approved',
      });
    });
  }

  /**
   * Return a deal's held funds to the campaign (KAN-37, KAN-38, KAN-51).
   *
   * The entry is **negative**: positive is into escrow, negative is out, and a
   * refund takes money out. A positive refund would make `hold(+X)` and
   * `refund(+X)` sum to `+2X` — the money becomes payable a second time, and
   * because the error inflates the balance the non-negativity guard never
   * trips on it (spike §3.5).
   *
   * The brand's available budget rising is a *consequence* of escrow falling,
   * derived from this one column — not a second entry (spike §6).
   */
  async refundDeal(dealId: string, actorId?: string): Promise<void> {
    const idempotencyKey = crypto.randomUUID();

    await this.inSerializableTx(async (tx) => {
      const deal = await this.lockDeal(tx, dealId);

      if (!REFUNDABLE_FROM.includes(deal.status)) {
        throw new LedgerError(
          `Deal ${dealId} is ${deal.status}, expected one of ${REFUNDABLE_FROM.join(', ')}.`,
          ErrorCode.DEAL_NOT_FUNDED
        );
      }

      await this.lockCampaign(tx, deal.campaignId);

      const holdRef = await this.requireHoldRef(tx, dealId);

      const balance = await this.sumBalance(tx, deal.campaignId);
      const afterRefund = balance - deal.totalPrice;

      if (afterRefund < 0) {
        throw new LedgerError(
          'Campaign escrow balance would go negative.',
          ErrorCode.BUDGET_EXCEEDED
        );
      }

      await this.provider.releaseHold(holdRef, idempotencyKey);

      await tx.insert(schema.ledgerEntry).values({
        campaignId: deal.campaignId,
        dealId: deal.id,
        entryType: 'refund',
        amount: -deal.totalPrice,
        balanceAfter: afterRefund,
        providerRef: holdRef,
      });

      await transitionDeal(tx, deal.id, 'refunded', actorId, {
        reason: 'Deal refunded',
      });
    });
  }

  // -- internals ------------------------------------------------------------

  /**
   * Runs `fn` in a serializable transaction, retrying serialization failures
   * (spike §5.3). Only `40001` is retried — every other error, including a
   * `PaymentError` or a refused transition, propagates on the first attempt.
   */
  private async inSerializableTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.transaction(fn, {
          isolationLevel: 'serializable',
        });
      } catch (error) {
        if (!isSerializationFailure(error)) throw error;

        const backoff = RETRY_BACKOFF_MS[attempt];
        if (backoff === undefined) {
          // Out of retries. Nothing was committed — every attempt rolled back.
          throw new LedgerError(
            'Payment could not be completed due to concurrent activity.',
            ErrorCode.PAYMENT_FAILED
          );
        }
        await sleep(backoff);
      }
    }
  }

  /**
   * The campaign row lock is what serialises concurrent money movement on a
   * campaign — every method takes it before re-summing the balance.
   *
   * Note the spike's §5.4 snippet writes `SELECT SUM(amount) ... FOR UPDATE`.
   * Postgres rejects that ("FOR UPDATE is not allowed with aggregate
   * functions"), so the lock is taken on the campaign row instead and the sum
   * runs under it. Same serialisation guarantee, valid SQL.
   */
  private async lockCampaign(tx: Tx, campaignId: string) {
    const [row] = await tx
      .select()
      .from(schema.campaign)
      .where(eq(schema.campaign.id, campaignId))
      .for('update')
      .limit(1);

    if (!row) {
      throw new LedgerError(
        `Campaign ${campaignId} not found.`,
        ErrorCode.VALIDATION_ERROR
      );
    }
    return row;
  }

  private async lockDeal(tx: Tx, dealId: string) {
    const [row] = await tx
      .select()
      .from(schema.deal)
      .where(eq(schema.deal.id, dealId))
      .for('update')
      .limit(1);

    if (!row) {
      throw new LedgerError(
        `Deal ${dealId} not found.`,
        ErrorCode.VALIDATION_ERROR
      );
    }
    return row;
  }

  /**
   * Re-summed from every prior entry, never carried forward from the last row
   * (spike §5.4).
   *
   * Carrying forward was also plainly wrong here: `created_at` defaults to
   * `now()`, which is constant within a transaction, so every entry written by
   * one `holdForCampaign` shares a timestamp and `ORDER BY created_at DESC
   * LIMIT 1` picked an arbitrary one of them.
   *
   * Delegates to `sumEscrowedByCampaign` rather than holding its own copy of the
   * query, so the figure the guards below enforce and the figure a brand is shown
   * (AC-019 item 6) are the same sum. Always through `tx` — this runs under the
   * campaign row lock taken above, and the global `db` would wait on a connection
   * the `max: 5` pool has already lent out.
   */
  private sumBalance(tx: Tx, campaignId: string): Promise<number> {
    return sumEscrowedByCampaign(campaignId, tx);
  }

  private async requireHoldRef(tx: Tx, dealId: string): Promise<string> {
    const [entry] = await tx
      .select({ providerRef: schema.ledgerEntry.providerRef })
      .from(schema.ledgerEntry)
      .where(
        and(
          eq(schema.ledgerEntry.dealId, dealId),
          eq(schema.ledgerEntry.entryType, 'hold')
        )
      )
      .limit(1);

    if (!entry?.providerRef) {
      throw new PaymentError(
        `No hold reference recorded for deal ${dealId}.`,
        'INVALID_REFERENCE'
      );
    }
    return entry.providerRef;
  }
}
