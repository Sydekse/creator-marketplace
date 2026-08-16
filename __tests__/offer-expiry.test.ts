import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  EXPIRE_BATCH_LIMIT,
  EXPIRE_EVENT_REASON,
  EXPIRE_OFFERS_JOB_NAME,
  buildLapsedOffersWhere,
  expireOffers,
  expireOffersJob,
} from '../lib/deals/expire-offers';
import type {
  ExpireOffersDeps,
  ExpiringDealRow,
} from '../lib/deals/expire-offers';
import {
  LEGAL_TRANSITIONS,
  TransitionError,
  getErrorCodeForInvalidTransition,
} from '../lib/deals/state-machine';
import { COMMITS_BUDGET } from '../lib/campaigns/budget';
import { OFFER_WINDOW_DAYS, offerExpiresAt } from '../lib/config/pricing';
import { NOTIFICATION_TYPES } from '../lib/notifications/types';
import type { Tx } from '../lib/authz';
import { ErrorCode } from '../lib/validation';
import { db } from '../db';
import { deal } from '../db/schema';
import type { DealStatus } from '../db/schema';

/**
 * KAN-38 — stale offers expire on their own and the budget comes back
 * (US-006, AC-018 expiry branch, Tech Spec §5, §8.1).
 *
 * The sweep is the one deal transition with nobody watching it, which changes
 * what these tests have to prove. An accept or a decline has a creator in front
 * of a screen who notices when it misbehaves; this runs at midnight against a
 * table nobody is looking at, so every failure mode is silent by default.
 *
 * **`examined` and `acted` are different numbers, deliberately.** A deal
 * resolved between the select and the lock is `skipped`, not `expired`, and the
 * counters have to say so. Collapsing them would hide contention — the one thing
 * an operator reading a cron log is trying to see.
 *
 * **Idempotency (AC-2) is asserted as inheritance, not as behaviour of its
 * own.** There is no dedupe table and no marker column, because there does not
 * need to be: `pending` is the predicate, so a second run re-selects nothing, and
 * a racing duplicate is refused by `LEGAL_TRANSITIONS` under the row lock. The
 * suite asserts the two mechanisms rather than running the sweep twice and
 * observing that nothing broke — the second proves the outcome for one ordering,
 * the first proves it for all of them.
 *
 * **The release is an absence.** AC-018 says the cost returns to available
 * budget, and this module contains no budget write at all: `expired` is `false`
 * in `COMMITS_BUDGET`, so the status flip *is* the release. The tests assert the
 * absence of a second write, because the strongest form of "these apply together
 * or not at all" is that there is only one of them.
 *
 * **AC-7 (a creator accepting moments before expiry wins) is a claim about a
 * lock**, which no unit test can observe directly. What is asserted instead is
 * every consequence of it: the load takes `FOR UPDATE`, the sweep never
 * overwrites a resolved status, and a late acceptance gets `OFFER_EXPIRED` from
 * the shared table. Source guards cover the lock itself.
 */

const DEAL_A = '11111111-1111-4111-8111-111111111111';
const DEAL_B = '22222222-2222-4222-8222-222222222222';
const DEAL_C = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN_ID = '44444444-4444-4444-8444-444444444444';
const BRAND_USER_ID = '55555555-5555-4555-8555-555555555555';

const TOTAL_PRICE = 450_000;
const CAMPAIGN_NAME = 'Ramadan Beauty Push';
const NOW = new Date('2026-08-14T00:00:00.000Z');

interface Recorded {
  /** Seam names in call order — ordering asserted without reading source. */
  calls: string[];
  selects: Array<{ limit: number; now: Date }>;
  loads: string[];
  /**
   * Transitions **attempted**, not committed.
   *
   * A deal whose notify then fails appears here and is still rolled back — the
   * fake records the call, and the real transaction is what discards it. Use
   * `committed` to assert what actually survived; conflating the two is how a
   * rollback test passes while asserting nothing.
   */
  transitions: string[];
  notifications: Array<{ userId: string; type: string; payload: unknown }>;
  errors: string[];
  /** Outcomes whose transaction body returned without throwing. */
  committed: string[];
}

