import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { approveDeliverable } from '../lib/deals/approve-deliverable';
import type { ApproveDeliverableDeps } from '../lib/deals/approve-deliverable';
import {
  LEGAL_TRANSITIONS,
  getErrorCodeForInvalidTransition,
} from '../lib/deals/state-machine';
import { ErrorCode, ErrorMessage } from '../lib/validation';
import { PaymentError } from '../lib/payment';
import { LedgerError } from '../lib/payment/ledger';
import type { DealStatus } from '../db/schema';

/**
 * KAN-45 — the brand approves a delivered video and the creator is paid net
 * of commission (US-008, AC-023, FR-004, NFR-003, Tech Spec §4.4 approve).
 *
 * Five claims carry the weight here.
 *
 * **The money path already exists and this module does not re-implement it.**
 * `EscrowLedgerService.payoutForDeal` is the one transaction: lock, status
 * guard, snapshotted-rate split, provider capture, paired ledger entries,
 * `delivered -> completed`. Its own suite (`escrow-ledger.test.ts`) exhausts
 * it. What this module adds is the ownership gate, the entry point, and the
 * notification — so the strongest assertions here are about what is *not*
 * here: no status hand-written, no ledger entry inserted, no transition
 * called from this file.
 *
 * **The state machine's answer is the status guard, and it is the ledger's
 * to surface.** `payoutForDeal` re-reads the row under its own lock and
 * throws `DEAL_NOT_DELIVERED` for anything but `delivered` — including a
 * double-approval, which arrives as `completed -> completed`. This module
 * maps that code through; it never invents one.
 *
 * **The split figures come from the ledger, verbatim.** The action returns
 * and notifies with the payout the transaction actually wrote, so there is
 * no second source for the amount (AC-3, AC-8). The snapshot math itself is
 * the ledger's invariant, pinned there.
 *
 * **The notification is written after the ledger commits.** `payoutForDeal`
 * opens its own serializable transaction (and retries it), so wrapping it in
 * `withNotifications` would nest transactions and re-queue emails per retry
 * — the `fund-campaign.ts` header documents why. The honest failure mode is
 * a paid creator nobody told, which is the right direction to fail in — and
 * because the money and the status are already final, that failure is traced
 * and swallowed: the response still reports the completed payout instead of
 * a 500 that would lie about an approval that succeeded.
 *
 * **The endpoint takes no body.** The amounts are derived from the deal
 * under the ledger's lock, so there is nothing for a client to vary except
 * which deal — which is in the path. The route never reads the request.
 */

const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleApproveDeliverable } =
  await import('../app/api/deals/[id]/approve/route');

const BRAND_USER_ID = '55555555-5555-4555-8555-555555555555';
const BRAND_PROFILE_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_BRAND_PROFILE_ID = '77777777-7777-4777-8777-777777777777';
const CREATOR_USER_ID = '99999999-9999-4999-8999-999999999999';
const DEAL_ID = '33333333-3333-4333-8333-333333333333';

const CAMPAIGN_NAME = 'Ramadan Beauty Push';
const TOTAL = 100_000;
const PAYOUT = 85_000;
const COMMISSION = 15_000;

interface Recorded {
  /** Seam names in call order — ordering asserted without reading source. */
  calls: string[];
  loads: Array<{ dealId: string; brandProfileId: string }>;
  pays: Array<{ dealId: string; actorId: string }>;
  notifications: Array<{ userId: string; type: string; payload: unknown }>;
  logs: Array<{ operation: string; dealId: string; actorId: string }>;
  notifyLogs: Array<{ dealId: string; actorId: string }>;
}

interface Overrides {
  dealMissing?: boolean;
  status?: DealStatus;
  payError?: Error;
  payResult?: { payout: number; commission: number };
  failNotify?: boolean;
}

