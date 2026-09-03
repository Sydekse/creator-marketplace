import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  campaign,
  campaignItem,
  deal,
  deliverable,
  ledgerEntry,
} from '@/db/schema';
import { UUID_REGEX } from '@/lib/validation';

/**
 * Read paths for `campaign`.
 */

/**
 * The cart the top-bar icon points at: the brand's most recently created draft
 * campaign, with a count of the creators carted in it.
 *
 * Carts are per-campaign, so a single icon cannot point at "the" cart — it
 * resolves to the newest draft, which is the one a brand actively shopping is
 * almost always building. `null` (no draft) means the icon links to `/campaigns`
 * with no badge — the honest empty state, not a dead control.
 */
export async function getActiveDraftCart(brandProfileId: string) {
  const [row] = await db
    .select({
      campaignId: campaign.id,
      itemCount: sql<number>`count(${campaignItem.id})::int`,
    })
    .from(campaign)
    .leftJoin(campaignItem, eq(campaignItem.campaignId, campaign.id))
    .where(
      and(eq(campaign.brandId, brandProfileId), eq(campaign.status, 'draft'))
    )
    .groupBy(campaign.id)
    .orderBy(desc(campaign.createdAt))
    .limit(1);

  return row ?? null;
}

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
 * The campaign list with the numbers the v4 list rows render: money committed
 * (ledger holds — never recomputed, invariant 4), videos ordered across live
 * deals, and videos delivered. Three grouped reads merged in memory: each
 * aggregates a different child table, and one query with two 1-many joins
 * would cross-multiply the rows.
 */
export async function listCampaignsWithProgress(brandProfileId: string) {
  const [campaigns, committedRows, orderedRows, deliveredRows] =
    await Promise.all([
      listCampaignsByBrand(brandProfileId),
      db
        .select({
          campaignId: ledgerEntry.campaignId,
          committed: sql<number>`coalesce(sum(case when ${ledgerEntry.entryType} = 'hold' then ${ledgerEntry.amount} else 0 end), 0)::int`,
        })
        .from(ledgerEntry)
        .innerJoin(campaign, eq(ledgerEntry.campaignId, campaign.id))
        .where(eq(campaign.brandId, brandProfileId))
        .groupBy(ledgerEntry.campaignId),
      db
        .select({
          campaignId: deal.campaignId,
          ordered: sql<number>`coalesce(sum(${deal.videoCount}), 0)::int`,
        })
        .from(deal)
        .innerJoin(campaign, eq(deal.campaignId, campaign.id))
        .where(
          and(
            eq(campaign.brandId, brandProfileId),
            inArray(deal.status, [
              'funded',
              'delivered',
              'revision_requested',
              'completed',
            ])
          )
        )
        .groupBy(deal.campaignId),
      db
        .select({
          campaignId: deal.campaignId,
          delivered: sql<number>`count(${deliverable.id})::int`,
        })
        .from(deliverable)
        .innerJoin(deal, eq(deliverable.dealId, deal.id))
        .innerJoin(campaign, eq(deal.campaignId, campaign.id))
        .where(eq(campaign.brandId, brandProfileId))
        .groupBy(deal.campaignId),
    ]);

  const committed = new Map(
    committedRows.map((r) => [r.campaignId, Number(r.committed)])
  );
  const ordered = new Map(
    orderedRows.map((r) => [r.campaignId, Number(r.ordered)])
  );
  const delivered = new Map(
    deliveredRows.map((r) => [r.campaignId, Number(r.delivered)])
  );

  return campaigns.map((c) => ({
    ...c,
    committed: committed.get(c.id) ?? 0,
    orderedVideos: ordered.get(c.id) ?? 0,
    deliveredVideos: delivered.get(c.id) ?? 0,
  }));
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

/**
 * Deal statuses that count as "contracted" for the campaign header: the
 * creator said yes and the deal hasn't been unwound. `pending` is an offer,
 * `declined`/`expired` never happened, and `refunded` was contracted but the
 * money went back — showing it as contracted would overstate what the brand
 * is getting.
 */
const CONTRACTED_STATUSES = [
  'accepted',
  'funded',
  'delivered',
  'revision_requested',
  'completed',
] as const;

/**
 * Total videos across the campaign's contracted deals — what the header shows
 * next to the brief's `desiredVideos` wish. Zero until a creator accepts:
 * cart items are the brand talking to itself, not a contract (Nate chose 2
 * videos, the header said "3 videos" from the brief, and the mismatch read as
 * a bug).
 */
export async function sumContractedVideos(campaignId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${deal.videoCount}), 0)::int` })
    .from(deal)
    .where(
      and(
        eq(deal.campaignId, campaignId),
        inArray(deal.status, [...CONTRACTED_STATUSES])
      )
    );
  return Number(row?.total ?? 0);
}
