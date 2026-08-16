import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDispute } from '../lib/deals/resolve-dispute';
import type {
  ResolveDeal,
  ResolveDisputeDeps,
} from '../lib/deals/resolve-dispute';
import { TransitionError, type DealRow } from '../lib/deals/state-machine';
import { ForbiddenError } from '../lib/authz';
import type { Tx } from '../lib/authz';
import { EscrowLedgerService, LedgerError } from '../lib/payment/ledger';
import { PaymentError } from '../lib/payment';
import type { CurrentUser } from '../lib/auth';
import {
  ErrorCode,
  MAX_RESOLUTION_NOTE_LENGTH,
  resolveDisputeSchema,
} from '../lib/validation';

/**
 * KAN-51 — an admin resolves a disputed deal: release, refund, or request
 * revision (US-010, AC-030, Tech Spec §4.6 resolve).
 *
 * The load-bearing claims:
 *
 * **The ledger is the money path, not a parallel one (AC-2, AC-3).** `release`
 * is `payoutForDeal` — the same call brand approval makes — and `refund` is
 * `refundDeal`. Both run before this module writes anything else, because each
 * opens and retries its own serializable transaction; the seam records that
 * the ledger ran, and the route echoes the figures it returned.
 *
 * **`revision` is one transaction: machine + audit + both notifications.**
 * `withNotifications` (outer, owns the real transaction) wraps
 * `withAdminAudit` (inner, transaction seam) so the status change, the
 * `deal.resolve_dispute` row, and both parties' `dispute_resolved` rows commit
 * or roll back together, and emails flush only after commit (AC-3/AC-4).
 *
 * **Audit + notifications follow the ledger for `release`/`refund`.** The
 * ledger has already committed by the time the audit row can be written, so
 * the audit + notification transaction is a second phase; a failure there is
 * traced and swallowed, and the deal stays resolved. The tests assert the
 * audit row and both notification rows were written through the same fake
 * transaction.
 *
 * **AC-9 falls out of the machine.** A `release` on anything but `delivered`
 * is the ledger's `DEAL_NOT_DELIVERED`, a `refund` from a non-refundable
 * status is `DEAL_NOT_FUNDED`, a `revision` on a funded deal is the machine's
 * `DEAL_NOT_DELIVERED` — so a second resolution of an already-resolved deal is
 * refused with the machine's own code, never a second payout or second refund.
 *
 * **The note is mandatory and stored.** `resolveDisputeSchema` refuses an
 * empty, whitespace-only, or over-long note; the action records it in the
 * audit detail.
 */

const ADMIN_USER: CurrentUser = {
  id: '99999999-9999-4999-8999-999999999999',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
};
const ACTOR_USER_ID = ADMIN_USER.id;
const BRAND_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CREATOR_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEAL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const DEAL: ResolveDeal = {
  id: DEAL_ID,
  status: 'delivered',
  campaignName: 'Summer launch',
  brandUserId: BRAND_USER_ID,
  creatorUserId: CREATOR_USER_ID,
};