interface Overrides {
  /** Ids the predicate matched, in order. */
  lapsed?: string[];
  /** Per-deal status at the moment the lock is taken. */
  statusAt?: Record<string, DealStatus>;
  /** Deals whose row has vanished by the time it is loaded. */
  missing?: string[];
  /** Deals whose transition throws something that is not a TransitionError. */
  crashOn?: string[];
  /** Deals whose notification fails. */
  failNotifyOn?: string[];
}

function makeDeps(overrides: Overrides = {}): {
  deps: ExpireOffersDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    calls: [],
    selects: [],
    loads: [],
    transitions: [],
    notifications: [],
    errors: [],
    committed: [],
  };

  const lapsed = overrides.lapsed ?? [DEAL_A];
  const tx = {} as Tx;

  const deps: ExpireOffersDeps = {
    selectLapsed: async (limit, now) => {
      recorded.calls.push('selectLapsed');
      recorded.selects.push({ limit, now });
      return lapsed;
    },
    loadDeal: async (_tx, dealId) => {
      recorded.calls.push('loadDeal');
      recorded.loads.push(dealId);
      if (overrides.missing?.includes(dealId)) return null;

      return {
        id: dealId,
        totalPrice: TOTAL_PRICE,
        campaignId: CAMPAIGN_ID,
        campaignName: CAMPAIGN_NAME,
        brandUserId: BRAND_USER_ID,
      } satisfies ExpiringDealRow;
    },
    transition: async (_tx, dealId) => {
      recorded.calls.push('transition');
      if (overrides.crashOn?.includes(dealId)) {
        throw new Error('connection terminated unexpectedly');
      }
      // The state machine re-reads under its own lock, so the status it judges
      // is the one at lock time — not the one the select saw.
      const status = overrides.statusAt?.[dealId] ?? 'pending';
      if (!LEGAL_TRANSITIONS[status].includes('expired')) {
        throw new TransitionError(
          `cannot expire from ${status}`,
          getErrorCodeForInvalidTransition(status, 'expired')
        );
      }
      recorded.transitions.push(dealId);
    },
    run: async (fn) => {
      const notify = (async (
        userId: string,
        type: string,
        payload: unknown
      ) => {
        recorded.calls.push('notify');
        const dealId = (payload as { dealId: string }).dealId;
        if (overrides.failNotifyOn?.includes(dealId)) {
          throw new Error('resend down');
        }
        recorded.notifications.push({ userId, type, payload });
      }) as Parameters<ExpireOffersDeps['run']>[0] extends (
        tx: Tx,
        notify: infer N
      ) => unknown
        ? N
        : never;

      const result = await fn(tx, notify);
      // Only reached when the body returns without throwing, which is what
      // makes a rollback observable here at all.
      if (typeof result === 'string') recorded.committed.push(result);
      return result;
    },
    log: {
      error: (message: unknown) => {
        recorded.errors.push(String(message));
      },
    },
    now: () => NOW,
  };

  return { deps, recorded };
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const SOURCE = readFileSync('lib/deals/expire-offers.ts', 'utf8');
const CODE = stripComments(SOURCE);

// ---------------------------------------------------------------------------
// AC-1 — the sweep selects pending offers past their window and expires them
// ---------------------------------------------------------------------------

