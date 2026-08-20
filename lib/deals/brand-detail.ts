import { and, asc, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '@/db';
import {
  campaign,
  creatorProfile,
  deal,
  deliverable,
  rightsTerms,
} from '@/db/schema';
import type { DealStatus, ReviewStatus } from '@/db/schema';
import { guard } from '@/lib/authz';
import { canReview } from '@/lib/deals/state-machine';
import { UUID_REGEX } from '@/lib/validation';

/**
 * One deal, for the brand reviewing its deliverable (KAN-68, US-008, AC-023,
 * AC-024).
 *
 * The mirror of `lib/deals/detail.ts`, which is creator-scoped by construction.
 * The difference is only which side of the deal owns it: there the lookup is
 * ANDed with the session's `creatorProfileId`, here with the owning brand
 * through `campaign.brand_id`. Everything else — the gate running before the
 * arguments, every miss answering `null`, the `deps` seam — is the same shape,
 * because the reasons for it are the same.
 *
 * **Ownership is in the SQL, not checked after the read.** `buildBrandDealWhere`
 * makes the brand id the base that the deal id narrows, so there is no argument
 * a caller could pass that produces a row this brand does not own (NFR-005 layer
 * two). `reject-deliverable.ts` exports its equivalent for the same reason —
 * asserting the ownership half is present is easier here than through a database.
 *
 * **The gate is inside this module**, before the id is even looked at. A read
 * protected only by its callers is protected as well as the least careful one,
 * and this one is reachable from a page a notification links to.
 *
 * **Every kind of miss looks identical**, and all of them are `null`: a
 * malformed id, an id nobody holds, and a real deal on another brand's campaign.
 * Distinguishing them would make the URL an existence oracle for deal ids
 * (Tech Spec §6.3) — `readCreatorDetail` set this rule and `readCreatorDeal`
 * follows it. The page turns `null` into `notFound()`.
 *
 * **`null` rather than a throw** for the reason `readCreatorDeal` documents:
 * there is no error boundary anywhere in this app, so a thrown denial renders an
 * unstyled 500 where a 404 belongs.
 */

/** One submitted video, as the reviewing brand sees it. */
export interface BrandDeliverableView {
  /**
   * The row's own id — the target of `POST /api/deals/{id}/reject`, which now
   * names which video is being sent back (F38). The URL is not enough: two
   * videos on one deal are distinguished by id, not by link.
   */
  id: string;
  tiktokUrl: string;
  submittedAt: Date;
  /**
   * Where the review stands. `pending` is a submission nobody has judged;
   * `rejected` is one sent back and not yet replaced, which is what makes
   * `rejectionReason` worth rendering (AC-7).
   */
  reviewStatus: ReviewStatus;
  reviewedAt: Date | null;
  /** The brand's own words from a previous rejection, or null if never rejected. */
  rejectionReason: string | null;
}

export interface BrandDealDetail {
  id: string;
  status: DealStatus;
  /** So the page can link back to the campaign the deal belongs to. */
  campaignId: string;
  campaignName: string;
  /**
   * The creator's public handle, and nothing else about them.
   *
   * No email, no contact column — the brand has no need of one to judge a video,
   * and a read that selects it puts it one careless render away from a log
   * (NFR-010). `lib/deals/detail.ts` applies the same rule in the other
   * direction, where the creator sees a company name rather than a person.
   */
  creatorHandle: string;
  videoCount: number;
  unitPrice: number;
  totalPrice: number;
  /**
   * The usage-rights version governing this deal (KAN-35's AC-6, which F31
   * assigned to whichever ticket built this screen).
   *
   * The deal's own `rights_terms_id`, never the version currently in effect —
   * that distinction is the whole point. A deal is governed by the text its
   * creator accepted, and a later republication must not retroactively change
   * what a signed agreement says. `readCreatorDeal` substitutes the *current*
   * version while an offer is still open because acceptance has to match it;
   * nothing on this screen is deciding whether to accept, so there is nothing to
   * substitute.
   *
   * Null for an older deal that never recorded one, and the page says so rather
   * than rendering a blank label.
   */
  rightsTermsVersion: string | null;
  /**
   * Every video submitted so far, oldest first (F38).
   *
   * An **array**, and empty rather than null before the creator has submitted
   * anything — a deal priced for three videos can have one, two or three, and the
   * count against `videoCount` is what tells the brand whether there is anything
   * to approve. `deliverables.length < videoCount` means the delivery is still in
   * progress, which is also why `canReview(status)` is false there.
   */
  deliverables: BrandDeliverableView[];
}

/**
 * The lookup, as a `where` clause — layer two of NFR-005 expressed in SQL.
 *
 * The brand id is the base the deal id narrows, so there is no argument that
 * produces a lookup without it. Exported so a test can assert the ownership half
 * is present without standing up a database.
 */
export function buildBrandDealWhere(
  dealId: string,
  brandProfileId: string
): SQL {
  return and(eq(deal.id, dealId), eq(campaign.brandId, brandProfileId)) as SQL;
}

/** One joined row from the deal query. */
export interface BrandDealJoinRow {
  id: string;
  status: DealStatus;
  campaignId: string;
  campaignName: string;
  creatorHandle: string;
  videoCount: number;
  unitPrice: number;
  totalPrice: number;
  rightsTermsVersion: string | null;
}

/**
 * The query as a builder rather than a promise, so a test can read the SQL it
 * emits without a database — `creatorDealQuery`'s shape.
 *
 * `campaign` and `creator_profile` are inner joins: both foreign keys are
 * `not null`, so neither can miss, and the `campaign` join is what the ownership
 * predicate reads. `rights_terms` is **left**, for the reason `creatorDealQuery`
 * gives — a deal with no recorded terms version must come back and say so rather
 * than vanish from its owner's own review screen.
 *
 * **The deliverable join is gone** (F38). A deal can hold several videos, and a
 * one-row query with a left join returned one arbitrary one while silently
 * multiplying the deal's own columns. The videos are a second read
 * (`brandDealDeliverablesQuery`), which is also what lets them be ordered.
 */
export function brandDealQuery(where: SQL) {
  return db
    .select({
      id: deal.id,
      status: deal.status,
      campaignId: campaign.id,
      campaignName: campaign.name,
      creatorHandle: creatorProfile.tiktokHandle,
      videoCount: deal.videoCount,
      unitPrice: deal.unitPrice,
      totalPrice: deal.totalPrice,
      rightsTermsVersion: rightsTerms.version,
    })
    .from(deal)
    .innerJoin(campaign, eq(deal.campaignId, campaign.id))
    .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
    .leftJoin(rightsTerms, eq(deal.rightsTermsId, rightsTerms.id))
    .where(where)
    .limit(1);
}

/**
 * Every video submitted against one deal, oldest first (F38).
 *
 * Ordered by `submitted_at` so the list reads as the delivery happened, and so
 * "video 1" means the same thing on two page loads — an unordered list would
 * renumber itself between renders and make the brand's rejection note ambiguous.
 *
 * Takes the deal id alone: it is issued only after `brandDealQuery` has already
 * proved this brand owns that deal, which is where ownership lives.
 */
export function brandDealDeliverablesQuery(dealId: string) {
  return db
    .select({
      id: deliverable.id,
      tiktokUrl: deliverable.tiktokUrl,
      submittedAt: deliverable.submittedAt,
      reviewStatus: deliverable.reviewStatus,
      reviewedAt: deliverable.reviewedAt,
      rejectionReason: deliverable.rejectionReason,
    })
    .from(deliverable)
    .where(eq(deliverable.dealId, dealId))
    .orderBy(asc(deliverable.submittedAt));
}

/*
 * There is no `toBrandDealDetail` any more, and its absence is the point.
 *
 * It existed to fold a left join's all-nullable columns into one nullable object
 * — the decision "has the creator submitted?" expressed over five columns that
 * were null together. With the videos read as their own rows
 * (`brandDealDeliverablesQuery`) there is nothing nullable to fold: every column
 * is `not null` in the table, so a row that came back is a submission that
 * happened, and "how many videos so far" is `deliverables.length`. A pure
 * function wrapping a spread would be a seam with no decision behind it.
 */

/** Seam for tests, matching the shape the rest of `lib/` uses. */
export interface BrandDealDeps {
  requireBrand: () => Promise<{ brandProfileId: string | null }>;
  select: (where: SQL) => Promise<BrandDealJoinRow | null>;
  /**
   * The deal's videos, read only once the deal itself came back.
   *
   * A second query, and deliberately behind the ownership check — the seam exists
   * so a test can prove the videos are never fetched for a deal this brand does
   * not own.
   */
  selectDeliverables: (dealId: string) => Promise<BrandDeliverableView[]>;
}

const defaultDeps: BrandDealDeps = {
  requireBrand: () => guard({ roles: ['brand'] }),
  select: async (where) => {
    const [row] = await brandDealQuery(where);
    return row ?? null;
  },
  selectDeliverables: (dealId) => brandDealDeliverablesQuery(dealId),
};

/**
 * One of the caller's own deals by id, or `null`. Throws `ForbiddenError` for
 * every non-brand caller, including unauthenticated ones — `guard` fails closed.
 *
 * The gate runs first, before the id is looked at, so a denied caller learns
 * nothing about which ids are well-formed or which deals exist. The shape check
 * comes second and short-circuits the query entirely: Postgres answers a non-uuid
 * compared against a `uuid` column with `22P02`, which would turn a mistyped link
 * into a 500 rather than a not-found.
 *
 * **Two reads, in order** (F38). The deal proves ownership; only then are its
 * videos fetched. Sequential rather than concurrent for the same reason the
 * creator's deal page awaits its two reads in order: the second is scoped by an
 * id the first had to validate, and issuing them together would fetch videos for
 * a deal the caller may not own.
 */
export async function readBrandDeal(
  dealId: string,
  deps: BrandDealDeps = defaultDeps
): Promise<BrandDealDetail | null> {
  const { brandProfileId } = await deps.requireBrand();
  if (!brandProfileId) return null;

  if (!UUID_REGEX.test(dealId)) return null;

  const row = await deps.select(buildBrandDealWhere(dealId, brandProfileId));
  if (!row) return null;

  return { ...row, deliverables: await deps.selectDeliverables(row.id) };
}

/**
 * Review-screen copy, held beside the query that serves it — the
 * `ADD_TO_CAMPAIGN_LABEL` precedent. A string defined once cannot be paraphrased
 * apart from itself by a later edit, and the tests assert the constant *and* that
 * no page retypes it.
 *
 * Its own constants rather than a share of the creator's: the same sentence must
 * not exist in two places, and none of these say quite what the creator's screen
 * says even where they are about the same fact. No KAN number appears in any
 * string a user reads.
 */
export const DELIVERABLE_TITLE = 'Submitted video';
export const SUBMITTED_AT_LABEL = 'Submitted';
export const REVIEW_STATUS_LABEL = 'Review status';
export const RIGHTS_TERMS_LABEL = 'Usage rights';
export const CREATOR_LABEL = 'Creator';
export const VIDEO_COUNT_LABEL = 'Videos';
export const UNIT_PRICE_LABEL = 'Price per video';
export const TOTAL_PRICE_LABEL = 'Deal total';

/**
 * The heading over the list of submitted videos, and how one video is named
 * within it (F38).
 *
 * `videoHeading` is a function because the number is part of the name: with
 * several videos on one deal, "Video 2" is how the brand and the creator refer
 * to the same thing, and the rejection note the brand writes is about one of
 * them. The ordinal comes from the list's own order — `brandDealDeliverablesQuery`
 * sorts by `submitted_at` so it is stable across page loads.
 */
export const DELIVERABLES_TITLE = 'Submitted videos';
export function videoHeading(index: number): string {
  return `Video ${index + 1}`;
}

/**
 * How much of the delivery has arrived (F38).
 *
 * Stated on the brand's screen as well as the creator's, because it is the answer
 * to "why is there no Approve button" — a deal one video short is not a deal
 * nobody has looked at. Reads `2 of 3 videos submitted`, and the singular case
 * still says `1 of 1` rather than dropping the fraction: the brand ordered a
 * number and is entitled to see it accounted for.
 */
export function deliveryProgress(
  submitted: number,
  videoCount: number
): string {
  return `${submitted} of ${videoCount} video${videoCount === 1 ? '' : 's'} submitted`;
}

/**
 * How many of a deal's videos actually stand — every row except one the brand
 * sent back (KAN-200).
 *
 * **Not `deliverables.length`**, and that difference is a bug Nate walked into.
 * `recordSubmission` replaces a rejected row *in place* rather than inserting
 * beside it, so the row count on a two-video deal stays 2 while one of those rows
 * is a video the brand has refused and the creator has not replaced. Both deal
 * pages read the count into `deliveryProgress`, so both said "2 of 2 videos
 * submitted" directly above a form asking for another link — the screen
 * contradicting itself in two adjacent sentences.
 *
 * A rejected row is a slot, not a delivery. Counting it as one also broke the
 * creator page's explanatory sentence (`remaining` came out zero, so nothing
 * explained why the form was back) and would have let a brand's progress line
 * imply a delivery was complete when the thing it was waiting on was its own
 * rejection.
 *
 * Structurally typed over `{ reviewStatus }` rather than over
 * `BrandDeliverableView`, so the creator's `DeliverableView` satisfies it without
 * either module importing the other's shape. Exported and pure because it is the
 * one decision in the progress line, and testing it directly is cheaper than
 * reaching it through a database — `computeSplit`'s reasoning, applied to a count.
 *
 * Deliberately **not** a field on `BrandDealDetail`/`CreatorDealDetail`: those are
 * built in two different places (`readBrandDeal` has no `toBrandDealDetail`, by
 * design), so a stored field would be derived twice and free to disagree with
 * itself. One function, called at the two render sites, cannot.
 */
export function standingVideoCount(
  deliverables: ReadonlyArray<{ reviewStatus: ReviewStatus }>
): number {
  return deliverables.filter((video) => video.reviewStatus !== 'rejected')
    .length;
}

/** AC-6's version string, when a deal has one and when it does not. */
export const NO_RIGHTS_TERMS_MESSAGE =
  'No usage-rights version was recorded for this deal.';

/**
 * Shown while there is nothing to review yet.
 *
 * Says what the brand is waiting for rather than describing the deal's status a
 * second time — the badge above already does that.
 */
export const AWAITING_DELIVERABLE_MESSAGE =
  'The creator has not submitted a video for this deal yet. You will be emailed when they do.';

/**
 * Why the review controls are absent while the delivery is still in progress
 * (F38).
 *
 * Distinct from `AWAITING_DELIVERABLE_MESSAGE`, which covers a deal with nothing
 * submitted at all. This one is for a deal with some videos in and some
 * outstanding: there is something on screen to look at, and the brand needs to
 * know that judging it is not yet the thing to do. Approval is per deal (AC-023
 * releases "the held funds for that deal"), so it waits for the whole delivery.
 */
export const AWAITING_REMAINING_VIDEOS_MESSAGE =
  'You can approve or send back this deal once the creator has submitted every video it covers.';

/**
 * Why the review controls are absent, when a deliverable exists but the deal is
 * not in a reviewable state.
 *
 * A sentence beside the controls, never a `title=` tooltip — hover-only copy
 * tells a touch user nothing. Two cases reach it: a deal already approved or
 * refunded, and one the brand has already sent back and is waiting on.
 */
export const ALREADY_REVIEWED_MESSAGE =
  'You have already reviewed this video, so there is nothing to approve or send back.';
export const AWAITING_RESUBMISSION_MESSAGE =
  'You asked for changes, so this deal is back with the creator. You can review again once they resubmit.';

/**
 * Which of those sentences explains the missing review controls, or `null` when
 * they are on screen.
 *
 * Four cases, three of them absences, and the **order is the decision** (KAN-200):
 * a deal the brand sent back has a row set that is simultaneously full
 * (`deliverables.length === videoCount`) and short (`standingVideoCount <
 * videoCount`), because the rejected row still occupies its slot. Testing the
 * count first would tell the brand it was waiting on the creator's *next* video
 * when what it is waiting on is a replacement for a video it refused itself. So
 * `revision_requested` is asked before any count.
 *
 * A deal with nothing submitted answers `null` rather than a fourth sentence:
 * `AWAITING_DELIVERABLE_MESSAGE` already stands in for the empty list, and two
 * paragraphs saying the same thing is how one of them drifts.
 *
 * Pure, exported, and total — `null` for a reviewable deal too, so the page reads
 * as "the button, and the reason if there is no button" instead of a five-deep
 * ternary. `canReview` is read here rather than passed in, so this cannot disagree
 * with the control it explains.
 */
export function reviewAbsenceMessage(deal: {
  status: DealStatus;
  videoCount: number;
  deliverables: ReadonlyArray<{ reviewStatus: ReviewStatus }>;
}): string | null {
  if (canReview(deal.status)) return null;
  if (deal.deliverables.length === 0) return null;
  if (deal.status === 'revision_requested')
    return AWAITING_RESUBMISSION_MESSAGE;
  if (standingVideoCount(deal.deliverables) < deal.videoCount) {
    return AWAITING_REMAINING_VIDEOS_MESSAGE;
  }
  return ALREADY_REVIEWED_MESSAGE;
}

/** The stored reason from a previous rejection (AC-7). */
export const REJECTION_REASON_LABEL = 'Changes you asked for';

/**
 * The strings the review controls render, re-exported so this module stays the
 * one place a server-side caller looks for brand deal copy.
 *
 * They are *defined* in `lib/deals/copy.ts` because
 * `components/deals/review-actions.tsx` is a client component and importing them
 * from here would pull `pg` into the browser bundle through the query above. Same
 * forcing reason as the creator's offer and deliverable copy; see that module's
 * header.
 */
export {
  APPROVE_DELIVERABLE_LABEL,
  APPROVE_FAILED_MESSAGE,
  APPROVE_SUCCESS_MESSAGE,
  APPROVING_LABEL,
  approveConfirmMessage,
  REJECT_DELIVERABLE_LABEL,
  REJECT_FAILED_MESSAGE,
  REJECT_REASON_HINT,
  REJECT_REASON_LABEL,
  REJECT_REASON_PLACEHOLDER,
  REJECT_SUCCESS_MESSAGE,
  REJECTING_LABEL,
  REVIEW_NETWORK_ERROR_MESSAGE,
} from './copy';