interface Recorded {
  /** Rows the fake transaction saw — audit row and notification rows. */
  rows: Record<string, unknown>[];
  loads: string[];
  pays: Array<{ dealId: string; actorId: string }>;
  refunds: Array<{ dealId: string; actorId: string }>;
  transitions: Array<{
    dealId: string;
    toStatus: string;
    actorId: string | null;
    reason?: string;
  }>;
  committed: boolean;
}
function makeDeps(
  overrides: {
    deal?: ResolveDeal | null;
    failPay?: Error;
    failRefund?: Error;
    failTransition?: Error;
    failPostLedger?: Error;
  } = {}
): { deps: ResolveDisputeDeps; recorded: Recorded; fakeTx: Tx } {
  const recorded: Recorded = {
    rows: [],
    loads: [],
    pays: [],
    refunds: [],
    transitions: [],
    committed: false,
  };

  // The one transaction the action's own writes land in — the same object the
  // audit row and both notification rows must share to prove atomicity. Only
  // `insert` is needed: the ledger and the state machine are seamed, so the
  // only rows that reach this transaction are the audit row (withAdminAudit)
  // and the notification rows (the scoped notify).
  const fakeTx = {
    insert: vi.fn(() => ({
      values: vi.fn((row: Record<string, unknown>) => {
        if (overrides.failPostLedger) throw overrides.failPostLedger;
        recorded.rows.push(row);
        return Promise.resolve();
      }),
    })),
  } as unknown as Tx;

  const deps: ResolveDisputeDeps = {
    loadDeal: async (id) => {
      recorded.loads.push(id);
      return overrides.deal === undefined ? DEAL : overrides.deal;
    },
    pay: async (dealId, actorId) => {
      recorded.pays.push({ dealId, actorId });
      if (overrides.failPay) throw overrides.failPay;
      return { payout: 85_000, commission: 15_000 };
    },
    refund: async (dealId, actorId) => {
      recorded.refunds.push({ dealId, actorId });
      if (overrides.failRefund) throw overrides.failRefund;
    },
    transition: async (_tx, dealId, toStatus, actorId, opts) => {
      recorded.transitions.push({
        dealId,
        toStatus,
        actorId: actorId ?? null,
        reason: opts?.reason,
      });
      if (overrides.failTransition) throw overrides.failTransition;
      return { ...DEAL, status: toStatus } as unknown as DealRow;
    },
    notifyDeps: {
      db: {
        transaction: async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
          const result = await fn(fakeTx);
          recorded.committed = true;
          return result;
        },
      } as unknown as NonNullable<ResolveDisputeDeps['notifyDeps']>['db'],
      provider: null as unknown as NonNullable<
        ResolveDisputeDeps['notifyDeps']
      >['provider'],
      render: async () => ({ subject: '', text: '', html: '' }),
      log: {
        info: vi.fn(),
        error: vi.fn(),
      } as unknown as NonNullable<ResolveDisputeDeps['notifyDeps']>['log'],
      sleep: async () => {},
    },
    adminAuditDeps: {
      getCurrentUser: async () => ADMIN_USER,
      loadProfileIds: async () => ({
        brandProfileId: null,
        creatorProfileId: null,
      }),
      loadOwnerRefs: async () => null,
    },
    logFailure: vi.fn() as unknown as ResolveDisputeDeps['logFailure'],
    logPostLedgerFailure:
      vi.fn() as unknown as ResolveDisputeDeps['logPostLedgerFailure'],
  };

  return { deps, recorded, fakeTx };
}

function resolve(
  deps: ResolveDisputeDeps,
  over: {
    resolution?: 'release' | 'refund' | 'revision';
    note?: string;
  } = {}
) {
  return resolveDispute(
    DEAL_ID,
    {
      resolution: over.resolution ?? 'release',
      note: over.note ?? 'Creator delivered on time; brand dispute unfounded.',
    },
    ACTOR_USER_ID,
    deps
  );
}

/** The `deal.resolve_dispute` audit row the transaction saw, if any. */
function auditRow(recorded: Recorded): Record<string, unknown> | undefined {
  return recorded.rows.find((r) => r.action === 'deal.resolve_dispute');
}

/** The notification rows the transaction saw, keyed by recipient. */
function notificationRows(
  recorded: Recorded
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of recorded.rows) {
    if (r.type === 'dispute_resolved') {
      out[r.userId as string] = r;
    }
  }
  return out;
}

// -- The three paths --------------------------------------------------------

