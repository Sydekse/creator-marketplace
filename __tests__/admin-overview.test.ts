import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCampaignLedgerForAdmin,
  listCampaignsForAdmin,
  listDisputedDealsForAdmin,
} from '../lib/admin/overview';
import type {
  AdminCampaignOverview,
  AdminDisputeRow,
  AdminLedgerEntry,
  AdminOverviewDeps,
} from '../lib/admin/overview';

import type { DealHistoryDeps } from '../lib/deals/queries';
import { ForbiddenError } from '../lib/authz';

import { ErrorCode } from '../lib/validation';

/**
 * KAN-53 — the admin overview: campaigns with held/spent totals, a campaign's
 * ledger with a reconciliation answer, the disputed-deals worklist, and deal
 * history (US-010, Tech Spec §4.6, §3.2 `ledger_entry`).
 *
 * The load-bearing claims:
 *
 * **The gate lives inside the module, and the routes run it again.** Every
 * read here awaits `requireAdmin` before touching its data — a read protected
 * only by its callers is protected as well as its least careful caller — and
 * each route gates first too, the double-check the audit-log route keeps.
 * The tests prove the gate runs *before* the data seam for each function.
 *
 * **The money figures are ledger-derived.** `held` is `sum(amount)`, the same
 * definition `sumEscrowedByCampaign` guards (invariant 7); `paidOut`,
 * `commission`, and `refunded` are the three ways money left escrow. The
 * ledger view's `reconciled` is the AC-3 answer: `sum(amount)` equals the
 * stored final `balance_after`, or the chain is corrupt.
 *
 * **The worklist is `REFUNDABLE_FROM` by construction** — exactly what the
 * resolve endpoint can act on, so the worklist and the mutation agree.
 *
 * **Deal history is reused, not reimplemented.** `getDealHistory` already
 * serves the admin; the endpoint wraps it with an admin-first gate.
 */

// -- Fixtures ---------------------------------------------------------------

// Valid UUIDs: the module and the routes shape-check ids before use, and a
// non-UUID would be refused before the fake seams ever run.
const CAMPAIGN_ID = '00000000-0000-4000-8000-000000000001';
const DEAL_ID = '00000000-0000-4000-8000-000000000002';
const MISSING_CAMPAIGN_ID = '00000000-0000-4000-8000-0000000000ff';

const CAMPAIGNS: AdminCampaignOverview[] = [
  {
    id: CAMPAIGN_ID,
    name: 'Summer launch',
    status: 'funded',
    budget: 500_000,
    held: 400_000,
    paidOut: 85_000,
    commission: 15_000,
    refunded: 0,
  },
];

/** A fully reconciled ledger: hold → payout+commission → 0, sums agree. */
const RECONCILED_ENTRIES: AdminLedgerEntry[] = [
  {
    id: 'e1',
    entryType: 'hold',
    amount: 300_000,
    balanceAfter: 300_000,
    providerRef: 'p1',
    createdAt: new Date('2026-08-01'),
  },
  {
    id: 'e2',
    entryType: 'release_payout',
    amount: -255_000,
    balanceAfter: 45_000,
    providerRef: 'p1',
    createdAt: new Date('2026-08-02'),
  },
  {
    id: 'e3',
    entryType: 'commission',
    amount: -45_000,
    balanceAfter: 0,
    providerRef: 'p1',
    createdAt: new Date('2026-08-02'),
  },
];

const DISPUTES: AdminDisputeRow[] = [
  {
    id: DEAL_ID,
    status: 'funded',
    totalPrice: 100_000,
    videoCount: 1,
    campaignId: CAMPAIGN_ID,
    campaignName: 'Summer launch',
    brandCompanyName: 'Acme',
    creatorHandle: '@selam',
    createdAt: new Date('2026-08-01'),
  },
];

