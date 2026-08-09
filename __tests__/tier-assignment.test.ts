import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  assignTier,
  selectTier,
  tierOutcomeToResponse,
} from '../lib/creators/tier-assignment';
import type {
  AssignTierDeps,
  TierCandidate,
} from '../lib/creators/tier-assignment';
import {
  countAwaitingTier,
  readAwaitingTier,
  type AwaitingTierCreator,
  type AwaitingTierDeps,
} from '../lib/creators/awaiting-tier';
import { isBookable } from '../lib/creators/queries';
import {
  handleAssignTier,
  type AssignTierRouteDeps,
} from '../app/api/admin/creators/[id]/assign-tier/route';
import { ForbiddenError } from '../lib/authz';
import type { AdminAuditDeps, Tx } from '../lib/authz';
import type { CurrentUser } from '../lib/auth';
import { AUDIT_ACTIONS, AUDIT_ACTION_TARGET } from '../lib/audit/actions';
import { ErrorCode, ErrorHttpStatus } from '../lib/validation';
import { PAGE_SIZE } from '../lib/paging';

/**
 * KAN-23 — tier assignment (AC-004, AC-006, FR-002, Tech Spec §5).
 *
 * The ladders here are invented, never imported from `lib/config/pricing.ts`.
 * Q2 is open: the real bands are provisional and will move, and a suite that
 * asserted against them would fail on a pricing decision rather than on a
 * regression.
 */

const ADMIN_USER: CurrentUser = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
};

function tier(overrides: Partial<TierCandidate> = {}): TierCandidate {
  return {
    id: 'tier-x',
    name: 'X',
    pricePerVideo: 100_000,
    minFollowers: 0,
    minEngagement: null,
    active: true,
    ...overrides,
  };
}

/** Three inclusive bands, the shape the seed uses. */
const LADDER: TierCandidate[] = [
  tier({
    id: 'tier-micro',
    name: 'Micro',
    pricePerVideo: 150_000,
    minFollowers: 10_000,
    minEngagement: '2.00',
  }),
  tier({
    id: 'tier-mid',
    name: 'Mid',
    pricePerVideo: 400_000,
    minFollowers: 100_000,
    minEngagement: '2.50',
  }),
  tier({
    id: 'tier-macro',
    name: 'Macro',
    pricePerVideo: 900_000,
    minFollowers: 500_000,
    minEngagement: '3.00',
  }),
];

// -- The rule ---------------------------------------------------------------

