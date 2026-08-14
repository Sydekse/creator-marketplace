import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { campaign, deal } from '@/db/schema';
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

/**
 * How many of a campaign's deals are `accepted` — the set funding would hold for
 * (KAN-43, AC-019).
 *
 * A count and not a list, because the only caller is the fund button's
 * disabled/enabled state and the sentence beside it. The brand's view of *which*
 * creators accepted is KAN-49's campaign dashboard; building it here would widen
 * the ticket for a screen that already exists in the plan.
 *
 * Un-guarded, matching every other function in this module: callers reach it
 * after `getCampaignForBrand` has already scoped the campaign to the session's
 * brand. It is a count of rows the brand's own campaign owns, so it says nothing
 * a brand may not know — but it is only ever called with an id that read
 * returned, never one from a URL.
 */
export async function countAcceptedDeals(campaignId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(deal)
    .where(and(eq(deal.campaignId, campaignId), eq(deal.status, 'accepted')));

  return Number(row?.count ?? 0);
}
