import { describe, it, expect } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';
import type { DealStatus } from '../db/schema';
import { ErrorCode } from '../lib/validation/errors';
import { UUID_REGEX } from '../lib/validation/schemas';
import { MockPaymentProvider } from '../lib/payment/mock-provider';
import { PaymentError } from '../lib/payment/types';
import {
  EscrowLedgerService,
  LedgerError,
  REFUNDABLE_FROM,
  computeSplit,
} from '../lib/payment/ledger';

/**
 * NFR-009 asks for 100% coverage of the ledger math. `computeSplit` *is* that
 * math, pulled out of the service as a pure function so it can be covered
 * exhaustively with no database in the way. Everything that genuinely needs a
 * transaction is covered by the orchestration suites below.
 */
describe('computeSplit — commission and payout (spike §3.3)', () => {
  it('splits a round amount at 15%', () => {
    expect(computeSplit(100_000, '15.00')).toEqual({
      commission: 15_000,
      payout: 85_000,
    });
  });

  it('always sums back to the total, across rates and amounts', () => {
    // The property the subtraction formula exists to guarantee. Multiplying
    // both sides independently and rounding each fails this for roughly one
    // combination in ten.
    const rates = ['0.00', '2.50', '7.33', '10.00', '15.00', '33.33', '100.00'];
    const totals = [1, 2, 3, 7, 99, 101, 999, 1_000, 12_345, 150_000, 999_999];

    for (const rate of rates) {
      for (const total of totals) {
        const { commission, payout } = computeSplit(total, rate);
        expect(commission + payout).toBe(total);
      }
    }
  });

  it('keeps both sides non-negative integers', () => {
    for (const total of [1, 7, 99, 12_345, 999_999]) {
      const { commission, payout } = computeSplit(total, '33.33');
      expect(Number.isInteger(commission)).toBe(true);
      expect(Number.isInteger(payout)).toBe(true);
      expect(commission).toBeGreaterThanOrEqual(0);
      expect(payout).toBeGreaterThanOrEqual(0);
    }
  });

  it('takes nothing at 0% and everything at 100%', () => {
    expect(computeSplit(5_000, '0.00')).toEqual({
      commission: 0,
      payout: 5_000,
    });
    expect(computeSplit(5_000, '100.00')).toEqual({
      commission: 5_000,
      payout: 0,
    });
  });

  it('rounds a fractional santim of commission to the nearest integer', () => {
    // 15% of 3 santim is 0.45 -> 0; 15% of 10 is 1.5 -> 2 (round half up).
    expect(computeSplit(3, '15.00')).toEqual({ commission: 0, payout: 3 });
    expect(computeSplit(10, '15.00')).toEqual({ commission: 2, payout: 8 });
  });

  it('accepts the rate as the string drizzle returns for numeric(5,2)', () => {
    // deal.commission_rate is numeric(5,2), which drizzle maps to string.
    expect(computeSplit(200, '12.50')).toEqual({ commission: 25, payout: 175 });
  });

  it('handles a zero-priced deal', () => {
    expect(computeSplit(0, '15.00')).toEqual({ commission: 0, payout: 0 });
  });
});

// -- Recording fake database ------------------------------------------------

/**
 * A recording stand-in for the Drizzle client.
 *
 * The suite this replaces passed `db as never` and only reached three "row not
 * found" throws — which is how a positive-signed refund got through review. This
 * one records every statement in order, so the tests can assert the things that
 * actually went wrong: that the provider is called *inside* the transaction,
 * that the non-negativity guard trips *before* the provider is paid, and that a
 * failure leaves no rows behind.
 *
 * What it cannot do is prove `FOR UPDATE` serialises anything — only that we
 * asked for it. Real concurrency coverage needs Postgres in CI, which this
 * project does not have yet; that is filed as a follow-up rather than widening
 * this ticket.
 */
interface Seed {
  campaignStatus?: schema.CampaignStatus;
  /** When true the campaign lookup returns no row. */
  campaignMissing?: boolean;
  /** Rows returned by the accepted-deals scan in `holdForCampaign`. */
  deals?: { id: string; status: DealStatus; totalPrice: number }[];
  /** The single row returned by a locked lookup by id. */
  targetDeal?: {
    id: string;
    status: DealStatus;
    totalPrice: number;
    commissionRate: string;
  };
  /** Existing ledger rows for the campaign; their sum is the escrow balance. */
  entries?: { amount: number }[];
  /** When true the balance aggregate returns no row at all. */
  noBalanceRow?: boolean;
  /** `null` means no hold entry exists for the deal. */
  holdRef?: string | null;
  /**
   * Hold references per deal id, for tests that must tell one deal's escrow from
   * another's (F20). Takes precedence over `holdRef` when the locked lookup names
   * a deal in it, so a two-deal campaign can be refunded one deal at a time.
   */
  dealHoldRefs?: Record<string, string>;
  alreadyHeld?: boolean;
  /** Errors thrown before the transaction body runs, indexed by attempt. */
  txErrors?: (Error | undefined)[];
  /** Number of leading attempts that fail at COMMIT, after the body ran. */
  commitFailures?: number;
}

const CAMPAIGN_ID = 'c0000000-0000-0000-0000-000000000001';
const CREATOR_ID = 'cr000000-0000-0000-0000-000000000001';
const DEAL_ID = 'd0000000-0000-0000-0000-000000000001';

function serializationFailure(): Error {
  return Object.assign(new Error('could not serialize access'), {
    code: '40001',
  });
}

/**
 * The uuid a predicate binds, so the fake can tell one locked read of `deal`
 * from another. `sqlToQuery` is the same rendering the real driver does, which
 * is why it is preferred here over reaching into `queryChunks`: the predicate
 * is read the way Postgres would read it.
 */
