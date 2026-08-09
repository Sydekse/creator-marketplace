import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMPAIGN_CREATOR_UNIQUE_CONSTRAINT,
  addToCart,
} from '../lib/campaigns/add-to-cart';
import type { AddToCartDeps } from '../lib/campaigns/add-to-cart';
import { ForbiddenError } from '../lib/authz';
import {
  ErrorCode,
  ErrorMessage,
  addCampaignItemSchema,
  zodIssuesToDetails,
} from '../lib/validation';
import { COMMISSION_RATE } from '../lib/config/pricing';

/**
 * KAN-30 — Add creators + video counts to campaign cart, running total (AC-009, AC-013).
 */

const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleAddCampaignItem } =
  await import('../app/api/campaigns/[id]/items/route');

const BRAND_USER_ID = 'user-brand-1';
const BRAND_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';
const CREATOR_ID = '33333333-3333-4333-8333-333333333333';
const TIER_ID = '44444444-4444-4444-8444-444444444444';

function postRequest(body: unknown, raw?: string) {
  return new Request(`http://localhost/api/campaigns/${CAMPAIGN_ID}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

function uniqueViolation(constraint: string) {
  return Object.assign(
    new Error('duplicate key value violates unique constraint'),
    { code: '23505', constraint }
  );
}

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

describe('addCampaignItemSchema', () => {
  it('accepts valid input with positive integer video count', () => {
    const parsed = addCampaignItemSchema.safeParse({
      creatorId: CREATOR_ID,
      videoCount: 2,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.creatorId).toBe(CREATOR_ID);
      expect(parsed.data.videoCount).toBe(2);
    }
  });

  it('rejects invalid creator UUID', () => {
    const parsed = addCampaignItemSchema.safeParse({
      creatorId: 'not-a-uuid',
      videoCount: 1,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const details = zodIssuesToDetails(parsed.error);
      expect(details.creatorId).toContain('Valid creator ID is required.');
    }
  });

  it('rejects zero or negative video counts', () => {
    for (const count of [0, -1, -5]) {
      const parsed = addCampaignItemSchema.safeParse({
        creatorId: CREATOR_ID,
        videoCount: count,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const details = zodIssuesToDetails(parsed.error);
        expect(details.videoCount).toContain(
          'Video count must be greater than zero.'
        );
      }
    }
  });

  it('rejects non-integer video counts', () => {
    const parsed = addCampaignItemSchema.safeParse({
      creatorId: CREATOR_ID,
      videoCount: 1.5,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('addToCart service', () => {
  const mockCampaign = {
    id: CAMPAIGN_ID,
    brandId: BRAND_PROFILE_ID,
    budget: 500000, // 5,000 ETB in santim
    status: 'draft' as const,
  };

  const mockCreator = {
    id: CREATOR_ID,
    status: 'verified' as const,
    tierId: TIER_ID,
    pricePerVideo: 100000, // 1,000 ETB in santim
    tierActive: true,
  };

  function createMockDeps(
    overrides: Partial<AddToCartDeps> = {}
  ): AddToCartDeps {
    return {
      getCampaign: vi.fn().mockResolvedValue(mockCampaign),
      getCreatorWithTier: vi.fn().mockResolvedValue(mockCreator),
      insertItem: vi.fn().mockResolvedValue({ id: 'item-uuid-1' }),
      getRunningTotal: vi.fn().mockResolvedValue(200000), // 2 videos * 1,000 ETB
      ...overrides,
    };
  }

  it('adds item to cart, computing snapshot prices and running total', async () => {
    const deps = createMockDeps();
    const result = await addToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorId: CREATOR_ID, videoCount: 2 },
      deps
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item.id).toBe('item-uuid-1');
      expect(result.runningTotal).toBe(200000);
      expect(result.remainingBudget).toBe(300000); // 500,000 - 200,000
    }

    expect(deps.insertItem).toHaveBeenCalledWith({
      campaignId: CAMPAIGN_ID,
      creatorId: CREATOR_ID,
      videoCount: 2,
      unitPrice: 100000,
      totalPrice: 200000,
      commissionRate: COMMISSION_RATE,
    });
  });

  it('rejects if campaign does not exist or does not belong to brand', async () => {
    const deps = createMockDeps({
      getCampaign: vi.fn().mockResolvedValue(null),
    });

    const result = await addToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorId: CREATOR_ID, videoCount: 1 },
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects if campaign is not in draft status', async () => {
    const deps = createMockDeps({
      getCampaign: vi.fn().mockResolvedValue({
        ...mockCampaign,
        status: 'confirmed',
      }),
    });

    const result = await addToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorId: CREATOR_ID, videoCount: 1 },
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'not_draft' });
  });

  it('rejects if creator does not exist', async () => {
    const deps = createMockDeps({
      getCreatorWithTier: vi.fn().mockResolvedValue(null),
    });

    const result = await addToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorId: CREATOR_ID, videoCount: 1 },
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'creator_not_found' });
  });

  it('rejects if creator is not verified', async () => {
    const deps = createMockDeps({
      getCreatorWithTier: vi.fn().mockResolvedValue({
        ...mockCreator,
        status: 'pending_verification',
      }),
    });

    const result = await addToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorId: CREATOR_ID, videoCount: 1 },
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'creator_not_bookable' });
  });

  it('rejects if creator is untiered (tierId is null)', async () => {
    const deps = createMockDeps({
      getCreatorWithTier: vi.fn().mockResolvedValue({
        ...mockCreator,
        tierId: null,
        pricePerVideo: null,
      }),
    });

    const result = await addToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorId: CREATOR_ID, videoCount: 1 },
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'creator_not_bookable' });
  });

  it('rejects if creator tier is inactive', async () => {
    const deps = createMockDeps({
      getCreatorWithTier: vi.fn().mockResolvedValue({
        ...mockCreator,
        tierActive: false,
      }),
    });

    const result = await addToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorId: CREATOR_ID, videoCount: 1 },
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'creator_not_bookable' });
  });

  it('handles duplicate creator in campaign via unique violation', async () => {
    const deps = createMockDeps({
      insertItem: vi
        .fn()
        .mockRejectedValue(uniqueViolation(CAMPAIGN_CREATOR_UNIQUE_CONSTRAINT)),
    });

    const result = await addToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorId: CREATOR_ID, videoCount: 1 },
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'creator_already_in_cart' });
  });
});

describe('POST /api/campaigns/[id]/items route handler', () => {
  const mockCampaign = {
    id: CAMPAIGN_ID,
    brandId: BRAND_PROFILE_ID,
    budget: 500000,
    status: 'draft' as const,
  };

  const mockCreator = {
    id: CREATOR_ID,
    status: 'verified' as const,
    tierId: TIER_ID,
    pricePerVideo: 100000,
    tierActive: true,
  };

  function createMockAddToCartDeps(
    overrides: Partial<AddToCartDeps> = {}
  ): AddToCartDeps {
    return {
      getCampaign: vi.fn().mockResolvedValue(mockCampaign),
      getCreatorWithTier: vi.fn().mockResolvedValue(mockCreator),
      insertItem: vi.fn().mockResolvedValue({ id: 'item-1' }),
      getRunningTotal: vi.fn().mockResolvedValue(200000),
      ...overrides,
    };
  }

  it('returns 200 with item and totals on successful addition', async () => {
    const deps = createMockAddToCartDeps();
    const response = await handleAddCampaignItem(
      postRequest({ creatorId: CREATOR_ID, videoCount: 2 }),
      CAMPAIGN_ID,
      { addToCartDeps: deps }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      item: { id: 'item-1' },
      running_total: 200000,
      remaining_budget: 300000,
    });
  });

  it('enforces RBAC — rejects unauthorized callers with 403 FORBIDDEN', async () => {
    guardMock.mockRejectedValue(new ForbiddenError('wrong role'));

    const response = await handleAddCampaignItem(
      postRequest({ creatorId: CREATOR_ID, videoCount: 1 }),
      CAMPAIGN_ID
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.FORBIDDEN]);
  });

  it('rejects malformed campaign id with 403 FORBIDDEN', async () => {
    const response = await handleAddCampaignItem(
      postRequest({ creatorId: CREATOR_ID, videoCount: 1 }),
      'not-a-uuid'
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('rejects invalid JSON with 422 VALIDATION_ERROR', async () => {
    const response = await handleAddCampaignItem(
      postRequest(null, '{ broken json'),
      CAMPAIGN_ID
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.error.details._root).toContain(
      'Request body must be valid JSON.'
    );
  });

  it('rejects invalid body schema with 422 VALIDATION_ERROR', async () => {
    const response = await handleAddCampaignItem(
      postRequest({ creatorId: 'invalid', videoCount: -1 }),
      CAMPAIGN_ID
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.error.details.creatorId).toBeDefined();
    expect(body.error.details.videoCount).toBeDefined();
  });

  it('returns 409 CAMPAIGN_NOT_DRAFT when campaign is not draft', async () => {
    const deps = createMockAddToCartDeps({
      getCampaign: vi.fn().mockResolvedValue({
        ...mockCampaign,
        status: 'confirmed',
      }),
    });

    const response = await handleAddCampaignItem(
      postRequest({ creatorId: CREATOR_ID, videoCount: 1 }),
      CAMPAIGN_ID,
      { addToCartDeps: deps }
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.CAMPAIGN_NOT_DRAFT);
  });

  it('returns 422 CREATOR_NOT_BOOKABLE when creator is not verified or untiered', async () => {
    const deps = createMockAddToCartDeps({
      getCreatorWithTier: vi.fn().mockResolvedValue({
        ...mockCreator,
        status: 'pending_verification',
      }),
    });

    const response = await handleAddCampaignItem(
      postRequest({ creatorId: CREATOR_ID, videoCount: 1 }),
      CAMPAIGN_ID,
      { addToCartDeps: deps }
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.CREATOR_NOT_BOOKABLE);
  });

  it('returns 409 CREATOR_ALREADY_IN_CART when creator is duplicate', async () => {
    const deps = createMockAddToCartDeps({
      insertItem: vi
        .fn()
        .mockRejectedValue(uniqueViolation(CAMPAIGN_CREATOR_UNIQUE_CONSTRAINT)),
    });

    const response = await handleAddCampaignItem(
      postRequest({ creatorId: CREATOR_ID, videoCount: 1 }),
      CAMPAIGN_ID,
      { addToCartDeps: deps }
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.CREATOR_ALREADY_IN_CART);
  });
});
