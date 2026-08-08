import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BUDGET_CONSTRAINT,
  createCampaign,
} from '../lib/campaigns/create-campaign';
import type { CreateCampaignDeps } from '../lib/campaigns/create-campaign';
import { updateCampaign } from '../lib/campaigns/update-campaign';
import type { UpdateCampaignDeps } from '../lib/campaigns/update-campaign';
import { ForbiddenError } from '../lib/authz';
import {
  ErrorCode,
  ErrorMessage,
  MAX_CAMPAIGN_GOAL_LENGTH,
  MAX_CAMPAIGN_NAME_LENGTH,
  createCampaignSchema,
  updateCampaignSchema,
} from '../lib/validation';

/**
 * KAN-26 — Brand creates a campaign brief in Draft with budget validation.
 *
 * Covers:
 *   - US-003, AC-007: Brief in draft status, lists drafts
 *   - US-003, AC-008: Budget validation (> 0), returns 422 BUDGET_NOT_POSITIVE
 *   - Draft edit path (PATCH /api/campaigns/:id)
 *   - Structural constraints and gate inheritance
 */

// Mock the authorization guard
const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleCreateCampaign, handleListCampaigns } =
  await import('../app/api/campaigns/route');
const { handleUpdateCampaign } =
  await import('../app/api/campaigns/[id]/route');

const BRAND_USER_ID = 'user-brand-123';
const BRAND_PROFILE_ID = '3f1a6c9e-1c2b-4f6d-9a1e-2b7c8d9e0f11';
const CAMPAIGN_ID = '7a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';

