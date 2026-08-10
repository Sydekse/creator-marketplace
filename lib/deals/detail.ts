import { and, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '@/db';
import { brandProfile, campaign, deal, rightsTerms } from '@/db/schema';
import type { DealStatus } from '@/db/schema';
import { guard } from '@/lib/authz';
import { computeSplit } from '@/lib/payment/ledger';
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
   * The version of the terms this deal is governed by, or null.
   *
   * Nullable because the column is. Every deal KAN-33 creates carries one — the
   * confirmation refuses to issue offers without terms in effect — so a null
   * here is an older row, and the view says so rather than rendering an empty
   * card.
   */
  rightsTerms: DealRightsTerms | null;
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
 * Applies the commission split to a joined row.
 *
 * Exported and pure for the reason `toHistoryEvent` is: it is the only part of
 * this read with a decision in it, and testing it directly is cheaper and more
 * honest than reaching it through a database. It is also where AC-2's "expected
 * payout net of commission" actually happens, so it is worth being able to
 * point at.
 */
export function toDealDetail(row: CreatorDealJoinRow): CreatorDealDetail {
  const { commission, payout } = computeSplit(
    row.totalPrice,
    row.commissionRate
  );

  return { ...row, commission, expectedPayout: payout };
}

/** Seam for tests, matching the shape the rest of `lib/` uses. */
export interface CreatorDealDeps {
  requireCreator: () => Promise<{ creatorProfileId: string | null }>;
  select: (where: SQL) => Promise<CreatorDealDetail | null>;
}

async function selectCreatorDeal(
  where: SQL
): Promise<CreatorDealDetail | null> {
  const [row] = await creatorDealQuery(where);
  if (!row) return null;
  return toDealDetail(row);
}

const defaultDeps: CreatorDealDeps = {
  requireCreator: () => guard({ roles: ['creator'] }),
  select: selectCreatorDeal,
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
 */
export async function readCreatorDeal(
  dealId: string,
  deps: CreatorDealDeps = defaultDeps
): Promise<CreatorDealDetail | null> {
  const { creatorProfileId } = await deps.requireCreator();
  if (!creatorProfileId) return null;

  if (!UUID_REGEX.test(dealId)) return null;

  return deps.select(buildCreatorDealWhere(dealId, creatorProfileId));
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
 * The three strings the accept surface renders, re-exported so this module stays
 * the one place a server-side caller looks for deal copy.
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
  DECLINE_DEAL_LABEL,
  OFFER_ACTIONS_UNAVAILABLE_MESSAGE,
} from './copy';

export const SUBMIT_DELIVERABLE_LABEL = 'Submit your video';
export const SUBMIT_DELIVERABLE_UNAVAILABLE_MESSAGE =
  'Submitting a video is not available yet. The brand has funded this deal and will be told as soon as you can post.';

export const DEAL_HISTORY_TITLE = 'Deal history';
export const DEAL_HISTORY_EMPTY = 'Nothing has happened on this deal yet.';
/** A `deal_event` with no actor was the system acting, never a blank name. */
export const SYSTEM_ACTOR_LABEL = 'Automatically';
