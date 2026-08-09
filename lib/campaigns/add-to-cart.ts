import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  campaign,
  campaignItem,
  creatorProfile,
  pricingTier,
} from '@/db/schema';
import type { CampaignStatus, CreatorStatus } from '@/db/schema';
import { COMMISSION_RATE } from '@/lib/config/pricing';
import { isBookable } from '@/lib/creators/queries';
import type { AddCampaignItemInput } from '@/lib/validation';
import { getCartRunningTotal } from './cart-queries';

/** Postgres error codes */
const UNIQUE_VIOLATION = '23505';

/** Constraint name from `db/schema.ts` */
export const CAMPAIGN_CREATOR_UNIQUE_CONSTRAINT =
  'campaign_item_campaign_creator_unique';

export type AddToCartResult =
  | {
      ok: true;
      item: { id: string };
      runningTotal: number;
      remainingBudget: number;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_draft'
        | 'creator_not_found'
        | 'creator_not_bookable'
        | 'creator_already_in_cart';
    };

export interface AddToCartDeps {
  getCampaign: (
    campaignId: string,
    brandProfileId: string
  ) => Promise<{
    id: string;
    brandId: string;
    budget: number;
    status: CampaignStatus;
  } | null>;
  getCreatorWithTier: (creatorId: string) => Promise<{
    id: string;
    status: CreatorStatus;
    tierId: string | null;
    pricePerVideo: number | null;
    tierActive: boolean | null;
  } | null>;
  insertItem: (values: {
    campaignId: string;
    creatorId: string;
    videoCount: number;
    unitPrice: number;
    totalPrice: number;
    commissionRate: string;
  }) => Promise<{ id: string }>;
  getRunningTotal: (campaignId: string) => Promise<number>;
}

const defaultDeps: AddToCartDeps = {
  getCampaign: async (campaignId, brandProfileId) => {
    const [row] = await db
      .select({
        id: campaign.id,
        brandId: campaign.brandId,
        budget: campaign.budget,
        status: campaign.status,
      })
      .from(campaign)
      .where(
        and(eq(campaign.id, campaignId), eq(campaign.brandId, brandProfileId))
      )
      .limit(1);

    return row ?? null;
  },
  getCreatorWithTier: async (creatorId) => {
    const [row] = await db
      .select({
        id: creatorProfile.id,
        status: creatorProfile.status,
        tierId: creatorProfile.tierId,
        pricePerVideo: pricingTier.pricePerVideo,
        tierActive: pricingTier.active,
      })
      .from(creatorProfile)
      .leftJoin(pricingTier, eq(creatorProfile.tierId, pricingTier.id))
      .where(eq(creatorProfile.id, creatorId))
      .limit(1);

    return row ?? null;
  },
  insertItem: async (values) => {
    const [row] = await db
      .insert(campaignItem)
      .values({
        campaignId: values.campaignId,
        creatorId: values.creatorId,
        videoCount: values.videoCount,
        unitPrice: values.unitPrice,
        totalPrice: values.totalPrice,
        commissionRate: values.commissionRate,
      })
      .returning({ id: campaignItem.id });

    return row;
  },
  getRunningTotal: getCartRunningTotal,
};

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, constraint } = error as {
    code?: unknown;
    constraint?: unknown;
  };
  return (
    code === UNIQUE_VIOLATION &&
    constraint === CAMPAIGN_CREATOR_UNIQUE_CONSTRAINT
  );
}

/**
 * Adds a creator to a brand's draft campaign cart (KAN-30, AC-009, AC-013).
 *
 * `brandProfileId` comes from `guard()` via authz resolution, never from
 * the client payload.
 */
export async function addToCart(
  campaignId: string,
  brandProfileId: string,
  input: AddCampaignItemInput,
  deps: AddToCartDeps = defaultDeps
): Promise<AddToCartResult> {
  const camp = await deps.getCampaign(campaignId, brandProfileId);
  if (!camp) {
    return { ok: false, reason: 'not_found' };
  }

  if (camp.status !== 'draft') {
    return { ok: false, reason: 'not_draft' };
  }

  const creator = await deps.getCreatorWithTier(input.creatorId);
  if (!creator) {
    return { ok: false, reason: 'creator_not_found' };
  }

  if (!isBookable(creator) || creator.pricePerVideo === null) {
    return { ok: false, reason: 'creator_not_bookable' };
  }

  const unitPrice = creator.pricePerVideo;
  const totalPrice = unitPrice * input.videoCount;

  // We insert into `campaignItem` instead of `deal` to prevent leaking `pending` offers
  // before campaign confirmation (PRD AC-013, AC-009, AC-016) and to respect Tech Spec
  // NFR-012 (audit logging). Cart items have not transitioned into the deal state machine yet.
  let inserted: { id: string };
  try {
    inserted = await deps.insertItem({
      campaignId,
      creatorId: input.creatorId,
      videoCount: input.videoCount,
      unitPrice,
      totalPrice,
      commissionRate: COMMISSION_RATE,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: 'creator_already_in_cart' };
    }
    throw error;
  }

  const runningTotal = await deps.getRunningTotal(campaignId);
  const remainingBudget = camp.budget - runningTotal;

  return {
    ok: true,
    item: inserted,
    runningTotal,
    remainingBudget,
  };
}
