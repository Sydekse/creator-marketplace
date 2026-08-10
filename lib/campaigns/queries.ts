import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaign } from '@/db/schema';
import { UUID_REGEX } from '@/lib/validation';

/**
 * Read paths for `campaign`.
 */

/**
 * Lists all draft campaigns belonging to a brand profile, ordered by creation date descending.
 *
 * Draft-only, and only for the callers that need it that way: the "add to
 * campaign" picker on a creator's profile, which must never offer a campaign
 * that has already sent its offers, and `GET /api/campaigns`, whose contract is
 * published. A brand's own campaign *list* wants every status —
 * `listCampaignsByBrand` below.
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
 * Every campaign belonging to a brand profile, whatever its status, newest
 * first.
 *
 * This exists because confirmation (KAN-33) is the first thing that moves a
 * campaign out of `draft`. Serving the list view from the draft-only query would
 * mean a brand's campaign vanished from their own list the instant they
 * confirmed it — invisible while nothing could leave `draft`, and a hole the
 * moment something could.
 */
export async function listCampaignsByBrand(brandProfileId: string) {
  return db
    .select()
    .from(campaign)
    .where(eq(campaign.brandId, brandProfileId))
    .orderBy(desc(campaign.createdAt));
}

/**
 * Gets a specific campaign belonging to a brand profile (for edit prefill and viewing).
 */
export async function getCampaignForBrand(
  campaignId: string,
  brandProfileId: string
) {
  if (!UUID_REGEX.test(campaignId)) {
    return null;
  }

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