describe('selectTier', () => {
  it('assigns the tier a creator exactly qualifies for', () => {
    expect(
      selectTier(LADDER, { followerCount: 25_000, engagementRate: '3.50' })
    ).toEqual({
      assigned: true,
      tierId: 'tier-micro',
      tierName: 'Micro',
      pricePerVideo: 150_000,
    });
  });

  it('picks the highest tier when several qualify', () => {
    // Clears all three floors — the ticket says highest, not first match.
    const outcome = selectTier(LADDER, {
      followerCount: 900_000,
      engagementRate: '6.00',
    });

    expect(outcome).toMatchObject({ assigned: true, tierName: 'Macro' });
  });

  it('is capped by whichever threshold the creator misses', () => {
    // Macro follower count, Mid engagement — engagement is the binding
    // constraint, so Mid is the answer. Both thresholds have to be met, and a
    // rule that ORed them would say Macro here.
    const outcome = selectTier(LADDER, {
      followerCount: 900_000,
      engagementRate: '2.50',
    });

    expect(outcome).toMatchObject({ assigned: true, tierName: 'Mid' });
  });

  it('treats both thresholds as inclusive floors', () => {
    const outcome = selectTier(LADDER, {
      followerCount: 100_000,
      engagementRate: '2.50',
    });

    expect(outcome).toMatchObject({ assigned: true, tierName: 'Mid' });
  });

  it('excludes a creator one follower below the floor', () => {
    const outcome = selectTier(LADDER, {
      followerCount: 99_999,
      engagementRate: '2.50',
    });

    expect(outcome).toMatchObject({ assigned: true, tierName: 'Micro' });
  });

  it('compares engagement numerically, not as strings', () => {
    // The trap this exists for: `'3.50' > '10.00'` is true under string
    // comparison, and Drizzle hands `numeric` back as a string. A 3.5% creator
    // must not clear a 10% floor.
    const strict = [
      tier({
        id: 't',
        name: 'Strict',
        minFollowers: 0,
        minEngagement: '10.00',
      }),
    ];

    expect(
      selectTier(strict, { followerCount: 50_000, engagementRate: '3.50' })
    ).toEqual({ assigned: false, reason: 'no_matching_tier' });
  });

  it('compares fractional engagement at basis-point precision', () => {
    const strict = [
      tier({ id: 't', name: 'Strict', minFollowers: 0, minEngagement: '2.05' }),
    ];

    expect(
      selectTier(strict, { followerCount: 50_000, engagementRate: '2.04' })
    ).toMatchObject({ assigned: false });
    expect(
      selectTier(strict, { followerCount: 50_000, engagementRate: '2.05' })
    ).toMatchObject({ assigned: true });
  });

  it('ignores inactive tiers', () => {
    const ladder = [
      ...LADDER,
      tier({
        id: 'tier-retired',
        name: 'Retired',
        pricePerVideo: 5_000_000,
        minFollowers: 1_000,
        minEngagement: '1.00',
        active: false,
      }),
    ];

    // The retired band has the highest price and the lowest floors, so it would
    // win on every tiebreak if `active` were not checked first.
    const outcome = selectTier(ladder, {
      followerCount: 900_000,
      engagementRate: '6.00',
    });

    expect(outcome).toMatchObject({ assigned: true, tierName: 'Macro' });
  });

  it('treats a null minEngagement as no engagement floor', () => {
    // Nullable column, so this is a legal row and must not be skipped.
    const ladder = [
      tier({ id: 'tier-open', name: 'Open', minFollowers: 1_000 }),
    ];

    expect(
      selectTier(ladder, { followerCount: 5_000, engagementRate: '0.10' })
    ).toMatchObject({ assigned: true, tierName: 'Open' });
  });

  it('denies rather than admits when a threshold is unparseable', () => {
    // A tier nobody can be priced into shows up on /admin/tiers; a tier
    // everybody matches silently mis-prices the marketplace.
    const ladder = [
      tier({ id: 'tier-broken', name: 'Broken', minEngagement: 'n/a' }),
    ];

    expect(
      selectTier(ladder, { followerCount: 900_000, engagementRate: '9.00' })
    ).toEqual({ assigned: false, reason: 'no_matching_tier' });
  });

  describe('AC-006 — missing or unusable data assigns nothing', () => {
    // A zero-threshold tier is present in every case: if the missing-data check
    // did not run first, these creators would all match it.
    const permissive = [tier({ id: 'tier-any', name: 'Any', minFollowers: 0 })];

    it.each([
      ['null follower count', { followerCount: null, engagementRate: '4.00' }],
      ['null engagement rate', { followerCount: 50_000, engagementRate: null }],
      ['both null', { followerCount: null, engagementRate: null }],
      [
        'empty engagement string',
        { followerCount: 50_000, engagementRate: '' },
      ],
      [
        'non-numeric engagement',
        { followerCount: 50_000, engagementRate: 'high' },
      ],
      [
        'negative follower count',
        { followerCount: -1, engagementRate: '4.00' },
      ],
      [
        'negative engagement',
        { followerCount: 50_000, engagementRate: '-2.00' },
      ],
      [
        'non-finite follower count',
        { followerCount: Number.NaN, engagementRate: '4.00' },
      ],
    ])('%s → missing_data', (_label, profile) => {
      expect(selectTier(permissive, profile)).toEqual({
        assigned: false,
        reason: 'missing_data',
      });
    });
  });

  it('distinguishes "no data" from "below every band"', () => {
    // Same non-assignment, different admin action: one is a data problem, the
    // other is a pricing problem.
    expect(
      selectTier(LADDER, { followerCount: null, engagementRate: null })
    ).toMatchObject({ reason: 'missing_data' });
    expect(
      selectTier(LADDER, { followerCount: 200, engagementRate: '1.00' })
    ).toMatchObject({ reason: 'no_matching_tier' });
  });

  it('returns no_matching_tier against an empty ladder', () => {
    expect(
      selectTier([], { followerCount: 900_000, engagementRate: '9.00' })
    ).toEqual({ assigned: false, reason: 'no_matching_tier' });
  });

  it('breaks a follower-floor tie deterministically, whatever the row order', () => {
    // Two bands on the same floor: highest price wins, and it must not depend
    // on the order Postgres returned the rows in.
    const a = tier({
      id: 'tier-a',
      name: 'A',
      pricePerVideo: 200_000,
      minFollowers: 10_000,
    });
    const b = tier({
      id: 'tier-b',
      name: 'B',
      pricePerVideo: 300_000,
      minFollowers: 10_000,
    });
    const profile = { followerCount: 20_000, engagementRate: '5.00' };

    expect(selectTier([a, b], profile)).toMatchObject({ tierId: 'tier-b' });
    expect(selectTier([b, a], profile)).toMatchObject({ tierId: 'tier-b' });
  });

  it('breaks a price tie by name, whatever the row order', () => {
    const a = tier({ id: 'tier-a', name: 'Alpha', minFollowers: 10_000 });
    const b = tier({ id: 'tier-b', name: 'Beta', minFollowers: 10_000 });
    const profile = { followerCount: 20_000, engagementRate: '5.00' };

    expect(selectTier([a, b], profile)).toMatchObject({ tierId: 'tier-a' });
    expect(selectTier([b, a], profile)).toMatchObject({ tierId: 'tier-a' });
  });

  it('never returns more than one tier', () => {
    // AC-3 in its structural form: the return type holds a single id, so this
    // asserts the shape rather than a count.
    const outcome = selectTier(LADDER, {
      followerCount: 900_000,
      engagementRate: '9.00',
    });

    expect(outcome.assigned).toBe(true);
    expect(Object.keys(outcome)).toEqual([
      'assigned',
      'tierId',
      'tierName',
      'pricePerVideo',
    ]);
  });

  it('is idempotent — same inputs, same answer', () => {
    const profile = { followerCount: 120_000, engagementRate: '2.75' };

    expect(selectTier(LADDER, profile)).toEqual(selectTier(LADDER, profile));
  });

  it('does not mutate the ladder it is given', () => {
    // It sorts, and sorting in place would reorder the caller's rows.
    const ladder = [...LADDER];
    const order = ladder.map((t) => t.id);

    selectTier(ladder, { followerCount: 900_000, engagementRate: '9.00' });

    expect(ladder.map((t) => t.id)).toEqual(order);
  });
});

