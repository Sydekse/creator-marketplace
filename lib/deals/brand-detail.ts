import { and, eq } from 'drizzle-orm';
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

/** The one deliverable row a deal can have, as the reviewing brand sees it. */
export interface BrandDeliverableView {
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
  /** Null until the creator has submitted (KAN-46). */
  deliverable: BrandDeliverableView | null;
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

/** One joined row, before the deliverable pair is folded. */
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
  /** Nullable columns: a missing row arrives as all-nulls, not a joined null. */
  deliverable: {
    tiktokUrl: string | null;
    submittedAt: Date | null;
    reviewStatus: ReviewStatus | null;
    reviewedAt: Date | null;
    rejectionReason: string | null;
  } | null;
}

/**
 * The query as a builder rather than a promise, so a test can read the SQL it
 * emits without a database — `creatorDealQuery`'s shape.
 *
 * `campaign` and `creator_profile` are inner joins: both foreign keys are
 * `not null`, so neither can miss, and the `campaign` join is what the ownership
 * predicate reads. The other two are **left** joins, for the reason
 * `creatorDealQuery` gives — a deal with no deliverable yet, or no recorded
 * terms version, must come back and say so rather than vanish from its owner's
 * own review screen.
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
      deliverable: {
        tiktokUrl: deliverable.tiktokUrl,
        submittedAt: deliverable.submittedAt,
        reviewStatus: deliverable.reviewStatus,
        reviewedAt: deliverable.reviewedAt,
        rejectionReason: deliverable.rejectionReason,
      },
    })
    .from(deal)
    .innerJoin(campaign, eq(deal.campaignId, campaign.id))
    .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
    .leftJoin(rightsTerms, eq(deal.rightsTermsId, rightsTerms.id))
    .leftJoin(deliverable, eq(deliverable.dealId, deal.id))
    .where(where)
    .limit(1);
}

/**
 * Folds the joined nullable columns into one nullable object.
 *
 * Exported and pure for the reason `toDealDetail` is: it is the only part of this
 * read with a decision in it. The pair comes from a single left join, so a URL
 * present guarantees the timestamp and review status are too (`submitted_at` and
 * `review_status` are both `not null` in the table) — which is what lets the page
 * ask one question, "has the creator submitted?", instead of five.
 */
export function toBrandDealDetail(row: BrandDealJoinRow): BrandDealDetail {
  return {
    ...row,
    deliverable: row.deliverable?.tiktokUrl
      ? {
          tiktokUrl: row.deliverable.tiktokUrl,
          submittedAt: row.deliverable.submittedAt as Date,
          reviewStatus: row.deliverable.reviewStatus as ReviewStatus,
          reviewedAt: row.deliverable.reviewedAt,
          rejectionReason: row.deliverable.rejectionReason,
        }
      : null,
  };
}

/** Seam for tests, matching the shape the rest of `lib/` uses. */
export interface BrandDealDeps {
  requireBrand: () => Promise<{ brandProfileId: string | null }>;
  select: (where: SQL) => Promise<BrandDealDetail | null>;
}

async function selectBrandDeal(where: SQL): Promise<BrandDealDetail | null> {
  const [row] = await brandDealQuery(where);
  if (!row) return null;
  return toBrandDealDetail(row);
}

const defaultDeps: BrandDealDeps = {
  requireBrand: () => guard({ roles: ['brand'] }),
  select: selectBrandDeal,
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
 */
export async function readBrandDeal(
  dealId: string,
  deps: BrandDealDeps = defaultDeps
): Promise<BrandDealDetail | null> {
  const { brandProfileId } = await deps.requireBrand();
  if (!brandProfileId) return null;

  if (!UUID_REGEX.test(dealId)) return null;

  return deps.select(buildBrandDealWhere(dealId, brandProfileId));
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
  APPROVE_CONFIRM_MESSAGE,
  APPROVE_DELIVERABLE_LABEL,
  APPROVE_FAILED_MESSAGE,
  APPROVE_SUCCESS_MESSAGE,
  APPROVING_LABEL,
  REJECT_DELIVERABLE_LABEL,
  REJECT_FAILED_MESSAGE,
  REJECT_REASON_HINT,
  REJECT_REASON_LABEL,
  REJECT_REASON_PLACEHOLDER,
  REJECT_SUCCESS_MESSAGE,
  REJECTING_LABEL,
  REVIEW_NETWORK_ERROR_MESSAGE,
} from './copy';
