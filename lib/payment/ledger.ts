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
 * Called from outside `lib/payment/` since KAN-55 — `confirm-campaign.ts` needs
 * it to tell a creator what an offer would pay. It stays here rather than moving
 * to a shared leaf: the payout that eventually happens is computed by this
 * function, and a copy anywhere else is a second answer to the same question.
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
 * What one approval released to the creator and kept as commission (KAN-45).
 *
 * The figures the `release_payout`/`commission` entries were written from,
 * returned from inside the transaction rather than re-derived afterwards —
 * the same rule `HoldForCampaignResult` documents for funding.
 */
export interface PayoutResult {
  /** Integer santim the creator receives, net of commission. */
  payout: number;
  /** Integer santim the platform keeps. */
  commission: number;
  /**
   * The deal's gross, as locked (KAN-55 AC-4).
   *
   * Here so the payment email can state gross, commission and net without a
   * caller re-reading the deal or adding the other two together. Both of those
   * would be a second source for a figure this transaction already has, and the
   * re-read could see a different row than the one that was paid.
   */
  totalPrice: number;
}

/**
 * KAN-69 (F32, F39): the knobs `payoutForDeal` takes beyond the money itself.
 *
 * `reason` overrides the `deal_event` reason the transaction writes. The
 * default stays "Deliverable approved" so brand approval is byte-identical;
 * the dispute path passes an honest "Dispute resolved: …" instead, because a
 * `deal_event` is append-only and a losing brand must not read that their
 * deliverable was approved (F32).
 *
 * `onCommit` runs **inside the same serializable transaction**, after the
 * ledger rows and the state change, before commit — a rejection rolls back
 * the payout with everything else (invariant 1, NFR-003). This is the F39
 * fix: the caller's `deal.resolve_dispute` audit row becomes atomic with the
 * money movement instead of a second, post-commit transaction that could be
 * lost. Notifications deliberately stay *outside*: emails must not be queued
 * inside a retrying transaction (they would re-send per serialization retry)
 * and the ledger must not hold a second pool connection — the shape
 * `approve-deliverable.ts` documents.
 */
export interface PayoutForDealOptions {
  reason?: string;
  onCommit?: (tx: Tx, result: PayoutResult) => Promise<void>;
}

/** The refund twin of `PayoutForDealOptions` — no result to hand back. */
export interface RefundDealOptions {
  reason?: string;
  onCommit?: (tx: Tx) => Promise<void>;
}

/**
 * What one funding run put into escrow (KAN-43).
 *
 * The figures the `campaign_funded` notification states, taken from the
 * transaction that wrote the entries rather than re-derived afterwards.
 *
 * There is deliberately **no `providerRef`** here. Funding places one hold per
 * deal (KAN-68, F20), so there are N references and no single one describes the
 * run — the field this type used to carry documented itself as "shared by every
 * entry in the run", which is exactly the property that made refunding one deal
 * release every deal's money. Each `hold` ledger row carries its own ref, which
 * is where a reconciliation should read them from.
 */
export interface HoldForCampaignResult {
  /** How many deals moved `accepted -> funded`. */
  dealCount: number;
  /** The sum held, in integer santim (invariant 4). */
  totalHeld: number;
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
   * **One `provider.hold()` per deal**, each with its own `providerRef` on its
   * own `hold` ledger entry, so a deal's escrow can genuinely be released or
   * refunded independently.
   *
   * This reverses spike §5.2, which says to call `provider.hold()` once for the
   * campaign total (KAN-68, F20). The spike's own design forces the reversal: it
   * defines `refundDeal(dealId)` as a per-deal operation while `releaseHold`
   * takes no amount and is documented as releasing the *entire* hold. With one
   * campaign-wide reference, refunding one deal of five told the processor to let
   * go of all five — our ledger recorded a single refund, the PSP released
   * everything, and the next payout failed against a reference that was no longer
   * `held`. The PRD is silent on granularity (AC-019 says "captured/held"), so
   * nothing above the spike had to change.
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

      let balance = await this.sumBalance(tx, campaignId);

