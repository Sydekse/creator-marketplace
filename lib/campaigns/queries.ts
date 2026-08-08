import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaign } from '@/db/schema';

/**
 * Read paths for `campaign`.
 */

/**
 * Lists all draft campaigns belonging to a brand profile, ordered by creation date descending.
 */
export async function listDraftCampaignsByBrand(brandProfileId: string) {
  return db
    .select()
    .from(campaign)
    .where(
      and(eq(campaign.brandId, brandProfileId), eq(campaign.status, 'draft'))
    )
    .orderBy(desc(campaign.createdAt));
}

/**
 * Gets a specific campaign belonging to a brand profile (for edit prefill and viewing).
 */
export async function getCampaignForBrand(
  campaignId: string,
  brandProfileId: string
) {
  const [row] = await db
    .select()
    .from(campaign)
    .where(
      and(eq(campaign.id, campaignId), eq(campaign.brandId, brandProfileId))
    )
    .limit(1);

  return row ?? null;
}

export type CampaignRow = NonNullable<
  Awaited<ReturnType<typeof getCampaignForBrand>>
>;