function makeDeps(
  overrides: {
    campaign?: {
      id: string;
      name: string;
      status: string;
      budget: number;
    } | null;
    entries?: AdminLedgerEntry[];
    failAdmin?: boolean;
  } = {}
): {
  deps: AdminOverviewDeps;
  calls: string[];
} {
  const calls: string[] = [];
  const deps: AdminOverviewDeps = {
    requireAdmin: async () => {
      calls.push('requireAdmin');
      if (overrides.failAdmin) throw new ForbiddenError('not an admin');
    },
    listCampaigns: async () => {
      calls.push('listCampaigns');
      return CAMPAIGNS;
    },
    getCampaign: async () => {
      calls.push('getCampaign');
      // `undefined` means "no override" — an explicit `null` must win so a
      // missing-campaign test can make the seam answer `null`.
      const campaign = overrides.campaign;
      return (
        campaign === undefined
          ? {
              id: CAMPAIGN_ID,
              name: 'Summer launch',
              status: 'funded',
              budget: 500_000,
            }
          : campaign
      ) as AdminOverviewDeps['getCampaign'] extends (
        id: string
      ) => Promise<infer R>
        ? R
        : never;
    },
    ledgerFor: async () => {
      calls.push('ledgerFor');
      return overrides.entries ?? RECONCILED_ENTRIES;
    },
    listDisputes: async () => {
      calls.push('listDisputes');
      return DISPUTES;
    },
  };
  return { deps, calls };
}

// -- The module gate --------------------------------------------------------

describe('the admin gate lives inside the module', () => {
  it('listCampaignsForAdmin gates before listing', async () => {
    const { deps, calls } = makeDeps();

    const result = await listCampaignsForAdmin(deps);

    expect(result).toEqual(CAMPAIGNS);
    expect(calls).toEqual(['requireAdmin', 'listCampaigns']);
  });

  it('listDisputedDealsForAdmin gates before listing', async () => {
    const { deps, calls } = makeDeps();

    const result = await listDisputedDealsForAdmin(deps);

    expect(result).toEqual(DISPUTES);
    expect(calls).toEqual(['requireAdmin', 'listDisputes']);
  });

  it('getCampaignLedgerForAdmin gates before reading', async () => {
    const { deps, calls } = makeDeps();

    await getCampaignLedgerForAdmin(CAMPAIGN_ID, deps);

    expect(calls.slice(0, 2)).toEqual(['requireAdmin', 'getCampaign']);
  });

  it('refuses a malformed id before the gate — never a database error', async () => {
    const { deps, calls } = makeDeps();

    await expect(getCampaignLedgerForAdmin('not-a-uuid', deps)).rejects.toThrow(
      ForbiddenError
    );
    expect(calls).toEqual([]);
  });

  it('a denied caller never reaches the data seams', async () => {
    const { deps, calls } = makeDeps({ failAdmin: true });

    await expect(listCampaignsForAdmin(deps)).rejects.toThrow(ForbiddenError);
    await expect(listDisputedDealsForAdmin(deps)).rejects.toThrow(
      ForbiddenError
    );
    expect(calls).toEqual(['requireAdmin', 'requireAdmin']);
  });
});

// -- The ledger view --------------------------------------------------------