      for (const d of deals) {
        // One hold per deal, keyed per deal. The suffix is not decoration:
        // `MockPaymentProvider.hold` deduplicates on `{ amount }` alone, so two
        // equal-priced deals sharing one key would silently receive the *same*
        // `providerRef` with no error raised — reproducing the very bug this
        // loop exists to fix. Deriving the key from the method-level UUID rather
        // than generating one here keeps the retry-replay property above: the
        // same deal asks for the same key on every attempt.
        const held = await this.provider.hold(
          d.totalPrice,
          `${idempotencyKey}:${d.id}`
        );

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
      };
    });
  }

  /**
   * Release payout and commission for one approved deliverable (KAN-45).
   *
   * `payout` is derived by subtraction from integer basis points (spike §3.3),
   * which is what guarantees `release_payout + commission === total_price`
   * exactly rather than to within a rounding error.
   *
   * **Two provider legs, one per ledger row** (KAN-68, F21): the creator's payout
   * and the platform's commission. Together they draw the deal's hold down to
   * zero, which is what takes it to `captured` — the terminal state the provider
   * contract documents. Capturing only the payout, which is what this used to do,
   * left the commission slice outstanding at the processor forever.
   *
   * Returns what it moved, like `holdForCampaign` returns what it held: the
   * figures the entries were actually written from, captured inside the
   * transaction rather than re-derived afterwards from a read that could see
   * a *different* state (and would double as a second source for the split).
   *
   * Also marks the deliverable `'approved'` (KAN-55). That belongs here rather
   * than in `approve-deliverable.ts` because it has to share this transaction —
   * a deliverable marked approved outside it could survive a rolled-back payout.
   */
  async payoutForDeal(
    dealId: string,
    actorId?: string,
    opts?: PayoutForDealOptions
  ): Promise<PayoutResult> {
    const idempotencyKey = crypto.randomUUID();

    return this.inSerializableTx(async (tx) => {
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
        `${idempotencyKey}:payout`
      );

      // The platform's leg (KAN-68, F21). Until this existed the `commission`
      // row below said the platform took its cut and the processor was never
      // told, so the hold sat at `held` with the commission slice outstanding
      // forever and the platform was never actually paid.
      //
      // Skipped at zero, which is a real and ordinary case rather than a guard
      // against nonsense: `computeSplit(3, '15.00')` is 0, and so is any deal at
      // a 0% rate, while the provider refuses a zero amount. Nothing is stranded
      // by the skip — `payout + commission === total_price` exactly, and the hold
      // is for `total_price`, so a zero commission means the payout leg alone
      // drew the remaining amount to zero and the hold is already `captured`.
      //
      // Distinct keys per leg. Two legs sharing one key throw
      // `DUPLICATE_IDEMPOTENCY` the moment their amounts differ, and would
      // replay the first leg's cached result in the case where they matched.
      //
      // Both calls are inside the transaction, so a failure here rolls back the
      // payout leg's rows with everything else (invariant 1, NFR-003). It costs
      // a second provider round-trip on approve, which is an NFR-002 latency
      // consideration rather than a correctness one — free against the in-process
      // mock, and a real processor under Q3 would want them batched.
      if (commission > 0) {
        await this.provider.captureCommission(
          commission,
          holdRef,
          `${idempotencyKey}:commission`
        );
      }

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
        reason: opts?.reason ?? 'Deliverable approved',
      });

      // The deliverable is now judged, and says so.
      //
      // Until KAN-55 nothing ever wrote `'approved'`: `submit-deliverable.ts`
      // writes `'pending'`, `reject-deliverable.ts` writes `'rejected'`, and this
      // path paid the creator and closed the deal without touching the row. So a
      // paid-out video still read as a submission nobody had looked at — the
      // meaning `lib/deals/brand-detail.ts` gives `'pending'`, on a column it
      // already selects — and `'approved'` was a declared enum value with no
      // writer at all.
      //
      // Inside the transaction, so it cannot disagree with the payout: the same
      // rollback that un-pays the creator un-approves the deliverable
      // (invariant 1). `reviewedAt` is computed in JS and set alongside the
      // status, matching `recordRejection`.
      //
      // No row-count check. `payoutForDeal` refuses any status but `delivered`,
      // and reaching `delivered` requires a submitted deliverable, so the update
      // matches exactly one row — and an update that matched none would leave
      // nothing inconsistent anyway.
      await tx
        .update(schema.deliverable)
        .set({ reviewStatus: 'approved', reviewedAt: new Date() })
        .where(eq(schema.deliverable.dealId, deal.id));

      // F39: the caller's bookkeeping (the audit row) runs under the same lock
      // and the same fate as the money — see `PayoutForDealOptions`.
      await opts?.onCommit?.(tx, {
        payout,
        commission,
        totalPrice: deal.totalPrice,
      });

      // Returned from inside the transaction, so a serialization retry returns
      // the winning attempt's figures rather than a stale closure's — the same
      // rule `holdForCampaign` documents for its own return.
      return { payout, commission, totalPrice: deal.totalPrice };
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
  async refundDeal(
    dealId: string,
    actorId?: string,
    opts?: RefundDealOptions
  ): Promise<void> {
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
        reason: opts?.reason ?? 'Deal refunded',
      });

      // F39: same as `payoutForDeal` — the audit row commits with the refund.
      await opts?.onCommit?.(tx);
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