describe('release — the same ledger path as brand approval (AC-2)', () => {
  it('loads the deal, then pays the creator net of commission', async () => {
    const { deps, recorded } = makeDeps();

    const result = await resolve(deps, { resolution: 'release' });

    expect(result).toEqual({
      ok: true,
      dealId: DEAL_ID,
      status: 'completed',
      resolution: 'release',
      payout: 85_000,
      commission: 15_000,
    });
    expect(recorded.loads).toEqual([DEAL_ID]);
    expect(recorded.pays).toEqual([
      { dealId: DEAL_ID, actorId: ACTOR_USER_ID },
    ]);
    expect(recorded.refunds).toHaveLength(0);
    expect(recorded.transitions).toHaveLength(0);
  });

  it('writes one deal.resolve_dispute audit row and notifies both parties', async () => {
    const { deps, recorded } = makeDeps();

    await resolve(deps, { resolution: 'release', note: 'Both sides heard.' });

    // Audit row + two notification rows all landed in the same transaction.
    expect(recorded.committed).toBe(true);
    const audit = auditRow(recorded);
    expect(audit).toMatchObject({
      actorId: ACTOR_USER_ID,
      action: 'deal.resolve_dispute',
      targetType: 'deal',
      targetId: DEAL_ID,
    });
    expect(audit?.detail).toMatchObject({
      resolution: 'release',
      note: 'Both sides heard.',
      before: 'delivered',
      after: 'completed',
      payout: 85_000,
      commission: 15_000,
    });

    const notifications = notificationRows(recorded);
    expect(Object.keys(notifications).sort()).toEqual(
      [BRAND_USER_ID, CREATOR_USER_ID].sort()
    );
    for (const row of Object.values(notifications)) {
      expect(row.payload).toMatchObject({
        dealId: DEAL_ID,
        campaignTitle: 'Summer launch',
        resolution: 'released',
      });
    }
  });

  it('maps the ledger refusal for a non-delivered deal to its own code', async () => {
    const { deps, recorded } = makeDeps({
      failPay: new LedgerError('not delivered', ErrorCode.DEAL_NOT_DELIVERED),
    });

    const result = await resolve(deps, { resolution: 'release' });

    expect(result).toEqual({
      ok: false,
      reason: 'illegal',
      code: ErrorCode.DEAL_NOT_DELIVERED,
    });
    // Nothing was audited or notified — the refusal happened before any write.
    expect(recorded.rows).toHaveLength(0);
    expect(deps.logFailure).toHaveBeenCalledTimes(0);
  });

  it('maps a provider failure to payment_failed and traces it', async () => {
    const { deps, recorded } = makeDeps({
      failPay: new PaymentError('processor down', 'PROVIDER_UNAVAILABLE'),
    });

    const result = await resolve(deps, { resolution: 'release' });

    expect(result).toEqual({ ok: false, reason: 'payment_failed' });
    expect(recorded.rows).toHaveLength(0);
    expect(deps.logFailure).toHaveBeenCalledWith(
      expect.any(PaymentError),
      expect.objectContaining({ operation: 'resolve_dispute', dealId: DEAL_ID })
    );
  });

  it('swallows a post-ledger audit/notification failure and still reports the resolution', async () => {
    // Money and status are already final once the ledger has committed; the
    // audit + notification write failing afterwards must not turn the response
    // into a 500 that tells the admin their resolution failed when it
    // succeeded. The failure is traced instead (module header).
    const { deps, recorded } = makeDeps({
      failPostLedger: new Error('db unavailable'),
    });

    const result = await resolve(deps, { resolution: 'release' });

    expect(result).toEqual({
      ok: true,
      dealId: DEAL_ID,
      status: 'completed',
      resolution: 'release',
      payout: 85_000,
      commission: 15_000,
    });
    expect(recorded.pays).toHaveLength(1);
    // Nothing reached the post-ledger transaction, and the swallow left a trace
    // naming the deal, the actor, and the resolution.
    expect(recorded.rows).toHaveLength(0);
    expect(deps.logPostLedgerFailure).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        dealId: DEAL_ID,
        actorId: ACTOR_USER_ID,
        resolution: 'release',
      })
    );
  });
});

describe('refund — returns the held amount to the brand (AC-3)', () => {
  it('refunds and moves the deal to refunded', async () => {
    const { deps, recorded } = makeDeps({
      deal: { ...DEAL, status: 'funded' },
    });

    const result = await resolve(deps, { resolution: 'refund' });

    expect(result).toEqual({
      ok: true,
      dealId: DEAL_ID,
      status: 'refunded',
      resolution: 'refund',
    });
    expect(recorded.refunds).toEqual([
      { dealId: DEAL_ID, actorId: ACTOR_USER_ID },
    ]);
    expect(recorded.pays).toHaveLength(0);

    const audit = auditRow(recorded);
    expect(audit?.detail).toMatchObject({
      resolution: 'refund',
      before: 'funded',
      after: 'refunded',
    });
    const notifications = notificationRows(recorded);
    expect(Object.keys(notifications).sort()).toEqual(
      [BRAND_USER_ID, CREATOR_USER_ID].sort()
    );
    for (const row of Object.values(notifications)) {
      expect(row.payload).toMatchObject({ resolution: 'refunded' });
    }
  });

  it('maps a non-refundable status to DEAL_NOT_FUNDED', async () => {
    const { deps, recorded } = makeDeps({
      failRefund: new LedgerError('not refundable', ErrorCode.DEAL_NOT_FUNDED),
    });

    const result = await resolve(deps, { resolution: 'refund' });

    expect(result).toEqual({
      ok: false,
      reason: 'illegal',
      code: ErrorCode.DEAL_NOT_FUNDED,
    });
    expect(recorded.rows).toHaveLength(0);
  });
});