describe('getCampaignLedgerForAdmin', () => {
  it('returns the campaign, ordered entries, and reconciled totals', async () => {
    const { deps } = makeDeps();

    const result = await getCampaignLedgerForAdmin(CAMPAIGN_ID, deps);

    expect(result?.campaign).toEqual({
      id: CAMPAIGN_ID,
      name: 'Summer launch',
      status: 'funded',
      budget: 500_000,
    });
    expect(result?.entries).toEqual(RECONCILED_ENTRIES);
    expect(result?.totals).toEqual({
      held: 0,
      paidOut: 255_000,
      commission: 45_000,
      refunded: 0,
    });
    // sum(amount) = 0 equals the final balance_after — the AC-3 answer.
    expect(result?.reconciled).toBe(true);
  });

  it('reports held as the signed sum across entry types', async () => {
    const entries: AdminLedgerEntry[] = [
      {
        id: 'a',
        entryType: 'hold',
        amount: 300_000,
        balanceAfter: 300_000,
        providerRef: null,
        createdAt: new Date(),
      },
      {
        id: 'b',
        entryType: 'refund',
        amount: -300_000,
        balanceAfter: 0,
        providerRef: null,
        createdAt: new Date(),
      },
    ];
    const { deps } = makeDeps({ entries });

    const result = await getCampaignLedgerForAdmin(CAMPAIGN_ID, deps);

    expect(result?.totals).toEqual({
      held: 0,
      paidOut: 0,
      commission: 0,
      refunded: 300_000,
    });
    expect(result?.reconciled).toBe(true);
  });

  it('flags a ledger whose running balance disagrees with its entries', async () => {
    // Corrupted chain: the stored balance says 10_000 but the entries sum to 0.
    const entries: AdminLedgerEntry[] = [
      {
        id: 'a',
        entryType: 'hold',
        amount: 100_000,
        balanceAfter: 100_000,
        providerRef: null,
        createdAt: new Date(),
      },
      {
        id: 'b',
        entryType: 'release_payout',
        amount: -100_000,
        balanceAfter: 10_000,
        providerRef: null,
        createdAt: new Date(),
      },
    ];
    const { deps } = makeDeps({ entries });

    const result = await getCampaignLedgerForAdmin(CAMPAIGN_ID, deps);

    expect(result?.reconciled).toBe(false);
  });

  it('returns null for a campaign that does not exist', async () => {
    const { deps } = makeDeps({ campaign: null });

    const result = await getCampaignLedgerForAdmin(MISSING_CAMPAIGN_ID, deps);

    expect(result).toBeNull();
  });

  it('treats an empty ledger as reconciled at zero', async () => {
    const { deps } = makeDeps({ entries: [] });

    const result = await getCampaignLedgerForAdmin(CAMPAIGN_ID, deps);

    expect(result?.totals).toEqual({
      held: 0,
      paidOut: 0,
      commission: 0,
      refunded: 0,
    });
    expect(result?.reconciled).toBe(true);
  });
});

// -- The worklist definition ------------------------------------------------

describe('the disputed worklist', () => {
  it('is served read-only with the names an operator recognises', async () => {
    const { deps } = makeDeps();

    const result = await listDisputedDealsForAdmin(deps);

    expect(result[0]).toMatchObject({
      id: DEAL_ID,
      status: 'funded',
      campaignName: 'Summer launch',
      brandCompanyName: 'Acme',
      creatorHandle: '@selam',
    });
  });

  it('defines the set from the ledger, never a typed-out list', async () => {
    // The query filters on `REFUNDABLE_FROM` imported from the ledger — a
    // source-guard mirror of the state-machine/ledger agreement tests.
    const { readFileSync } = await import('fs');
    const source = readFileSync('lib/admin/overview.ts', 'utf8');
    expect(source).toContain('REFUNDABLE_FROM');
    expect(source).toContain('inArray(deal.status, REFUNDABLE_FROM)');
  });
});

// -- AC-5: read-only by construction -----------------------------------------

describe('the admin views are read-only (AC-5)', () => {
  it('contains no write primitives anywhere in the read path', async () => {
    // Mutations live in the audited verify/resolve stories; these views must
    // never grow a write. AC-5 is structural, so the test pins the absence
    // that makes it hold — the mirror of the `REFUNDABLE_FROM` guard above.
    const { readFileSync } = await import('fs');
    const files = [
      'lib/admin/overview.ts',
      'app/api/admin/campaigns/route.ts',
      'app/api/admin/campaigns/[id]/ledger/route.ts',
      'app/api/admin/disputes/route.ts',
      'app/api/admin/deals/[id]/history/route.ts',
    ];
    const writePrimitives = [
      '.insert(',
      '.update(',
      '.delete(',
      'db.transaction',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const primitive of writePrimitives) {
        expect(source, `${file} must not contain ${primitive}`).not.toContain(
          primitive
        );
      }
    }
  });
});

// -- The endpoints ----------------------------------------------------------

const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleListCampaigns } =
  await import('../app/api/admin/campaigns/route');
const { handleCampaignLedger } =
  await import('../app/api/admin/campaigns/[id]/ledger/route');
