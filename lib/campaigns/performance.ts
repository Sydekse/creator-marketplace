import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { creatorProfile, deal, deliverable, videoMetric } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import { ForbiddenError, guard } from '@/lib/authz';
import { sumSettledByCampaign } from '@/lib/payment/escrow';
import { UUID_REGEX } from '@/lib/validation';

/**
 * The brand's campaign performance dashboard (KAN-49, US-009, AC-026, FR-006).
 *
 * Two halves, read together: what each video did, and what the campaign cost. The
 * money half is summed from the ledger and the engagement half from
 * `video_metric` — this module is the first thing in the repo to read that table
 * at all, KAN-48 having been the first to write it.
 *
 * **One row per deal, not per video, and that is a known gap rather than a
 * choice.** AC-026 says "each video shows views, likes, shares, and comments", and
 * the schema cannot express it: `deliverable.deal_id` is unique and
 * `video_metric.deliverable_id` is unique, so a deal for three videos has one
 * submitted URL and one set of counts. **F38** records the whole of it — a brand
 * can pay for three videos and receive one — and the interim decision is that
 * campaigns use one video per creator, which makes a per-deal row exactly a
 * per-video row. Nothing here works around it; the rendering is accurate about the
 * data that exists.
 *
 * **Ownership is in the guard, and the guard is inside this module.** Gated before
 * the argument is looked at, with `resource` so `guard` resolves `campaign.brand_id`
 * itself — the `readCampaignEscrow` shape. A read protected only by its callers is
 * protected as well as its least careful one, and the campaign page is not the only
 * thing that will want this.
 *
 * **Totals exclude what was never measured (AC-026 bullet 3).** A null count is not
 * a zero — the `video_metric` docstring is explicit that a stored `0` is a real,
 * recorded zero — so summing nulls as zeros would understate nothing and overstate
 * coverage, reporting a campaign total that quietly averages in videos nobody has
 * looked at. `toCampaignTotals` is pure and exported so that rule is testable
 * directly rather than through a database.
 */

/** One deal's row on the dashboard: what it cost, and what the video did. */
export interface CampaignVideoRow {
  dealId: string;
  status: DealStatus;
  /** The creator's public handle. No contact column is read (NFR-010). */
  creatorHandle: string;
  videoCount: number;
  /** Price per video, snapshotted onto the deal at offer time (invariant 8). */
  unitPrice: number;
  /** `unit_price × video_count`, guaranteed by `deal_total_price_valid`. */
  totalPrice: number;
  /**
   * The live post, once the creator has submitted (KAN-46). Null before that, and
   * the row still appears — a funded deal awaiting delivery is part of the
   * campaign's story.
   */
  tiktokUrl: string | null;
  submittedAt: Date | null;
  /**
   * The four counts, each independently nullable.
   *
   * Null means "not measured", never zero, and the distinction is per *field*
   * rather than per row: `updateMetricsSchema` accepts any subset, so a creator
   * can record views and leave comments blank. A row with views and no comments
   * shows the views and says the comments are pending.
   */
  views: number | null;
  likes: number | null;
  shares: number | null;
  comments: number | null;
}

/**
 * The campaign's engagement totals, and how much of the campaign they cover.
 *
 * Each figure is `null` when **no** video recorded that metric, so the total
 * itself reads as pending rather than as a confident zero. Where some videos
 * recorded it, the total is the sum of those and `measuredVideos` says how many
 * contributed — a total over 2 of 5 videos is a different claim from a total over
 * all 5, and a dashboard that shows the number without the coverage invites the
 * wrong one.
 */
export interface CampaignTotals {
  views: number | null;
  likes: number | null;
  shares: number | null;
  comments: number | null;
  /** Rows with at least one recorded count. */
  measuredVideos: number;
  /** Rows in total, measured or not. */
  totalVideos: number;
}

/** The four money figures the dashboard states, all integer santim. */
export interface CampaignSettlement {
  /** Released to creators, net of commission, summed from `release_payout`. */
  paidOut: number;
  /** Kept by the platform, summed from `commission`. */
  commission: number;
}

export interface CampaignPerformance {
  videos: CampaignVideoRow[];
  totals: CampaignTotals;
  settlement: CampaignSettlement;
}

/**
 * What a draft campaign's performance is, without asking the database.
 *
 * A draft has no deals, no deliverables and no ledger entries, so every figure is
 * known to be empty. Exported so the page can short-circuit the read on the one
 * screen a brand reloads repeatedly while shopping, and so it does so with a value
 * rather than a `null` that every consumer would then have to defend against.
 */
export const EMPTY_PERFORMANCE: CampaignPerformance = {
  videos: [],
  totals: {
    views: null,
    likes: null,
    shares: null,
    comments: null,
    measuredVideos: 0,
    totalVideos: 0,
  },
  settlement: { paidOut: 0, commission: 0 },
};

/** The four metric keys, in the order AC-026 names them. */
const METRIC_KEYS = ['views', 'likes', 'shares', 'comments'] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export { METRIC_KEYS };