function postRequest(body: unknown, raw?: string) {
  return new Request('http://localhost/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

function getRequest() {
  return new Request('http://localhost/api/campaigns', {
    method: 'GET',
  });
}

function patchRequest(id: string, body: unknown, raw?: string) {
  return new Request(`http://localhost/api/campaigns/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

function checkViolation(constraint: string) {
  return Object.assign(
    new Error('new row for relation "campaign" violates check constraint'),
    { code: '23514', constraint }
  );
}

function readSource(relative: string) {
  return readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    'utf8'
  );
}

beforeEach(() => {
  guardMock.mockReset();
  guardMock.mockResolvedValue({
    user: {
      id: BRAND_USER_ID,
      email: 'brand@example.com',
      name: 'Brand User',
      role: 'brand',
    },
    brandProfileId: BRAND_PROFILE_ID,
    creatorProfileId: null,
  });
});

// ============================================================================
// Schemas
// ============================================================================

describe('createCampaignSchema', () => {
  it('accepts a fully populated valid campaign payload', () => {
    const parsed = createCampaignSchema.parse({
      name: 'Summer Product Launch',
      goal: 'Drive awareness for new cosmetic line',
      targetAudience: { region: 'Addis Ababa', age: '18-35' },
      budget: 500000, // in santim
      desiredVideos: 5,
    });
    expect(parsed.name).toBe('Summer Product Launch');
    expect(parsed.goal).toBe('Drive awareness for new cosmetic line');
    expect(parsed.targetAudience).toEqual({
      region: 'Addis Ababa',
      age: '18-35',
    });
    expect(parsed.budget).toBe(500000);
    expect(parsed.desiredVideos).toBe(5);
  });

  it('accepts minimal required fields', () => {
    const parsed = createCampaignSchema.parse({
      name: 'Minimal Campaign',
      budget: 10000,
      desiredVideos: 1,
    });
    expect(parsed.name).toBe('Minimal Campaign');
    expect(parsed.budget).toBe(10000);
    expect(parsed.desiredVideos).toBe(1);
    expect(parsed.goal).toBeUndefined();
    expect(parsed.targetAudience).toBeUndefined();
  });

  it('trims whitespace and transforms empty goal to undefined', () => {
    const parsed = createCampaignSchema.parse({
      name: '  Trimmed Campaign  ',
      goal: '   ',
      budget: 25000,
      desiredVideos: 2,
    });
    expect(parsed.name).toBe('Trimmed Campaign');
    expect(parsed.goal).toBeUndefined();
  });

  it('rejects empty campaign name', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: '   ',
        budget: 50000,
        desiredVideos: 3,
      })
    ).toThrow('Campaign name is required.');
  });

  it('rejects campaign name exceeding MAX_CAMPAIGN_NAME_LENGTH', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: 'A'.repeat(MAX_CAMPAIGN_NAME_LENGTH + 1),
        budget: 50000,
        desiredVideos: 3,
      })
    ).toThrow();
  });

  it('rejects goal exceeding MAX_CAMPAIGN_GOAL_LENGTH', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: 'Valid Name',
        goal: 'G'.repeat(MAX_CAMPAIGN_GOAL_LENGTH + 1),
        budget: 50000,
        desiredVideos: 3,
      })
    ).toThrow();
  });

  it('rejects zero budget with spec message (AC-008)', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: 'Test',
        budget: 0,
        desiredVideos: 1,
      })
    ).toThrow('Budget must be greater than zero.');
  });

  it('rejects negative budget with spec message (AC-008)', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: 'Test',
        budget: -500,
        desiredVideos: 1,
      })
    ).toThrow('Budget must be greater than zero.');
  });

  it('rejects non-integer budget', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: 'Test',
        budget: 100.5,
        desiredVideos: 1,
      })
    ).toThrow();
  });

  it('rejects zero or negative desiredVideos', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: 'Test',
        budget: 10000,
        desiredVideos: 0,
      })
    ).toThrow('Desired videos must be greater than zero.');

    expect(() =>
      createCampaignSchema.parse({
        name: 'Test',
        budget: 10000,
        desiredVideos: -2,
      })
    ).toThrow('Desired videos must be greater than zero.');
  });

  it('rejects extra unknown fields due to strict mode', () => {
    expect(() =>
      createCampaignSchema.parse({
        name: 'Test',
        budget: 10000,
        desiredVideos: 1,
        status: 'confirmed',
      })
    ).toThrow();
  });
});

describe('updateCampaignSchema', () => {
  it('accepts valid update payload', () => {
    const parsed = updateCampaignSchema.parse({
      name: 'Updated Name',
      budget: 800000,
      desiredVideos: 8,
      goal: 'Updated Goal',
    });
    expect(parsed.name).toBe('Updated Name');
    expect(parsed.budget).toBe(800000);
    expect(parsed.desiredVideos).toBe(8);
  });

  it('rejects zero or negative budget', () => {
    expect(() =>
      updateCampaignSchema.parse({
        name: 'Test',
        budget: 0,
        desiredVideos: 1,
      })
    ).toThrow('Budget must be greater than zero.');
  });
});

// ============================================================================
// Service Layer
// ============================================================================

describe('createCampaign service', () => {
  it('inserts campaign with draft status and returns id', async () => {
    const insertMock = vi.fn().mockResolvedValue({
      id: CAMPAIGN_ID,
      status: 'draft',
    });
    const deps: CreateCampaignDeps = { insert: insertMock };

    const result = await createCampaign(
      BRAND_PROFILE_ID,
      {
        name: 'Winter Campaign',
        budget: 100000,
        desiredVideos: 2,
      },
      deps
    );

    expect(result).toEqual({
      ok: true,
      campaign: { id: CAMPAIGN_ID, status: 'draft' },
    });
    expect(insertMock).toHaveBeenCalledWith({
      brandId: BRAND_PROFILE_ID,
      name: 'Winter Campaign',
      goal: undefined,
      targetAudience: undefined,
      budget: 100000,
      desiredVideos: 2,
    });
  });

  it('catches postgres 23514 check-violation on budget', async () => {
    const deps: CreateCampaignDeps = {
      insert: vi.fn().mockRejectedValue(checkViolation(BUDGET_CONSTRAINT)),
    };

    const result = await createCampaign(
      BRAND_PROFILE_ID,
      {
        name: 'Invalid Budget Campaign',
        budget: 100000,
        desiredVideos: 2,
      },
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'budget_not_positive' });
  });

  it('re-throws other unexpected errors', async () => {
    const deps: CreateCampaignDeps = {
      insert: vi.fn().mockRejectedValue(new Error('DB connection lost')),
    };

    await expect(
      createCampaign(
        BRAND_PROFILE_ID,
        {
          name: 'Test',
          budget: 10000,
          desiredVideos: 1,
        },
        deps
      )
    ).rejects.toThrow('DB connection lost');
  });
});

describe('updateCampaign service', () => {
  it('updates draft campaign successfully', async () => {
    const deps: UpdateCampaignDeps = {
      load: vi.fn().mockResolvedValue({ id: CAMPAIGN_ID, status: 'draft' }),
      update: vi.fn().mockResolvedValue({
        id: CAMPAIGN_ID,
        name: 'New Name',
        goal: 'New Goal',
        targetAudience: null,
        budget: 200000,
        desiredVideos: 3,
        status: 'draft',
      }),
    };

    const result = await updateCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      {
        name: 'New Name',
        goal: 'New Goal',
        budget: 200000,
        desiredVideos: 3,
      },
      deps
    );

    expect(result).toEqual({
      ok: true,
      campaign: {
        id: CAMPAIGN_ID,
        name: 'New Name',
        goal: 'New Goal',
        targetAudience: null,
        budget: 200000,
        desiredVideos: 3,
        status: 'draft',
      },
    });
  });

  it('returns not_found if campaign does not exist or brand does not own it', async () => {
    const deps: UpdateCampaignDeps = {
      load: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    };

    const result = await updateCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      {
        name: 'New Name',
        budget: 200000,
        desiredVideos: 3,
      },
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_draft if campaign status is not draft', async () => {
    const deps: UpdateCampaignDeps = {
      load: vi.fn().mockResolvedValue({ id: CAMPAIGN_ID, status: 'confirmed' }),
      update: vi.fn(),
    };

    const result = await updateCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      {
        name: 'New Name',
        budget: 200000,
        desiredVideos: 3,
      },
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'not_draft' });
  });

  it('catches check violation on budget update', async () => {
    const deps: UpdateCampaignDeps = {
      load: vi.fn().mockResolvedValue({ id: CAMPAIGN_ID, status: 'draft' }),
      update: vi.fn().mockRejectedValue(checkViolation(BUDGET_CONSTRAINT)),
    };

    const result = await updateCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      {
        name: 'New Name',
        budget: 200000,
        desiredVideos: 3,
      },
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'budget_not_positive' });
  });
});

// ============================================================================
// Route Handlers
// ============================================================================

describe('POST /api/campaigns (handleCreateCampaign)', () => {
  it('creates campaign brief in draft and returns 201 with id and status', async () => {
    const deps: CreateCampaignDeps = {
      insert: vi.fn().mockResolvedValue({
        id: CAMPAIGN_ID,
        status: 'draft',
      }),
    };

    const request = postRequest({
      name: 'Spring Collection',
      goal: 'Promote spring arrival apparel',
      budget: 350000,
      desiredVideos: 4,
    });

    const response = await handleCreateCampaign(request, deps);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body).toEqual({
      id: CAMPAIGN_ID,
      status: 'draft',
    });
  });

  it('returns 422 BUDGET_NOT_POSITIVE when budget is 0 (AC-008)', async () => {
    const request = postRequest({
      name: 'Zero Budget',
      budget: 0,
      desiredVideos: 2,
    });

    const response = await handleCreateCampaign(request);
    expect(response.status).toBe(422);

    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.BUDGET_NOT_POSITIVE);
    expect(body.error.message).toBe(
      ErrorMessage[ErrorCode.BUDGET_NOT_POSITIVE]
    );
  });

  it('returns 422 BUDGET_NOT_POSITIVE when budget is negative (AC-008)', async () => {
    const request = postRequest({
      name: 'Negative Budget',
      budget: -100,
      desiredVideos: 2,
    });

    const response = await handleCreateCampaign(request);
    expect(response.status).toBe(422);

    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.BUDGET_NOT_POSITIVE);
    expect(body.error.message).toBe(
      ErrorMessage[ErrorCode.BUDGET_NOT_POSITIVE]
    );
  });

  it('returns 422 VALIDATION_ERROR with details when name is missing', async () => {
    const request = postRequest({
      budget: 50000,
      desiredVideos: 2,
    });

    const response = await handleCreateCampaign(request);
    expect(response.status).toBe(422);

    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.error.details?.name).toBeDefined();
  });

  it('returns 422 VALIDATION_ERROR when request body is not valid JSON', async () => {
    const request = postRequest(null, '{malformed json');
    const response = await handleCreateCampaign(request);
    expect(response.status).toBe(422);

    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('returns 403 FORBIDDEN when user has no brand profile', async () => {
    guardMock.mockResolvedValueOnce({
      user: { id: 'other-user', role: 'brand' },
      brandProfileId: null,
      creatorProfileId: null,
    });

    const request = postRequest({
      name: 'Test',
      budget: 50000,
      desiredVideos: 1,
    });

    const response = await handleCreateCampaign(request);
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('returns 403 FORBIDDEN when guard throws ForbiddenError', async () => {
    guardMock.mockRejectedValueOnce(new ForbiddenError('not a brand'));

    const request = postRequest({
      name: 'Test',
      budget: 50000,
      desiredVideos: 1,
    });

    const response = await handleCreateCampaign(request);
    expect(response.status).toBe(403);
  });

  it('returns 422 BUDGET_NOT_POSITIVE when db throws 23514 check violation', async () => {
    const deps: CreateCampaignDeps = {
      insert: vi.fn().mockRejectedValue(checkViolation(BUDGET_CONSTRAINT)),
    };

    const request = postRequest({
      name: 'Test',
      budget: 50000,
      desiredVideos: 1,
    });

    const response = await handleCreateCampaign(request, deps);
    expect(response.status).toBe(422);

    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.BUDGET_NOT_POSITIVE);
  });
});

describe('GET /api/campaigns (handleListCampaigns)', () => {
  it('returns 200 with list of draft campaigns in snake_case', async () => {
    const now = new Date();
    const deps = {
      listDrafts: vi.fn().mockResolvedValue([
        {
          id: CAMPAIGN_ID,
          brandId: BRAND_PROFILE_ID,
          name: 'Summer Launch',
          goal: 'Brand awareness',
          targetAudience: { region: 'ET' },
          budget: 500000,
          desiredVideos: 5,
          status: 'draft',
          createdAt: now,
        },
      ]),
    };

    const request = getRequest();
    const response = await handleListCampaigns(request, deps);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      id: CAMPAIGN_ID,
      name: 'Summer Launch',
      goal: 'Brand awareness',
      target_audience: { region: 'ET' },
      budget: 500000,
      desired_videos: 5,
      status: 'draft',
      created_at: now.toISOString(),
    });
  });

  it('returns empty array when brand has no drafts', async () => {
    const deps = {
      listDrafts: vi.fn().mockResolvedValue([]),
    };

    const request = getRequest();
    const response = await handleListCampaigns(request, deps);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual([]);
  });

  it('returns 403 FORBIDDEN when user has no brand profile', async () => {
    guardMock.mockResolvedValueOnce({
      user: { id: 'other-user', role: 'brand' },
      brandProfileId: null,
      creatorProfileId: null,
    });

    const request = getRequest();
    const response = await handleListCampaigns(request);
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/campaigns/:id (handleUpdateCampaign)', () => {
  it('updates draft campaign and returns 200 with updated fields', async () => {
    const deps: UpdateCampaignDeps = {
      load: vi.fn().mockResolvedValue({ id: CAMPAIGN_ID, status: 'draft' }),
      update: vi.fn().mockResolvedValue({
        id: CAMPAIGN_ID,
        name: 'Updated Name',
        goal: 'Updated Goal',
        targetAudience: { age: '25-34' },
        budget: 600000,
        desiredVideos: 6,
        status: 'draft',
      }),
    };

    const request = patchRequest(CAMPAIGN_ID, {
      name: 'Updated Name',
      goal: 'Updated Goal',
      targetAudience: { age: '25-34' },
      budget: 600000,
      desiredVideos: 6,
    });

    const response = await handleUpdateCampaign(request, CAMPAIGN_ID, deps);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({
      id: CAMPAIGN_ID,
      name: 'Updated Name',
      goal: 'Updated Goal',
      target_audience: { age: '25-34' },
      budget: 600000,
      desired_videos: 6,
      status: 'draft',
    });
  });

  it('returns 403 FORBIDDEN for malformed UUID id', async () => {
    const request = patchRequest('not-a-uuid', {
      name: 'Test',
      budget: 10000,
      desiredVideos: 1,
    });

    const response = await handleUpdateCampaign(request, 'not-a-uuid');
    expect(response.status).toBe(403);
  });

  it('returns 409 CAMPAIGN_NOT_DRAFT when campaign is not draft', async () => {
    const deps: UpdateCampaignDeps = {
      load: vi.fn().mockResolvedValue({ id: CAMPAIGN_ID, status: 'funded' }),
      update: vi.fn(),
    };

    const request = patchRequest(CAMPAIGN_ID, {
      name: 'Updated Name',
      budget: 600000,
      desiredVideos: 6,
    });

    const response = await handleUpdateCampaign(request, CAMPAIGN_ID, deps);
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.CAMPAIGN_NOT_DRAFT);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.CAMPAIGN_NOT_DRAFT]);
  });

  it('returns 422 BUDGET_NOT_POSITIVE when budget <= 0', async () => {
    const request = patchRequest(CAMPAIGN_ID, {
      name: 'Updated Name',
      budget: 0,
      desiredVideos: 6,
    });

    const response = await handleUpdateCampaign(request, CAMPAIGN_ID);
    expect(response.status).toBe(422);

    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.BUDGET_NOT_POSITIVE);
  });
});

// ============================================================================
// Structural Assertions
// ============================================================================

describe('Structural & Architectural invariants', () => {
  it('campaigns pages live inside the (onboarded) layout group', () => {
    const campaignsPage = readSource(
      '../app/(brand)/(onboarded)/campaigns/page.tsx'
    );
    const newPage = readSource(
      '../app/(brand)/(onboarded)/campaigns/new/page.tsx'
    );
    const editPage = readSource(
      '../app/(brand)/(onboarded)/campaigns/[id]/edit/page.tsx'
    );

    expect(campaignsPage).toBeDefined();
    expect(newPage).toBeDefined();
    expect(editPage).toBeDefined();
  });

  it('db schema contains check constraints for budget and desiredVideos', () => {
    const schemaSource = readSource('../db/schema.ts');
    expect(schemaSource).toContain('campaign_budget_positive');
    expect(schemaSource).toContain('campaign_desired_videos_positive');
  });

  it('navigation links include Campaigns for brand role', () => {
    const navSource = readSource('../lib/navigation.ts');
    expect(navSource).toContain("label: 'Campaigns'");
    expect(navSource).toContain("href: '/campaigns'");
  });
});