const { handleListDisputes } = await import('../app/api/admin/disputes/route');
const { handleDealHistory } =
  await import('../app/api/admin/deals/[id]/history/route');

describe('GET /api/admin/campaigns', () => {
  beforeEach(() => {
    guardMock.mockReset();
    guardMock.mockResolvedValue({
      user: { id: 'admin', role: 'admin' },
      brandProfileId: null,
      creatorProfileId: null,
    });
  });

  it('gates on admin and returns the campaign list', async () => {
    const { deps } = makeDeps();

    const response = await handleListCampaigns({ overviewDeps: deps });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.campaigns).toEqual(CAMPAIGNS);
    expect(guardMock).toHaveBeenCalledWith({ roles: ['admin'] });
  });

  it('returns 403 for a non-admin', async () => {
    guardMock.mockRejectedValueOnce(new ForbiddenError('not an admin'));
    const { deps } = makeDeps();

    const response = await handleListCampaigns({ overviewDeps: deps });

    expect(response.status).toBe(403);
  });
});

describe('GET /api/admin/campaigns/[id]/ledger', () => {
  beforeEach(() => {
    guardMock.mockReset();
    guardMock.mockResolvedValue({
      user: { id: 'admin', role: 'admin' },
      brandProfileId: null,
      creatorProfileId: null,
    });
  });

  it('returns the ledger with its reconciliation answer', async () => {
    const { deps } = makeDeps();

    const response = await handleCampaignLedger(CAMPAIGN_ID, {
      overviewDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.campaign.id).toBe(CAMPAIGN_ID);
    expect(body.entries).toHaveLength(3);
    expect(body.totals.paidOut).toBe(255_000);
    expect(body.reconciled).toBe(true);
  });

  it('answers a malformed id with 404, never a database error', async () => {
    const { deps, calls } = makeDeps();

    const response = await handleCampaignLedger('not-a-uuid', {
      overviewDeps: deps,
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe(ErrorCode.NOT_FOUND);
    expect(calls).toEqual([]);
  });

  it('answers a missing campaign with 404', async () => {
    const { deps } = makeDeps({ campaign: null });

    const response = await handleCampaignLedger(MISSING_CAMPAIGN_ID, {
      overviewDeps: deps,
    });

    expect(response.status).toBe(404);
  });
});

describe('GET /api/admin/disputes', () => {
  beforeEach(() => {
    guardMock.mockReset();
    guardMock.mockResolvedValue({
      user: { id: 'admin', role: 'admin' },
      brandProfileId: null,
      creatorProfileId: null,
    });
  });

  it('returns the disputed-deals worklist', async () => {
    const { deps } = makeDeps();

    const response = await handleListDisputes({ overviewDeps: deps });
    const body = await response.json();

    expect(response.status).toBe(200);
    // Through `Response.json` the fixture's `Date` becomes its ISO string.
    expect(body.deals).toEqual(
      DISPUTES.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))
    );
  });
});

describe('GET /api/admin/deals/[id]/history', () => {
  beforeEach(() => {
    guardMock.mockReset();
    guardMock.mockResolvedValue({
      user: { id: 'admin', role: 'admin' },
      brandProfileId: null,
      creatorProfileId: null,
    });
  });

  const EVENTS = [
    {
      id: 'ev-1',
      fromStatus: null,
      toStatus: 'pending',
      reason: null,
      createdAt: new Date('2026-08-01'),
      actor: null,
    },
  ];

  it('wraps getDealHistory with the admin gate', async () => {
    const select = vi.fn(async () => EVENTS);
    const response = await handleDealHistory(DEAL_ID, {
      dealHistoryDeps: {
        requireAccess: vi.fn(),
        select,
      } as unknown as DealHistoryDeps,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    // `createdAt` is a `Date` in the module and its ISO string over the wire.
    expect(body.events).toEqual(
      EVENTS.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))
    );
    expect(select).toHaveBeenCalledWith(DEAL_ID);
  });

  it('answers a malformed id with 404', async () => {
    const response = await handleDealHistory('not-a-uuid');

    expect(response.status).toBe(404);
  });
});
