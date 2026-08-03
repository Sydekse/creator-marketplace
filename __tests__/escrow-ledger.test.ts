import { describe, it, expect } from 'vitest';
import * as schema from '../db/schema';
import type { DealStatus } from '../db/schema';
import { ErrorCode } from '../lib/validation/errors';
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
    return 'unknown';
  }

  /**
   * Every read the service makes is distinguishable by (table, selected fields,
   * whether it was limited), so the fake can answer without parsing SQL.
   */
  private rowsFor(
    table: unknown,
    fields: Record<string, unknown> | undefined,
    limited: boolean
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
        const d = this.seed.targetDeal;
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

    const builder = {
      from: (t: unknown) => {
        table = t;
        return builder;
      },
      where: () => builder,
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
        return Promise.resolve(this.rowsFor(table, fields, limited)).then(
          resolve,
          reject
        );
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
 */
async function build(seed: Seed) {
  const mock = new MockPaymentProvider();

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
  return { db, svc, mock };
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
    expect(db.updates.filter((u) => u.table === 'deal')).toHaveLength(2);
    expect(db.updates.find((u) => u.table === 'campaign')?.set).toEqual({
      status: 'funded',
    });
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
