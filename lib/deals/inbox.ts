import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { brandProfile, campaign, deal } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import { guard } from '@/lib/authz';
import { groupDeals } from '@/lib/deals/groups';
import type { DealGroup } from '@/lib/deals/groups';

/**
 * The creator's deal inbox (KAN-39, US-006, AC-1).
 *
 * A sibling of `lib/creators/dashboard.ts` rather than a branch inside it. The
 * dashboard shows deals as one section among several and deliberately joins no
 * brand; this is the screen a creator opens *to work through offers*, so it
 * carries who is asking and by when. The two share their grouping and nothing
 * else — `groupDeals` is imported from `lib/deals/groups.ts`, so a status
 * cannot land in different groups on the two screens.
 *
 * **AC-6, ownership, is structural.** `readDealInbox` takes no creator id. The
 * gate runs inside the module and `guard` hands back the caller's own
 * `creatorProfileId` (`lib/authz.ts`), which is the only thing the `where` is
 * built from. There is no argument a caller could pass to read somebody else's
 * offers — a stronger guarantee than checking an argument against the session,
 * because the check cannot be forgotten when there is nothing to check.
 *
 * Note the two hops: `deal.creator_id` references `creator_profile.id`, **not**
 * `user.id`. Filtering on the session user's id would match no rows and read on
 * screen as "you have no offers", which is the quiet version of this bug.
 */

export interface InboxDealRow {
  id: string;
  status: DealStatus;
  campaignName: string;
  /** Who is making the offer — AC-1 is unreadable without it. */
  companyName: string;
  videoCount: number;
  /**
   * `unit_price × video_count`, snapshotted onto the deal at offer time — the
   * gross the brand pays, not the creator's net. The list shows the deal's
   * value; the payout net of commission is on the detail view, where there is
   * room to label it as an estimate (`lib/deals/detail.ts`).
   */
  totalPrice: number;
  offerExpiresAt: Date | null;
}

export interface InboxGroup {
  group: DealGroup;
  deals: InboxDealRow[];
  count: number;
}

export interface DealInbox {
  /** All five groups, always, in `DEAL_GROUPS` order — empty ones included. */
  groups: InboxGroup[];
  /** True when this creator has no deals at all, in any group. */
  isEmpty: boolean;
}

/**
 * Every deal for one creator, newest first, with the campaign and the brand
 * behind it.
 *
 * One query for all five groups rather than five queries: the grouping is a
 * partition of the same rows, so five round trips would read the same index
 * five times to produce the same set (AC-7, NFR-001). Served by
 * `deal_creator_status_idx`.
 *
 * Exported as a builder rather than a promise so a test can read the emitted
 * SQL without a database — the `dealsQuery` / `creatorDetailQuery` precedent.
 * `pg` opens no socket until a query actually runs.
 *
 * Both joins are inner, which is correct rather than convenient: `campaign_id`
 * and `campaign.brand_id` are both `not null` with foreign keys, so a deal with
 * no campaign or a campaign with no brand cannot exist. `company_name` is the
 * brand's trading name, which the brand publishes to be found by — no contact
 * column is selected (NFR-010).
 */
export function inboxQuery(creatorProfileId: string) {
  return db
    .select({
      id: deal.id,
      status: deal.status,
      campaignName: campaign.name,
      companyName: brandProfile.companyName,
      videoCount: deal.videoCount,
      totalPrice: deal.totalPrice,
      offerExpiresAt: deal.offerExpiresAt,
    })
    .from(deal)
    .innerJoin(campaign, eq(deal.campaignId, campaign.id))
    .innerJoin(brandProfile, eq(campaign.brandId, brandProfile.id))
    .where(eq(deal.creatorId, creatorProfileId))
    .orderBy(desc(deal.createdAt));
}

/** Seam for tests, matching the shape the rest of `lib/` uses. */
export interface DealInboxDeps {
  requireCreator: () => Promise<{ creatorProfileId: string | null }>;
  selectDeals: (creatorProfileId: string) => Promise<InboxDealRow[]>;
}

const defaultDeps: DealInboxDeps = {
  requireCreator: () => guard({ roles: ['creator'] }),
  selectDeals: (creatorProfileId) => inboxQuery(creatorProfileId),
};

/**
 * The creator's own deals, grouped, pending offers first. Throws
 * `ForbiddenError` for every non-creator caller, including unauthenticated
 * ones — `guard` fails closed.
 *
 * Returns `null` when the caller is a creator with no profile row yet. That is
 * the pre-onboarding state, and it is the page's cue to redirect to the form
 * rather than render an empty inbox — the same thing `readCreatorDashboard`
 * does.
 *
 * "Pending offers first" is not sorted here. `DEAL_GROUPS` puts `pending` at
 * the head of the group order, so it falls out of the vocabulary rather than
 * out of a comparator a later edit could reorder.
 */
export async function readDealInbox(
  deps: DealInboxDeps = defaultDeps
): Promise<DealInbox | null> {
  const { creatorProfileId } = await deps.requireCreator();
  if (!creatorProfileId) return null;

  const rows = await deps.selectDeals(creatorProfileId);

  return {
    groups: groupDeals(rows),
    isEmpty: rows.length === 0,
  };
}

/**
 * Inbox copy, held beside the query that serves it, following
 * `NO_MATCHES_TITLE` in `lib/creators/discovery.ts`: a user-facing string
 * defined once cannot be paraphrased apart from itself by a later edit to a
 * page.
 *
 * `NO_DEALS_DESCRIPTION` is deliberately **not** the dashboard's sentence, and
 * not a share of it either. `lib/creators/dashboard.ts` exports a constant of
 * the same name whose text is about a section of that page; this screen is the
 * whole deal list, so "appears here" means something different on each and one
 * string serving both would be wrong on one of them. What must not happen is the
 * *same* sentence existing twice — two copies drift silently, and no test can
 * tell which one a page meant to render.
 */
export const INBOX_TITLE = 'Your deals';
export const INBOX_DESCRIPTION =
  'Offers from brands, and every deal you have accepted. Open one to read its terms.';

export const NO_DEALS_TITLE = 'No offers yet.';
export const NO_DEALS_DESCRIPTION =
  'Brands send offers to the creators they want in a campaign. Anything you are offered, and every deal you go on to accept, is listed on this page.';

/** The per-row link into the detail view (AC-1 → AC-2). */
export const VIEW_DEAL_LABEL = 'View deal';