// -- Thresholds come from rows, not from this file --------------------------

/**
 * The structural half of AC-6.
 *
 * Every behavioural test above would still pass if the module carried a
 * fallback ladder for the case where `pricing_tier` is empty. Reading the
 * source is the only way to assert that no band exists in the code — mirrors
 * the pre-check guard in `__tests__/creator-onboarding.test.ts`.
 */
describe('tier-assignment.ts hardcodes no thresholds or prices', () => {
  const source = readFileSync(
    fileURLToPath(
      new URL('../lib/creators/tier-assignment.ts', import.meta.url)
    ),
    'utf8'
  );

  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('names no tier', () => {
    expect(code).not.toMatch(/Micro|Mid\b|Macro/);
  });

  it('carries no numeric literal that could be a threshold or a price', () => {
    // Two kinds of number are legitimately here and neither is a band:
    // `100` is the percent→basis-point factor, and 0/±1 are the comparator's
    // return values and its emptiness checks. A follower floor or a santim
    // price cannot hide among those.
    const literals = (code.match(/\d[\d_]*(\.\d+)?/g) ?? []).filter(
      (n) => Number(n.replaceAll('_', '')) > 1 && n !== '100'
    );
    expect(literals).toEqual([]);
  });
});

// -- The write --------------------------------------------------------------

