import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaign, creatorProfile, deal, user } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import { guard } from '@/lib/authz';

/**
 * The brand's deals inbox (§15).
 *
 * All deals across all of the brand's campaigns, grouped by campaign. A brand
 * thinks in campaigns, not in deal states — "what's happening with my X
 * campaign?" is the natural question, and the grouping answers it.
 *
 * **Ownership is structural.** The query filters by `campaign.brand_id`, which
 * is resolved from the session. There is no argument a caller could pass to
 * read another brand's deals.
 *
 * **One query, grouped in memory.** Same pattern as the creator inbox
 * (`lib/deals/inbox.ts`) and the performance dashboard (`lib/campaigns/performance.ts`):
 * a single query fetches all rows, and a pure function folds them into groups.
 * Five queries over five campaigns would read the same index five times to
 * produce the same set (NFR-001).
 */

export interface BrandInboxDeal {
  id: string;
  status: DealStatus;
  creatorHandle: string;
  /** The creator's profile picture; initials fallback when null. */
  creatorImage: string | null;
  campaignName: string;
  campaignId: string;
  videoCount: number;
  totalPrice: number;
}

export interface BrandInboxCampaign {
  campaignId: string;
  campaignName: string;
  deals: BrandInboxDeal[];
  count: number;
}

export interface BrandDealInbox {
  campaigns: BrandInboxCampaign[];
  isEmpty: boolean;
}

/** Seam for tests. */
export interface BrandInboxDeps {
  requireBrand: () => Promise<{ brandProfileId: string | null }>;
  selectDeals: (brandProfileId: string) => Promise<BrandInboxDeal[]>;
}

const defaultDeps: BrandInboxDeps = {
  requireBrand: () => guard({ roles: ['brand'] }),
  selectDeals: async (brandProfileId) => {
    return (
      db
        .select({
          id: deal.id,
          status: deal.status,
          creatorHandle: creatorProfile.tiktokHandle,
          creatorImage: user.image,
          campaignName: campaign.name,
          campaignId: campaign.id,
          videoCount: deal.videoCount,
          totalPrice: deal.totalPrice,
        })
        .from(deal)
        .innerJoin(campaign, eq(deal.campaignId, campaign.id))
        .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
        // Only `image` travels off `user` — the row's face, nothing contactable.
        .innerJoin(user, eq(creatorProfile.userId, user.id))
        .where(eq(campaign.brandId, brandProfileId))
        .orderBy(desc(deal.createdAt))
    );
  },
};

/**
 * Groups flat deal rows by campaign, preserving campaign order from the query
 * (newest campaign first, then deals within each campaign newest first).
 *
 * Pure and exported so the grouping logic is testable without a database.
 */
export function groupByCampaign(rows: BrandInboxDeal[]): BrandInboxCampaign[] {
  const groups = new Map<string, BrandInboxCampaign>();

  for (const row of rows) {
    let group = groups.get(row.campaignId);
    if (!group) {
      group = {
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        deals: [],
        count: 0,
      };
      groups.set(row.campaignId, group);
    }
    group.deals.push(row);
    group.count++;
  }

  return [...groups.values()];
}

/**
 * The brand's own deals, grouped by campaign. Throws `ForbiddenError` for
 * every non-brand caller, including unauthenticated ones — `guard` fails
 * closed.
 *
 * Returns `null` when the caller is a brand with no profile row yet (the
 * pre-onboarding state).
 */
export async function readBrandDealInbox(
  deps: BrandInboxDeps = defaultDeps
): Promise<BrandDealInbox | null> {
  const { brandProfileId } = await deps.requireBrand();
  if (!brandProfileId) return null;

  const rows = await deps.selectDeals(brandProfileId);

  return {
    campaigns: groupByCampaign(rows),
    isEmpty: rows.length === 0,
  };
}

/** Inbox copy, held beside the query that serves it. */
export const BRAND_INBOX_TITLE = 'Deals';
export const BRAND_INBOX_DESCRIPTION =
  'Every deal across your campaigns. Open one to review deliverables.';

export const BRAND_NO_DEALS_TITLE = 'No deals yet.';
export const BRAND_NO_DEALS_DESCRIPTION =
  'Deals appear here once you discover creators and send offers through a campaign.';