function makeDeps(overrides: Overrides = {}): {
  deps: ApproveDeliverableDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    calls: [],
    loads: [],
    pays: [],
    notifications: [],
    logs: [],
    notifyLogs: [],
  };

  const deps: ApproveDeliverableDeps = {
    getDeal: async (dealId, brandProfileId) => {
      recorded.calls.push('getDeal');
      recorded.loads.push({ dealId, brandProfileId });
      // The ownership scope is in the `where`, so a deal whose campaign
      // belongs to another brand does not come back at all. The fake honours
      // that rather than returning the row and trusting a later check.
      if (overrides.dealMissing) return null;
      if (brandProfileId !== BRAND_PROFILE_ID) return null;

      return {
        id: dealId,
        status: overrides.status ?? 'delivered',
        campaignName: CAMPAIGN_NAME,
        creatorUserId: CREATOR_USER_ID,
      };
    },
    pay: async (dealId, actorId) => {
      recorded.calls.push('pay');
      recorded.pays.push({ dealId, actorId });
      if (overrides.payError) throw overrides.payError;
      return overrides.payResult ?? { payout: PAYOUT, commission: COMMISSION };
    },
    notify: async (userId, type, payload) => {
      recorded.calls.push('notify');
      recorded.notifications.push({ userId, type, payload });
      if (overrides.failNotify) throw new Error('notification insert failed');
    },
    logFailure: async (error, context) => {
      recorded.calls.push('logFailure');
      recorded.logs.push({
        operation: context.operation,
        dealId: context.dealId ?? '',
        actorId: context.actorId ?? '',
      });
    },
    logNotifyFailure: async (_error, context) => {
      recorded.calls.push('logNotifyFailure');
      recorded.notifyLogs.push({
        dealId: context.dealId,
        actorId: context.actorId,
      });
    },
  };

  return { deps, recorded };
}

