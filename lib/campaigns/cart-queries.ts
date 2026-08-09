import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaignItem, creatorProfile, pricingTier } from '@/db/schema';

/**
 * Read paths for campaign cart items (campaign_item table).
 * Cart items are stored separately from deals to preserve the deal state
 * machine invariant — deals only enter 'pending' upon campaign confirmation
 * (PRD AC-016).
 */

import { guard } from '@/lib/authz';

/**
 * Calculates the current running total (sum of total_price in santim) of all
 * items in a campaign cart.
 */
export async function getCartRunningTotal(
  campaignId: string,
  deps = {
    requireOwnership: () =>
      guard({
        roles: ['brand'],
        resource: { kind: 'campaign', id: campaignId },
      }),
  }
): Promise<number> {
  await deps.requireOwnership();
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
export async function listCartItems(
  campaignId: string,
  deps = {
    requireOwnership: () =>
      guard({
        roles: ['brand'],
        resource: { kind: 'campaign', id: campaignId },
      }),
  }
) {
  await deps.requireOwnership();
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
export async function getCartItem(
  campaignId: string,
  creatorId: string,
  deps = {
    requireOwnership: () =>
      guard({
        roles: ['brand'],
        resource: { kind: 'campaign', id: campaignId },
      }),
  }
) {
  await deps.requireOwnership();
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