function firstUuidParam(condition: unknown): string | undefined {
  if (!condition) return undefined;
  const { params } = new PgDialect().sqlToQuery(condition as SQL);
  return params.find(
    (p): p is string => typeof p === 'string' && UUID_REGEX.test(p)
  );
}

class FakeDb {
  log: string[] = [];
  inserts: { table: string; values: Record<string, unknown>[] }[] = [];
  updates: { table: string; set: Record<string, unknown> }[] = [];
  isolationLevels: (string | undefined)[] = [];
  attempts = 0;

  constructor(readonly seed: Seed) {}

  private tableName(t: unknown): string {
    if (t === schema.campaign) return 'campaign';
    if (t === schema.deal) return 'deal';
    if (t === schema.dealEvent) return 'deal_event';
    if (t === schema.ledgerEntry) return 'ledger_entry';
    if (t === schema.deliverable) return 'deliverable';
    return 'unknown';
  }

  /**
   * Every read the service makes is distinguishable by (table, selected fields,
   * whether it was limited), so the fake can answer without parsing SQL.
   *
   * `whereId` is the exception: two locked reads of `deal` differ only by the
   * id they ask for, so that one value is extracted from the predicate.
   */
  private rowsFor(
    table: unknown,
    fields: Record<string, unknown> | undefined,
    limited: boolean,
    whereId?: string
  ): Record<string, unknown>[] {
    const name = this.tableName(table);

    if (name === 'campaign') {
      if (this.seed.campaignMissing) return [];
      return [
        {
          id: CAMPAIGN_ID,
          status: this.seed.campaignStatus ?? 'confirmed',
          budget: 10_000_000,
        },
      ];
    }

    if (name === 'deal') {
      // Lock-by-id uses .limit(1); the accepted-deals scan does not.
      if (limited) {
        // Answered by the id the caller actually asked for, not by whichever
        // row the seed happens to list first. `holdForCampaign` scans for
        // accepted deals and then calls `transitionDeal` once per deal, each
        // re-reading its own row by id under FOR UPDATE — a fake that returned
        // `deals[0]` to both would let the multi-deal test pass while the
        // service validated the wrong row's status twice.
        const candidates: { id: string; status: DealStatus }[] = [
          ...(this.seed.targetDeal ? [this.seed.targetDeal] : []),
          ...(this.seed.deals ?? []),
        ];
        const d = whereId
          ? candidates.find((c) => c.id === whereId)
          : candidates[0];
        return d
          ? [{ ...d, campaignId: CAMPAIGN_ID, creatorId: CREATOR_ID }]
          : [];
      }
      return (this.seed.deals ?? []).map((d) => ({
        ...d,
        campaignId: CAMPAIGN_ID,
        creatorId: CREATOR_ID,
      }));
    }

    if (name === 'ledger_entry') {
      if (fields && 'balance' in fields) {
        if (this.seed.noBalanceRow) return [];
        return [
          {
            balance: (this.seed.entries ?? []).reduce(
              (s, e) => s + e.amount,
              0
            ),
          },
        ];
      }
      if (fields && 'providerRef' in fields) {
        // Per-deal first. `requireHoldRef` answering every deal with one seeded
        // reference is exactly the campaign-wide-reference bug F20 fixes, so a
        // test that needs to tell one deal's hold from another's seeds this map
        // instead — see `dealHoldRefs` on `Seed`.
        if (whereId !== undefined) {
          const perDeal = this.seed.dealHoldRefs?.[whereId];
          if (perDeal !== undefined) return [{ providerRef: perDeal }];
        }

        const ref = this.seed.holdRef;
        return ref == null ? [] : [{ providerRef: ref }];
      }
      if (fields && 'dealId' in fields) {
        return this.seed.alreadyHeld ? [{ dealId: DEAL_ID }] : [];
      }
    }

    return [];
  }

  // Arrow functions throughout, so `this` stays lexically the FakeDb instance
  // rather than the builder literal each one is attached to.
  private select(fields?: Record<string, unknown>) {
    let table: unknown;
    let limited = false;
    let locked = false;
    let whereId: string | undefined;

    const builder = {
      from: (t: unknown) => {
        table = t;
        return builder;
      },
      where: (condition?: unknown) => {
        whereId = firstUuidParam(condition);
        return builder;
      },
      for: (strength: string) => {
        locked = true;
        this.log.push(`lock:${this.tableName(table)}:${strength}`);
        return builder;
      },
      limit: () => {
        limited = true;
        return builder;
      },
      then: (
        resolve: (v: Record<string, unknown>[]) => unknown,
        reject?: (e: unknown) => unknown
      ) => {
        this.log.push(
          `select:${this.tableName(table)}${locked ? ':forUpdate' : ''}`
        );
        return Promise.resolve(
          this.rowsFor(table, fields, limited, whereId)
        ).then(resolve, reject);
      },
    };
    return builder;
  }

  private makeTx() {
    return {
      select: (fields?: Record<string, unknown>) => this.select(fields),
      insert: (table: unknown) => ({
        values: async (
          v: Record<string, unknown> | Record<string, unknown>[]
        ) => {
          this.log.push(`insert:${this.tableName(table)}`);
          this.inserts.push({
            table: this.tableName(table),
            values: Array.isArray(v) ? v : [v],
          });
        },
      }),
      update: (table: unknown) => ({
        set: (s: Record<string, unknown>) => ({
          where: async () => {
            this.log.push(`update:${this.tableName(table)}`);
            this.updates.push({ table: this.tableName(table), set: s });
          },
        }),
      }),
    };
  }

