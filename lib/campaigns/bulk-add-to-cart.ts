import { and, eq, inArray } from 'drizzle-orm';
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
import type { BulkAddCampaignItemsInput } from '@/lib/validation';
import type { Tx } from '@/lib/authz';
import { sumCartTotal } from './cart-queries';

export type BulkAddToCartResult =
  | {
      ok: true;
      /** Rows created (creators not previously carted). */
      added: number;
      /** Rows whose video count grew (creators already carted). */
      updated: number;
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
      /** The creator that failed, so the client can name them. */
      creatorId?: string;
    };

export interface BulkAddToCartDeps {
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
  getCreatorsWithTiers: (
    tx: Tx,
    creatorIds: string[]
  ) => Promise<
    Array<{
      id: string;
      status: CreatorStatus;
      tierId: string | null;
      pricePerVideo: number | null;
      tierActive: boolean | null;
    }>
  >;
  getExistingItems: (
    tx: Tx,
    campaignId: string,
    creatorIds: string[]
  ) => Promise<Array<{ id: string; creatorId: string; videoCount: number }>>;
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
  updateItemCount: (
    tx: Tx,
    itemId: string,
    values: { videoCount: number; totalPrice: number }
  ) => Promise<{ id: string }>;
  getRunningTotal: (tx: Tx, campaignId: string) => Promise<number>;
  transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}

const defaultDeps: BulkAddToCartDeps = {
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
  getCreatorsWithTiers: async (tx, creatorIds) => {
    if (creatorIds.length === 0) return [];
    return tx
      .select({
        id: creatorProfile.id,
        status: creatorProfile.status,
        tierId: creatorProfile.tierId,
        pricePerVideo: pricingTier.pricePerVideo,
        tierActive: pricingTier.active,
      })
      .from(creatorProfile)
      .leftJoin(pricingTier, eq(creatorProfile.tierId, pricingTier.id))
      .where(inArray(creatorProfile.id, creatorIds));
  },
  getExistingItems: async (tx, campaignId, creatorIds) => {
    if (creatorIds.length === 0) return [];
    return tx
      .select({
        id: campaignItem.id,
        creatorId: campaignItem.creatorId,
        videoCount: campaignItem.videoCount,
      })
      .from(campaignItem)
      .where(
        and(
          eq(campaignItem.campaignId, campaignId),
          inArray(campaignItem.creatorId, creatorIds)
        )
      );
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
 * Adds several creators to a draft campaign cart in one transaction — the bulk
 * half of the discover page's mark-and-add flow.
 *
 * One transaction, not N calls to `addToCart`: the budget ceiling has to be
 * checked against the *summed* delta under the campaign row lock, and N separate
 * transactions would each pass a check the batch as a whole fails.
 *
 * Per-creator semantics match `addToCart` exactly: a creator already in the
 * cart has their video count grown by the batch's count (never a second row,
 * never an error), and every row reprices off the creator's snapshotted unit
 * price so the `total = unit * count` CHECK holds.
 *
 * The batch is atomic on creator validity: one unbookable or missing creator
 * refuses the whole batch, because a partial add would leave the brand guessing
 * which of their marked tiles landed. The failing creator's id is returned so
 * the client can name them.
 */
export async function bulkAddToCart(
  campaignId: string,
  brandProfileId: string,
  input: BulkAddCampaignItemsInput,
  deps: BulkAddToCartDeps = defaultDeps
): Promise<BulkAddToCartResult> {
  return deps.transaction(async (tx) => {
    const camp = await deps.getCampaign(tx, campaignId, brandProfileId);
    if (!camp) {
      return { ok: false, reason: 'not_found' };
    }

    if (camp.status !== 'draft') {
      return { ok: false, reason: 'not_draft' };
    }

    // Duplicated ids in one batch would double-count the delta against the
    // ceiling and double-grow an existing row.
    const creatorIds = [...new Set(input.creatorIds)];

    const creators = await deps.getCreatorsWithTiers(tx, creatorIds);
    const byId = new Map(creators.map((c) => [c.id, c]));

    for (const creatorId of creatorIds) {
      const creator = byId.get(creatorId);
      if (!creator) {
        return { ok: false, reason: 'creator_not_found', creatorId };
      }
      if (!isBookable(creator) || creator.pricePerVideo === null) {
        return { ok: false, reason: 'creator_not_bookable', creatorId };
      }
    }

    const existing = await deps.getExistingItems(tx, campaignId, creatorIds);
    const existingByCreator = new Map(
      existing.map((row) => [row.creatorId, row])
    );

    // The ceiling applies to the summed *delta* — the increment each creator's
    // row grows by — on the same reasoning as `addToCart`'s upsert: videos
    // already carted were charged when they were added.
    const currentTotal = await deps.getRunningTotal(tx, campaignId);
    const delta = creatorIds.reduce(
      (sum, id) => sum + byId.get(id)!.pricePerVideo! * input.videoCount,
      0
    );
    const newTotal = currentTotal + delta;
    // AC-014: the budget ceiling holds for a batch exactly as for one add.
    if (newTotal > camp.budget) {
      return {
        ok: false,
        reason: 'budget_exceeded',
        excess: newTotal - camp.budget,
      };
    }

    let added = 0;
    let updated = 0;
    for (const creatorId of creatorIds) {
      const creator = byId.get(creatorId)!;
      const unitPrice = creator.pricePerVideo!;
      const row = existingByCreator.get(creatorId);

      if (row) {
        const videoCount = row.videoCount + input.videoCount;
        await deps.updateItemCount(tx, row.id, {
          videoCount,
          totalPrice: unitPrice * videoCount,
        });
        updated += 1;
      } else {
        await deps.insertItem(tx, {
          campaignId,
          creatorId,
          videoCount: input.videoCount,
          unitPrice,
          totalPrice: unitPrice * input.videoCount,
          commissionRate: COMMISSION_RATE,
        });
        added += 1;
      }
    }

    return {
      ok: true,
      added,
      updated,
      runningTotal: newTotal,
      remainingBudget: camp.budget - newTotal,
    };
  });
}