describe('expireOffers — the sweep (AC-1)', () => {
  it('expires a lapsed offer and reports it as acted on', async () => {
    const { deps, recorded } = makeDeps();

    await expect(expireOffers(deps)).resolves.toEqual({
      examined: 1,
      acted: 1,
    });
    expect(recorded.transitions).toEqual([DEAL_A]);
  });

  it('drives the transition through the state machine, in the transaction', async () => {
    const { deps, recorded } = makeDeps();

    await expireOffers(deps);

    // The order is the AC: locked, then judged, then the brand told. A notify
    // before the transition would email about a release that had not happened.
    expect(recorded.calls).toEqual([
      'selectLapsed',
      'loadDeal',
      'transition',
      'notify',
    ]);
  });

  it('selects with the run-time clock, not a schedule-derived one', async () => {
    const { deps, recorded } = makeDeps();

    await expireOffers(deps);

    // Hobby cron fires anywhere in the scheduled hour (±59 min), so a predicate
    // built from the schedule rather than the clock expires offers early.
    expect(recorded.selects).toEqual([{ limit: EXPIRE_BATCH_LIMIT, now: NOW }]);
  });

  it('sweeps every lapsed offer in one run, not just the first', async () => {
    const { deps, recorded } = makeDeps({ lapsed: [DEAL_A, DEAL_B, DEAL_C] });

    await expect(expireOffers(deps)).resolves.toEqual({
      examined: 3,
      acted: 3,
    });
    expect(recorded.transitions).toEqual([DEAL_A, DEAL_B, DEAL_C]);
  });

  it('does nothing, successfully, when no offer has lapsed', async () => {
    const { deps, recorded } = makeDeps({ lapsed: [] });

    await expect(expireOffers(deps)).resolves.toEqual({
      examined: 0,
      acted: 0,
    });
    expect(recorded.calls).toEqual(['selectLapsed']);
    expect(recorded.notifications).toEqual([]);
  });

  it('records the reason in words, so the history reads as system-driven', async () => {
    expect(EXPIRE_EVENT_REASON).toBe(
      'Offer expired before the creator responded'
    );
    // No KAN number ever appears in text a user could read.
    expect(EXPIRE_EVENT_REASON).not.toMatch(/KAN-/);
  });
});

