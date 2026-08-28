import { describe, expect, it, vi } from 'vitest';

/**
 * Default-dep smoke tests for the brand dashboard and inbox reads.
 *
 * These exercise the real default deps (the DB-backed query functions) by
 * mocking `@/db` so the drizzle chain resolves without a database. The goal
 * is function-level coverage — the business logic is already tested by the
 * seam-injected tests in `brand-dashboard.test.ts` and `brand-deal-inbox.test.ts`.
 */

// -- Mock the DB module ------------------------------------------------------

vi.mock('../db', () => {
  // A fresh chain per query, not one shared `mockReturnThis` object. The
  // dashboard and inbox run several queries concurrently (`Promise.all`), and a
  // single shared chain deadlocks them: the second `select()` re-enters the same
  // object's `then` while the first query's promise is already settled against
  // it, so the later query's `await` never resolves and the test times out.
  // Handing each query its own awaitable chain is what lets them all settle.
  const makeChain = (): unknown => {
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
    ]) {
      chain[m] = vi.fn(() => chain);
    }
    chain.then = (resolve: (v: unknown) => void) =>
      resolve([
        {
          status: 'draft',
          count: 1,
          held: 0,
          paidOut: 0,
          commission: 0,
          dealId: 'd0000000-0000-4000-8000-000000000001',
          creatorHandle: '@test',
          campaignName: 'Test',
          campaignId: 'c0000000-0000-4000-8000-000000000001',
          videoCount: 1,
          totalPrice: 100_000,
          id: 'd0000000-0000-4000-8000-000000000001',
          creatorId: 'cr000000-0000-4000-8000-000000000001',
          // The spend chart buckets by week; a mock without a timestamp would
          // throw inside the series builder.
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          amount: 100_000,
        },
      ]);
    return chain;
  };
  return { db: { select: vi.fn(() => makeChain()) } };
});

// -- Mock authz to return a brand session ------------------------------------

vi.mock('../lib/authz', async (importOriginal) => {
  const actual: object = await importOriginal();
  return {
    ...actual,
    guard: vi.fn(async () => ({
      brandProfileId: 'b0000000-0000-4000-8000-000000000001',
    })),
  };
});

// -- Tests -------------------------------------------------------------------

describe('default deps: readBrandDashboard', () => {
  it('exercises the default query deps without error', async () => {
    const { readBrandDashboard } = await import('../lib/brands/dashboard');
    const result = await readBrandDashboard();

    expect(result).toBeDefined();
    expect(result.campaigns).toBeDefined();
    expect(result.money).toBeDefined();
    expect(Array.isArray(result.awaitingReview)).toBe(true);
  }, 15_000);
});

describe('default deps: readBrandDealInbox', () => {
  it('exercises the default query dep without error', async () => {
    const { readBrandDealInbox } = await import('../lib/deals/brand-inbox');
    const result = await readBrandDealInbox();

    expect(result).toBeDefined();
    expect(result?.campaigns).toBeDefined();
  }, 15_000);
});