/**
 * The query as a builder rather than a promise, so a test can read the SQL it
 * emits without a database — `brandDealQuery`'s shape.
 *
 * `creator_profile` is an inner join: `deal.creator_id` is `not null` with a
 * foreign key, so it cannot miss. `deliverable` and `video_metric` are **left**
 * joins, and that is the whole reason this read shows what it shows — a funded
 * deal with nothing submitted, and a submitted video nobody has measured, both
 * have to appear and say so. An inner join would silently reduce the dashboard to
 * "videos we happen to have numbers for", which is the failure AC-026 bullet 3 is
 * about seen from the other side.
 *
 * No brand predicate here: this is called only after `readCampaignPerformance`'s
 * guard has resolved `campaign.brand_id` for the id, which is where ownership
 * lives. Ordered by handle so a brand looking for one creator has a stable place
 * to look, matching the list this replaces.
 */
export function campaignVideosQuery(campaignId: string) {
  return db
    .select({
      dealId: deal.id,
      status: deal.status,
      creatorHandle: creatorProfile.tiktokHandle,
      videoCount: deal.videoCount,
      unitPrice: deal.unitPrice,
      totalPrice: deal.totalPrice,
      tiktokUrl: deliverable.tiktokUrl,
      submittedAt: deliverable.submittedAt,
      views: videoMetric.views,
      likes: videoMetric.likes,
      shares: videoMetric.shares,
      comments: videoMetric.comments,
    })
    .from(deal)
    .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
    .leftJoin(deliverable, eq(deliverable.dealId, deal.id))
    .leftJoin(videoMetric, eq(videoMetric.deliverableId, deliverable.id))
    .where(eq(deal.campaignId, campaignId))
    .orderBy(asc(creatorProfile.tiktokHandle));
}

/**
 * Sums each metric across the campaign, counting only what was measured.
 *
 * AC-026 bullet 3, and the only decision in this module worth testing on its own.
 * Per column: `null` when no row recorded it, otherwise the sum of the rows that
 * did. A recorded `0` counts — it is data, and treating it as absence would be the
 * same mistake in the other direction.
 *
 * Pure, and takes rows rather than a campaign id, for the reason `toDealDetail` is
 * pure: this is the arithmetic, and testing arithmetic through a database proves
 * less and costs more.
 */
export function toCampaignTotals(rows: CampaignVideoRow[]): CampaignTotals {
  const totals: CampaignTotals = {
    views: null,
    likes: null,
    shares: null,
    comments: null,
    measuredVideos: 0,
    totalVideos: rows.length,
  };

  for (const row of rows) {
    let rowMeasured = false;

    for (const key of METRIC_KEYS) {
      const value = row[key];
      if (value === null) continue;

      rowMeasured = true;
      // `?? 0` rather than `|| 0`: the running total may legitimately be 0 from a
      // recorded zero, and `||` would restart the sum from that point.
      totals[key] = (totals[key] ?? 0) + value;
    }

    if (rowMeasured) totals.measuredVideos += 1;
  }

  return totals;
}

/** Seam for tests, matching the shape the rest of `lib/campaigns` uses. */
export interface CampaignPerformanceDeps {
  requireOwnership: (campaignId: string) => Promise<unknown>;
  selectVideos: (campaignId: string) => Promise<CampaignVideoRow[]>;
  selectSettlement: (campaignId: string) => Promise<CampaignSettlement>;
}

const defaultDeps: CampaignPerformanceDeps = {
  // Both layers of NFR-005 in one call: the role gate, then `guard` resolving
  // `campaign.brand_id` and throwing for a brand that does not own this campaign.
  // Takes the id rather than closing over it — the `readCampaignEscrow` shape,
  // because these defaults are one module-level object shared by every call.
  requireOwnership: (campaignId) =>
    guard({
      roles: ['brand'],
      resource: { kind: 'campaign', id: campaignId },
    }),
  selectVideos: (campaignId) => campaignVideosQuery(campaignId),
  selectSettlement: (campaignId) => sumSettledByCampaign(campaignId),
};

/**
 * Everything the campaign dashboard shows about performance (AC-026).
 *
 * Throws `ForbiddenError` for every caller that is not the owning brand, including
 * unauthenticated ones and admins — `guard` fails closed.
 *
 * **Throws rather than returning `null`**, following `readCampaignEscrow` and
 * unlike `readCampaignBudget`. That one reads the campaign row, so it can tell a
 * genuine miss from a denial and has something for a `null` to mean. This reads
 * deals and ledger entries: an unknown campaign id sums to zero and lists nothing,
 * which is indistinguishable from a real campaign that has neither. The only place
 * that distinction exists is the guard, which collapses unknown into unowned on
 * purpose (§6.3) — so a nullable return would invite a caller to render an empty
 * dashboard for a denial.
 *
 * The two reads are issued together. They touch different tables and neither feeds
 * the other, so awaiting them in sequence would add a round trip to a page with a
 * three-second budget (NFR-001).
 */