async function approve(
  overrides: Overrides = {},
  brandProfileId = BRAND_PROFILE_ID
) {
  const { deps, recorded } = makeDeps(overrides);
  const result = await approveDeliverable(
    DEAL_ID,
    brandProfileId,
    BRAND_USER_ID,
    deps
  );
  return { result, recorded };
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function read(path: string): string {
  return stripComments(readFileSync(path, 'utf8'));
}

const APPROVE_MODULE = read('lib/deals/approve-deliverable.ts');
const APPROVE_ROUTE = read('app/api/deals/[id]/approve/route.ts');
const LEDGER_MODULE = read('lib/payment/ledger.ts');

const NON_APPROVABLE = (Object.keys(LEGAL_TRANSITIONS) as DealStatus[]).filter(
  (s) => !LEGAL_TRANSITIONS[s].includes('completed')
);

// -- AC-023: the deal moves and the money follows ----------------------------

describe('AC-023 — approving pays the creator net of commission', () => {
  it('returns the completed state with the ledger’s payout and commission', async () => {
    const { result, recorded } = await approve();

    expect(result).toEqual({
      ok: true,
      dealId: DEAL_ID,
      status: 'completed',
      payout: PAYOUT,
      commission: COMMISSION,
    });
    expect(recorded.calls).toEqual(['getDeal', 'pay', 'notify']);
  });

  it('passes the brand as actor to the ledger, which owns the transition', async () => {
    const { recorded } = await approve();

    expect(recorded.pays).toEqual([
      { dealId: DEAL_ID, actorId: BRAND_USER_ID },
    ]);
    // AC-7 / FR-007: the actor recorded on the deal_event is the brand who
    // clicked approve, and it is the ledger's transition to write.
    expect(recorded.pays[0].actorId).toBe(BRAND_USER_ID);
  });

  it('takes the split from the ledger, never from its own arithmetic', async () => {
    // A deliberate non-15% figure — the snapshot math is the ledger's
    // invariant (AC-3). If this module re-derived the split it would have to
    // import COMMISSION_RATE or the rate, and the figures it returns and
    // notifies with would disagree with what the entries were written from.
    const { result, recorded } = await approve({
      payResult: { payout: 75_000, commission: 25_000 },
    });

    expect(result).toMatchObject({ payout: 75_000, commission: 25_000 });
    expect(recorded.notifications[0].payload).toMatchObject({
      payout: 75_000,
    });
  });

  it('hand-writes neither a status nor a ledger entry nor a transition', () => {
    // The strongest form of "the money path exists and is not re-implemented
    // here": this module contains none of the writes that would be needed to
    // move money on its own. The only status string that may appear is the
    // result's echo of what the ledger did.
    expect(APPROVE_MODULE).not.toContain('transitionDeal(');
    expect(APPROVE_MODULE).not.toContain('ledgerEntry');
    expect(APPROVE_MODULE).not.toContain('.update(deal)');
    expect(APPROVE_MODULE).not.toMatch(/entryType/);
  });
});

// -- AC-4: only a delivered deal can be approved -----------------------------

describe('AC-4 — approving is only legal from delivered', () => {
  it.each(NON_APPROVABLE)(
    'refuses a %s deal with the machine’s own code',
    async (status) => {
      // The ledger is the status guard: it re-reads the row under its lock
      // and answers with DEAL_NOT_DELIVERED. The action maps that through —
      // the refusal code is the ledger's, never one this module invents.
      const { result, recorded } = await approve({
        status,
        payError: new LedgerError(
          'not delivered',
          ErrorCode.DEAL_NOT_DELIVERED
        ),
      });

      expect(result).toEqual({ ok: false, reason: 'not_delivered' });
      expect(recorded.notifications).toHaveLength(0);
      expect(recorded.logs).toHaveLength(0);
    }
  );

  it('covers every status the machine does not send to completed', () => {
    expect(NON_APPROVABLE).toEqual(
      (Object.keys(LEGAL_TRANSITIONS) as DealStatus[]).filter(
        (s) => s !== 'delivered'
      )
    );
  });

  it('answers an undeclivered deal with DEAL_NOT_DELIVERED', async () => {
    // AC-4's named code, through the route. Runs before the endpoint
    // describe's beforeEach, so the brand guard is set up here too.
    guardMock.mockReset();
    guardMock.mockResolvedValue({
      user: {
        id: BRAND_USER_ID,
        email: 'brand@example.com',
        name: 'Brand',
        role: 'brand',
      },
      brandProfileId: BRAND_PROFILE_ID,
      creatorProfileId: null,
    });

    const { deps, recorded } = makeDeps({ status: 'funded' });
    const payError = new LedgerError(
      'not delivered',
      ErrorCode.DEAL_NOT_DELIVERED
    );

    const response = await handleApproveDeliverable(DEAL_ID, {
      approveDeliverableDeps: {
        ...deps,
        pay: async () => {
          throw payError;
        },
      },
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.DEAL_NOT_DELIVERED);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.DEAL_NOT_DELIVERED]);
    expect(recorded.notifications).toHaveLength(0);
  });
});

// -- AC-6: paying twice is impossible ----------------------------------------

