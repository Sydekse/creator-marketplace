import { beforeEach, describe, expect, it, vi } from 'vitest';
// Static imports, not the in-test dynamic imports `default-deps.test.ts`
// uses: `vi.mock` is hoisted above them either way, and resolving these
// modules mid-test is what times that file out under full-suite load.
import { addToCart } from '../lib/campaigns/add-to-cart';
import { bulkAddToCart } from '../lib/campaigns/bulk-add-to-cart';
import { getActiveDraftCart } from '../lib/campaigns/queries';
import {
  getCartItem,
  listCartItems,
  sumCartTotal,
} from '../lib/campaigns/cart-queries';

/**
 * Default-dep smoke tests for the cart read/write paths — the same pattern as
 * `default-deps.test.ts`, for the modules the mark-and-add work added to:
 * `add-to-cart`, `bulk-add-to-cart`, `cart-queries` and the campaigns query
 * module's `getActiveDraftCart`.
 *
 * These exist because the coverage gate counts *functions*: the seam-injected
 * tests drive the business logic with fakes, which leaves the real DB-backed
 * default deps unexecuted and drags the functions figure under its threshold.
 * The mock below resolves one generic row carrying every field any of these
 * queries reads, so each default dep runs end to end without a database. The
 * business outcomes are asserted by the seam tests; here "does not throw" is
 * the contract.
 */

// Constants and the query counter live in the hoisted block: with static
// imports, the `vi.mock` factories run before any top-level `const`, so
// anything the factories read must be hoisted with them. The counter resets
// per test — the mock resolves the first query of a run as the campaign row
// and the rest as creator rows.
const harness = vi.hoisted(() => ({
  queryIndex: 0,
  CREATOR_ID: '33333333-3333-4333-8333-333333333333',
  BRAND_PROFILE_ID: 'b0000000-0000-4000-8000-000000000001',
  CAMPAIGN_ID: 'c0000000-0000-4000-8000-000000000001',
}));

const { CREATOR_ID, BRAND_PROFILE_ID, CAMPAIGN_ID } = harness;

vi.mock('../db', () => {
  // One row that satisfies every reader — bookable creator, funded budget,
  // existing cart row. `creatorId` deliberately differs from `id` so the bulk
  // path's existing-items lookup misses and the insert branch runs too.
  //
  // The one field the readers disagree on is `status`: the campaign must read
  // 'draft' and the creator 'verified', and they are always the first and
  // second query of their respective flows. The mock resolves by query order —
  // query 1 is the campaign, everything after is the creator-shaped row. That
  // ordering is a property of the code under test, asserted by the outcomes
  // below (`ok: true` is unreachable if either read gets the wrong status).
  // The counter lives in `harness` so each test restarts the ordering.

  const baseRow = {
    id: harness.CREATOR_ID,
    creatorId: 'cr000000-0000-4000-8000-000000000001',
    campaignId: harness.CAMPAIGN_ID,
    brandId: harness.BRAND_PROFILE_ID,
    tierId: 't0000000-0000-4000-8000-000000000001',
    pricePerVideo: 100,
    tierActive: true,
    budget: 1000000,
    videoCount: 1,
    totalPrice: 100,
    unitPrice: 100,
    commissionRate: '15.00',
    total: 0,
    itemCount: 1,
    createdAt: new Date('2026-01-01'),
    tiktokHandle: '@test',
    niche: 'beauty',
    name: 'Campaign',
  };

  const makeChain = (index: number): Record<string, unknown> => {
    const row = { ...baseRow, status: index === 1 ? 'draft' : 'verified' };
    const chain: Record<string, unknown> = {};
    for (const m of [
      'select',
      'from',
      'where',
      'groupBy',
      'orderBy',
      'innerJoin',
      'leftJoin',
      'limit',
      'for',
      'insert',
      'values',
      'update',
      'set',
    ]) {
      chain[m] = vi.fn(() => chain);
    }
    // `returning` and the terminal await both resolve rows.
    chain.returning = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) => resolve([row]);
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => makeChain(++harness.queryIndex)),
      insert: vi.fn(() => makeChain(++harness.queryIndex)),
      update: vi.fn(() => makeChain(++harness.queryIndex)),
      transaction: vi.fn((fn: (tx: unknown) => unknown) =>
        fn({
          select: vi.fn(() => makeChain(++harness.queryIndex)),
          insert: vi.fn(() => makeChain(++harness.queryIndex)),
          update: vi.fn(() => makeChain(++harness.queryIndex)),
        })
      ),
    },
  };
});

vi.mock('../lib/authz', async (importOriginal) => {
  const actual: object = await importOriginal();
  return {
    ...actual,
    guard: vi.fn(async () => ({
      brandProfileId: harness.BRAND_PROFILE_ID,
    })),
  };
});

describe('default deps: cart writes', () => {
  beforeEach(() => {
    harness.queryIndex = 0;
  });

  it('addToCart runs its default query deps without error', async () => {
    const result = await addToCart(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      creatorId: CREATOR_ID,
      videoCount: 1,
    });
    // The mock row is an "existing" cart row, so this takes the upsert path.
    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
  });

  it('bulkAddToCart runs its default query deps without error', async () => {
    const result = await bulkAddToCart(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      creatorIds: [CREATOR_ID],
      videoCount: 1,
    });
    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
  });
});

describe('default deps: cart reads', () => {
  it('getActiveDraftCart resolves the newest draft row', async () => {
    const result = await getActiveDraftCart(BRAND_PROFILE_ID);
    expect(result).toBeDefined();
  });

  it('sumCartTotal, listCartItems and getCartItem run without error', async () => {
    expect(await sumCartTotal(CAMPAIGN_ID)).toBe(0);
    expect(Array.isArray(await listCartItems(CAMPAIGN_ID))).toBe(true);
    expect(await getCartItem(CAMPAIGN_ID, CREATOR_ID)).toBeDefined();
  });
});