describe('assignTier', () => {
  interface Recorded {
    updates: Record<string, unknown>[];
  }

  function mockTx(): { tx: Tx; recorded: Recorded } {
    const recorded: Recorded = { updates: [] };
    const tx = {
      update: vi.fn(() => ({
        set: vi.fn((values) => {
          recorded.updates.push(values);
          return { where: vi.fn(() => Promise.resolve()) };
        }),
      })),
    } as unknown as Tx;
    return { tx, recorded };
  }

  const deps: AssignTierDeps = { loadTiers: async () => LADDER };

  it('writes tier_id when a band matches', async () => {
    const { tx, recorded } = mockTx();

    const outcome = await assignTier(
      tx,
      { id: 'c-1', followerCount: 120_000, engagementRate: '3.00' },
      deps
    );

    expect(outcome).toMatchObject({ assigned: true, tierName: 'Mid' });
    expect(recorded.updates).toEqual([{ tierId: 'tier-mid' }]);
  });

  it('writes nothing when no band matches (AC-5)', async () => {
    const { tx, recorded } = mockTx();

    const outcome = await assignTier(
      tx,
      { id: 'c-2', followerCount: 500, engagementRate: '1.00' },
      deps
    );

    // Returns the reason instead of throwing: verified-but-unpriceable is a
    // state the marketplace holds, not an error.
    expect(outcome).toEqual({ assigned: false, reason: 'no_matching_tier' });
    expect(recorded.updates).toEqual([]);
  });

  it('writes nothing when the creator has no audience data', async () => {
    const { tx, recorded } = mockTx();

    const outcome = await assignTier(
      tx,
      { id: 'c-3', followerCount: null, engagementRate: null },
      deps
    );

    expect(outcome).toEqual({ assigned: false, reason: 'missing_data' });
    expect(recorded.updates).toEqual([]);
  });

  it('is idempotent — a second run writes the same tier_id (AC-3)', async () => {
    const { tx, recorded } = mockTx();
    const profile = {
      id: 'c-4',
      followerCount: 900_000,
      engagementRate: '9.00',
    };

    const first = await assignTier(tx, profile, deps);
    const second = await assignTier(tx, profile, deps);

    expect(second).toEqual(first);
    expect(recorded.updates).toEqual([
      { tierId: 'tier-macro' },
      { tierId: 'tier-macro' },
    ]);
  });

  it('re-reads the ladder each run, so a newly seeded band takes effect', async () => {
    const { tx } = mockTx();
    const profile = {
      id: 'c-5',
      followerCount: 50_000,
      engagementRate: '9.00',
    };

    const before = await assignTier(tx, profile, {
      loadTiers: async () => LADDER,
    });
    const after = await assignTier(tx, profile, {
      loadTiers: async () => [
        ...LADDER,
        tier({
          id: 'tier-new',
          name: 'New',
          pricePerVideo: 250_000,
          minFollowers: 40_000,
          minEngagement: '5.00',
        }),
      ],
    });

    expect(before).toMatchObject({ tierName: 'Micro' });
    expect(after).toMatchObject({ tierName: 'New' });
  });
});

// -- Response mapping -------------------------------------------------------

describe('tierOutcomeToResponse', () => {
  it('maps null through unchanged (rejection never tried)', () => {
    expect(tierOutcomeToResponse(null)).toBeNull();
  });

  it('renders an assignment in snake_case', () => {
    expect(
      tierOutcomeToResponse({
        assigned: true,
        tierId: 'tier-mid',
        tierName: 'Mid',
        pricePerVideo: 400_000,
      })
    ).toEqual({
      assigned: true,
      id: 'tier-mid',
      name: 'Mid',
      price_per_video: 400_000,
    });
  });

  it('renders a skip with its reason', () => {
    expect(
      tierOutcomeToResponse({ assigned: false, reason: 'missing_data' })
    ).toEqual({ assigned: false, reason: 'missing_data' });
  });
});

// -- Retry route ------------------------------------------------------------

