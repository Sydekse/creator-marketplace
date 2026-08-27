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
import type { Tx } from '@/lib/authz';
import { sumCartTotal } from './cart-queries';

export type AddToCartResult =
  | {
      ok: true;
      item: { id: string };
      /** `true` when the creator was already carted and the count grew. */
      updated: boolean;
      runningTotal: number;
      remainingBudget: number;
    }
  | { ok: false; reason: 'budget_exceeded'; excess: number }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_draft'
        | 'creator_not_found'
        | 'creator_not_bookable';
    };

export interface AddToCartDeps {
  getCampaign: (
    tx: Tx,
    campaignId: string,
    brandProfileId: string
  ) => Promise<{
    id: string;
    brandId: string;
    budget: number;
    status: CampaignStatus;
  } | null>;
  getCreatorWithTier: (
    tx: Tx,
    creatorId: string
  ) => Promise<{
    id: string;
    status: CreatorStatus;
    tierId: string | null;
    pricePerVideo: number | null;
    tierActive: boolean | null;
  } | null>;
  /** The existing cart row for (campaign, creator), if one is carted. */
  getExistingItem: (
    tx: Tx,
    campaignId: string,
    creatorId: string
  ) => Promise<{ id: string; videoCount: number } | null>;
  insertItem: (
    tx: Tx,
    values: {
      campaignId: string;
      creatorId: string;
      videoCount: number;
      unitPrice: number;
      totalPrice: number;
      commissionRate: string;
    }
  ) => Promise<{ id: string }>;
  /** Grows an existing row's count and reprices it off the same unit price. */
  updateItemCount: (
    tx: Tx,
    itemId: string,
    values: { videoCount: number; totalPrice: number }
  ) => Promise<{ id: string }>;
  getRunningTotal: (tx: Tx, campaignId: string) => Promise<number>;
  transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}

const defaultDeps: AddToCartDeps = {
  getCampaign: async (tx, campaignId, brandProfileId) => {
    const [row] = await tx
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
      .for('update')
      .limit(1);

    return row ?? null;
  },
  getCreatorWithTier: async (tx, creatorId) => {
    const [row] = await tx
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
  getExistingItem: async (tx, campaignId, creatorId) => {
    const [row] = await tx
      .select({ id: campaignItem.id, videoCount: campaignItem.videoCount })
      .from(campaignItem)
      .where(
        and(
          eq(campaignItem.campaignId, campaignId),
          eq(campaignItem.creatorId, creatorId)
        )
      )
      .limit(1);

    return row ?? null;
  },
  insertItem: async (tx, values) => {
    const [row] = await tx
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
  updateItemCount: async (tx, itemId, values) => {
    const [row] = await tx
      .update(campaignItem)
      .set({
        videoCount: values.videoCount,
        totalPrice: values.totalPrice,
      })
      .where(eq(campaignItem.id, itemId))
      .returning({ id: campaignItem.id });

    return row;
  },
  getRunningTotal: (tx, campaignId) => sumCartTotal(campaignId, tx),
  transaction: (fn) => db.transaction(fn),
};

/**
 * Adds a creator to a brand's draft campaign cart (KAN-30, AC-009, AC-013).
 * Enforces the campaign budget ceiling server-side (KAN-31, AC-014).
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
  return deps.transaction(async (tx) => {
    const camp = await deps.getCampaign(tx, campaignId, brandProfileId);
    if (!camp) {
      return { ok: false, reason: 'not_found' };
    }

    if (camp.status !== 'draft') {
      return { ok: false, reason: 'not_draft' };
    }

    const creator = await deps.getCreatorWithTier(tx, input.creatorId);
    if (!creator) {
      return { ok: false, reason: 'creator_not_found' };
    }

    if (!isBookable(creator) || creator.pricePerVideo === null) {
      return { ok: false, reason: 'creator_not_bookable' };
    }

    const unitPrice = creator.pricePerVideo;
    const currentTotal = await deps.getRunningTotal(tx, campaignId);
    const existing = await deps.getExistingItem(
      tx,
      campaignId,
      input.creatorId
    );

    // Re-adding a carted creator grows their video count instead of failing.
    // The budget ceiling then applies to the *delta* — the increment's cost —
    // not the row's whole new total: the videos already carted were charged
    // against the ceiling when they were added, and charging them again would
    // double-count them. `excess` is still measured against the full running
    // total so the message names the real shortfall.
    const addCount = input.videoCount;
    const delta = unitPrice * addCount;
    const newTotal = currentTotal + delta;
    // AC-014: Enforce budget ceiling server-side. Total cannot exceed budget.
    if (newTotal > camp.budget) {
      return {
        ok: false,
        reason: 'budget_exceeded',
        excess: newTotal - camp.budget,
      };
    }

    // We insert into `campaignItem` instead of `deal` to prevent leaking `pending` offers
    // before campaign confirmation (PRD AC-013, AC-009, AC-016) and to respect Tech Spec
    // NFR-012 (audit logging). Cart items have not transitioned into the deal state machine yet.
    if (existing) {
      // The count grows and the row reprices off the same snapshotted unit
      // price, so `total = unit * count` (the CHECK) still holds. The campaign
      // row is locked `for update` above, so two concurrent re-adds serialize —
      // the second reads the count the first wrote.
      const videoCount = existing.videoCount + addCount;
      const updated = await deps.updateItemCount(tx, existing.id, {
        videoCount,
        totalPrice: unitPrice * videoCount,
      });

      return {
        ok: true,
        item: updated,
        updated: true,
        runningTotal: newTotal,
        remainingBudget: camp.budget - newTotal,
      };
    }

    const inserted = await deps.insertItem(tx, {
      campaignId,
      creatorId: input.creatorId,
      videoCount: addCount,
      unitPrice,
      totalPrice: delta,
      commissionRate: COMMISSION_RATE,
    });

    return {
      ok: true,
      item: inserted,
      updated: false,
      runningTotal: newTotal,
      remainingBudget: camp.budget - newTotal,
    };
  });
}
