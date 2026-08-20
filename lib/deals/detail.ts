import { and, asc, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '@/db';
import {
  brandProfile,
  campaign,
  deal,
  deliverable,
  rightsTerms,
} from '@/db/schema';
import type { DealStatus, ReviewStatus } from '@/db/schema';
import { guard } from '@/lib/authz';
import { canAct } from '@/lib/deals/state-machine';
import { computeSplit } from '@/lib/payment/ledger';
import { getCurrentRightsTerms } from '@/lib/rights-terms/current';
import { UUID_REGEX } from '@/lib/validation';

/**
 * The joined `rights_terms` row, straight off the schema.
 *
 * Structurally the `RightsTermsRow` that `components/deals/usage-rights.tsx`
 * exports — both are `typeof rightsTerms.$inferSelect` — so the card accepts
 * this without a cast. Derived here rather than imported from there because a
 * `lib/` module reaching into `components/` inverts the layering, even for a
 * type that erases.
 */
type DealRightsTerms = typeof rightsTerms.$inferSelect;

/**
 * One deal, for the creator-facing detail view (KAN-39, US-006, AC-2).
 *
 * A sibling of `lib/deals/inbox.ts` rather than a branch inside it: the inbox
 * reads many rows for a list and this reads one row by id with everything a
 * creator needs to *decide* on it. What the two share is who is allowed to see
 * a deal, and that part is shared by construction — both build their `where`
 * from the session's own `creatorProfileId`.
 *
 * **AC-6, ownership.** The creator's profile id is ANDed into the lookup, and
 * it comes from `guard`, never from an argument. So `readCreatorDeal` returns
 * `null` for a malformed id, an id nobody holds, and a real deal belonging to
 * another creator — all three indistinguishable from outside, which is what
 * stops the URL becoming an existence oracle for deal ids (Tech Spec §6.3).
 *
 * **Why `null` and not `ForbiddenError`.** `getDealHistory` denies with a throw,
 * which is right for an API surface. This is read by a page, and there is no
 * error boundary anywhere in this app — a thrown denial renders an unstyled
 * 500 rather than a 404. `readCreatorDetail` set this shape for the same
 * reason; the page turns `null` into `notFound()`.
 */

export interface CreatorDealDetail {
  id: string;
  status: DealStatus;
  campaignName: string;
  /** AC-2's "brand name" — the brand's trading name, not a contact. */
  companyName: string;
  videoCount: number;
  /** Price per video, snapshotted onto the deal at offer time (invariant 8). */
  unitPrice: number;
  /** `unit_price × video_count`, guaranteed by `deal_total_price_valid`. */
  totalPrice: number;
  /** `numeric(5,2)` as drizzle returns it — a string, kept one end to end. */
  commissionRate: string;
  /** Platform commission on this deal, at this deal's own rate. */
  commission: number;
  /**
   * What the creator can expect to receive: `total_price − commission`.
   *
   * **Expected, not owed.** KAN-25's AC-4 forbids the dashboard computing a
   * payout because the ledger is the source there — those figures describe
   * money that has actually moved. This describes a `pending` offer, which has
   * no ledger rows at all, so there is nothing to read and the only honest
   * thing to show is an estimate labelled as one. `PAYOUT_ESTIMATE_NOTE` is
   * that label, and it is not optional decoration.
   *
   * Computed with `computeSplit` and the deal's **snapshotted**
   * `commission_rate`, never `COMMISSION_RATE` from config (invariant 8). A
   * later change to the platform rate must not retroactively change what an
   * already-offered deal appears to pay — which is exactly what
   * `priceForTier`'s docstring anticipates: once a deal exists, its own rate is
   * what should be passed in.
   */
  expectedPayout: number;
  offerExpiresAt: Date | null;
  /**
   * The terms the creator is being asked to agree to, or is governed by.
   *
   * **Which of the two depends on the status**, and that is the point.
   *
   *   - While the offer is still `pending`, this is the version *currently* in
   *     effect — not the one stamped on the deal at offer time. Terms can be
   *     republished while an offer sits open, and acceptance must match the
   *     current version (AC-017). Showing the stamped version would ask the
   *     creator to agree to text the server will refuse, and the 409 telling
   *     them to reload would be a dead end: the reload would show the same
   *     stale text, forever.
   *   - From `accepted` onward this is the deal's own `rights_terms_id` — the
   *     version they actually agreed to, which is what governs the deal and
   *     what a dispute turns on. A later republication must not retroactively
   *     change what a signed deal says (the same reasoning that snapshots
   *     `commission_rate`).
   *
   * `rightsTermsAreCurrent` says which one this is, so the accept surface and
   * the tests can tell them apart rather than inferring it from the status a
   * second time.
   *
   * Nullable because the column is, and because an unseeded environment has no
   * current version either. Every deal KAN-33 creates carries one, so a null
   * here is an older row and the view says so rather than rendering an empty
   * card.
   */
  rightsTerms: DealRightsTerms | null;
  /** True when `rightsTerms` is the version in effect now, not the stamped one. */
  rightsTermsAreCurrent: boolean;
  /**
   * The live TikTok post URLs the creator has submitted, oldest first (KAN-46,
   * AC-022, F38).
   *
   * An **array**, and empty rather than null before the first submission: a deal
   * priced for three videos accepts three, and `standingVideoCount` against
   * `videoCount` is what the page turns into "2 of 3 submitted". On
   * `revision_requested` one of these is the submission the brand sent back,
   * which the creator needs to see while they replace it.
   *
   * Carries the review columns as well as the URL (KAN-200). They were left out
   * on the grounds that the rejection note reaches the creator through their
   * notification — which it does, and it was not enough: a notification is a line
   * in a list somewhere else, and the creator standing on this page looking at two
   * links had no way to tell which one the brand refused, or what it said. The
   * columns are the brand's half of the review, but they are *about* the creator's
   * work, and this is the screen they act on.
   */
  deliverables: DeliverableView[];
}

/** One submitted video, as the creator is allowed to see it. */
export interface DeliverableView {
  /**
   * The row's own id — the target of `PUT /api/deliverables/{id}/metrics`
   * (KAN-48), which the metrics-entry form on this page needs. The URL is not
   * enough: the API keys the upsert by deliverable, not by deal, and with several
   * videos on one deal there is one form per row.
   */
  id: string;
  tiktokUrl: string;
  submittedAt: Date;
  /**
   * Where the review stands (KAN-200). `rejected` is the video the brand sent
   * back and the creator has not yet replaced — which is what makes
   * `rejectionReason` worth rendering, and what `standingVideoCount` subtracts so
   * the progress line stops claiming the delivery is complete.
   */
  reviewStatus: ReviewStatus;
  reviewedAt: Date | null;
  /**
   * The brand's own words, verbatim, or null if this video was never sent back.
   *
   * Shown as written rather than summarised: it is an instruction the creator has
   * to follow, `REASON_REQUIRED` makes the brand supply one, and paraphrasing the
   * only sentence explaining what to change would be the least useful edit
   * possible.
   */
  rejectionReason: string | null;
}

/**
 * The lookup, as a `where` clause. Exported for the same reason
 * `buildCreatorDetailWhere` is: asserting that the ownership half is present is
 * easier here than through a database.
 *
 * The creator id is not a filter this function chooses to add — it is the base
 * the deal id narrows, so there is no argument that produces a lookup without
 * it.
 */
export function buildCreatorDealWhere(
  dealId: string,
  creatorProfileId: string
): SQL {
  return and(eq(deal.creatorId, creatorProfileId), eq(deal.id, dealId)) as SQL;
}

/** One joined row, before the split is computed and the terms folded. */
export interface CreatorDealJoinRow {
  id: string;
  status: DealStatus;
  campaignName: string;
  companyName: string;
  videoCount: number;
  unitPrice: number;
  totalPrice: number;
  commissionRate: string;
  offerExpiresAt: Date | null;
  rightsTerms: DealRightsTerms | null;
}

/**
 * The query as a builder rather than a promise, so a test can read the SQL it
 * emits without a database.
 *
 * The `rights_terms` join is **left**. `deal.rights_terms_id` is nullable, and
 * an inner join would make an older deal vanish from the creator's own inbox
 * rather than render without its terms — a missing row is a reason to say so,
 * not a reason to deny the deal exists.
 *
 * The other two joins are inner: `campaign_id` and `campaign.brand_id` are both
 * `not null` with foreign keys, so neither can miss. No contact column is
 * selected from `brand_profile` (NFR-010).
 *
 * **The deliverable join is gone** (F38). A deal can hold several videos, and a
 * `.limit(1)` query with a left join returned one arbitrary one while multiplying
 * the deal's own columns across the rest. They are a second read
 * (`creatorDealDeliverablesQuery`), which is also what lets them be ordered.
 */
export function creatorDealQuery(where: SQL) {
  return db
    .select({
      id: deal.id,
      status: deal.status,
      campaignName: campaign.name,
      companyName: brandProfile.companyName,
      videoCount: deal.videoCount,
      unitPrice: deal.unitPrice,
      totalPrice: deal.totalPrice,
      commissionRate: deal.commissionRate,
      offerExpiresAt: deal.offerExpiresAt,
      rightsTerms: rightsTerms,
    })
    .from(deal)
    .innerJoin(campaign, eq(deal.campaignId, campaign.id))
    .innerJoin(brandProfile, eq(campaign.brandId, brandProfile.id))
    .leftJoin(rightsTerms, eq(deal.rightsTermsId, rightsTerms.id))
    .where(where)
    .limit(1);
}

/**
 * Every video the creator has submitted against one deal, oldest first (F38).
 *
 * The same order **and the same columns** as the brand's screen
 * (`brandDealDeliverablesQuery`), so "Video 2" means the same video on both sides
 * of a rejection and both sides read the same review state off it. Takes the deal
 * id alone: it is issued only after `creatorDealQuery` has proved this creator
 * owns that deal, which is where ownership lives.
 */
export function creatorDealDeliverablesQuery(dealId: string) {
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

/**
 * Applies the commission split to a joined row.
 *
 * Exported and pure for the reason `toHistoryEvent` is: it is the only part of
 * this read with a decision in it, and testing it directly is cheaper and more
 * honest than reaching it through a database. It is also where AC-2's "expected
 * payout net of commission" actually happens, so it is worth being able to
 * point at.
 *
 * Takes the videos as an argument rather than reading them: they arrive from
 * their own query, and the split has nothing to do with them.
 */
export function toDealDetail(
  row: CreatorDealJoinRow,
  deliverables: DeliverableView[]
): CreatorDealDetail {
  const { commission, payout } = computeSplit(
    row.totalPrice,
    row.commissionRate
  );

  return {
    ...row,
    commission,
    expectedPayout: payout,
    rightsTermsAreCurrent: false,
    deliverables,
  };
}

/**
 * Swaps in the terms currently in effect, for a deal that can still be acted on.
 *
 * Pure and separate from the query so the substitution rule is testable on its
 * own — it is the half of AC-3 that lives on the read side, and getting it wrong
 * is invisible until a creator is stuck in a 409 loop they cannot escape.
 *
 * A null `current` leaves the deal's own terms in place rather than blanking the
 * card: an unseeded environment is not a reason to hide the text the offer was
 * issued under. Acceptance would fail in that state anyway, and it fails with a
 * thrown `MissingRightsTermsError` rather than something the creator is asked to
 * act on.
 */
export function withCurrentTerms(
  detail: CreatorDealDetail,
  current: DealRightsTerms | null
): CreatorDealDetail {
  if (!canAct(detail.status) || !current) return detail;

  return { ...detail, rightsTerms: current, rightsTermsAreCurrent: true };
}

/** Seam for tests, matching the shape the rest of `lib/` uses. */
export interface CreatorDealDeps {
  requireCreator: () => Promise<{ creatorProfileId: string | null }>;
  select: (where: SQL) => Promise<CreatorDealJoinRow | null>;
  /**
   * The deal's videos, read only once the deal itself came back — so a test can
   * prove they are never fetched for a deal this creator does not own.
   */
  selectDeliverables: (dealId: string) => Promise<DeliverableView[]>;
  /**
   * The version in effect now, read only when the deal can still be acted on.
   *
   * A second query, and deliberately behind `canAct` so a settled deal does not
   * pay for it. The seam exists so a test can prove both that a pending deal
   * asks for it and that an accepted one does not.
   */
  currentTerms: () => Promise<DealRightsTerms | null>;
}

const defaultDeps: CreatorDealDeps = {
  requireCreator: () => guard({ roles: ['creator'] }),
  select: async (where) => {
    const [row] = await creatorDealQuery(where);
    return row ?? null;
  },
  selectDeliverables: (dealId) => creatorDealDeliverablesQuery(dealId),
  // `CurrentRightsTerms` and the joined `DealRightsTerms` are both
  // `typeof rightsTerms.$inferSelect`, so the two sources are interchangeable
  // and the card cannot tell which one it was handed.
  currentTerms: () => getCurrentRightsTerms(),
};

/**
 * One of the caller's own deals by id, or `null`. Throws `ForbiddenError` for
 * every non-creator caller, including unauthenticated ones — `guard` fails
 * closed.
 *
 * The gate runs first, before the id is even looked at, so a denied caller
 * learns nothing about which ids are well-formed or which deals exist. The
 * shape check comes second and short-circuits the query entirely: Postgres
 * answers a non-uuid compared against a `uuid` column with `22P02`, which turns
 * a mistyped link into a 500 rather than a 404.
 *
 * A still-open offer comes back carrying the terms **currently** in effect
 * rather than the version stamped on it — see `rightsTerms` on the result type
 * for why, and `withCurrentTerms` for the rule.
 */
export async function readCreatorDeal(
  dealId: string,
  deps: CreatorDealDeps = defaultDeps
): Promise<CreatorDealDetail | null> {
  const { creatorProfileId } = await deps.requireCreator();
  if (!creatorProfileId) return null;

  if (!UUID_REGEX.test(dealId)) return null;

  const row = await deps.select(
    buildCreatorDealWhere(dealId, creatorProfileId)
  );
  if (!row) return null;

  const detail = toDealDetail(row, await deps.selectDeliverables(row.id));

  // Only the deals that can still be accepted pay for the second query.
  if (!canAct(detail.status)) return detail;

  return withCurrentTerms(detail, await deps.currentTerms());
}

/**
 * Detail-view copy, held beside the query that serves it — the
 * `ADD_TO_CAMPAIGN_LABEL` precedent in `lib/creators/detail.ts`. A string
 * defined once cannot be paraphrased apart from itself by a later edit, and the
 * tests assert both the constant and that no page retypes it.
 *
 * Three of these describe controls that are present but cannot be used yet.
 * That is deliberate and it is KAN-29's shape: the AC names the control, so the
 * control is on screen, and the sentence beside it says why nothing happens —
 * never a `title=` tooltip, which tells a touch user nothing.
 */
export const DEAL_TERMS_TITLE = 'Deal terms';
export const VIDEO_COUNT_LABEL = 'Videos';
export const UNIT_PRICE_LABEL = 'Price per video';
export const TOTAL_PRICE_LABEL = 'Deal total';
export const EXPECTED_PAYOUT_LABEL = 'Expected payout';
export const COMMISSION_LABEL = 'Platform commission';
export const OFFER_EXPIRY_LABEL = 'Offer expires';

export const PAYOUT_ESTIMATE_NOTE =
  'Estimated from this deal’s agreed commission. The final amount is confirmed when the brand approves your video.';

export const NO_RIGHTS_TERMS_MESSAGE =
  'No usage-rights terms are recorded for this deal. Ask the brand to reissue the offer before accepting.';

/**
 * The strings the offer surface renders, re-exported so this module stays the
 * one place a server-side caller looks for deal copy.
 *
 * They are *defined* in `lib/deals/copy.ts` because `components/deals/offer-
 * actions.tsx` is a client component and importing them from here would pull
 * `pg` into the browser bundle through the query above — the build fails outright
 * with `Can't resolve 'util/types'`. Same forcing reason as `formatEtb` in
 * `lib/money.ts` and `formatDeadline` in `lib/dates.ts`: a bundle boundary
 * between two callers, not a preference. See that module's header.
 */
export {
  ACCEPT_DEAL_LABEL,
  ACCEPT_FAILED_MESSAGE,
  ACCEPT_NEEDS_AGREEMENT_MESSAGE,
  ACCEPT_NETWORK_ERROR_MESSAGE,
  ACCEPT_SUCCESS_MESSAGE,
  ACCEPTING_LABEL,
  DECLINE_CONFIRM_MESSAGE,
  DECLINE_DEAL_LABEL,
  DECLINE_FAILED_MESSAGE,
  DECLINE_SUCCESS_MESSAGE,
  DECLINING_LABEL,
  SUBMIT_DELIVERABLE_FAILED_MESSAGE,
  SUBMIT_DELIVERABLE_LABEL,
  SUBMIT_DELIVERABLE_NETWORK_ERROR_MESSAGE,
  SUBMIT_DELIVERABLE_SUCCESS_MESSAGE,
  SUBMIT_DELIVERABLE_URL_HINT,
  SUBMIT_DELIVERABLE_URL_LABEL,
  SUBMIT_DELIVERABLE_URL_PLACEHOLDER,
  SUBMITTING_DELIVERABLE_LABEL,
} from './copy';

/**
 * The creator's half of AC-019 item 6 — "both parties can see that the campaign
 * is funded and that money is held" (KAN-43).
 *
 * Shown when `isMoneyHeld(status)` and nowhere else, which is what makes it worth
 * putting on screen: until now a creator could not tell an accepted deal from a
 * funded one, because `GROUP_BY_STATUS` files both under "Accepted · in progress"
 * and this page had no status line of its own. The status badge is not the answer
 * either — `funded` is a word about the campaign; this is a sentence about their
 * money.
 *
 * Names the amount as the deal total rather than the payout, because the deal
 * total is what is actually held (one `hold` entry per deal, `amount =
 * total_price`). The commission comes out of it on approval, which the payout
 * figure above already shows, and quoting the payout here would understate the
 * escrow.
 *
 * Says "approve" and not "pay", per AC-021: the money is held and reaches nobody
 * until a deliverable is approved. Promising otherwise is the failure mode this
 * whole ledger exists to prevent.
 */
export const FUNDS_HELD_LABEL = 'Funds held in escrow';
export const FUNDS_HELD_MESSAGE =
  'The brand has funded this deal, so the full amount is held for you. It is released once they approve your video.';

/**
 * What the creator sees once a submission exists (KAN-46, AC-022).
 *
 * The submitted URL and its timestamp are facts the creator is entitled to
 * read back — "submitted_at is recorded" is an AC, and a submission the
 * screen then forgets would read as a lost video. The URL is shown as text,
 * not a link: the brand-side "links to the live TikTok post" requirement is
 * KAN-49's, and nothing here needs to navigate anywhere.
 */
export const SUBMITTED_DELIVERABLE_LABEL = 'Submitted video';
export const SUBMITTED_AT_LABEL = 'Submitted at';

/**
 * The heading over the creator's list of submitted videos, the name of one
 * within it, and the rule for how many of them count (F38, KAN-200).
 *
 * The plural title, the numbered heading and the standing count are the brand's
 * own (`DELIVERABLES_TITLE`, `videoHeading`, `standingVideoCount` in
 * `brand-detail.ts`) rather than a second set: "Video 2" has to mean the same
 * video on both screens, because the brand's rejection note refers to it and the
 * creator has to find it — and "2 of 3 submitted" has to mean the same delivery,
 * or the two sides of one deal disagree about whether it is finished.
 * Re-exported here so a creator-side caller still finds its copy in one place.
 *
 * `REVIEW_STATUS_LABEL` is shared for the same reason: it labels one column on one
 * row, and the brand and the creator are looking at the same fact. The *reason*
 * below is not shared — see it.
 */
export {
  DELIVERABLES_TITLE,
  deliveryProgress,
  REVIEW_STATUS_LABEL,
  standingVideoCount,
  videoHeading,
} from './brand-detail';

/**
 * The brand's stored rejection note, from the side that has to act on it
 * (KAN-200).
 *
 * Its own constant rather than a share of `brand-detail.ts`'s: that one reads
 * "Changes you asked for", which is addressed to the brand that wrote the note.
 * Said to the creator it would be flatly wrong about who asked. The same fact,
 * two readers, two labels — the rule `brand-detail.ts`'s copy header states, and
 * the reason `SUBMITTED_AT_LABEL` already differs between the two screens.
 */
export const REJECTION_REASON_LABEL = 'Changes the brand asked for';

/**
 * What the creator is being asked for after a rejection (KAN-200, AC-024).
 *
 * The sentence Nate's walkthrough was missing. A `revision_requested` deal put
 * the submission form back on screen under a progress line reading "2 of 2 videos
 * submitted", with nothing anywhere naming the video that had been refused — so
 * the page asked for a link it had just said was not needed.
 *
 * Names the video, because on a multi-video deal that is the whole question, and
 * the ordinal is the same one the brand's rejection form used (`videoHeading` off
 * the shared `submitted_at` order). Says the others stand, because
 * `recordSubmission` replaces the rejected row in place — a creator who feared
 * resubmitting would restart the whole delivery would be wrong, and the fear is
 * reasonable.
 *
 * A function rather than a constant for `videoHeading`'s reason: the number is
 * part of what is being said, and interpolating it at the call site would put half
 * the sentence in the page.
 */
export function revisionRequestedMessage(videoLabel: string): string {
  return `The brand asked for changes to ${videoLabel}. Submit a new link below to replace it — your other videos still stand, and the deal goes back for review once the replacement is in.`;
}

/**
 * What the creator is being asked for next (F38).
 *
 * Sits above the submission form on a deal that is part-delivered, because the
 * form alone does not say the deal will not reach the brand until the last video
 * lands — a creator who submitted one of three and saw nothing change would
 * reasonably think it failed. Says where the money is at the same time: it is the
 * reason to keep going.
 *
 * For the *next* video, not a replacement for a refused one — that case has its
 * own sentence (`revisionRequestedMessage`), because the two ask for different
 * things and only one of them names a video.
 */
export const REMAINING_VIDEOS_MESSAGE =
  'The brand reviews this deal once every video is in, and your payment stays held until they do.';

export const DEAL_HISTORY_TITLE = 'Deal history';
export const DEAL_HISTORY_EMPTY = 'Nothing has happened on this deal yet.';
/** A `deal_event` with no actor was the system acting, never a blank name. */
export const SYSTEM_ACTOR_LABEL = 'Automatically';
