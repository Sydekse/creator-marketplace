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
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn(async (resolve: (v: unknown) => void) =>
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
        },
      ])
    ),
  };
  return { db: chain };
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
  });
});

describe('default deps: readBrandDealInbox', () => {
  it('exercises the default query dep without error', async () => {
    const { readBrandDealInbox } = await import('../lib/deals/brand-inbox');
    const result = await readBrandDealInbox();

    expect(result).toBeDefined();
    expect(result?.campaigns).toBeDefined();
  });
});