describe('POST /api/admin/creators/:id/assign-tier', () => {
  const VALID_ID = '22222222-2222-4222-8222-222222222222';

  function routeDeps(
    creator: {
      id: string;
      status: string;
      tierId: string | null;
      followerCount: number | null;
      engagementRate: string | null;
    } | null,
    overrides: Partial<AssignTierRouteDeps> = {}
  ): { deps: AssignTierRouteDeps; rows: Record<string, unknown>[] } {
    const rows: Record<string, unknown>[] = [];

    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(creator ? [creator] : [])),
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((row) => {
          rows.push(row);
          return Promise.resolve();
        }),
      })),
    } as unknown as Tx;

    const adminAuditDeps: Partial<AdminAuditDeps> = {
      getCurrentUser: async () => ADMIN_USER,
      loadProfileIds: async () => ({
        brandProfileId: null,
        creatorProfileId: null,
      }),
      loadOwnerRefs: async () => null,
      transaction: <T>(fn: (t: Tx) => Promise<T>) => fn(tx),
    };

    return {
      deps: {
        guard: async () => ADMIN_USER,
        adminAuditDeps,
        assignTierDeps: { loadTiers: async () => LADDER },
        ...overrides,
      },
      rows,
    };
  }

  const verified = {
    id: VALID_ID,
    status: 'verified',
    tierId: null,
    followerCount: 120_000,
    engagementRate: '3.00',
  };

  it('assigns and returns the tier', async () => {
    const { deps } = routeDeps(verified);

    const response = await handleAssignTier(VALID_ID, deps);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      id: VALID_ID,
      tier: {
        assigned: true,
        id: 'tier-mid',
        name: 'Mid',
        price_per_video: 400_000,
      },
      // The tier held before this run — null here because the creator was
      // untiered. See the F12 cases below for why it is in the response.
      before: { tier_id: null },
    });
  });

  it('writes a creator.assign_tier audit row carrying the outcome', async () => {
    const { deps, rows } = routeDeps(verified);

    await handleAssignTier(VALID_ID, deps);

    const auditRow = rows.find((r) => r.action === 'creator.assign_tier');
    expect(auditRow).toBeDefined();
    expect(auditRow?.actorId).toBe(ADMIN_USER.id);
    expect(auditRow?.targetType).toBe('creator_profile');
    expect(auditRow?.targetId).toBe(VALID_ID);
    expect(auditRow?.detail).toMatchObject({
      before: { tierId: null },
      tier: { assigned: true, tierName: 'Mid' },
    });
  });

  it('logs the unmatched case too, rather than only the successes', async () => {
    const { deps, rows } = routeDeps({
      ...verified,
      followerCount: null,
      engagementRate: null,
    });

    const response = await handleAssignTier(VALID_ID, deps);

    expect(response.status).toBe(200);
    expect((await response.json()).tier).toEqual({
      assigned: false,
      reason: 'missing_data',
    });
    expect(
      rows.find((r) => r.action === 'creator.assign_tier')?.detail
    ).toMatchObject({ tier: { assigned: false, reason: 'missing_data' } });
  });

  it.each([['brand'], ['creator']])('returns 403 for a %s', async (role) => {
    const { deps } = routeDeps(verified, {
      guard: async () => {
        throw new ForbiddenError(`role ${role} not permitted`);
      },
    });

    const response = await handleAssignTier(VALID_ID, deps);

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('returns 403 before touching the row', async () => {
    const select = vi.fn();
    const { deps } = routeDeps(verified, {
      guard: async () => {
        throw new ForbiddenError('not an admin');
      },
      adminAuditDeps: {
        transaction: <T>(fn: (t: Tx) => Promise<T>) =>
          fn({ select } as unknown as Tx),
      },
    });

    await handleAssignTier(VALID_ID, deps);

    expect(select).not.toHaveBeenCalled();
  });

  it.each([['pending_verification'], ['rejected']])(
    'returns 409 CREATOR_NOT_VERIFIED for a %s creator',
    async (status) => {
      const { deps } = routeDeps({ ...verified, status });

      const response = await handleAssignTier(VALID_ID, deps);

      expect(response.status).toBe(
        ErrorHttpStatus[ErrorCode.CREATOR_NOT_VERIFIED]
      );
      const body = await response.json();
      expect(body.error.code).toBe(ErrorCode.CREATOR_NOT_VERIFIED);
      // Not the "already reviewed" string — a pending creator has not been.
      expect(body.error.message).toBe('This creator is not verified yet.');
    }
  );

  it('returns 404 when the creator does not exist', async () => {
    const { deps } = routeDeps(null);

    const response = await handleAssignTier(VALID_ID, deps);

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('returns 404 for a malformed id without opening a transaction', async () => {
    const transaction = vi.fn();
    const { deps } = routeDeps(verified, {
      adminAuditDeps: { transaction },
    });

    const response = await handleAssignTier('not-a-uuid', deps);

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe(ErrorCode.NOT_FOUND);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('maps its audit action to creator_profile', () => {
    // `withAdminAudit` throws on a mismatched pair before opening a
    // transaction, so a miswired action would be a 500 at runtime.
    expect(AUDIT_ACTION_TARGET[AUDIT_ACTIONS.CREATOR_ASSIGN_TIER]).toBe(
      'creator_profile'
    );
  });

  /**
   * F12 — a rerun against an already-tiered creator.
   *
   * The handler guards `status` but not `tier_id`, so a tiered creator whose
   * numbers no longer match any band gets `assigned: false` while their row keeps
   * its tier and stays bookable. That is the correct write — clearing the tier
   * would un-book a creator who may hold live deals — but a response saying only
   * "no tier matched" reads as "this creator has no price", which is false.
   *
   * `before.tier_id` is what separates the two. Both cases below return the same
   * `tier` object and differ only in that field.
   */
  describe('F12 — the retry response distinguishes tier-unchanged from untiered', () => {
    /** Tiered, but with numbers no band accepts any more. */
    const tieredNoMatch = {
      ...verified,
      tierId: 'tier-mid',
      followerCount: null,
      engagementRate: null,
    };

    it('reports the surviving tier when no band matches', async () => {
      const { deps } = routeDeps(tieredNoMatch);

      const body = await (await handleAssignTier(VALID_ID, deps)).json();

      expect(body.tier).toEqual({ assigned: false, reason: 'missing_data' });
      expect(body.before).toEqual({ tier_id: 'tier-mid' });
    });

    it('reports no prior tier for an untiered creator, same tier outcome', async () => {
      const { deps } = routeDeps({
        ...tieredNoMatch,
        tierId: null,
      });

      const body = await (await handleAssignTier(VALID_ID, deps)).json();

      expect(body.tier).toEqual({ assigned: false, reason: 'missing_data' });
      expect(body.before).toEqual({ tier_id: null });
    });

    it('leaves tier_id set — a no-match never un-books a creator', async () => {
      const set = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));
      const { deps } = routeDeps(tieredNoMatch, {
        adminAuditDeps: {
          getCurrentUser: async () => ADMIN_USER,
          loadProfileIds: async () => ({
            brandProfileId: null,
            creatorProfileId: null,
          }),
          loadOwnerRefs: async () => null,
          transaction: <T>(fn: (t: Tx) => Promise<T>) =>
            fn({
              select: vi.fn(() => ({
                from: vi.fn(() => ({
                  where: vi.fn(() => ({
                    for: vi.fn(() => ({
                      limit: vi.fn(() => Promise.resolve([tieredNoMatch])),
                    })),
                  })),
                })),
              })),
              update: vi.fn(() => ({ set })),
              insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
            } as unknown as Tx),
        },
      });

      await handleAssignTier(VALID_ID, deps);

      // No write at all on a no-match, so there is nothing that could clear it.
      expect(set).not.toHaveBeenCalled();
    });

    it('still upgrades a tiered creator who now matches a higher band', async () => {
      // The reseed-and-upgrade case, and the reason the handler must *not* be
      // guarded against an existing tier: a creator who grew into Macro is
      // exactly who a rerun is for.
      const { deps } = routeDeps({
        ...verified,
        tierId: 'tier-micro',
        followerCount: 900_000,
        engagementRate: '6.00',
      });

      const body = await (await handleAssignTier(VALID_ID, deps)).json();

      expect(body.tier).toMatchObject({ assigned: true, id: 'tier-macro' });
      expect(body.before).toEqual({ tier_id: 'tier-micro' });
    });

    it('records the same before value in the audit row as in the response', async () => {
      // The defect was the two disagreeing. Asserting them against each other
      // rather than against a literal is what keeps them from drifting again.
      const { deps, rows } = routeDeps(tieredNoMatch);

      const body = await (await handleAssignTier(VALID_ID, deps)).json();
      const detail = rows.find((r) => r.action === 'creator.assign_tier')
        ?.detail as { before: { tierId: string | null } };

      expect(detail.before.tierId).toBe(body.before.tier_id);
    });
  });
});

// -- Awaiting-tier read path ------------------------------------------------

describe('readAwaitingTier', () => {
  function creator(id: string): AwaitingTierCreator {
    return {
      id,
      tiktokHandle: `@${id}`,
      niche: 'lifestyle',
      followerCount: 500,
      engagementRate: '1.00',
      verifiedAt: new Date('2026-08-01T00:00:00Z'),
    };
  }

  function deps(
    creators: AwaitingTierCreator[],
    overrides: Partial<AwaitingTierDeps> = {}
  ): AwaitingTierDeps {
    return {
      requireAdmin: async () => ADMIN_USER,
      select: async (limit, offset) => creators.slice(offset, offset + limit),
      count: async () => creators.length,
      ...overrides,
    };
  }

  it('lists the creators who are stuck', async () => {
    const result = await readAwaitingTier(
      {},
      deps([creator('a'), creator('b')])
    );

    expect(result.creators.map((c) => c.id)).toEqual(['a', 'b']);
    expect(result.hasMore).toBe(false);
  });

  it('rejects a non-admin before querying', async () => {
    const select = vi.fn();
    const d = deps([], {
      requireAdmin: async () => {
        throw new ForbiddenError('role brand not permitted');
      },
      select,
    });

    await expect(readAwaitingTier({}, d)).rejects.toThrow(ForbiddenError);
    expect(select).not.toHaveBeenCalled();
  });

  it('gates the count as well as the list', async () => {
    const count = vi.fn();
    const d = deps([], {
      requireAdmin: async () => {
        throw new ForbiddenError('role creator not permitted');
      },
      count,
    });

    await expect(countAwaitingTier(d)).rejects.toThrow(ForbiddenError);
    expect(count).not.toHaveBeenCalled();
  });

  it('reports hasMore from an over-fetch without leaking the extra row', async () => {
    const creators = Array.from({ length: PAGE_SIZE + 1 }, (_, i) =>
      creator(`c-${i}`)
    );

    const result = await readAwaitingTier({ limit: PAGE_SIZE }, deps(creators));

    expect(result.creators).toHaveLength(PAGE_SIZE);
    expect(result.hasMore).toBe(true);
  });

  it('counts without paging', async () => {
    const creators = Array.from({ length: 7 }, (_, i) => creator(`c-${i}`));

    expect(await countAwaitingTier(deps(creators))).toBe(7);
  });
});

// -- AC-7: excluded from brand-facing reads ---------------------------------

/**
 * Discovery is KAN-28 and `GET /api/creators` does not exist yet, so the
 * assertion that belongs to this ticket is on the predicate that route will
 * import — `BOOKABLE_CREATOR` / `isBookable`, which already carries the rule.
 */
describe('a verified creator with no tier is not bookable (AC-006, AC-7)', () => {
  it.each([
    [
      'verified, untiered',
      { status: 'verified' as const, tierId: null, tierActive: null },
      false,
    ],
    [
      'verified, tiered',
      { status: 'verified' as const, tierId: 'tier-mid', tierActive: true },
      true,
    ],
    [
      'pending, tiered',
      {
        status: 'pending_verification' as const,
        tierId: 'tier-mid',
        tierActive: true,
      },
      false,
    ],
    [
      'pending, untiered',
      {
        status: 'pending_verification' as const,
        tierId: null,
        tierActive: null,
      },
      false,
    ],
    [
      'rejected, tiered',
      { status: 'rejected' as const, tierId: 'tier-mid', tierActive: true },
      false,
    ],
  ])('%s → %s', (_label, row, expected) => {
    expect(isBookable(row)).toBe(expected);
  });

  it('becomes bookable only once assignment writes a tier', async () => {
    // The end-to-end shape of the ticket, on one row: verified is half of it.
    const row = {
      status: 'verified' as const,
      tierId: null as string | null,
      tierActive: true as boolean | null,
    };
    expect(isBookable(row)).toBe(false);

    const tx = {
      update: vi.fn(() => ({
        set: vi.fn((values: { tierId: string }) => {
          row.tierId = values.tierId;
          return { where: vi.fn(() => Promise.resolve()) };
        }),
      })),
    } as unknown as Tx;

    await assignTier(
      tx,
      { id: 'c-1', followerCount: 120_000, engagementRate: '3.00' },
      { loadTiers: async () => LADDER }
    );

    expect(row.tierId).toBe('tier-mid');
    expect(isBookable(row)).toBe(true);
  });
});
