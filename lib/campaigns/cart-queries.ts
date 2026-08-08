import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { deal, creatorProfile, pricingTier } from '@/db/schema';

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
      total: sql<number>`coalesce(sum(${deal.totalPrice}), 0)::int`,
    })
    .from(deal)
    .where(eq(deal.campaignId, campaignId));

  return result?.total ?? 0;
}

/**
 * Lists all items in a campaign cart, joined with creator profile and tier details.
 */
export async function listCartItems(campaignId: string) {
  const rows = await db
    .select({
      id: deal.id,
      campaignId: deal.campaignId,
      creatorId: deal.creatorId,
      videoCount: deal.videoCount,
      unitPrice: deal.unitPrice,
      totalPrice: deal.totalPrice,
      commissionRate: deal.commissionRate,
      createdAt: deal.createdAt,
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
    .from(deal)
    .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
    .leftJoin(pricingTier, eq(creatorProfile.tierId, pricingTier.id))
    .where(eq(deal.campaignId, campaignId))
    .orderBy(desc(deal.createdAt));

  return rows;
}

export type CartItemRow = Awaited<ReturnType<typeof listCartItems>>[number];

/**
 * Gets a single cart item by campaign ID and creator ID.
 */
export async function getCartItem(campaignId: string, creatorId: string) {
  const [row] = await db
    .select()
    .from(deal)
    .where(and(eq(deal.campaignId, campaignId), eq(deal.creatorId, creatorId)))
    .limit(1);

  return row ?? null;
}
