import { db } from '@/db';
import { campaign } from '@/db/schema';
import type { CampaignStatus } from '@/db/schema';
import type { CreateCampaignInput } from '@/lib/validation';

/** Postgres check-violation error code. */
const CHECK_VIOLATION = '23514';

/** Constraint name from `db/schema.ts:163`. */
export const BUDGET_CONSTRAINT = 'campaign_budget_positive';

export type CreateCampaignResult =
  | { ok: true; campaign: { id: string; status: CampaignStatus } }
  | { ok: false; reason: 'budget_not_positive' };

export interface CreateCampaignDeps {
  insert: (values: {
    brandId: string;
    name: string;
    goal?: string;
    targetAudience?: Record<string, unknown>;
    budget: number;
    desiredVideos: number;
  }) => Promise<{ id: string; status: CampaignStatus }>;
}

const defaultDeps: CreateCampaignDeps = {
  insert: async (values) => {
    const [row] = await db
      .insert(campaign)
      .values({
        brandId: values.brandId,
        name: values.name,
        goal: values.goal,
        targetAudience: values.targetAudience,
        budget: values.budget,
        desiredVideos: values.desiredVideos,
        status: 'draft',
      })
      .returning({
        id: campaign.id,
        status: campaign.status,
      });
    return row;
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
 * Creates a campaign brief in draft status for an already-authorized brand.
 *
 * `brandProfileId` comes from `guard()` via authz resolution, never from
 * the client payload.
 */
export async function createCampaign(
  brandProfileId: string,
  input: CreateCampaignInput,
  deps: CreateCampaignDeps = defaultDeps
): Promise<CreateCampaignResult> {
  try {
    const created = await deps.insert({
      brandId: brandProfileId,
      name: input.name,
      goal: input.goal,
      targetAudience: input.targetAudience,
      budget: input.budget,
      desiredVideos: input.desiredVideos,
    });

    return { ok: true, campaign: created };
  } catch (error) {
    const constraint = checkViolationConstraint(error);
    if (constraint === BUDGET_CONSTRAINT) {
      return { ok: false, reason: 'budget_not_positive' };
    }
    throw error;
  }
}