describe('revision — returns the deal to revision_requested, funds held (AC-4)', () => {
  it('transitions inside the audit transaction and notifies both parties', async () => {
    const { deps, recorded } = makeDeps();

    const result = await resolve(deps, {
      resolution: 'revision',
      note: 'Reshoot the outro.',
    });

    expect(result).toEqual({
      ok: true,
      dealId: DEAL_ID,
      status: 'revision_requested',
      resolution: 'revision',
    });
    // The state machine ran inside the same transaction that carried the audit
    // row and both notifications — one commit (AC-6, NFR-003).
    expect(recorded.committed).toBe(true);
    expect(recorded.transitions).toEqual([
      {
        dealId: DEAL_ID,
        toStatus: 'revision_requested',
        actorId: ACTOR_USER_ID,
        reason: 'Reshoot the outro.',
      },
    ]);
    const audit = auditRow(recorded);
    expect(audit?.detail).toMatchObject({
      resolution: 'revision',
      note: 'Reshoot the outro.',
      before: 'delivered',
      after: 'revision_requested',
    });
    const notifications = notificationRows(recorded);
    expect(Object.keys(notifications).sort()).toEqual(
      [BRAND_USER_ID, CREATOR_USER_ID].sort()
    );
    for (const row of Object.values(notifications)) {
      expect(row.payload).toMatchObject({ resolution: 'revision_requested' });
    }
  });

  it('maps an illegal revision to the machine code', async () => {
    const { deps, recorded } = makeDeps({
      failTransition: new TransitionError(
        'Cannot transition deal from funded to revision_requested',
        ErrorCode.DEAL_NOT_DELIVERED
      ),
    });

    const result = await resolve(deps, { resolution: 'revision' });

    expect(result).toEqual({
      ok: false,
      reason: 'illegal',
      code: ErrorCode.DEAL_NOT_DELIVERED,
    });
    expect(recorded.rows).toHaveLength(0);
  });
});

// -- Existence and the note -------------------------------------------------

describe('the existence check and the note', () => {
  it('refuses a deal that does not exist, before any path runs', async () => {
    const { deps, recorded } = makeDeps({ deal: null });

    const result = await resolve(deps);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(recorded.pays).toHaveLength(0);
    expect(recorded.refunds).toHaveLength(0);
    expect(recorded.transitions).toHaveLength(0);
    expect(recorded.rows).toHaveLength(0);
  });

  it('records the note in the audit detail', async () => {
    const { deps, recorded } = makeDeps();

    await resolve(deps, {
      resolution: 'release',
      note: 'Brand never disputed.',
    });

    expect(auditRow(recorded)?.detail).toMatchObject({
      note: 'Brand never disputed.',
    });
  });
});

// -- The schema -------------------------------------------------------------

describe('resolveDisputeSchema', () => {
  it('accepts all three resolutions with a note', () => {
    for (const resolution of ['release', 'refund', 'revision'] as const) {
      expect(
        resolveDisputeSchema.parse({ resolution, note: 'Resolved.' })
      ).toEqual({ resolution, note: 'Resolved.' });
    }
  });

  it('rejects an empty note — resolves nothing (AC-5)', () => {
    for (const note of ['', '   ']) {
      expect(() =>
        resolveDisputeSchema.parse({ resolution: 'release', note })
      ).toThrow();
    }
  });

  it('rejects an unknown resolution', () => {
    expect(() =>
      resolveDisputeSchema.parse({ resolution: 'delete', note: 'x' })
    ).toThrow();
  });

  it('bounds the note to the audit cap', () => {
    expect(
      resolveDisputeSchema.parse({
        resolution: 'refund',
        note: 'x'.repeat(MAX_RESOLUTION_NOTE_LENGTH),
      }).note
    ).toHaveLength(MAX_RESOLUTION_NOTE_LENGTH);
    expect(() =>
      resolveDisputeSchema.parse({
        resolution: 'refund',
        note: 'x'.repeat(MAX_RESOLUTION_NOTE_LENGTH + 1),
      })
    ).toThrow();
  });

  it('rejects unknown keys instead of stripping them', () => {
    expect(() =>
      resolveDisputeSchema.parse({
        resolution: 'refund',
        note: 'x',
        resoultion: 'release',
      })
    ).toThrow();
  });
});

