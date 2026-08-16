import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMPAIGN_CREATOR_UNIQUE_CONSTRAINT,
  addToCart,
} from '../lib/campaigns/add-to-cart';
import type { AddToCartDeps } from '../lib/campaigns/add-to-cart';
import { removeFromCart } from '../lib/campaigns/remove-from-cart';
import type { RemoveFromCartDeps } from '../lib/campaigns/remove-from-cart';
import { ForbiddenError } from '../lib/authz';
import type { Tx } from '../lib/authz';
import {
  ErrorCode,
  ErrorMessage,
  addCampaignItemSchema,
  zodIssuesToDetails,
} from '../lib/validation';
import { COMMISSION_RATE } from '../lib/config/pricing';
import {
  CAMPAIGN_NOT_DRAFT_MESSAGE,
  REMOVE_FROM_CART_FAILED,
  REMOVE_FROM_CART_LABEL,
  REMOVE_FROM_CART_MISSING,
  REMOVE_FROM_CART_PENDING_LABEL,
  REMOVE_FROM_CART_SUCCESS,
} from '../lib/campaigns/constants';

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
const { handleDeleteCampaignItem } =
  await import('../app/api/campaigns/[id]/items/[creatorId]/route');

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

function deleteRequest() {
  return new Request(
    `http://localhost/api/campaigns/${CAMPAIGN_ID}/items/${CREATOR_ID}`,
    {
      method: 'DELETE',
    }
  );
}

function uniqueViolation(constraint: string) {
  return Object.assign(
    new Error('duplicate key value violates unique constraint'),
    { code: '23505', constraint }
  );
}