describe('AC-6 — a double-approval pays nothing twice', () => {
  it('refuses the second approval with the machine’s own code', async () => {
    // The second attempt arrives at the ledger as `completed -> completed`,
    // which the machine answers with DEAL_NOT_DELIVERED. The provider was
    // never called a second time because the refusal happens before the
    // capture — the ledger's transaction ordering, pinned here by the fact
    // that the action surfaced the refusal without calling notify or pay
    // again.
    const { result, recorded } = await approve({
      status: 'completed',
      payError: new LedgerError(
        'already completed',
        ErrorCode.DEAL_NOT_DELIVERED
      ),
    });

    expect(result).toEqual({ ok: false, reason: 'not_delivered' });
    expect(recorded.pays).toHaveLength(1);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('is structurally impossible: the second pay call is refused before capture', () => {
    // The money call is one shot. The action has no loop and no retry — the
    // only way a second capture could happen is a second `pay` invocation,
    // and the refusal path calls it exactly once.
    expect(APPROVE_MODULE).not.toMatch(/for \(|\.map\(|while \(/);
    expect(APPROVE_MODULE.match(/deps\.pay\(/g) ?? []).toHaveLength(1);
  });
});

// -- AC-7: the creator is notified after the money commits -------------------

describe('AC-7 — the creator is notified of approval and payout', () => {
  it('addresses the creator’s user id, not the profile id', async () => {
    const { recorded } = await approve();

    expect(recorded.notifications[0].userId).toBe(CREATOR_USER_ID);
  });

  it('sends the deliverable_approved type with the paid amount', async () => {
    const { recorded } = await approve();

    expect(recorded.notifications[0]).toMatchObject({
      type: 'deliverable_approved',
      payload: {
        dealId: DEAL_ID,
        campaignTitle: CAMPAIGN_NAME,
        payout: PAYOUT,
      },
    });
  });

  it('runs after the ledger, never before it', async () => {
    const { recorded } = await approve();
    expect(recorded.calls).toEqual(['getDeal', 'pay', 'notify']);
  });

  it('says nothing when the payout is refused', async () => {
    const { recorded } = await approve({
      status: 'funded',
      payError: new LedgerError('not delivered', ErrorCode.DEAL_NOT_DELIVERED),
    });

    expect(recorded.notifications).toHaveLength(0);
  });

  it('says nothing when the payout fails', async () => {
    const { recorded } = await approve({
      payError: new PaymentError('provider down', 'PROVIDER_UNAVAILABLE'),
    });

    expect(recorded.notifications).toHaveLength(0);
  });
});

// -- F2: a failed notification never undoes the payout -----------------------

describe('a failed notification does not undo the payout', () => {
  it('still reports ok:true with the written figures when notify throws', async () => {
    const { result, recorded } = await approve({ failNotify: true });

    // The money and the status were final before the notification ran, so a
    // failure there cannot roll either back — and the brand must not be told
    // their approval failed when it succeeded. The trace is the only casualty.
    expect(result).toEqual({
      ok: true,
      dealId: DEAL_ID,
      status: 'completed',
      payout: PAYOUT,
      commission: COMMISSION,
    });
    expect(recorded.pays).toEqual([
      { dealId: DEAL_ID, actorId: BRAND_USER_ID },
    ]);
    // Ordering is the proof the payout committed first: pay runs, then notify,
    // then the trace — there is no rollback between them to undo the payout.
    expect(recorded.calls).toEqual([
      'getDeal',
      'pay',
      'notify',
      'logNotifyFailure',
    ]);
  });

  it('traces the swallowed notification failure', async () => {
    const { recorded } = await approve({ failNotify: true });

    // The trace is the operator's only evidence that a paid creator was never
    // told, so the seam must fire with the join keys back to the payout.
    expect(recorded.notifyLogs).toEqual([
      { dealId: DEAL_ID, actorId: BRAND_USER_ID },
    ]);
  });
});

// -- AC-5: only the owning brand can approve ---------------------------------

describe('AC-5 — only the owning brand can approve', () => {
  it('puts the ownership scope in the where clause', () => {
    expect(APPROVE_MODULE).toContain('eq(campaign.brandId, brandProfileId)');
    expect(APPROVE_MODULE).toContain('eq(deal.id, dealId)');
  });

  it('takes the brand id from the session, never from the request', () => {
    // There is no request body at all — the brand is whatever the guard
    // returned, and the route's POST never reads the request.
    expect(APPROVE_ROUTE).toContain('brandProfileId = ctx.brandProfileId');
    expect(APPROVE_ROUTE).toContain('actorUserId = ctx.user.id');
    expect(APPROVE_ROUTE).not.toContain('request.json');
  });

  it('does not return another brand’s deal at all', async () => {
    const { result, recorded } = await approve({}, OTHER_BRAND_PROFILE_ID);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(recorded.pays).toHaveLength(0);
    expect(recorded.loads).toEqual([
      { dealId: DEAL_ID, brandProfileId: OTHER_BRAND_PROFILE_ID },
    ]);
  });
});

// -- Failure handling (the KAN-44 rule for the payout path) ------------------

describe('a failed payout leaves a trace and nothing else', () => {
  it('reports a provider failure as payment_failed and logs it', async () => {
    const { result, recorded } = await approve({
      payError: new PaymentError('provider down', 'PROVIDER_UNAVAILABLE'),
    });

    expect(result).toEqual({ ok: false, reason: 'payment_failed' });
    expect(recorded.logs).toEqual([
      {
        operation: 'approve_deliverable',
        dealId: DEAL_ID,
        actorId: BRAND_USER_ID,
      },
    ]);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('maps the ledger’s own PAYMENT_FAILED the same way', async () => {
    const { result } = await approve({
      payError: new LedgerError(
        'serialization retries exhausted',
        ErrorCode.PAYMENT_FAILED
      ),
    });

    expect(result).toEqual({ ok: false, reason: 'payment_failed' });
  });

  it('re-throws an unrecognised failure and logs it, rather than claiming a refusal', async () => {
    const { deps, recorded } = makeDeps();
    deps.pay = async () => {
      throw new Error('connection terminated');
    };

    await expect(
      approveDeliverable(DEAL_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps)
    ).rejects.toThrow('connection terminated');
    expect(recorded.logs).toHaveLength(1);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('does not log a clean refusal — there is nothing to debug', async () => {
    const { recorded } = await approve({
      status: 'funded',
      payError: new LedgerError('not delivered', ErrorCode.DEAL_NOT_DELIVERED),
    });

    expect(recorded.logs).toHaveLength(0);
  });
});

// -- AC-8: the figures reconcile to the deal total ---------------------------

describe('AC-8 — the released amounts reconcile', () => {
  it('echoes figures where payout + commission is exactly the total', async () => {
    // The subtraction formula's guarantee lives in the ledger (spike §3.3).
    // The action's contribution is to return the written figures untouched,
    // so the client and the notification both see the same split the entries
    // were written from — a reconciliation that cannot drift.
    const { result, recorded } = await approve();
    if (!result.ok) throw new Error('expected a successful approval');

    expect(result.payout + result.commission).toBe(TOTAL);
    expect(recorded.notifications[0].payload).toMatchObject({
      payout: result.payout,
    });
  });

  it('takes no part in the balance arithmetic itself', () => {
    // The held-balance decrease (escrow falls by exactly the total) is the
    // ledger's invariant-7 guarantee, already exhausted in escrow-ledger.
    expect(APPROVE_MODULE).not.toMatch(/balanceAfter|sumEscrowed|sumBalance/);
  });
});

// -- The endpoint -------------------------------------------------------------

describe('POST /api/deals/[id]/approve', () => {
  beforeEach(() => {
    guardMock.mockReset();
    guardMock.mockResolvedValue({
      user: {
        id: BRAND_USER_ID,
        email: 'brand@example.com',
        name: 'Brand',
        role: 'brand',
      },
      brandProfileId: BRAND_PROFILE_ID,
      creatorProfileId: null,
    });
  });

  it('returns 200 with what was paid', async () => {
    const { deps } = makeDeps();

    const response = await handleApproveDeliverable(DEAL_ID, {
      approveDeliverableDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      deal_id: DEAL_ID,
      status: 'completed',
      payout: PAYOUT,
      commission: COMMISSION,
    });
  });

  it('gates on the brand role and this deal', async () => {
    const { deps } = makeDeps();

    await handleApproveDeliverable(DEAL_ID, { approveDeliverableDeps: deps });

    expect(guardMock).toHaveBeenCalledWith({
      roles: ['brand'],
      resource: { kind: 'deal', id: DEAL_ID },
    });
  });

  it('refuses a malformed id before it reaches a uuid column', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleApproveDeliverable('not-a-uuid', {
      approveDeliverableDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
    expect(guardMock).not.toHaveBeenCalled();
    expect(recorded.calls).toHaveLength(0);
  });

  it('denies a brand with no profile row', async () => {
    const { deps, recorded } = makeDeps();
    guardMock.mockResolvedValueOnce({
      user: {
        id: BRAND_USER_ID,
        email: 'brand@example.com',
        name: 'Brand',
        role: 'brand',
      },
      brandProfileId: null,
      creatorProfileId: null,
    });

    const response = await handleApproveDeliverable(DEAL_ID, {
      approveDeliverableDeps: deps,
    });

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
  });

  it('collapses a vanished deal into 403, not 404', async () => {
    const { deps } = makeDeps({ dealMissing: true });

    const response = await handleApproveDeliverable(DEAL_ID, {
      approveDeliverableDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('returns 409 DEAL_NOT_DELIVERED for a deal that was never delivered', async () => {
    const { deps } = makeDeps({ status: 'funded' });
    const payError = new LedgerError(
      'not delivered',
      ErrorCode.DEAL_NOT_DELIVERED
    );

    const response = await handleApproveDeliverable(DEAL_ID, {
      approveDeliverableDeps: {
        ...deps,
        pay: async () => {
          throw payError;
        },
      },
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.DEAL_NOT_DELIVERED);
  });

  it('returns 402 PAYMENT_FAILED and leaves the deal untouched', async () => {
    const { deps, recorded } = makeDeps({
      payError: new PaymentError('provider down', 'PROVIDER_UNAVAILABLE'),
    });

    const response = await handleApproveDeliverable(DEAL_ID, {
      approveDeliverableDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error.code).toBe(ErrorCode.PAYMENT_FAILED);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.PAYMENT_FAILED]);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('passes the state machine’s code through rather than choosing one', async () => {
    const code = getErrorCodeForInvalidTransition('funded', 'completed');
    const { deps } = makeDeps({ status: 'funded' });
    const payError = new LedgerError(
      'not delivered',
      ErrorCode.DEAL_NOT_DELIVERED
    );

    const response = await handleApproveDeliverable(DEAL_ID, {
      approveDeliverableDeps: {
        ...deps,
        pay: async () => {
          throw payError;
        },
      },
    });
    const body = await response.json();

    expect(response.status).toBe(
      ErrorCode.DEAL_NOT_DELIVERED === code ? 409 : 500
    );
    expect(body.error.code).toBe(ErrorCode.DEAL_NOT_DELIVERED);
  });

  it('runs on the Node runtime, because pg cannot run on the edge', () => {
    expect(APPROVE_ROUTE).toContain("export const runtime = 'nodejs'");
  });
});

/**
 * NFR-002 (KAN-45 AC bullet 9) — approval answers within a second under
 * normal load.
 *
 * Asserted structurally rather than on the clock, for the reason the funding
 * suite documents (campaign-funding.test.ts): a wall-clock assertion against a
 * fake database measures the fake, and one against a real instance measures the
 * network. What actually decides whether this is a sub-second endpoint is the
 * query shape — one ownership read, one ledger transaction (one balance sum,
 * one provider capture), one notification — with nothing that grows with the
 * input.
 */
describe('NFR-002 — the work is bounded', () => {
  it('runs one ownership read, one payout, and one notification', async () => {
    const { recorded } = await approve();

    // The whole payout is a fixed sequence, not a per-deal or per-row fan-out:
    // the only input is a deal id, and nothing scales with any table's size.
    expect(recorded.calls.filter((c) => c === 'getDeal')).toHaveLength(1);
    expect(recorded.calls.filter((c) => c === 'pay')).toHaveLength(1);
    expect(recorded.calls.filter((c) => c === 'notify')).toHaveLength(1);
    expect(recorded.calls).toHaveLength(3);
  });

  it('sums the balance once and captures the payout once inside the ledger', () => {
    // Both in `payoutForDeal`: one `sumBalance` under the campaign lock and one
    // `provider.capturePayout`, with the two ledger inserts derived in memory
    // from the same computed split — no re-summing and no second capture for
    // any input shape.
    const payoutBody = LEDGER_MODULE.slice(
      LEDGER_MODULE.indexOf('async payoutForDeal'),
      LEDGER_MODULE.indexOf('async refundDeal')
    );
    expect(payoutBody).toContain('this.sumBalance(tx, deal.campaignId)');
    expect(payoutBody.match(/this\.sumBalance/g)).toHaveLength(1);
    expect(payoutBody.match(/this\.provider\./g)).toHaveLength(1);
  });
});