// -- The endpoint -----------------------------------------------------------

const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleResolveDispute } =
  await import('../app/api/admin/deals/[id]/resolve/route');

describe('POST /api/admin/deals/[id]/resolve', () => {
  beforeEach(() => {
    guardMock.mockReset();
    guardMock.mockResolvedValue({
      user: ADMIN_USER,
      brandProfileId: null,
      creatorProfileId: null,
    });
  });

  function post(body: unknown, id = DEAL_ID): Request {
    return new Request(`http://localhost/api/admin/deals/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  it('gates on role admin before the body is read', async () => {
    const { deps, recorded } = makeDeps();
    guardMock.mockRejectedValueOnce(new ForbiddenError('not an admin'));

    const response = await handleResolveDispute(
      post({ resolution: 'release', note: 'x' }),
      DEAL_ID,
      { resolveDisputeDeps: deps }
    );

    expect(response.status).toBe(403);
    expect(guardMock).toHaveBeenCalledWith({ roles: ['admin'] });
    expect(recorded.loads).toHaveLength(0);
  });

  it('returns 200 with the resolution and the release figures', async () => {
    const { deps } = makeDeps();

    const response = await handleResolveDispute(
      post({ resolution: 'release', note: 'Creator wins.' }),
      DEAL_ID,
      { resolveDisputeDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      deal_id: DEAL_ID,
      status: 'completed',
      resolution: 'release',
      payout: 85_000,
      commission: 15_000,
    });
  });

  it('refuses an empty or whitespace note with 422', async () => {
    for (const note of ['', '   ']) {
      const { deps, recorded } = makeDeps();
      const response = await handleResolveDispute(
        post({ resolution: 'refund', note }),
        DEAL_ID,
        { resolveDisputeDeps: deps }
      );
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(recorded.loads).toHaveLength(0);
    }
  });

  it('refuses a body that is not JSON at all', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleResolveDispute(post('not json'), DEAL_ID, {
      resolveDisputeDeps: deps,
    });

    expect(response.status).toBe(422);
    expect(recorded.loads).toHaveLength(0);
  });

  it('answers a malformed id with 404, never a database error', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleResolveDispute(
      post({ resolution: 'refund', note: 'x' }, 'not-a-uuid'),
      'not-a-uuid',
      { resolveDisputeDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND);
    expect(recorded.loads).toHaveLength(0);
  });

  it('answers a missing deal with 404 for an admin', async () => {
    const { deps } = makeDeps({ deal: null });

    const response = await handleResolveDispute(
      post({ resolution: 'release', note: 'x' }),
      DEAL_ID,
      { resolveDisputeDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('maps an illegal resolution to the machine code (409)', async () => {
    const { deps } = makeDeps({
      failPay: new LedgerError('not delivered', ErrorCode.DEAL_NOT_DELIVERED),
    });

    const response = await handleResolveDispute(
      post({ resolution: 'release', note: 'x' }),
      DEAL_ID,
      { resolveDisputeDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.DEAL_NOT_DELIVERED);
  });

  it('maps a provider failure to PAYMENT_FAILED', async () => {
    const { deps } = makeDeps({
      failPay: new PaymentError('processor down', 'PROVIDER_UNAVAILABLE'),
    });

    const response = await handleResolveDispute(
      post({ resolution: 'release', note: 'x' }),
      DEAL_ID,
      { resolveDisputeDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error.code).toBe(ErrorCode.PAYMENT_FAILED);
  });

  it('runs on the Node runtime, because pg cannot run on the edge', () => {
    expect(
      readFileSync('app/api/admin/deals/[id]/resolve/route.ts', 'utf8')
    ).toContain("export const runtime = 'nodejs'");
  });
});