/**
 * Source guards read code, not prose about code. A module that documents why it
 * avoids something names that thing in a comment, and an un-stripped guard reads
 * the explanation as the violation.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
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
      getRunningTotal: vi.fn().mockResolvedValue(0), // initial total 0
      transaction: async (fn) => fn({} as Tx),
      ...overrides,
    };
  }

  it('locks the campaign row for update', () => {
    const source = readFileSync('lib/campaigns/add-to-cart.ts', 'utf8');
    expect(source).toMatch(/\.for\(['"]update['"]\)/);
  });

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

    expect(deps.insertItem).toHaveBeenCalledWith(expect.anything(), {
      campaignId: CAMPAIGN_ID,
      creatorId: CREATOR_ID,
      videoCount: 2,
      unitPrice: 100000,
      totalPrice: 200000,
      commissionRate: COMMISSION_RATE,
    });
  });

  it('exact budget boundary (total === budget) is allowed', async () => {
    const deps = createMockDeps({
      getCampaign: vi
        .fn()
        .mockResolvedValue({ ...mockCampaign, budget: 300000 }), // 200000 existing + 100000 new
      getRunningTotal: vi.fn().mockResolvedValue(200000),
    });
    const result = await addToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorId: CREATOR_ID, videoCount: 1 },
      deps
    );
    expect(result.ok).toBe(true);
  });

  it('1-santim excess is rejected', async () => {
    const deps = createMockDeps({
      getCampaign: vi
        .fn()
        .mockResolvedValue({ ...mockCampaign, budget: 299999 }), // 200000 existing + 100000 new
      getRunningTotal: vi.fn().mockResolvedValue(200000),
      insertItem: vi.fn(),
    });
    const result = await addToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorId: CREATOR_ID, videoCount: 1 },
      deps
    );
    expect(result).toEqual({ ok: false, reason: 'budget_exceeded', excess: 1 });
    expect(deps.insertItem).not.toHaveBeenCalled();
  });

  it('accumulation across items', async () => {
    const deps = createMockDeps({
      getCampaign: vi
        .fn()
        .mockResolvedValue({ ...mockCampaign, budget: 500000 }),
      getRunningTotal: vi.fn().mockResolvedValue(400001), // 400001 + 100000 = 500001 > 500000
      insertItem: vi.fn(),
    });
    const result = await addToCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      { creatorId: CREATOR_ID, videoCount: 1 },
      deps
    );
    expect(result).toEqual({ ok: false, reason: 'budget_exceeded', excess: 1 });
    expect(deps.insertItem).not.toHaveBeenCalled();
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
      getRunningTotal: vi.fn().mockResolvedValue(0), // initial total 0
      transaction: async (fn) => fn({} as Tx),
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

  it('API route returns 409 for budget_exceeded', async () => {
    const deps = createMockAddToCartDeps({
      getCampaign: vi
        .fn()
        .mockResolvedValue({ ...mockCampaign, budget: 299999 }),
      getRunningTotal: vi.fn().mockResolvedValue(200000),
    });

    const response = await handleAddCampaignItem(
      postRequest({ creatorId: CREATOR_ID, videoCount: 1 }),
      CAMPAIGN_ID,
      { addToCartDeps: deps }
    );

    expect(response.status).toBe(409); // From ErrorHttpStatus mapping
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.BUDGET_EXCEEDED);
    // `toBe`, not `toContain`. The whole sentence is short enough that
    // `toContain('0.01 ETB')` passed against "by 0.01 ETB ETB." — `formatEtb`
    // already ends in the currency, so a substring match could not tell the
    // right string from the doubled one. Pinning the full sentence can.
    expect(body.error.details.excess[0]).toBe(
      'This exceeds your remaining budget by 0.01 ETB.'
    );
  });
});

describe('removeFromCart service', () => {
  const mockCampaign = {
    id: CAMPAIGN_ID,
    brandId: BRAND_PROFILE_ID,
    budget: 500000,
    status: 'draft' as const,
  };

  function createMockRemoveDeps(
    overrides: Partial<RemoveFromCartDeps> = {}
  ): RemoveFromCartDeps {
    return {
      getCampaign: vi.fn().mockResolvedValue(mockCampaign),
      deleteItem: vi.fn().mockResolvedValue([{ id: 'item-uuid-1' }]),
      getRunningTotal: vi.fn().mockResolvedValue(100000), // new total after removal
      transaction: async (fn) => fn({} as Tx),
      ...overrides,
    };
  }

  it('sums the cart on the transaction connection, not the pool', async () => {
    // Every other test here stubs `getRunningTotal`, so the real dependency
    // never runs and a deadlock in the wiring would go unseen. Two guards
    // stand in for it.

    // 1. Behavioural: the sum is handed the same `tx` the transaction opened.
    //    Dropping that argument sends the query to the global pool while this
    //    transaction still holds `FOR UPDATE` on the campaign row.
    const tx = { transactionConnection: true } as unknown as Tx;
    const deps = createMockRemoveDeps({
      transaction: async (fn) => fn(tx),
    });

    await removeFromCart(CAMPAIGN_ID, BRAND_PROFILE_ID, CREATOR_ID, deps);

    expect(deps.getRunningTotal).toHaveBeenCalledWith(tx, CAMPAIGN_ID);

    // 2. Structural: the default wiring uses the un-authz'd sum. Comments are
    //    stripped first — this module explains the choice in prose that names
    //    the wrong function, and a raw-source guard cannot tell an explanation
    //    from a violation.
    const service = stripComments(
      readFileSync('lib/campaigns/remove-from-cart.ts', 'utf8')
    );
    expect(service).toContain('export async function removeFromCart'); // not vacuous
    expect(service).toContain('sumCartTotal(campaignId, tx)');
    expect(service).not.toContain('guard(');

    // Same wiring in the sibling service, which is where the precedent is.
    const sibling = stripComments(
      readFileSync('lib/campaigns/add-to-cart.ts', 'utf8')
    );
    expect(sibling).toContain('sumCartTotal(campaignId, tx)');
    expect(sibling).not.toContain('guard(');
  });

  it('keeps the transaction-safe sum free of authz, unlike its neighbours', () => {
    // Without this the guard above is a spelling test. `sumCartTotal` is only
    // the safe one for as long as it stays free of authz — the moment it calls
    // `guard` it acquires a read of its own and the deadlock is back.
    //
    // The guarded wrapper this used to be compared against, `getCartRunningTotal`,
    // was deleted on KAN-37: its one caller was the campaign page, and that page
    // now reads `readCampaignBudget`, which switches from cart rows to deals once
    // offers exist (AC-018). Leaving a guarded total with no callers would have
    // left the next person a coin flip between two functions. `listCartItems` is
    // the guarded neighbour now, and it makes the same contrast.
    const queries = stripComments(
      readFileSync('lib/campaigns/cart-queries.ts', 'utf8')
    );
    const sumBody = queries.slice(
      queries.indexOf('export async function sumCartTotal'),
      queries.indexOf('export async function listCartItems')
    );

    expect(sumBody).toContain('sumCartTotal'); // not vacuous
    expect(sumBody).not.toContain('guard(');
    expect(sumBody).not.toContain('requireOwnership');
    // Gone, and asserted gone: a re-added guarded total is what would make the
    // deadlock guard above ambiguous again.
    expect(queries).not.toContain('getCartRunningTotal');
    // The neighbour that does gate, so the absence above is a property of this
    // function rather than of the whole module.
    expect(queries).toMatch(
      /export async function listCartItems[\s\S]*?requireOwnership/
    );
  });

  it('removes item from cart, returning updated running total and budget', async () => {
    const deps = createMockRemoveDeps();
    const result = await removeFromCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      CREATOR_ID,
      deps
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.runningTotal).toBe(100000);
      expect(result.remainingBudget).toBe(400000);
    }

    expect(deps.deleteItem).toHaveBeenCalledWith(
      expect.anything(),
      CAMPAIGN_ID,
      CREATOR_ID
    );
  });

  it('rejects if campaign does not exist or does not belong to brand', async () => {
    const deps = createMockRemoveDeps({
      getCampaign: vi.fn().mockResolvedValue(null),
    });

    const result = await removeFromCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      CREATOR_ID,
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    // The ownership layer is the `brandProfileId` reaching the `where` clause.
    // A lookup by campaign id alone would find another brand's campaign and
    // then delete from it, with the role gate none the wiser (NFR-005).
    expect(deps.getCampaign).toHaveBeenCalledWith(
      expect.anything(),
      CAMPAIGN_ID,
      BRAND_PROFILE_ID
    );
    expect(deps.deleteItem).not.toHaveBeenCalled();
  });

  it('rejects if campaign is not in draft status', async () => {
    const deps = createMockRemoveDeps({
      getCampaign: vi.fn().mockResolvedValue({
        ...mockCampaign,
        status: 'confirmed',
      }),
    });

    const result = await removeFromCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      CREATOR_ID,
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'not_draft' });
    // "and changes nothing" is the other half of that AC. A 409 that has
    // already deleted the row satisfies the status code and nothing else.
    expect(deps.deleteItem).not.toHaveBeenCalled();
  });

  it('refuses every non-draft status, not just confirmed', async () => {
    // The AC names confirmed and funded; the campaign machine has six statuses
    // and only one of them is removable. Asserting the one the reviewer thought
    // of leaves the other four to whichever comparison a later edit reaches for.
    const nonDraft = [
      'confirmed',
      'funded',
      'in_progress',
      'completed',
      'cancelled',
    ] as const;

    for (const status of nonDraft) {
      const deps = createMockRemoveDeps({
        getCampaign: vi.fn().mockResolvedValue({ ...mockCampaign, status }),
      });

      const result = await removeFromCart(
        CAMPAIGN_ID,
        BRAND_PROFILE_ID,
        CREATOR_ID,
        deps
      );

      expect(result).toEqual({ ok: false, reason: 'not_draft' });
      expect(deps.deleteItem).not.toHaveBeenCalled();
    }
  });

  it('locks the campaign row for update', () => {
    // Same reason as the add path: status is read, then the cart is mutated and
    // the total recomputed against `budget`. Without the lock a concurrent
    // confirm can land between the read and the delete.
    const source = readFileSync('lib/campaigns/remove-from-cart.ts', 'utf8');
    expect(source).toMatch(/\.for\(['"]update['"]\)/);
  });

  it('rejects if creator item was not found in cart', async () => {
    const deps = createMockRemoveDeps({
      deleteItem: vi.fn().mockResolvedValue([]),
    });

    const result = await removeFromCart(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      CREATOR_ID,
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'item_not_found' });
  });
});

describe('DELETE /api/campaigns/[id]/items/[creatorId] route handler', () => {
  const mockCampaign = {
    id: CAMPAIGN_ID,
    brandId: BRAND_PROFILE_ID,
    budget: 500000,
    status: 'draft' as const,
  };

  function createMockRemoveDeps(
    overrides: Partial<RemoveFromCartDeps> = {}
  ): RemoveFromCartDeps {
    return {
      getCampaign: vi.fn().mockResolvedValue(mockCampaign),
      deleteItem: vi.fn().mockResolvedValue([{ id: 'item-uuid-1' }]),
      getRunningTotal: vi.fn().mockResolvedValue(100000), // new total after removal
      transaction: async (fn) => fn({} as Tx),
      ...overrides,
    };
  }

  it('returns 200 with new totals on successful removal', async () => {
    const deps = createMockRemoveDeps();
    const response = await handleDeleteCampaignItem(
      deleteRequest(),
      CAMPAIGN_ID,
      CREATOR_ID,
      { removeFromCartDeps: deps }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      running_total: 100000,
      remaining_budget: 400000,
    });

    // The brand scope comes from the guard's resolved context, never from the
    // URL or the body — there is no parameter a caller could set to reach
    // another brand's cart.
    expect(deps.getCampaign).toHaveBeenCalledWith(
      expect.anything(),
      CAMPAIGN_ID,
      BRAND_PROFILE_ID
    );
  });

  it('returns 403 FORBIDDEN when the caller has the brand role but no profile', async () => {
    guardMock.mockResolvedValue({
      user: {
        id: BRAND_USER_ID,
        email: 'brand@example.com',
        name: 'Brand',
        role: 'brand',
      },
      brandProfileId: null,
      creatorProfileId: null,
    });

    const deps = createMockRemoveDeps();
    const response = await handleDeleteCampaignItem(
      deleteRequest(),
      CAMPAIGN_ID,
      CREATOR_ID,
      { removeFromCartDeps: deps }
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
    // Passing through with an undefined brand scope would widen the `where`
    // clause to every campaign, so the removal must not run at all.
    expect(deps.getCampaign).not.toHaveBeenCalled();
  });

  it('enforces RBAC — rejects unauthorized callers with 403 FORBIDDEN', async () => {
    guardMock.mockRejectedValue(new ForbiddenError('wrong role'));

    const response = await handleDeleteCampaignItem(
      deleteRequest(),
      CAMPAIGN_ID,
      CREATOR_ID
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('rejects malformed campaign id with 403 FORBIDDEN', async () => {
    const response = await handleDeleteCampaignItem(
      deleteRequest(),
      'not-a-uuid',
      CREATOR_ID
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('rejects malformed creatorId with 403 FORBIDDEN', async () => {
    const response = await handleDeleteCampaignItem(
      deleteRequest(),
      CAMPAIGN_ID,
      'not-a-uuid'
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('returns 403 FORBIDDEN when campaign is not found', async () => {
    const deps = createMockRemoveDeps({
      getCampaign: vi.fn().mockResolvedValue(null),
    });

    const response = await handleDeleteCampaignItem(
      deleteRequest(),
      CAMPAIGN_ID,
      CREATOR_ID,
      { removeFromCartDeps: deps }
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('returns 409 CAMPAIGN_NOT_DRAFT when campaign is not draft', async () => {
    const deps = createMockRemoveDeps({
      getCampaign: vi.fn().mockResolvedValue({
        ...mockCampaign,
        status: 'confirmed',
      }),
    });

    const response = await handleDeleteCampaignItem(
      deleteRequest(),
      CAMPAIGN_ID,
      CREATOR_ID,
      { removeFromCartDeps: deps }
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.CAMPAIGN_NOT_DRAFT);
  });

  it('returns 404 NOT_FOUND when item not found in cart', async () => {
    const deps = createMockRemoveDeps({
      deleteItem: vi.fn().mockResolvedValue([]),
    });

    const response = await handleDeleteCampaignItem(
      deleteRequest(),
      CAMPAIGN_ID,
      CREATOR_ID,
      { removeFromCartDeps: deps }
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND);
  });
});

describe('remove-from-cart button (AC-015 — the brand-facing half)', () => {
  // Source guards only. There is no DOM environment in this repo, so these
  // prove the component references the right things — never that it renders.
  const BUTTON_SOURCE = readFileSync(
    'components/campaign/remove-from-cart-button.tsx',
    'utf8'
  );
  const BUTTON = stripComments(BUTTON_SOURCE);
  const PAGE = stripComments(
    readFileSync('app/(brand)/(onboarded)/campaigns/[id]/page.tsx', 'utf8')
  );
  const ADD_FORM = stripComments(
    readFileSync('components/campaign/add-to-cart-form.tsx', 'utf8')
  );

  it('strips comments without stripping the component (guards are not vacuous)', () => {
    expect(BUTTON).toContain('export function RemoveFromCartButton');
    expect(PAGE).toContain('export default async function CampaignCartPage');
    expect(ADD_FORM).toContain('export function AddToCartForm');
  });

  it('the cart page renders a remove control for each item', () => {
    // Without this the endpoint is unreachable from the product and AC-015's
    // first clause — "a brand removes a creator" — has no surface at all.
    expect(PAGE).toContain('RemoveFromCartButton');
    expect(PAGE).toContain(
      "from '@/components/campaign/remove-from-cart-button'"
    );
    expect(PAGE).toContain('creatorId={item.creatorId}');
    expect(PAGE).toContain('creatorHandle={item.creator.tiktokHandle}');
  });

  it('shows the control only on a draft campaign', () => {
    // The guard moved from a condition on the button to the branch that decides
    // whether a cart is rendered at all (KAN-68). `settled` is
    // `status !== 'draft'`, the deals list is its first arm and the cart its
    // second, so a confirmed campaign never reaches the remove control — the two
    // lists are the same creators at different stages and showing both would
    // duplicate them.
    //
    // Asserted as structure rather than as the old inline `&&` so this test stays
    // about the rule instead of its spelling.
    expect(PAGE).toContain("const settled = campaign.status !== 'draft'");

    const ternary = PAGE.search(/settled \? \(/);
    const dealsBranch = PAGE.indexOf('Deals ({deals.length})');
    const cartBranch = PAGE.indexOf('Cart ({items.length})');
    const button = PAGE.indexOf('<RemoveFromCartButton');

    expect(ternary).toBeGreaterThan(-1);
    expect(dealsBranch).toBeGreaterThan(ternary);
    expect(cartBranch).toBeGreaterThan(dealsBranch);
    expect(button).toBeGreaterThan(cartBranch);
  });

  it('calls DELETE on the item endpoint with both ids encoded', () => {
    expect(BUTTON).toMatch(/method:\s*'DELETE'/);
    expect(BUTTON).toContain(
      '`/api/campaigns/${encodeURIComponent(campaignId)}/items/${encodeURIComponent(creatorId)}`'
    );
  });

  it('re-reads the totals from the server rather than patching them client-side', () => {
    // AC-015's second clause. The summary is server-rendered from
    // `sumCartTotal`; trusting the response body here would let the two
    // disagree after any concurrent change.
    expect(BUTTON).toContain('router.refresh()');
    expect(BUTTON).not.toContain('running_total');
    expect(BUTTON).not.toContain('remaining_budget');
  });

  it('confirms before removing, since the action is destructive and one click away', () => {
    expect(BUTTON).toContain('window.confirm');
    // The confirm names the creator — "Remove this item?" on a list of five
    // does not tell a brand which one they are about to drop.
    expect(BUTTON).toContain('${creatorHandle}');
  });

  it('names the creator in the accessible label', () => {
    // Five buttons all reading "Remove" are indistinguishable to a screen
    // reader walking the list.
    expect(BUTTON).toMatch(
      /aria-label=\{`\$\{REMOVE_FROM_CART_LABEL\} \$\{creatorHandle\}`\}/
    );
  });

  it('is a plain button with buttonVariants, not the Base UI Button', () => {
    // Base UI's `Button` is a client component; this file is already a client
    // component, but the precedent is the styling helper either way, and
    // `<Button render={<Link/>}>` is the shape the repo has banned.
    expect(BUTTON).toContain('buttonVariants({');
    expect(BUTTON).not.toMatch(/import \{[^}]*\bButton\b[^}]*\} from/);
    expect(BUTTON).not.toContain('<Button');
  });

  it('disables itself while the request is in flight and says so', () => {
    expect(BUTTON).toContain('disabled={removing}');
    expect(BUTTON).toContain('REMOVE_FROM_CART_PENDING_LABEL');
    // A disabled control explains itself beside the control, never on hover.
    expect(BUTTON).not.toContain('title=');
  });

  it('distinguishes an already-gone item from a real failure', () => {
    // A 404 here means someone else removed them, or this is a second click.
    // Reporting that as "failed" tells the brand to retry something that has
    // already happened.
    expect(BUTTON).toContain("code === 'NOT_FOUND'");
    expect(BUTTON).toContain('REMOVE_FROM_CART_MISSING');
    expect(BUTTON).toContain("code === 'CAMPAIGN_NOT_DRAFT'");
  });

  it('holds its copy in constants, and both cart paths share the not-draft sentence', () => {
    expect(REMOVE_FROM_CART_LABEL).toBe('Remove');
    expect(REMOVE_FROM_CART_MISSING).toBe(
      'That creator is no longer in this cart.'
    );
    expect(CAMPAIGN_NOT_DRAFT_MESSAGE).toBe(
      'This campaign is no longer a draft and cannot be edited.'
    );

    // Neither component retypes a string the constants already own — that is
    // what stops a later edit paraphrasing one copy away from the other.
    expect(BUTTON).not.toContain("'Remove'");
    expect(ADD_FORM).toContain('CAMPAIGN_NOT_DRAFT_MESSAGE');
    expect(ADD_FORM).not.toContain('no longer a draft');
  });

  it('puts no ticket number in anything a brand reads', () => {
    const copy = [
      REMOVE_FROM_CART_LABEL,
      REMOVE_FROM_CART_PENDING_LABEL,
      REMOVE_FROM_CART_SUCCESS,
      REMOVE_FROM_CART_MISSING,
      REMOVE_FROM_CART_FAILED,
      CAMPAIGN_NOT_DRAFT_MESSAGE,
    ];
    for (const line of copy) {
      expect(line).not.toMatch(/KAN-\d+/);
    }
    expect(BUTTON).not.toMatch(/KAN-\d+/);
  });
});