  async transaction<T>(
    fn: (tx: ReturnType<FakeDb['makeTx']>) => Promise<T>,
    opts?: { isolationLevel?: string }
  ): Promise<T> {
    this.isolationLevels.push(opts?.isolationLevel);
    const attempt = this.attempts++;

    const injected = this.seed.txErrors?.[attempt];
    if (injected) throw injected;

    const snapshot = { inserts: [...this.inserts], updates: [...this.updates] };
    this.log.push('BEGIN');
    try {
      const out = await fn(this.makeTx());
      if (attempt < (this.seed.commitFailures ?? 0))
        throw serializationFailure();
      this.log.push('COMMIT');
      return out;
    } catch (e) {
      // Rollback: discard everything this attempt wrote.
      this.inserts = snapshot.inserts;
      this.updates = snapshot.updates;
      this.log.push('ROLLBACK');
      throw e;
    }
  }
}

/** Wraps the real mock provider so its calls land in the same ordered log. */
function loggingProvider(log: string[], inner: MockPaymentProvider) {
  return {
    hold: (a: number, k: string) => {
      log.push('provider:hold');
      return inner.hold(a, k);
    },
    capturePayout: (a: number, r: string, h: string, k: string) => {
      log.push('provider:capturePayout');
      return inner.capturePayout(a, r, h, k);
    },
    captureCommission: (a: number, h: string, k: string) => {
      log.push('provider:captureCommission');
      return inner.captureCommission(a, h, k);
    },
    releaseHold: (h: string, k: string) => {
      log.push('provider:releaseHold');
      return inner.releaseHold(h, k);
    },
    getStatus: (r: string) => inner.getStatus(r),
  };
}

/**
 * Builds a service over the fake. When the seed implies an existing hold, a
 * real one is placed on the provider first (bypassing the log) so that
 * capture/release exercise the provider's genuine state machine rather than a
 * stub that accepts anything.
 *
 * `existingMock` carries provider state across two phases of one scenario — fund
 * a campaign, then refund one of its deals. The fake seeds statuses statically
 * and cannot show a deal moving from `accepted` to `funded` mid-test, so the two
 * halves need separate fakes over the *same* provider for the holds placed by the
 * first half to still be there for the second.
 */
async function build(seed: Seed, existingMock?: MockPaymentProvider) {
  const mock = existingMock ?? new MockPaymentProvider();

  const holdAmount = seed.targetDeal?.totalPrice ?? 0;
  let holdRef = seed.holdRef;
  if (holdRef === undefined && holdAmount > 0) {
    holdRef = (await mock.hold(holdAmount, 'setup-key')).providerRef;
  }

  const db = new FakeDb({ ...seed, holdRef });
  const svc = new EscrowLedgerService(
    db as never,
    loggingProvider(db.log, mock)
  );
  // `holdRef` is returned so a test can ask the provider what state the hold is
  // actually in, rather than inferring it from our own rows — which is the whole
  // point of F20/F21, where our rows balanced and the provider disagreed.
  return { db, svc, mock, holdRef };
}

function ledgerRows(db: FakeDb) {
  return db.inserts
    .filter((i) => i.table === 'ledger_entry')
    .flatMap((i) => i.values);
}

function dealEvents(db: FakeDb) {
  return db.inserts
    .filter((i) => i.table === 'deal_event')
    .flatMap((i) => i.values);
}

// -- holdForCampaign --------------------------------------------------------

