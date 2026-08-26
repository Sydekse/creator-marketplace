import { describe, expect, it, vi } from 'vitest';
import { bulkAddToCart } from '../lib/campaigns/bulk-add-to-cart';
import type { BulkAddToCartDeps } from '../lib/campaigns/bulk-add-to-cart';
import { ForbiddenError } from '../lib/authz';
import type { Tx } from '../lib/authz';
import { ErrorCode, bulkAddCampaignItemsSchema } from '../lib/validation';
import { COMMISSION_RATE } from '../lib/config/pricing';

/**
 * Bulk mark-and-add (the discover grid's batch add to cart).
 *
 * Covers: atomic creator validity, summed-delta budget ceiling, the
 * already-carted upsert, and the route's response contract.
 */

const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleBulkAddCampaignItems } =
  await import('../app/api/campaigns/[id]/items/bulk/route');

const BRAND_USER_ID = 'user-brand-bulk';
const BRAND_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';
const CREATOR_A = '33333333-3333-4333-8333-333333333333';
const CREATOR_B = '55555555-5555-4555-8555-555555555555';
const TIER_ID = '44444444-4444-4444-8444-444444444444';

function postRequest(body: unknown, raw?: string) {
  return new Request(
    `http://localhost/api/campaigns/${CAMPAIGN_ID}/items/bulk`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    }
  );
}

const mockCampaign = {
  id: CAMPAIGN_ID,
  brandId: BRAND_PROFILE_ID,
  budget: 500000,
  status: 'draft' as const,
};

const creatorA = {
  id: CREATOR_A,
  status: 'verified' as const,
  tierId: TIER_ID,
  pricePerVideo: 100000,
  tierActive: true,
};
const creatorB = { ...creatorA, id: CREATOR_B, pricePerVideo: 50000 };

function createMockDeps(
  overrides: Partial<BulkAddToCartDeps> = {}
): BulkAddToCartDeps {
  return {
    getCampaign: vi.fn().mockResolvedValue(mockCampaign),
    getCreatorsWithTiers: vi.fn().mockResolvedValue([creatorA, creatorB]),
    getExistingItems: vi.fn().mockResolvedValue([]),
    insertItem: vi.fn().mockResolvedValue({ id: 'new-item' }),
    updateItemCount: vi.fn().mockResolvedValue({ id: 'existing-item' }),
    getRunningTotal: vi.fn().mockResolvedValue(0),
    transaction: async (fn) => fn({} as Tx),
    ...overrides,
  };
}