export async function readCampaignPerformance(
  campaignId: string,
  deps: CampaignPerformanceDeps = defaultDeps
): Promise<CampaignPerformance> {
  // Shape-checked before it reaches a `uuid` column, which Postgres answers with
  // `22P02` — a 500 for what is really a mistyped link. `guard` would run that
  // query itself, so this has to come first, and a malformed id belongs to nobody:
  // the same denial the guard would give, without the round trip.
  if (!UUID_REGEX.test(campaignId)) {
    throw new ForbiddenError('malformed campaign id');
  }

  await deps.requireOwnership(campaignId);

  const [videos, settlement] = await Promise.all([
    deps.selectVideos(campaignId),
    deps.selectSettlement(campaignId),
  ]);

  return { videos, totals: toCampaignTotals(videos), settlement };
}

/**
 * Dashboard copy, held beside the query that serves it — the `NO_MATCHES_TITLE`
 * precedent. A string defined once cannot be paraphrased apart from itself by a
 * later edit to a page, and the tests assert the constant *and* that no page
 * retypes it. No KAN number appears in anything a user reads.
 */

/**
 * AC-027's exact string, and the one piece of copy here that is not ours.
 *
 * Borrowed deliberately. AC-027 belongs to KAN-50, but a row with no numbers has
 * to render *something*, and inventing a placeholder would put two strings in the
 * product for one state — the worse outcome, and one KAN-50 would then have to
 * hunt down. What KAN-50 keeps is the rest of AC-027: the last-updated timestamp
 * and the stale marking, both of which KAN-48 now writes real data for and neither
 * of which this ticket reads.
 *
 * "**rather than zeros**" is part of the AC, not a stylistic note — a zero here
 * would claim a measurement nobody took.
 */
export const METRICS_PENDING = 'Metrics pending';

/**
 * One engagement count for display — `25000` → `'25,000'`, `null` →
 * `'Metrics pending'`.
 *
 * Thousands separators for `formatFollowerCount`'s reason: these numbers are
 * compared down a column at a glance, and `25000` beside `250000` is a
 * digit-counting exercise. **Not** abbreviated to `25.0K` — `components/admin/
 * awaiting-tier-list.tsx` does that privately for its own table, and a campaign
 * total a brand might act on should not be rounded on the way to the screen.
 *
 * This is deliberately *not* `formatFollowerCount`, which it otherwise duplicates:
 * the two differ only in what null renders as, and the difference is the point.
 * An absent follower count is `Not provided` — a creator declined to say. An
 * absent metric is `Metrics pending` — nobody has measured yet. Same shape, two
 * different claims, and collapsing them would make one of the two lie. The
 * duplicated `toLocaleString` is recorded as a follow-up rather than resolved by
 * merging two rules that only look alike.
 */
export function formatMetricCount(count: number | null): string {
  if (count === null) return METRICS_PENDING;
  return count.toLocaleString('en-US');
}

export const PERFORMANCE_TITLE = 'Video performance';

export const VIEWS_LABEL = 'Views';
export const LIKES_LABEL = 'Likes';
export const SHARES_LABEL = 'Shares';
export const COMMENTS_LABEL = 'Comments';

/** The labels for the four counts, keyed so a component can iterate them. */
export const METRIC_LABELS: Record<MetricKey, string> = {
  views: VIEWS_LABEL,
  likes: LIKES_LABEL,
  shares: SHARES_LABEL,
  comments: COMMENTS_LABEL,
};

export const CAMPAIGN_TOTAL_LABEL = 'Campaign total';

/**
 * Says which videos the totals actually cover.
 *
 * Not decoration. A campaign total is a number a brand may act on, and a total
 * over 2 of 5 videos means something different from a total over all 5. Without
 * this line the figure reads as complete, which is the same species of overclaim
 * AC-027 forbids one row at a time.
 */
export function coverageNote(measured: number, total: number): string {
  return `Totals cover ${measured} of ${total} ${total === 1 ? 'video' : 'videos'} with recorded metrics.`;
}

export const VIEW_POST_LABEL = 'View post';

export const AWAITING_DELIVERY_LABEL = 'Not submitted yet';

export const NO_VIDEOS_TITLE = 'No videos yet';
export const NO_VIDEOS_DESCRIPTION =
  'Once your creators post their videos and submit the links, each one appears here with its engagement.';

/** The two money rows this ticket adds to the campaign's budget summary. */
export const PAID_OUT_LABEL = 'Paid out';
export const COMMISSION_LABEL = 'Platform commission';

/**
 * Why the paid-out figure can be less than what left escrow.
 *
 * Stated because the two rows beside each other invite the wrong sum: a brand
 * seeing "paid out" next to "held in escrow" may read the commission as an extra
 * charge on top rather than a slice of the same money.
 */
export const SETTLEMENT_NOTE =
  'Paid out and commission together are what has left escrow on approved videos.';