describe('holdForCampaign', () => {
  const twoDeals = [
    { id: DEAL_ID, status: 'accepted' as DealStatus, totalPrice: 100_000 },
    {
      id: 'd0000000-0000-0000-0000-000000000002',
      status: 'accepted' as DealStatus,
      totalPrice: 50_000,
    },
  ];

  it('writes one positive hold per deal with a running balance', async () => {
    const { db, svc } = await build({ deals: twoDeals });
    await svc.holdForCampaign(CAMPAIGN_ID);

    const rows = ledgerRows(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.entryType)).toEqual(['hold', 'hold']);
    expect(rows.map((r) => r.amount)).toEqual([100_000, 50_000]);
    // The balance accumulates across entries rather than repeating per row.
    expect(rows.map((r) => r.balanceAfter)).toEqual([100_000, 150_000]);
    expect(rows.every((r) => typeof r.providerRef === 'string')).toBe(true);
  });

  it('gives every deal its own provider hold and its own reference (F20)', async () => {
    const { db, svc, mock } = await build({ deals: twoDeals });
    await svc.holdForCampaign(CAMPAIGN_ID);

    // One call per deal, for that deal's own total rather than the campaign sum.
    expect(db.log.filter((l) => l === 'provider:hold')).toHaveLength(2);

    // Distinctness is the property, not merely presence. The version this
    // replaced stamped one campaign-wide ref onto every row, and every existing
    // assertion about `providerRef` being a string passed against it.
    const refs = ledgerRows(db).map((r) => r.providerRef);
    expect(new Set(refs).size).toBe(2);

    // Each ref names a real hold at the provider, for that deal's amount.
    for (const [i, ref] of refs.entries()) {
      const status = await mock.getStatus(ref as string);
      expect(status.state).toBe('held');
      expect(status.amount).toBe(twoDeals[i].totalPrice);
    }
  });

  it('keys each hold per deal, so equal-priced deals cannot share a reference', async () => {
    // The trap this guards: `MockPaymentProvider.hold` deduplicates on
    // `{ amount }` alone, so two deals of the same price under one key would be
    // handed the *same* cached `providerRef` — silently rebuilding the bug F20
    // fixes, with no error anywhere.
    const equalPriced = [
      { id: DEAL_ID, status: 'accepted' as DealStatus, totalPrice: 100_000 },
      {
        id: 'd0000000-0000-0000-0000-000000000002',
        status: 'accepted' as DealStatus,
        totalPrice: 100_000,
      },
    ];
    const { db, svc } = await build({ deals: equalPriced });
    await svc.holdForCampaign(CAMPAIGN_ID);

    const refs = ledgerRows(db).map((r) => r.providerRef);
    expect(refs).toHaveLength(2);
    expect(new Set(refs).size).toBe(2);
  });

  it('runs serializable, locks both tables, and pays the provider inside the transaction', async () => {
    const { db, svc } = await build({ deals: twoDeals });
    await svc.holdForCampaign(CAMPAIGN_ID);

    expect(db.isolationLevels).toEqual(['serializable']);
    expect(db.log).toContain('lock:campaign:update');
    expect(db.log).toContain('lock:deal:update');

    // Spike §5.1 — the provider call sits strictly between BEGIN and COMMIT, so
    // a provider failure takes every row we would have written down with it.
    const begin = db.log.indexOf('BEGIN');
    const call = db.log.indexOf('provider:hold');
    const commit = db.log.indexOf('COMMIT');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(call).toBeGreaterThan(begin);
    expect(commit).toBeGreaterThan(call);
  });

  it('moves every deal accepted -> funded and records a deal_event for each', async () => {
    const { db, svc } = await build({ deals: twoDeals });
    await svc.holdForCampaign(CAMPAIGN_ID, 'user-1');

    const events = dealEvents(db);
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.fromStatus).toBe('accepted');
      expect(e.toStatus).toBe('funded');
      expect(e.actorId).toBe('user-1');
    }
    // One event per deal, each naming its own deal. Asserting only the count
    // would pass if the service transitioned the first deal twice.
    expect(events.map((e) => e.dealId).sort()).toEqual(
      twoDeals.map((d) => d.id).sort()
    );
    expect(db.updates.filter((u) => u.table === 'deal')).toHaveLength(2);
    expect(db.updates.find((u) => u.table === 'campaign')?.set).toEqual({
      status: 'funded',
    });
  });

  it('validates each deal against its own locked row, not the first one', async () => {
    // The scan and the per-deal lock are separate reads, and only the second
    // is under FOR UPDATE. If `transitionDeal` trusted the status the scan
    // returned — or if anything collapsed the N lookups into one — a deal that
    // moved on between the two reads would be funded out of the wrong state.
    // Seeding a second deal the scan should never have returned makes that
    // visible: it has to be judged on `delivered`, which cannot reach funded.
    const { svc } = await build({
      deals: [
        { id: DEAL_ID, status: 'accepted' as DealStatus, totalPrice: 100_000 },
        {
          id: 'd0000000-0000-0000-0000-000000000002',
          status: 'delivered' as DealStatus,
          totalPrice: 50_000,
        },
      ],
    });

    await expect(svc.holdForCampaign(CAMPAIGN_ID, 'user-1')).rejects.toThrow(
      /from delivered to funded/
    );
  });

  it('records a null actor when the system acts', async () => {
    const { db, svc } = await build({ deals: twoDeals });
    await svc.holdForCampaign(CAMPAIGN_ID);
    expect(dealEvents(db)[0].actorId).toBeNull();
  });

  it('refuses a campaign that is not confirmed', async () => {
    const { db, svc } = await build({
      campaignStatus: 'draft',
      deals: twoDeals,
    });

    await expect(svc.holdForCampaign(CAMPAIGN_ID)).rejects.toThrow(LedgerError);
    expect(ledgerRows(db)).toHaveLength(0);
    expect(db.log).not.toContain('provider:hold');
  });

  it('refuses a campaign with no accepted deals', async () => {
    const { db, svc } = await build({ deals: [] });

    await expect(svc.holdForCampaign(CAMPAIGN_ID)).rejects.toMatchObject({
      code: ErrorCode.NO_ACCEPTED_DEALS,
    });
    expect(ledgerRows(db)).toHaveLength(0);
  });

  it('refuses to fund the same campaign twice', async () => {
    const { db, svc } = await build({ deals: twoDeals, alreadyHeld: true });

    await expect(svc.holdForCampaign(CAMPAIGN_ID)).rejects.toThrow(
      /already been funded/
    );
    expect(ledgerRows(db)).toHaveLength(0);
    expect(db.log).not.toContain('provider:hold');
  });

  it('refuses an unknown campaign', async () => {
    const { db, svc } = await build({ campaignMissing: true, deals: twoDeals });

    await expect(svc.holdForCampaign(CAMPAIGN_ID)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(db.log).not.toContain('provider:hold');
  });

  it('writes nothing when the provider fails', async () => {
    const { db, svc, mock } = await build({ deals: twoDeals });
    mock.setFailNext('hold');

    await expect(svc.holdForCampaign(CAMPAIGN_ID)).rejects.toThrow(
      PaymentError
    );
    expect(db.log).toContain('ROLLBACK');
    expect(ledgerRows(db)).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });

  // -- AC-020: a failed attempt leaves everything exactly as it was ----------

  /**
   * The bullet above covers "no ledger rows" and "no updates". These cover the
   * two AC-020 clauses it does not reach in those words: that no deal moved, and
   * that nothing about the failed attempt poisons the retry.
   */
  it('leaves every deal status untouched when the provider fails (AC-020)', async () => {
    const { db, svc, mock } = await build({ deals: twoDeals });
    mock.setFailNext('hold');

    await expect(svc.holdForCampaign(CAMPAIGN_ID)).rejects.toThrow(
      PaymentError
    );

    // No `deal` update, so both deals are still `accepted` — the "nothing sits in
    // a half-funded state" clause. Asserted on the table rather than on
    // `updates.length` so a future write to some *other* table cannot mask it.
    expect(db.updates.filter((u) => u.table === 'deal')).toHaveLength(0);
    expect(db.updates.filter((u) => u.table === 'campaign')).toHaveLength(0);
    // And no history claiming otherwise. `deal_event` is append-only, so a row
    // written before the rollback would be a permanent record of a transition
    // that did not happen — the rollback is what prevents it, and this is what
    // proves the insert is inside the transaction.
    expect(dealEvents(db)).toHaveLength(0);
  });

  it('funds normally on a retry after a failed attempt (AC-020)', async () => {
    const { db, svc, mock } = await build({ deals: twoDeals });

    // `setFailNext` arms exactly one failure, so the second call takes the
    // ordinary path — which is the point: the retry must behave as a first
    // attempt, not as a resumption of a half-finished one.
    mock.setFailNext('hold');
    await expect(svc.holdForCampaign(CAMPAIGN_ID)).rejects.toThrow(
      PaymentError
    );

    const result = await svc.holdForCampaign(CAMPAIGN_ID);

    expect(result.dealCount).toBe(2);
    expect(result.totalHeld).toBe(150_000);
    // Two entries from the successful attempt and none left over from the failed
    // one. A `hold` per deal, and the balance built from zero — 150_000 rather
    // than 300_000 is the assertion that the failed attempt contributed nothing.
    const rows = ledgerRows(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.balanceAfter)).toEqual([100_000, 150_000]);
    // Three provider calls across the two attempts, not two: the failed attempt
    // got as far as the first deal's hold before `setFailNext` tripped it, and
    // the successful attempt then placed one hold per deal. The failed attempt's
    // idempotency key is not reused — a fresh method-level UUID is generated per
    // call, outside the retry loop but inside the method — so the successful
    // attempt is a new authorization rather than a replay of the declined one.
    expect(db.log.filter((l) => l === 'provider:hold')).toHaveLength(3);
  });

  it('rolls back with nothing held when a deal is priced at zero', async () => {
    // Reachable, if only just: `deal_total_price_valid` ties `total_price` to
    // `unit_price × video_count` and `video_count > 0` is checked, but no CHECK
    // bounds `unit_price` or `pricing_tier.price_per_video`. Per-deal holds move
    // the provider's positive-amount rule onto each deal instead of the sum, so
    // this became reachable with F20 where the campaign total had masked it.
    //
    // The failure is safe — the whole transaction rolls back and nothing is held
    // — but it surfaces as `PAYMENT_FAILED` ("please try again"), which invites a
    // retry that cannot succeed. The missing constraint is filed as a follow-up
    // rather than guarded here; this test pins the containment either way.
    const { db, svc } = await build({
      deals: [
        { id: DEAL_ID, status: 'accepted' as DealStatus, totalPrice: 100_000 },
        {
          id: 'd0000000-0000-0000-0000-000000000002',
          status: 'accepted' as DealStatus,
          totalPrice: 0,
        },
      ],
    });

    await expect(svc.holdForCampaign(CAMPAIGN_ID)).rejects.toThrow(
      PaymentError
    );

    expect(db.log).toContain('ROLLBACK');
    expect(ledgerRows(db)).toHaveLength(0);
    expect(dealEvents(db)).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });

  it('leaves the earlier deals held at the provider when a later one fails', async () => {
    // The known gap, pinned so it is visible rather than silent. Spike §5.2
    // already acknowledges a provider-succeeds/DB-rolls-back window and defers
    // the mitigation (an outbox, or a pending-hold row) to Phase 2; per-deal
    // holds multiply that window by the deal count.
    //
    // Our rows roll back cleanly. The provider's do not: deal one's hold is real
    // and nothing ever releases it. Asserted against the mock's own state,
    // because `db.log` shows a clean ROLLBACK and says nothing about this.
    const { db, svc, mock } = await build({ deals: twoDeals });

    // Let the first hold through, fail the second. `setFailNext` cannot express
    // "the second call" — it arms exactly one failure, which would trip on the
    // first — so the provider is wrapped for this one test.
    const placed: string[] = [];
    const realHold = mock.hold.bind(mock);
    mock.hold = async (amount: number, key: string) => {
      if (placed.length === 1) {
        throw new PaymentError('Mock hold failed', 'INSUFFICIENT_FUNDS');
      }
      const result = await realHold(amount, key);
      placed.push(result.providerRef);
      return result;
    };

    await expect(svc.holdForCampaign(CAMPAIGN_ID)).rejects.toThrow(
      PaymentError
    );

    expect(db.log).toContain('ROLLBACK');
    expect(ledgerRows(db)).toHaveLength(0);
    expect(dealEvents(db)).toHaveLength(0);

    // One hold was really placed, and after the rollback no row of ours refers
    // to it. It stays `held` at the provider until someone reconciles by hand.
    expect(placed).toHaveLength(1);
    const orphaned = await mock.getStatus(placed[0]);
    expect(orphaned.state).toBe('held');
    expect(orphaned.amount).toBe(twoDeals[0].totalPrice);
  });
});