describe('bulkAddToCart', () => {
  it('inserts one row per creator at the batch video count', async () => {
    const deps = createMockDeps();
    const result = await bulkAddToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorIds: [CREATOR_A, CREATOR_B], videoCount: 2 },
      deps
    );

    expect(result).toEqual({
      ok: true,
      added: 2,
      updated: 0,
      runningTotal: 300000, // (100000 + 50000) * 2
      remainingBudget: 200000,
    });
    expect(deps.insertItem).toHaveBeenCalledWith(expect.anything(), {
      campaignId: CAMPAIGN_ID,
      creatorId: CREATOR_A,
      videoCount: 2,
      unitPrice: 100000,
      totalPrice: 200000,
      commissionRate: COMMISSION_RATE,
    });
    expect(deps.updateItemCount).not.toHaveBeenCalled();
  });

  it('grows the count of a creator already in the cart', async () => {
    const deps = createMockDeps({
      getExistingItems: vi
        .fn()
        .mockResolvedValue([
          { id: 'row-a', creatorId: CREATOR_A, videoCount: 1 },
        ]),
      getRunningTotal: vi.fn().mockResolvedValue(100000),
    });

    const result = await bulkAddToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorIds: [CREATOR_A, CREATOR_B], videoCount: 1 },
      deps
    );

    expect(result).toEqual({
      ok: true,
      added: 1,
      updated: 1,
      // 100000 existing + 100000 (A's increment) + 50000 (B) = 250000
      runningTotal: 250000,
      remainingBudget: 250000,
    });
    expect(deps.updateItemCount).toHaveBeenCalledWith(
      expect.anything(),
      'row-a',
      { videoCount: 2, totalPrice: 200000 }
    );
  });

  it('checks the ceiling against the summed delta, once', async () => {
    // 400000 carted; batch delta (100000 + 50000) * 1 = 150000 → 550000 > 500000.
    const deps = createMockDeps({
      getRunningTotal: vi.fn().mockResolvedValue(400000),
    });

    const result = await bulkAddToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorIds: [CREATOR_A, CREATOR_B], videoCount: 1 },
      deps
    );

    expect(result).toEqual({
      ok: false,
      reason: 'budget_exceeded',
      excess: 50000,
    });
    expect(deps.insertItem).not.toHaveBeenCalled();
    expect(deps.updateItemCount).not.toHaveBeenCalled();
  });

  it('is atomic on creator validity — one unbookable creator refuses all', async () => {
    const deps = createMockDeps({
      getCreatorsWithTiers: vi
        .fn()
        .mockResolvedValue([
          creatorA,
          { ...creatorB, status: 'pending_verification' as const },
        ]),
    });

    const result = await bulkAddToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorIds: [CREATOR_A, CREATOR_B], videoCount: 1 },
      deps
    );

    expect(result).toEqual({
      ok: false,
      reason: 'creator_not_bookable',
      creatorId: CREATOR_B,
    });
    expect(deps.insertItem).not.toHaveBeenCalled();
  });

  it('names the missing creator when one id does not resolve', async () => {
    const deps = createMockDeps({
      getCreatorsWithTiers: vi.fn().mockResolvedValue([creatorA]),
    });

    const result = await bulkAddToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorIds: [CREATOR_A, CREATOR_B], videoCount: 1 },
      deps
    );

    expect(result).toEqual({
      ok: false,
      reason: 'creator_not_found',
      creatorId: CREATOR_B,
    });
  });

  it('dedupes repeated ids rather than double-charging them', async () => {
    const deps = createMockDeps();
    const result = await bulkAddToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorIds: [CREATOR_A, CREATOR_A], videoCount: 1 },
      deps
    );

    expect(result).toEqual({
      ok: true,
      added: 1,
      updated: 0,
      runningTotal: 100000,
      remainingBudget: 400000,
    });
    expect(deps.insertItem).toHaveBeenCalledTimes(1);
  });

  it('refuses a campaign that is not a draft', async () => {
    const deps = createMockDeps({
      getCampaign: vi
        .fn()
        .mockResolvedValue({ ...mockCampaign, status: 'confirmed' }),
    });

    const result = await bulkAddToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorIds: [CREATOR_A], videoCount: 1 },
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'not_draft' });
  });

  it('locks the campaign row for update', () => {
    // The ceiling is only safe against concurrent batches because the campaign
    // row is taken FOR UPDATE before any total is read.
    const fs = require('node:fs');
    const source = fs.readFileSync('lib/campaigns/bulk-add-to-cart.ts', 'utf8');
    expect(source).toMatch(/\.for\(['"]update['"]\)/);
  });
});

describe('bulkAddCampaignItemsSchema', () => {
  it('defaults videoCount to 1', () => {
    const parsed = bulkAddCampaignItemsSchema.parse({
      creatorIds: [CREATOR_A],
    });
    expect(parsed.videoCount).toBe(1);
  });

  it('rejects an empty batch and a batch over the cap', () => {
    expect(
      bulkAddCampaignItemsSchema.safeParse({ creatorIds: [] }).success
    ).toBe(false);
    expect(
      bulkAddCampaignItemsSchema.safeParse({
        creatorIds: Array.from(
          { length: 51 },
          (_, i) => `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`
        ),
      }).success
    ).toBe(false);
  });
});

describe('POST /api/campaigns/[id]/items/bulk route handler', () => {
  it('returns 200 with added/updated counts and totals', async () => {
    const deps = createMockDeps({
      getExistingItems: vi
        .fn()
        .mockResolvedValue([
          { id: 'row-a', creatorId: CREATOR_A, videoCount: 1 },
        ]),
      getRunningTotal: vi.fn().mockResolvedValue(100000),
    });
    guardMock.mockResolvedValue({ brandProfileId: BRAND_PROFILE_ID });

    const response = await handleBulkAddCampaignItems(
      postRequest({ creatorIds: [CREATOR_A, CREATOR_B], videoCount: 1 }),
      CAMPAIGN_ID,
      { bulkAddToCartDeps: deps }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      added: 1,
      updated: 1,
      running_total: 250000,
      remaining_budget: 250000,
    });
  });

  it('enforces RBAC — rejects unauthorized callers with 403', async () => {
    guardMock.mockRejectedValue(new ForbiddenError('wrong role'));

    const response = await handleBulkAddCampaignItems(
      postRequest({ creatorIds: [CREATOR_A] }),
      CAMPAIGN_ID
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('rejects an invalid body with 422', async () => {
    guardMock.mockResolvedValue({ brandProfileId: BRAND_PROFILE_ID });

    const response = await handleBulkAddCampaignItems(
      postRequest({ creatorIds: ['not-a-uuid'] }),
      CAMPAIGN_ID
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('returns 422 CREATOR_NOT_BOOKABLE naming the failing creator', async () => {
    guardMock.mockResolvedValue({ brandProfileId: BRAND_PROFILE_ID });
    const deps = createMockDeps({
      getCreatorsWithTiers: vi
        .fn()
        .mockResolvedValue([
          creatorA,
          { ...creatorB, status: 'pending_verification' as const },
        ]),
    });

    const response = await handleBulkAddCampaignItems(
      postRequest({ creatorIds: [CREATOR_A, CREATOR_B], videoCount: 1 }),
      CAMPAIGN_ID,
      { bulkAddToCartDeps: deps }
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.CREATOR_NOT_BOOKABLE);
    expect(body.error.details.creator).toEqual([CREATOR_B]);
  });

  it('returns 409 BUDGET_EXCEEDED with the shortfall sentence', async () => {
    guardMock.mockResolvedValue({ brandProfileId: BRAND_PROFILE_ID });
    const deps = createMockDeps({
      getRunningTotal: vi.fn().mockResolvedValue(400000),
    });

    const response = await handleBulkAddCampaignItems(
      postRequest({ creatorIds: [CREATOR_A, CREATOR_B], videoCount: 1 }),
      CAMPAIGN_ID,
      { bulkAddToCartDeps: deps }
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.BUDGET_EXCEEDED);
  });
});
