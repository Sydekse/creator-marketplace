import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaign } from '@/db/schema';
import type { CampaignStatus } from '@/db/schema';
import type { UpdateCampaignInput } from '@/lib/validation';

/** Postgres check-violation error code. */
const CHECK_VIOLATION = '23514';

/** Constraint name from `db/schema.ts:163`. */
export const BUDGET_CONSTRAINT = 'campaign_budget_positive';

export interface UpdatedCampaign {
  id: string;
  name: string;
  goal: string | null;
  targetAudience: unknown;
  budget: number;
  desiredVideos: number;
  status: CampaignStatus;
}

export type UpdateCampaignResult =
  | { ok: true; campaign: UpdatedCampaign }
  | { ok: false; reason: 'not_found' | 'not_draft' | 'budget_not_positive' };

export interface UpdateCampaignDeps {
  load: (
    id: string,
    brandId: string
  ) => Promise<{ id: string; status: CampaignStatus } | null>;
  update: (args: {
    id: string;
    brandId: string;
    name: string;
    goal?: string;
    targetAudience?: Record<string, unknown>;
    budget: number;
    desiredVideos: number;
  }) => Promise<UpdatedCampaign | null>;
}

const defaultDeps: UpdateCampaignDeps = {
  load: async (id, brandId) => {
    const [row] = await db
      .select({ id: campaign.id, status: campaign.status })
      .from(campaign)
      .where(and(eq(campaign.id, id), eq(campaign.brandId, brandId)))
      .limit(1);
    return row ?? null;
  },
  update: async ({
    id,
    brandId,
    name,
    goal,
    targetAudience,
    budget,
    desiredVideos,
  }) => {
    const [row] = await db
      .update(campaign)
      .set({
        name,
        goal: goal ?? null,
        targetAudience: targetAudience ?? null,
        budget,
        desiredVideos,
      })
      .where(and(eq(campaign.id, id), eq(campaign.brandId, brandId)))
      .returning({
        id: campaign.id,
        name: campaign.name,
        goal: campaign.goal,
        targetAudience: campaign.targetAudience,
        budget: campaign.budget,
        desiredVideos: campaign.desiredVideos,
        status: campaign.status,
      });
    return row ?? null;
  },
};

function checkViolationConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as {
    code?: unknown;
    constraint?: unknown;
  };
  if (code !== CHECK_VIOLATION) return null;
  return typeof constraint === 'string' ? constraint : '';
}

/**
 * Updates a draft campaign brief for an already-authorized brand.
 *
 * Locked once a campaign moves beyond 'draft' status.
 */
export async function updateCampaign(
  campaignId: string,
  brandProfileId: string,
  input: UpdateCampaignInput,
  deps: UpdateCampaignDeps = defaultDeps
): Promise<UpdateCampaignResult> {
  const existing = await deps.load(campaignId, brandProfileId);
  if (!existing) {
    return { ok: false, reason: 'not_found' };
  }

  if (existing.status !== 'draft') {
    return { ok: false, reason: 'not_draft' };
  }

  try {
    const updated = await deps.update({
      id: campaignId,
      brandId: brandProfileId,
      name: input.name,
      goal: input.goal,
      targetAudience: input.targetAudience,
      budget: input.budget,
      desiredVideos: input.desiredVideos,
    });

    if (!updated) {
      return { ok: false, reason: 'not_found' };
    }

    return { ok: true, campaign: updated };
  } catch (error) {
    const constraint = checkViolationConstraint(error);
    if (constraint === BUDGET_CONSTRAINT) {
      return { ok: false, reason: 'budget_not_positive' };
    }
    throw error;
  }
}
