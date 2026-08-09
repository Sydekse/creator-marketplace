import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaignItem, creatorProfile, pricingTier } from '@/db/schema';

/**
 * Read paths for cart items (deals in a draft campaign).
 */

/**
 * Calculates the current running total (sum of total_price in santim) of all
 * items in a campaign cart.
 */
export async function getCartRunningTotal(campaignId: string): Promise<number> {
  const [result] = await db
    .select({
      total: sql<number>`coalesce(sum(${campaignItem.totalPrice}), 0)::int`,
    })
    .from(campaignItem)
    .where(eq(campaignItem.campaignId, campaignId));

  return result?.total ?? 0;
}

/**
 * Lists all items in a campaign cart, joined with creator profile and tier details.
 */
export async function listCartItems(campaignId: string) {
  const rows = await db
    .select({
      id: campaignItem.id,
      campaignId: campaignItem.campaignId,
      creatorId: campaignItem.creatorId,
      videoCount: campaignItem.videoCount,
      unitPrice: campaignItem.unitPrice,
      totalPrice: campaignItem.totalPrice,
      commissionRate: campaignItem.commissionRate,
      createdAt: campaignItem.createdAt,
      creator: {
        tiktokHandle: creatorProfile.tiktokHandle,
        niche: creatorProfile.niche,
        status: creatorProfile.status,
      },
      tier: {
        id: pricingTier.id,
        name: pricingTier.name,
      },
    })
    .from(campaignItem)
    .innerJoin(creatorProfile, eq(campaignItem.creatorId, creatorProfile.id))
    .leftJoin(pricingTier, eq(creatorProfile.tierId, pricingTier.id))
    .where(eq(campaignItem.campaignId, campaignId))
    .orderBy(desc(campaignItem.createdAt));

  return rows;
}

export type CartItemRow = Awaited<ReturnType<typeof listCartItems>>[number];

/**
 * Gets a single cart item by campaign ID and creator ID.
 */
export async function getCartItem(campaignId: string, creatorId: string) {
  const [row] = await db
    .select()
    .from(campaignItem)
    .where(
      and(
        eq(campaignItem.campaignId, campaignId),
        eq(campaignItem.creatorId, creatorId)
      )
    )
    .limit(1);

  return row ?? null;
}