// -- payoutForDeal ----------------------------------------------------------

describe('payoutForDeal', () => {
  const delivered = {
    id: DEAL_ID,
    status: 'delivered' as DealStatus,
    totalPrice: 100_000,
    commissionRate: '15.00',
  };

  it('writes paired negative entries that sum to the total price', async () => {
    const { db, svc } = await build({
      targetDeal: delivered,
      entries: [{ amount: 100_000 }],
    });
    await svc.payoutForDeal(DEAL_ID);

    const rows = ledgerRows(db);
    expect(rows.map((r) => r.entryType)).toEqual([
      'release_payout',
      'commission',
    ]);
    expect(rows.map((r) => r.amount)).toEqual([-85_000, -15_000]);
    // Escrow falls by exactly total_price and lands on zero.
    expect(rows.map((r) => r.balanceAfter)).toEqual([15_000, 0]);
    const moved = rows.reduce((s, r) => s + (r.amount as number), 0);
    expect(moved).toBe(-delivered.totalPrice);
  });

  it('completes the deal and records the transition', async () => {
    const { db, svc } = await build({
      targetDeal: delivered,
      entries: [{ amount: 100_000 }],
    });
    await svc.payoutForDeal(DEAL_ID, 'brand-1');

    expect(db.updates.find((u) => u.table === 'deal')?.set).toEqual({
      status: 'completed',
    });
    expect(dealEvents(db)[0]).toMatchObject({
      fromStatus: 'delivered',
      toStatus: 'completed',
      actorId: 'brand-1',
    });
  });

  it('marks the deliverable approved, which nothing used to do (KAN-55)', async () => {
    // `submit-deliverable.ts` writes `'pending'` and `reject-deliverable.ts`
    // writes `'rejected'`, but this path used to pay the creator and close the
    // deal without touching the row — so a paid-out video still read as a
    // submission nobody had judged, and `'approved'` was a declared enum value
    // with no writer anywhere. Asserted here rather than in the approval action
    // because it has to happen in *this* transaction.
    const { db, svc } = await build({
      targetDeal: delivered,
      entries: [{ amount: 100_000 }],
    });
    await svc.payoutForDeal(DEAL_ID);

    const update = db.updates.find((u) => u.table === 'deliverable');
    expect(update?.set).toMatchObject({ reviewStatus: 'approved' });
    expect(update?.set.reviewedAt).toBeInstanceOf(Date);
    // The stamp and the status are set together. A status with no timestamp is
    // what `reject-deliverable.ts` deliberately avoids, and the metrics sweep
    // reads the pair.
    expect(Object.keys(update?.set ?? {}).sort()).toEqual([
      'reviewStatus',
      'reviewedAt',
    ]);
  });

  it('returns the gross the transaction locked, for the payment email (AC-4)', async () => {
    // The email states gross, commission and net. Returning the gross from
    // inside the transaction is what keeps all three the figures the ledger rows
    // were written from — a caller re-reading the deal could see a different row
    // than the one that was paid, and adding payout to commission would make the
    // caller a second source for a split `computeSplit` already owns.
    const { svc } = await build({
      targetDeal: delivered,
      entries: [{ amount: 100_000 }],
    });

    const result = await svc.payoutForDeal(DEAL_ID);

    expect(result).toEqual({
      payout: 85_000,
      commission: 15_000,
      totalPrice: 100_000,
    });
    expect(result.totalPrice).toBe(delivered.totalPrice);
    expect(result.payout + result.commission).toBe(result.totalPrice);
  });

  it('captures both legs and drains the hold to captured (F21)', async () => {
    const { db, svc, mock, holdRef } = await build({
      targetDeal: delivered,
      entries: [{ amount: 100_000 }],
    });

    // Before: the whole deal total is sitting held at the provider.
    expect(await mock.getStatus(holdRef as string)).toMatchObject({
      state: 'held',
      amount: 100_000,
    });

    await svc.payoutForDeal(DEAL_ID);

    // After: nothing remains, and the hold has reached its terminal state. This
    // is the assertion that fails against the version of this method that
    // captured only the payout — there, 15_000 stayed held forever and the
    // platform's own ledger row described money the processor never moved.
    expect(await mock.getStatus(holdRef as string)).toMatchObject({
      state: 'captured',
      amount: 0,
    });

    // Both legs reached the provider, inside the transaction, payout first.
    const payout = db.log.indexOf('provider:capturePayout');
    const commission = db.log.indexOf('provider:captureCommission');
    expect(payout).toBeGreaterThan(db.log.indexOf('BEGIN'));
    expect(commission).toBeGreaterThan(payout);
    expect(db.log.indexOf('COMMIT')).toBeGreaterThan(commission);
  });

  it('drains the hold on the payout leg alone when commission is zero', async () => {
    // A zero commission is ordinary, not a degenerate input: `computeSplit(3,
    // '15.00')` is 0, and so is any deal at a 0% rate. The provider refuses a
    // zero amount, so the commission leg is skipped — and nothing is stranded,
    // because payout then equals total_price and drains the hold by itself.
    const { db, svc, mock, holdRef } = await build({
      targetDeal: { ...delivered, commissionRate: '0.00' },
      entries: [{ amount: 100_000 }],
    });

    const result = await svc.payoutForDeal(DEAL_ID);

    expect(result).toEqual({
      payout: 100_000,
      commission: 0,
      totalPrice: 100_000,
    });
    expect(db.log).not.toContain('provider:captureCommission');
    expect(await mock.getStatus(holdRef as string)).toMatchObject({
      state: 'captured',
      amount: 0,
    });

    // The paired rows are still both written — a zero commission is a real
    // recorded zero, and dropping the row would lose the fact that the rate was
    // zero rather than that nobody looked. Negating it yields `-0`, which
    // Postgres stores as 0 in an `integer` column and which sums and compares
    // as 0 everywhere; asserted as written rather than normalised away.
    const rows = ledgerRows(db);
    expect(rows.map((r) => r.entryType)).toEqual([
      'release_payout',
      'commission',
    ]);
    expect(rows.map((r) => r.amount)).toEqual([-100_000, -0]);
    expect(rows.reduce((s, r) => s + (r.amount as number), 0)).toBe(-100_000);
  });

  it.each<DealStatus>([
    'pending',
    'accepted',
    'declined',
    'expired',
    'funded',
    'revision_requested',
    'completed',
    'refunded',
  ])('refuses to pay out a %s deal', async (status) => {
    const { db, svc } = await build({
      targetDeal: { ...delivered, status },
      entries: [{ amount: 100_000 }],
    });

    await expect(svc.payoutForDeal(DEAL_ID)).rejects.toMatchObject({
      code: ErrorCode.DEAL_NOT_DELIVERED,
    });
    expect(ledgerRows(db)).toHaveLength(0);
    expect(db.log).not.toContain('provider:capturePayout');
  });

  it('refuses to overdraw the campaign, and refuses before paying the provider', async () => {
    // Only 10_000 left in escrow, but the deal wants 100_000 out.
    const { db, svc } = await build({
      targetDeal: delivered,
      entries: [{ amount: 10_000 }],
    });

    await expect(svc.payoutForDeal(DEAL_ID)).rejects.toMatchObject({
      code: ErrorCode.BUDGET_EXCEEDED,
    });
    // Invariant 7. Guarding after the call would mean the PSP has already moved
    // the money by the time we decide the campaign cannot afford it.
    expect(db.log).not.toContain('provider:capturePayout');
    expect(ledgerRows(db)).toHaveLength(0);
  });

  it('refuses an unknown deal', async () => {
    const { db, svc } = await build({ entries: [{ amount: 100_000 }] });

    await expect(svc.payoutForDeal(DEAL_ID)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(db.log).not.toContain('provider:capturePayout');
  });

  it('throws when the deal has no recorded hold reference', async () => {
    const { svc } = await build({
      targetDeal: delivered,
      entries: [{ amount: 100_000 }],
      holdRef: null,
    });

    await expect(svc.payoutForDeal(DEAL_ID)).rejects.toThrow(PaymentError);
  });

  it('writes nothing when the provider fails', async () => {
    const { db, svc, mock } = await build({
      targetDeal: delivered,
      entries: [{ amount: 100_000 }],
    });
    mock.setFailNext('capturePayout');

    await expect(svc.payoutForDeal(DEAL_ID)).rejects.toThrow(PaymentError);
    expect(db.log).toContain('ROLLBACK');
    expect(ledgerRows(db)).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
    // Invariant 1 in the other direction: the deliverable is not approved on a
    // rollback either. A row marked approved by a transaction that did not pay
    // would tell a creator their video was accepted and leave them unpaid.
    expect(db.updates.filter((u) => u.table === 'deliverable')).toHaveLength(0);
  });

  it('uses the rate snapshotted on the deal, not a global (invariant 8)', async () => {
    const { db, svc } = await build({
      targetDeal: { ...delivered, commissionRate: '25.00' },
      entries: [{ amount: 100_000 }],
    });
    await svc.payoutForDeal(DEAL_ID);

    expect(ledgerRows(db).map((r) => r.amount)).toEqual([-75_000, -25_000]);
  });
});

// -- refundDeal -------------------------------------------------------------

describe('refundDeal', () => {
  const funded = {
    id: DEAL_ID,
    status: 'funded' as DealStatus,
    totalPrice: 100_000,
    commissionRate: '15.00',
  };

  it('writes a NEGATIVE refund entry (spike §3.5)', async () => {
    const { db, svc } = await build({
      targetDeal: funded,
      entries: [{ amount: 100_000 }],
    });
    await svc.refundDeal(DEAL_ID);

    const [row] = ledgerRows(db);
    expect(row.entryType).toBe('refund');
    expect(row.amount).toBe(-100_000);
    expect(row.amount as number).toBeLessThan(0);
  });

  it('is zero-sum with its hold, so the money is not payable twice', async () => {
    const { db, svc } = await build({
      targetDeal: funded,
      entries: [{ amount: 100_000 }],
    });
    await svc.refundDeal(DEAL_ID);

    // hold(+X) + refund(-X) === 0. A positive refund gives +2X here, and because
    // it inflates the balance the non-negativity guard never catches it.
    const refund = ledgerRows(db)[0].amount as number;
    expect(100_000 + refund).toBe(0);
    expect(ledgerRows(db)[0].balanceAfter).toBe(0);
  });

  it('marks the deal refunded and records the transition', async () => {
    const { db, svc } = await build({
      targetDeal: funded,
      entries: [{ amount: 100_000 }],
    });
    await svc.refundDeal(DEAL_ID, 'admin-1');

    expect(db.updates.find((u) => u.table === 'deal')?.set).toEqual({
      status: 'refunded',
    });
    expect(dealEvents(db)[0]).toMatchObject({
      fromStatus: 'funded',
      toStatus: 'refunded',
      actorId: 'admin-1',
    });
  });

  it('releases only the refunded deal, leaving its siblings held (F20)', async () => {
    // The test this whole change exists for, and the one that could not be
    // written before it. Driven end to end rather than from seeded references:
    // fund a two-deal campaign for real, then refund one deal and ask the
    // *provider* what happened to the other.
    //
    // Against the previous design it fails on the last assertion. One
    // `provider.hold()` for the campaign total meant both deals shared a
    // reference, and `releaseHold` is documented to release the entire hold — so
    // refunding deal one returned deal two's money as well, our ledger recorded
    // exactly one refund, and the next payout threw `INVALID_REFERENCE` against a
    // hold that was no longer `held`.
    const secondId = 'd0000000-0000-0000-0000-000000000002';

    // Phase one: fund. No `targetDeal`, so no setup hold is placed — every hold
    // here is one `holdForCampaign` really asked for.
    const funding = await build({
      deals: [
        { id: DEAL_ID, status: 'accepted', totalPrice: 100_000 },
        { id: secondId, status: 'accepted', totalPrice: 50_000 },
      ],
    });
    await funding.svc.holdForCampaign(CAMPAIGN_ID);

    const dealHoldRefs = Object.fromEntries(
      ledgerRows(funding.db)
        .filter((r) => r.entryType === 'hold')
        .map((r) => [r.dealId as string, r.providerRef as string])
    );
    expect(Object.keys(dealHoldRefs)).toHaveLength(2);

    // Phase two: refund one deal, over the same provider. `holdRef: null`
    // suppresses a second setup hold; the references come from phase one's rows.
    const { db, svc, mock } = await build(
      {
        targetDeal: {
          id: DEAL_ID,
          status: 'funded',
          totalPrice: 100_000,
          commissionRate: '15.00',
        },
        entries: [{ amount: 150_000 }],
        holdRef: null,
        dealHoldRefs,
      },
      funding.mock
    );

    await svc.refundDeal(DEAL_ID, 'admin-1');

    expect(ledgerRows(db)).toHaveLength(1);
    expect(ledgerRows(db)[0]).toMatchObject({
      entryType: 'refund',
      amount: -100_000,
    });

    // The refunded deal's hold is released…
    expect(await mock.getStatus(dealHoldRefs[DEAL_ID])).toMatchObject({
      state: 'released',
    });
    // …and the other deal's money is untouched and still spendable.
    expect(await mock.getStatus(dealHoldRefs[secondId])).toMatchObject({
      state: 'held',
      amount: 50_000,
    });
  });

  it.each([...REFUNDABLE_FROM])('allows a refund from %s', async (status) => {
    const { db, svc } = await build({
      targetDeal: { ...funded, status },
      entries: [{ amount: 100_000 }],
    });
    await svc.refundDeal(DEAL_ID);

    expect(ledgerRows(db)).toHaveLength(1);
    expect(dealEvents(db)[0]).toMatchObject({
      fromStatus: status,
      toStatus: 'refunded',
    });
  });

  it.each<DealStatus>([
    'pending',
    'accepted',
    'declined',
    'expired',
    'completed',
    'refunded',
  ])('refuses a refund from %s', async (status) => {
    const { db, svc } = await build({
      targetDeal: { ...funded, status },
      entries: [{ amount: 100_000 }],
    });

    await expect(svc.refundDeal(DEAL_ID)).rejects.toMatchObject({
      code: ErrorCode.DEAL_NOT_FUNDED,
    });
    expect(ledgerRows(db)).toHaveLength(0);
    expect(db.log).not.toContain('provider:releaseHold');
  });

  it('treats an absent balance row as a zero balance, not as unlimited', async () => {
    // COALESCE + an aggregate always yields one row, so this is defensive. It
    // must fail closed: reading no row as "no constraint" would let any refund
    // through unchecked.
    const { db, svc } = await build({ targetDeal: funded, noBalanceRow: true });

    await expect(svc.refundDeal(DEAL_ID)).rejects.toMatchObject({
      code: ErrorCode.BUDGET_EXCEEDED,
    });
    expect(db.log).not.toContain('provider:releaseHold');
  });

  it('refuses to drive the escrow balance negative', async () => {
    const { db, svc } = await build({
      targetDeal: funded,
      entries: [{ amount: 10_000 }],
    });

    await expect(svc.refundDeal(DEAL_ID)).rejects.toMatchObject({
      code: ErrorCode.BUDGET_EXCEEDED,
    });
    expect(db.log).not.toContain('provider:releaseHold');
    expect(ledgerRows(db)).toHaveLength(0);
  });

  it('writes nothing when the provider fails', async () => {
    const { db, svc, mock } = await build({
      targetDeal: funded,
      entries: [{ amount: 100_000 }],
    });
    mock.setFailNext('releaseHold');

    await expect(svc.refundDeal(DEAL_ID)).rejects.toThrow(PaymentError);
    expect(db.log).toContain('ROLLBACK');
    expect(ledgerRows(db)).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });
});

// -- Serialization failure and retry (spike §5.3, §4.2) ---------------------

describe('serialization failure retry', () => {
  const funded = {
    id: DEAL_ID,
    status: 'funded' as DealStatus,
    totalPrice: 100_000,
    commissionRate: '15.00',
  };
  const seed: Seed = { targetDeal: funded, entries: [{ amount: 100_000 }] };

  it('retries a 40001 and succeeds on a later attempt', async () => {
    const { db, svc } = await build({
      ...seed,
      txErrors: [serializationFailure(), serializationFailure()],
    });

    await svc.refundDeal(DEAL_ID);

    expect(db.attempts).toBe(3);
    expect(ledgerRows(db)).toHaveLength(1);
  });

  it('reuses one idempotency key across retries instead of moving money twice', async () => {
    // The first attempt reaches the provider and then loses the commit race.
    // A key regenerated per attempt would send a second releaseHold for a hold
    // already in 'released', which the provider rejects — so this passing at
    // all is the assertion that the key is generated outside the retry loop.
    const { db, svc } = await build({ ...seed, commitFailures: 1 });

    await svc.refundDeal(DEAL_ID);

    expect(db.attempts).toBe(2);
    expect(db.log.filter((l) => l === 'provider:releaseHold')).toHaveLength(2);
    // Rolled back once, so only the surviving attempt's row remains.
    expect(ledgerRows(db)).toHaveLength(1);
    expect(ledgerRows(db)[0].amount).toBe(-100_000);
  });

  it('gives up after three retries with PAYMENT_FAILED and no state change', async () => {
    const { db, svc } = await build({
      ...seed,
      txErrors: Array.from({ length: 4 }, () => serializationFailure()),
    });

    await expect(svc.refundDeal(DEAL_ID)).rejects.toMatchObject({
      code: ErrorCode.PAYMENT_FAILED,
    });
    // The initial attempt plus the three retries.
    expect(db.attempts).toBe(4);
    expect(ledgerRows(db)).toHaveLength(0);
  });

  it('does not retry an ordinary error', async () => {
    const { db, svc } = await build({
      ...seed,
      txErrors: [new Error('column does not exist')],
    });

    await expect(svc.refundDeal(DEAL_ID)).rejects.toThrow(
      /column does not exist/
    );
    expect(db.attempts).toBe(1);
  });

  it('does not retry a provider failure', async () => {
    const { db, svc, mock } = await build(seed);
    mock.setFailNext('releaseHold');

    await expect(svc.refundDeal(DEAL_ID)).rejects.toThrow(PaymentError);
    expect(db.attempts).toBe(1);
  });
});
