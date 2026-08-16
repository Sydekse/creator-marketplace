import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setDealFlagged } from '../lib/deals/flag-deal';
import type { FlagDealDeps } from '../lib/deals/flag-deal';
import type { DealStatus } from '../db/schema';
import { ForbiddenError } from '../lib/authz';
import type { Tx } from '../lib/authz';
import { ErrorCode } from '../lib/validation';

/**
 * KAN-69 (F40) — the admin flag mutation: `POST /api/admin/deals/{id}/flag`.
 *
 * The load-bearing claims:
 *
 * **The flag is attention metadata, not a status.** The state machine's
 * statuses drive legal transitions and AC-9's terminal guarantee; a boolean
 * column is additive, so nothing in the machine has to know it exists. The
 * resolve endpoint clears it in the same transaction as the resolution (the
 * resolve suite asserts that) — this suite asserts the setter's side.
 *
 * **Every admin action is audited (AC-031).** `withAdminAudit` gates the role
 * inside the module and writes `deal.flag` in the same transaction as the
 * flag — an unlogged flag cannot exist.
 *
 * **Missing and malformed ids are the admin route's 404.** The route
 * shape-checks before the module runs (never a Postgres `22P02` → 500), and
 * the module answers `null` for a missing deal.
 */

const ADMIN_USER = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin' as const,
};
const DEAL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function makeDeps(overrides: { deal?: { status: DealStatus } | null } = {}) {
  const rows: Record<string, unknown>[] = [];
  const setFlags: Array<{ dealId: string; flagged: boolean }> = [];

  // The one transaction: the audit row (withAdminAudit) and the flag update
  // (setFlag) must share it. The module's real `setFlag` drives `tx.update`;
  // the fake records through the same object to prove the sharing.
  const fakeTx = {
    insert: vi.fn(() => ({
      values: vi.fn(async (row: Record<string, unknown>) => {
        rows.push(row);
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => Promise.resolve()) })),
    })),
  } as unknown as Tx;

  const deps: FlagDealDeps = {
    loadDeal: async () =>
      overrides.deal === undefined
        ? { status: 'delivered' as DealStatus }
        : overrides.deal,
    setFlag: async (tx, dealId, flagged) => {
      setFlags.push({ dealId, flagged });
      await tx
        .update(null as never)
        .set({ flagged })
        .where(null as never);
    },
    adminAuditDeps: {
      getCurrentUser: async () => ADMIN_USER,
      loadProfileIds: async () => ({
        brandProfileId: null,
        creatorProfileId: null,
      }),
      loadOwnerRefs: async () => null,
      transaction: (fn) => fn(fakeTx),
    },
  };

  return { deps, rows, setFlags };
}

// -- The module -------------------------------------------------------------

describe('setDealFlagged', () => {
  it('flags a deal and writes the audited record in the same transaction', async () => {
    const { deps, rows, setFlags } = makeDeps();

    const result = await setDealFlagged(DEAL_ID, { flagged: true }, deps);

    expect(result).toEqual({ id: DEAL_ID, flagged: true, status: 'delivered' });
    expect(setFlags).toEqual([{ dealId: DEAL_ID, flagged: true }]);
    const audit = rows.find((r) => r.action === 'deal.flag');
    expect(audit).toMatchObject({
      actorId: ADMIN_USER.id,
      action: 'deal.flag',
      targetType: 'deal',
      targetId: DEAL_ID,
    });
    expect(audit?.detail).toMatchObject({
      flagged: true,
      status: 'delivered',
    });
  });

  it('unflags a deal', async () => {
    const { deps, setFlags } = makeDeps();

    const result = await setDealFlagged(DEAL_ID, { flagged: false }, deps);

    expect(result).toEqual({
      id: DEAL_ID,
      flagged: false,
      status: 'delivered',
    });
    expect(setFlags).toEqual([{ dealId: DEAL_ID, flagged: false }]);
  });

  it('records the admin note in the audit detail', async () => {
    const { deps, rows } = makeDeps();

    await setDealFlagged(
      DEAL_ID,
      { flagged: true, note: 'Brand raised the dispute by phone.' },
      deps
    );

    const audit = rows.find((r) => r.action === 'deal.flag');
    expect(audit?.detail).toMatchObject({
      note: 'Brand raised the dispute by phone.',
    });
  });

  it('returns null for a deal that does not exist, before any write', async () => {
    const { deps, rows, setFlags } = makeDeps({ deal: null });

    const result = await setDealFlagged(DEAL_ID, { flagged: true }, deps);

    expect(result).toBeNull();
    expect(setFlags).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });
});

// -- The endpoint -----------------------------------------------------------

const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleFlagDeal } =
  await import('../app/api/admin/deals/[id]/flag/route');

describe('POST /api/admin/deals/[id]/flag', () => {
  beforeEach(() => {
    guardMock.mockReset();
    guardMock.mockResolvedValue({
      user: ADMIN_USER,
      brandProfileId: null,
      creatorProfileId: null,
    });
  });

  function post(body: unknown, id = DEAL_ID): Request {
    return new Request(`http://localhost/api/admin/deals/${id}/flag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  it('gates on role admin before the body is read', async () => {
    const { deps } = makeDeps();
    guardMock.mockRejectedValueOnce(new ForbiddenError('not an admin'));

    const response = await handleFlagDeal(DEAL_ID, post({ flagged: true }), {
      flagDeps: deps,
    });

    expect(response.status).toBe(403);
    expect(guardMock).toHaveBeenCalledWith({ roles: ['admin'] });
  });

  it('flags a deal and returns the new state', async () => {
    const { deps } = makeDeps();

    const response = await handleFlagDeal(
      DEAL_ID,
      post({ flagged: true, note: 'Awaiting brand evidence.' }),
      { flagDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      deal_id: DEAL_ID,
      flagged: true,
      status: 'delivered',
    });
  });

  it('answers a malformed id with 404, never a database error', async () => {
    const { deps } = makeDeps();

    const response = await handleFlagDeal(
      'not-a-uuid',
      post({ flagged: true }),
      { flagDeps: deps }
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('answers a missing deal with 404', async () => {
    const { deps } = makeDeps({ deal: null });

    const response = await handleFlagDeal(DEAL_ID, post({ flagged: true }), {
      flagDeps: deps,
    });

    expect(response.status).toBe(404);
  });

  it('refuses a body without the flagged field with 422', async () => {
    const { deps } = makeDeps();

    const response = await handleFlagDeal(DEAL_ID, post({}), {
      flagDeps: deps,
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('refuses a body that is not JSON at all', async () => {
    const { deps } = makeDeps();

    const response = await handleFlagDeal(DEAL_ID, post('not json', DEAL_ID), {
      flagDeps: deps,
    });

    expect(response.status).toBe(422);
  });
});
