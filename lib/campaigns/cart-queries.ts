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
import type { Tx } from '@/lib/authz';

/**
 * Calculates the total price from campaign items, decoupled from authz
 * to allow safe use inside transactions without deadlocks.
 *
 * This is the **draft-only** figure. Once a campaign is confirmed its cart rows
 * stay in place as the brand's record of what was carted and at what price, so
 * they stop being what the budget is measured against — `readCampaignBudget` in
 * `lib/campaigns/budget.ts` switches to the deals at that point (KAN-37,
 * AC-018). Call this directly only from a path that is already draft-only:
 * `add-to-cart.ts` and `remove-from-cart.ts` both are.
 */
export async function sumCartTotal(
  campaignId: string,
  client: typeof db | Tx = db
): Promise<number> {
  const [result] = await client
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