describe('buildLapsedOffersWhere — the predicate (AC-1)', () => {
  // Compiled through a real query builder rather than inspected as an object:
  // the drizzle AST is cyclic, and the SQL is what Postgres will actually run.
  const compiled = () =>
    db.select().from(deal).where(buildLapsedOffersWhere(NOW)).toSQL();

  it('filters on pending status, which is what makes a second run a no-op', () => {
    const { sql, params } = compiled();
    expect(sql).toMatch(/"status" = \$/);
    expect(params).toContain('pending');
  });

  it('compares the window against the passed clock', () => {
    const { sql, params } = compiled();
    expect(sql).toMatch(/"offer_expires_at" < \$/);
    // The clock reaches the query as the instant it was called with, so a run at
    // 00:47 does not sweep offers that lapse at 00:58.
    expect(params.map(String)).toContain(NOW.toISOString());
  });

  it('requires a window to be set at all', () => {
    expect(compiled().sql).toMatch(/"offer_expires_at" is not null/i);
  });

  it('excludes null windows explicitly', () => {
    // Redundant against `<`, and kept because it says out loud that an offer
    // issued without a window never expires (F27).
    expect(CODE).toMatch(/isNotNull\(\s*deal\.offerExpiresAt\s*\)/);
  });

  it('orders by deadline so a backlog drains oldest-first', () => {
    expect(CODE).toMatch(/orderBy\(\s*asc\(\s*deal\.offerExpiresAt\s*\)\s*\)/);
  });

  it('bounds the batch, so a neglected table cannot outrun the watchdog', () => {
    expect(EXPIRE_BATCH_LIMIT).toBeGreaterThan(0);
    expect(EXPIRE_BATCH_LIMIT).toBeLessThanOrEqual(500);
    expect(CODE).toMatch(/\.limit\(\s*limit\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// AC-2 — the sweep is idempotent
// ---------------------------------------------------------------------------

describe('expireOffers — idempotency (AC-2)', () => {
  it('skips a deal the creator accepted between the select and the lock', async () => {
    const { deps, recorded } = makeDeps({
      statusAt: { [DEAL_A]: 'accepted' },
    });

    // Examined, because the predicate matched it. Not acted on, because by the
    // time the lock was taken there was nothing to expire.
    await expect(expireOffers(deps)).resolves.toEqual({
      examined: 1,
      acted: 0,
    });
    expect(recorded.transitions).toEqual([]);
  });

  it('does not notify the brand about a deal it did not expire', async () => {
    const { deps, recorded } = makeDeps({
      statusAt: { [DEAL_A]: 'declined' },
    });

    await expireOffers(deps);

    // The double-notification AC-2 rules out. A brand told twice that the same
    // money came back will believe it came back twice.
    expect(recorded.notifications).toEqual([]);
  });

  it('treats an already-expired deal as a skip, never an error', async () => {
    const { deps, recorded } = makeDeps({
      statusAt: { [DEAL_A]: 'expired' },
    });

    // The duplicate-delivery case: Vercel can deliver a cron twice and never
    // retries a failure, so a duplicate must be a no-op rather than a failed run.
    await expect(expireOffers(deps)).resolves.toEqual({
      examined: 1,
      acted: 0,
    });
    expect(recorded.errors).toEqual([]);
  });

  it('re-selects nothing on a second run, because the predicate excludes what it wrote', () => {
    // The mechanism, asserted rather than simulated: the predicate matches
    // `pending` only, and the sweep writes `expired`, so a swept row cannot come
    // back. This holds for every interleaving, where running the sweep twice
    // would only prove one.
    const { params } = db
      .select()
      .from(deal)
      .where(buildLapsedOffersWhere(NOW))
      .toSQL();
    expect(params).toContain('pending');
    expect(params).not.toContain('expired');
  });

  it('cannot double-release, because expired is terminal', () => {
    // `LEGAL_TRANSITIONS.expired` being empty is what makes a second expiry
    // impossible rather than merely unlikely — there is no edge out of it at all.
    expect(LEGAL_TRANSITIONS.expired).toEqual([]);
    expect(LEGAL_TRANSITIONS.pending).toContain('expired');
  });
});

// ---------------------------------------------------------------------------
// AC-3 — expiry events are system-driven
// ---------------------------------------------------------------------------

describe('expireOffers — the actor (AC-3)', () => {
  it('passes a null actor to the state machine', () => {
    // The schema's convention for "the system did this", and what makes
    // `toHistoryEvent` render the system rather than a blank name.
    expect(CODE).toMatch(
      /transitionDeal\(\s*tx,\s*dealId,\s*'expired',\s*null\s*,/
    );
  });

  it('has no user id to record, and takes none as an argument', () => {
    // A sweep that accepted an actor id would invite a caller to pass one, and
    // the audit trail would then claim a person expired the offer.
    expect(CODE).not.toMatch(/actorUserId|actorId\s*:/);
  });
});

// ---------------------------------------------------------------------------
// AC-5 — one failing deal does not abort the sweep
// ---------------------------------------------------------------------------

describe('expireOffers — failure isolation (AC-5)', () => {
  it('carries on after a deal whose transition crashes', async () => {
    const { deps, recorded } = makeDeps({
      lapsed: [DEAL_A, DEAL_B, DEAL_C],
      crashOn: [DEAL_B],
    });

    // The harness only sees whole-job failure, so isolation has to live here.
    // Without it, one deadlocked row costs every later deal a day of budget.
    await expect(expireOffers(deps)).resolves.toEqual({
      examined: 3,
      acted: 2,
    });
    expect(recorded.transitions).toEqual([DEAL_A, DEAL_C]);
  });

  it('carries on after a deal whose notification fails', async () => {
    const { deps, recorded } = makeDeps({
      lapsed: [DEAL_A, DEAL_B],
      failNotifyOn: [DEAL_A],
    });

    await expect(expireOffers(deps)).resolves.toEqual({
      examined: 2,
      acted: 1,
    });
    // Both were attempted — DEAL_A's transition ran and was then rolled back by
    // the failing notify, which is why `transitions` records attempts rather
    // than commits. Only DEAL_B's expiry survived.
    expect(recorded.transitions).toEqual([DEAL_A, DEAL_B]);
    expect(recorded.notifications.map((n) => n.payload)).toEqual([
      {
        dealId: DEAL_B,
        campaignId: CAMPAIGN_ID,
        campaignTitle: CAMPAIGN_NAME,
        releasedAmount: TOTAL_PRICE,
      },
    ]);
  });

  it('rolls the status back when the notification fails, so the retry is clean', async () => {
    const { deps, recorded } = makeDeps({ failNotifyOn: [DEAL_A] });

    await expireOffers(deps);

    // The transaction body threw, so nothing committed: the deal is still
    // `pending` and still lapsed, and the next run sweeps it and sends one
    // email. An expiry that committed without its notification would leave the
    // brand's budget released and the brand never told.
    expect(recorded.committed).toEqual([]);
  });

  it('does not count a failed deal as acted on', async () => {
    const { deps } = makeDeps({ crashOn: [DEAL_A] });

    await expect(expireOffers(deps)).resolves.toEqual({
      examined: 1,
      acted: 0,
    });
  });

  it('skips a row that vanished between the select and the load', async () => {
    const { deps, recorded } = makeDeps({
      lapsed: [DEAL_A, DEAL_B],
      missing: [DEAL_A],
    });

    // Nothing we ship deletes a deal, so this is a skip rather than a failure —
    // and either way the sweep must reach DEAL_B.
    await expect(expireOffers(deps)).resolves.toEqual({
      examined: 2,
      acted: 1,
    });
    expect(recorded.errors).toEqual([]);
    expect(recorded.transitions).toEqual([DEAL_B]);
  });

  it('leaves a failed deal for the next run rather than retrying in-process', async () => {
    const { deps, recorded } = makeDeps({ crashOn: [DEAL_A] });

    await expireOffers(deps);

    // One attempt per deal per run. The deal is still `pending` and still
    // lapsed, so the next run picks it up — retry by reconciliation, which
    // matters because Vercel never retries a failed cron.
    expect(recorded.loads).toEqual([DEAL_A]);
  });
});

// ---------------------------------------------------------------------------
// AC-6 / NFR-010 — failures are logged with the deal, and no PII
// ---------------------------------------------------------------------------

describe('expireOffers — failure logging (AC-5, NFR-010)', () => {
  it('logs the failing deal id, so the affected deal is identifiable', async () => {
    const { deps, recorded } = makeDeps({ crashOn: [DEAL_A] });

    await expireOffers(deps);

    expect(recorded.errors).toHaveLength(1);
    const logged = JSON.parse(recorded.errors[0]);
    expect(logged.dealId).toBe(DEAL_A);
    expect(logged.job).toBe(EXPIRE_OFFERS_JOB_NAME);
    expect(logged.event).toBe('expire_offers.deal_failed');
  });

  it('logs one JSON object per failure, which is field-parseable and injection-proof', async () => {
    const { deps, recorded } = makeDeps({
      lapsed: [DEAL_A, DEAL_B],
      crashOn: [DEAL_A, DEAL_B],
    });

    await expireOffers(deps);

    // JSON escaping neutralises CR/LF log injection (CWE-117) by construction,
    // the same reasoning as the harness's `toLogString`.
    expect(recorded.errors).toHaveLength(2);
    for (const line of recorded.errors) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(line).not.toMatch(/\n/);
    }
  });

  it('logs no row content, so no PII can reach a log line', async () => {
    const { deps, recorded } = makeDeps({ crashOn: [DEAL_A] });

    await expireOffers(deps);

    // The harness's contract: scheduler logs carry counts and whitelisted ids,
    // never row content. Its email scrubber is a backstop, not the rule.
    const logged = JSON.parse(recorded.errors[0]);
    expect(Object.keys(logged).sort()).toEqual([
      'dealId',
      'event',
      'job',
      'level',
      'message',
      'name',
    ]);
    expect(recorded.errors[0]).not.toContain(CAMPAIGN_NAME);
    expect(recorded.errors[0]).not.toContain(BRAND_USER_ID);
    expect(recorded.errors[0]).not.toContain(String(TOTAL_PRICE));
  });

  it('survives a rejection that is not an Error', async () => {
    const { deps, recorded } = makeDeps();
    deps.transition = async () => {
      throw 'connection lost';
    };

    await expect(expireOffers(deps)).resolves.toEqual({
      examined: 1,
      acted: 0,
    });
    expect(JSON.parse(recorded.errors[0]).message).toBe('connection lost');
  });
});

// ---------------------------------------------------------------------------
// AC-018 — the cost returns to the brand's available budget
// ---------------------------------------------------------------------------

describe('the budget release (AC-018)', () => {
  it('excludes expired deals from the budget derivation', () => {
    // This is the release. There is no budget column, so the row dropping out of
    // the sum is the whole mechanism.
    expect(COMMITS_BUDGET.expired).toBe(false);
  });

  it('releases exactly total_price, because that is the column the sum stops counting', async () => {
    const { deps, recorded } = makeDeps();

    await expireOffers(deps);

    const payload = recorded.notifications[0].payload as {
      releasedAmount: number;
    };
    expect(payload.releasedAmount).toBe(TOTAL_PRICE);
  });

  it('reads the amount from the locked row, not from the select', () => {
    // So the figure is the deal's price at the moment of expiry rather than one
    // that might have moved between two statements.
    expect(CODE).toMatch(/releasedAmount:\s*row\.totalPrice/);
  });

  it('writes no budget column, so the release cannot half-apply', () => {
    // The strongest form of AC-018's "one transaction": there is no second write
    // to roll back and no window in which status and budget disagree.
    expect(CODE).not.toMatch(/update\(\s*campaign\s*\)/);
    expect(CODE).not.toMatch(/heldBalance|held_balance|availableBudget/);
  });

  it('makes no ledger call, because a pending deal never entered escrow', () => {
    // Money first moves at funding, so there is no `hold` to reverse.
    // `REFUNDABLE_FROM` excludes `pending` for the same reason.
    expect(CODE).not.toMatch(/refundDeal|EscrowLedger|ledgerEntry/);
  });

  it('keeps the amount an integer in santim (invariant 4)', async () => {
    const { deps, recorded } = makeDeps();

    await expireOffers(deps);

    const payload = recorded.notifications[0].payload as {
      releasedAmount: number;
    };
    expect(Number.isInteger(payload.releasedAmount)).toBe(true);
    // Never a formatted string — the stored row must not bake in a currency
    // format, and a float cannot represent santim exactly.
    expect(typeof payload.releasedAmount).toBe('number');
  });
});

describe('the brand is notified (AC-018)', () => {
  it('notifies the brand that the offer expired', async () => {
    const { deps, recorded } = makeDeps();

    await expireOffers(deps);

    expect(recorded.notifications).toEqual([
      {
        userId: BRAND_USER_ID,
        type: 'offer_expired',
        payload: {
          dealId: DEAL_A,
          campaignId: CAMPAIGN_ID,
          campaignTitle: CAMPAIGN_NAME,
          releasedAmount: TOTAL_PRICE,
        },
      },
    ]);
  });

  it('carries the campaign id, so the email can link the campaign (KAN-55)', async () => {
    // The released budget is re-offered on the campaign page, so the mail asking
    // the brand to re-offer used to land them one click short — the template had
    // no id to build a URL from and fell back to the campaign list. The sweep
    // already selected `campaignId` for its own joins and dropped it here.
    const { deps, recorded } = makeDeps();

    await expireOffers(deps);

    const payload = recorded.notifications[0].payload as {
      campaignId: string;
    };
    expect(payload.campaignId).toBe(CAMPAIGN_ID);
    // Taken from the locked row like every other figure in this payload, not
    // re-read after the transition.
    expect(CODE).toMatch(/campaignId:\s*row\.campaignId/);
  });

  it('uses offer_expired rather than offer_declined', () => {
    // Both release the same money, but they are different facts: nobody
    // answered, versus a creator said no. A brand may re-offer differently.
    expect(NOTIFICATION_TYPES).toContain('offer_expired');
    expect(CODE).toContain("'offer_expired'");
    expect(CODE).not.toContain("'offer_declined'");
  });

  it('addresses the brand user, not the brand profile', async () => {
    const { deps, recorded } = makeDeps();

    await expireOffers(deps);

    // The two-hop rule: `campaign.brand_id` is a profile id, and a notification
    // row addressed to it is one nobody can read.
    expect(recorded.notifications[0].userId).toBe(BRAND_USER_ID);
    expect(CODE).toMatch(/brandUserId:\s*brandProfile\.userId/);
  });

  it('notifies inside the transaction, so a rollback un-sends it', () => {
    // `withNotifications` flushes only after the commit, so a rolled-back expiry
    // never queues an email.
    expect(CODE).toMatch(/run:\s*\(fn\)\s*=>\s*withNotifications\(fn\)/);
  });

  it('sends one notification per expired deal, and none for the rest', async () => {
    const { deps, recorded } = makeDeps({
      lapsed: [DEAL_A, DEAL_B, DEAL_C],
      statusAt: { [DEAL_B]: 'accepted' },
    });

    await expireOffers(deps);

    expect(recorded.notifications.map((n) => n.type)).toEqual([
      'offer_expired',
      'offer_expired',
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC-7 — a creator who accepts moments before expiry wins
// ---------------------------------------------------------------------------

describe('the accept/expire race (AC-7)', () => {
  it('loads the deal FOR UPDATE, which is what serialises the two paths', () => {
    // The loser blocks here, then reads the status the winner wrote.
    expect(CODE).toMatch(/\.for\('update',\s*\{\s*of:\s*deal\s*\}\)/);
  });

  it('locks the deal row only, not the campaign or the brand', () => {
    // `{ of: deal }` matters: locking the joins would serialise every other deal
    // in the same batch on the same campaign.
    expect(CODE).toMatch(/of:\s*deal/);
  });

  it('leaves an accepted deal untouched, because the machine refuses the edge', async () => {
    const { deps, recorded } = makeDeps({
      statusAt: { [DEAL_A]: 'accepted' },
    });

    await expireOffers(deps);

    expect(recorded.transitions).toEqual([]);
    expect(LEGAL_TRANSITIONS.accepted).not.toContain('expired');
  });

  it('answers a late acceptance with OFFER_EXPIRED, from the shared table', () => {
    // The other half of the race, owned by the state machine: a creator tapping
    // Accept on a swept offer is told it expired, not to "refresh deal state".
    expect(getErrorCodeForInvalidTransition('expired', 'accepted')).toBe(
      ErrorCode.OFFER_EXPIRED
    );
  });

  it('cannot expire anything but a pending offer', () => {
    // Every status the sweep might race, checked against the one table both
    // paths read. Only `pending` has an `expired` edge.
    const expirable = (Object.keys(LEGAL_TRANSITIONS) as DealStatus[]).filter(
      (status) => LEGAL_TRANSITIONS[status].includes('expired')
    );
    expect(expirable).toEqual(['pending']);
  });
});

// ---------------------------------------------------------------------------
// AC-4 / AC-6 — the scheduler registration
// ---------------------------------------------------------------------------

describe('the scheduler registration (KAN-56 AC-003, AC-006)', () => {
  it('exposes the sweep as a named Job', () => {
    expect(expireOffersJob.name).toBe(EXPIRE_OFFERS_JOB_NAME);
    expect(typeof expireOffersJob.run).toBe('function');
  });

  it('is registered on the cron route', () => {
    const route = stripComments(readFileSync('app/api/cron/route.ts', 'utf8'));
    expect(route).toMatch(/jobsToRun:\s*Job\[\]\s*=\s*\[\s*expireOffersJob/);
    // The empty-array placeholder KAN-56 left must be gone, or the job is
    // written and never runs.
    expect(route).not.toMatch(/jobsToRun:\s*Job\[\]\s*=\s*\[\s*\]/);
  });

  it('reports counters the harness can log (AC-006)', async () => {
    const { deps } = makeDeps({ lapsed: [DEAL_A, DEAL_B] });

    const output = await expireOffers(deps);

    // `examined` and `acted` are the harness's log fields — the job's whole
    // observable output, and deliberately counts rather than row content.
    expect(Object.keys(output).sort()).toEqual(['acted', 'examined']);
  });

  it('honours the abort signal between deals', async () => {
    const controller = new AbortController();
    const { deps, recorded } = makeDeps({ lapsed: [DEAL_A, DEAL_B, DEAL_C] });
    const inner = deps.transition;
    deps.transition = async (tx, dealId) => {
      await inner(tx, dealId);
      controller.abort();
    };

    const output = await expireOffers(deps, controller.signal);

    // Stopped after the first deal committed, and did not start the second. The
    // check sits between deals because a transaction is not interruptible without
    // leaving the release half-applied.
    expect(output).toEqual({ examined: 1, acted: 1 });
    expect(recorded.loads).toEqual([DEAL_A]);
  });

  it('passes the signal through from the Job wrapper', () => {
    expect(CODE).toMatch(
      /run:\s*\(signal\)\s*=>\s*expireOffers\(\s*\w+,\s*signal\s*\)/
    );
  });

  it('does nothing when the signal is already aborted', async () => {
    const { deps, recorded } = makeDeps({ lapsed: [DEAL_A, DEAL_B] });

    const output = await expireOffers(deps, AbortSignal.abort());

    expect(output).toEqual({ examined: 0, acted: 0 });
    expect(recorded.loads).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Structural guards — FR-007, NFR-005, and the offer window
// ---------------------------------------------------------------------------

describe('structural guards', () => {
  it('goes through the state machine, never a direct status write (FR-007)', () => {
    // Also enforced repo-wide by `deal-state-machine.test.ts`, and restated here
    // because this is the module a reader of KAN-38 opens.
    expect(CODE).toContain('transitionDeal');
    expect(CODE).not.toMatch(/\.update\(\s*deal\s*\)/);
    expect(CODE).not.toMatch(/insert\(\s*dealEvent\s*\)/);
  });

  it('one transaction per deal, not one for the sweep', () => {
    // A shared transaction would roll back every expiry when the last one
    // deadlocked, which is exactly what AC-5 forbids.
    expect(CODE).toMatch(/async function expireOne[\s\S]*?deps\.run\(/);
    // The loop body calls the per-deal function; it does not open a transaction
    // of its own around the iteration.
    expect(CODE).toMatch(/for \(const dealId of lapsed\)[\s\S]*?expireOne\(/);
  });

  it('takes no session and no role guard, because there is no user (NFR-005)', () => {
    // The authentication boundary is the cron secret one layer out. A `guard()`
    // here would have no session to read.
    expect(CODE).not.toMatch(/\bguard\(/);
    expect(CODE).not.toMatch(/requireRole|getSession/);
  });

  it('is reachable from the scheduler and tests only', () => {
    // Not exported through `lib/deals/index.ts`, so no request-scoped caller can
    // pick it up by accident and run an unauthenticated sweep.
    const barrel = readFileSync('lib/deals/index.ts', 'utf8');
    expect(barrel).not.toContain('expire-offers');
  });

  it('holds the offer window in config, at seven days', () => {
    // A product decision (F27), and the reason the sweep has anything to select.
    expect(OFFER_WINDOW_DAYS).toBe(7);
    const issued = new Date('2026-08-01T00:00:00.000Z');
    expect(offerExpiresAt(issued).toISOString()).toBe(
      '2026-08-08T00:00:00.000Z'
    );
  });

  it('does not restate the window, so the sweep cannot disagree with the issuer', () => {
    // The sweep compares against the column, never against its own arithmetic —
    // a second copy of "7 days" here could drift from the one that set it.
    expect(CODE).not.toMatch(/OFFER_WINDOW|7\s*\*\s*24/);
  });

  it('names no KAN ticket in anything a user could read', () => {
    expect(EXPIRE_EVENT_REASON).not.toMatch(/KAN-/);
    expect(EXPIRE_OFFERS_JOB_NAME).not.toMatch(/KAN-/);
  });
});
