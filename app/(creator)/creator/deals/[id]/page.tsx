import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import { DealHistory } from '@/components/deals/deal-history';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { PageHeader } from '@/components/layout/page-header';
import { MetricsForm } from '@/components/deals/metrics-form';
import { DeliverableForm } from '@/components/deals/deliverable-form';
import { OfferActions } from '@/components/deals/offer-actions';
import { UsageRightsCard } from '@/components/deals/usage-rights';
import { NO_EXPIRY_LABEL, expiryLabel, formatDeadlineUtc } from '@/lib/dates';
import {
  canAct,
  canDeliver,
  canReportMetrics,
  labelForReviewStatus,
  labelForStatus,
} from '@/lib/deals';
import { Chip } from '@/components/ui/chip';
import { dealStatusTone } from '@/lib/deals/status-tone';
import {
  COMMISSION_LABEL,
  DEAL_TERMS_TITLE,
  DELIVERABLES_TITLE,
  deliveryProgress,
  EXPECTED_PAYOUT_LABEL,
  FUNDS_HELD_LABEL,
  FUNDS_HELD_MESSAGE,
  NO_RIGHTS_TERMS_MESSAGE,
  OFFER_EXPIRY_LABEL,
  PAYOUT_ESTIMATE_NOTE,
  REJECTION_REASON_LABEL,
  REMAINING_VIDEOS_MESSAGE,
  REVIEW_STATUS_LABEL,
  revisionRequestedMessage,
  standingVideoCount,
  SUBMITTED_AT_LABEL,
  TOTAL_PRICE_LABEL,
  UNIT_PRICE_LABEL,
  VIDEO_COUNT_LABEL,
  videoHeading,
  readCreatorDeal,
} from '@/lib/deals/detail';
import { getDealHistory } from '@/lib/deals/queries';
import { formatEtb } from '@/lib/money';
import { isMoneyHeld } from '@/lib/payment/ledger';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * One deal, in full, for the creator deciding on it (KAN-39, US-006, AC-2).
 *
 * `params` is a Promise and has to be awaited — the Next 16 shape, per
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`.
 *
 * **The two reads are sequential on purpose.** `readCreatorDeal` returns `null`
 * for every kind of miss and `getDealHistory` *throws* `ForbiddenError`, and this
 * app has no error boundary anywhere — running them together would turn a stale
 * link into an unstyled 500 instead of the not-found page beside this file. The
 * ownership check has to pass before the history is asked for, which is also the
 * order that makes the second call's guard a formality rather than the thing
 * standing between a stranger and this deal's audit trail.
 *
 * Nothing on this page computes money. `readCreatorDeal` already applied the
 * split using the deal's own snapshotted `commission_rate` (invariant 8), so the
 * only arithmetic-shaped call below is `formatEtb`.
 */

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}

export default async function CreatorDealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const deal = await readCreatorDeal(id);
  if (!deal) notFound();

  const history = await getDealHistory(id);

  const isPending = canAct(deal.status);

  /**
   * How much of the delivery stands, and what is still owed (F38, KAN-200).
   *
   * `standingVideoCount`, never `deliverables.length`: a video the brand sent
   * back keeps its row, so the raw length said "2 of 2 videos submitted" directly
   * above a form asking for another link. See the function for the whole story.
   *
   * `remaining` drives the sentence above the submission form, and only that —
   * whether the form appears at all is `canDeliver`, read off the transition table.
   */
  const standing = standingVideoCount(deal.deliverables);
  const remaining = deal.videoCount - standing;

  /**
   * Which video the brand refused, if any.
   *
   * At most one row can be `rejected` at a time — `submit-deliverable.ts` states
   * the rule and the state machine enforces it, because a rejection is only legal
   * from `delivered` and moves the deal to `revision_requested` where `canReview`
   * is false. So naming "the" flagged video is safe rather than a guess, and the
   * ordinal is the one the brand's own review screen used.
   */
  const rejectedIndex = deal.deliverables.findIndex(
    (video) => video.reviewStatus === 'rejected'
  );

  /*
   * The verb is only correct while the offer is still open. On an accepted or
   * completed deal the deadline is in the past by definition and was answered,
   * not missed — "Expired 3 Aug" would tell a creator their finished deal
   * lapsed. So the tense is spent on the one status where it means something,
   * and every other status shows the bare instant.
   */
  const deadline =
    deal.offerExpiresAt === null
      ? NO_EXPIRY_LABEL
      : isPending
        ? expiryLabel(deal.offerExpiresAt, new Date())
        : formatDeadlineUtc(deal.offerExpiresAt);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 py-4">
      <Link
        href="/creator/deals"
        className="inline-flex w-fit items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm text-neutral-700 transition-[border-color,box-shadow,color] duration-200 ease-[var(--ease-smooth)] hover:border-neutral-300 hover:text-neutral-900 hover:shadow-[0_12px_24px_-16px_rgba(23,23,23,0.35)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <ArrowLeft size={14} weight="regular" aria-hidden />
        Back to your deals
      </Link>

      <PageHeader
        label="Deal"
        title={deal.campaignName}
        description={
          /* AC-2's brand name: the trading name the brand publishes, never a
             contact (NFR-010). */
          <div className="flex items-center gap-2">
            <InitialsAvatar name={deal.companyName} size="sm" />
            <span>{deal.companyName}</span>
            <Chip tone={dealStatusTone[deal.status]} size="sm">
              {labelForStatus(deal.status)}
            </Chip>
          </div>
        }
      />

      <section>
        <h2 className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
          {DEAL_TERMS_TITLE}
        </h2>
        {/* Two columns on a phone, three from `sm:` up (NFR-007). */}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-6 border-y border-neutral-200 py-6 sm:grid-cols-3">
          <Fact label={VIDEO_COUNT_LABEL} value={String(deal.videoCount)} />
          <Fact label={UNIT_PRICE_LABEL} value={formatEtb(deal.unitPrice)} />
          <Fact label={TOTAL_PRICE_LABEL} value={formatEtb(deal.totalPrice)} />
          <Fact label={COMMISSION_LABEL} value={formatEtb(deal.commission)} />
          <Fact
            label={EXPECTED_PAYOUT_LABEL}
            value={formatEtb(deal.expectedPayout)}
          />
          <Fact label={OFFER_EXPIRY_LABEL} value={deadline} />
        </dl>
        {/* Labelled as an estimate, not decoration: a pending deal has no ledger
            rows, so this figure describes money that has not moved. KAN-25's
            AC-4 is why the dashboard's numbers are ledger sums instead. */}
        <p className="mt-4 text-sm text-muted-foreground">
          {PAYOUT_ESTIMATE_NOTE}
        </p>
      </section>

      {/* AC-2's "full usage-rights terms", inline rather than behind a link.
          Rendered by the page, not by `OfferActions`, so this static body stays
          server-rendered instead of riding into the client bundle with the one
          control that needs an event handler.

          While the offer is open this is the version *currently* in effect, not
          the one stamped at offer time — `readCreatorDeal` swaps it, because
          acceptance must match the current version and agreeing to superseded
          text would be refused with a 409 no reload could clear.

          Collapsed once the offer is answered (KAN-200), off the same predicate
          that gates the accept controls: while a creator is being asked to agree
          the text is the decision and AC-2 says they see it, and afterwards it is
          reference material that was pushing the deliverable form and the review
          status below the fold on every later visit. Still on the page either way
          — a `<details>` the creator opens, not a link they leave for. */}
      {deal.rightsTerms ? (
        <UsageRightsCard terms={deal.rightsTerms} collapsed={!isPending} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {NO_RIGHTS_TERMS_MESSAGE}
        </p>
      )}

      {/* KAN-43, AC-019 item 6 — the creator's half of "both parties can see
          that money is held".

          Gated on `isMoneyHeld`, which is `REFUNDABLE_FROM`: the ledger's own
          answer to "is there a live hold for this deal", derived from the list it
          refuses refunds against rather than a second list of statuses that could
          disagree with it. So this line appears exactly when a `hold` entry
          exists and has not been released, with no edit here if that set ever
          changes.

          Above the deliver button on purpose: the money being held is why the
          creator is willing to start work, so it comes before the control that
          starts it. */}
      {isMoneyHeld(deal.status) ? (
        <section className="rounded-[24px] border border-neutral-800 bg-neutral-900 p-6 text-neutral-50 shadow-[0_20px_48px_-32px_rgba(23,23,23,0.6)]">
          <p className="text-[13px] font-semibold tracking-[0.14em] text-neutral-300 uppercase">
            {FUNDS_HELD_LABEL}
          </p>
          <p className="mt-3 font-mono text-2xl font-medium">
            {formatEtb(deal.totalPrice)}
          </p>
          <p className="mt-2 max-w-xl text-sm text-neutral-400">
            {FUNDS_HELD_MESSAGE}
          </p>
        </section>
      ) : null}

      {/* AC-3. `canAct` reads `LEGAL_TRANSITIONS`, so these controls cannot
          outlive the rule that permits them — a status the machine stops
          accepting from stops rendering them here with no edit to this file. */}
      {isPending ? (
        <OfferActions dealId={deal.id} terms={deal.rightsTerms} />
      ) : null}

      {/* What the creator submitted, once there is something to show — one
          section per video (F38), oldest first, numbered the same way the brand's
          review screen numbers them so a rejection note about "Video 2" finds the
          same video here.

          **Above the submission form**, which is where the comment here always
          said it was and where it now actually is (KAN-200). On a
          `revision_requested` deal the thing being replaced has to be readable
          before the field that replaces it — a creator cannot act on a note they
          have to scroll past the form to find.

          The URL is shown as text, not a link: nothing on this page navigates or
          fetches (AC-8), and the brand's screen is where the live post is opened. */}
      {deal.deliverables.length > 0 ? (
        <section className="flex flex-col gap-5 border-t border-neutral-200 pt-8">
          <div className="flex flex-col gap-1">
            <h2 className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
              {DELIVERABLES_TITLE}
            </h2>
            <p className="text-sm text-muted-foreground">
              {deliveryProgress(standing, deal.videoCount)}
            </p>
          </div>

          {deal.deliverables.map((video, index) => (
            <div
              key={video.id}
              className="flex flex-col gap-2 rounded-[20px] border border-neutral-200 bg-neutral-50 p-5"
            >
              <h3 className="text-sm font-medium">{videoHeading(index)}</h3>
              {/* Text, never a link or an embed (AC-8) — nothing on the creator
                  side navigates to the post. The card carries no hover state
                  either: it is not clickable, and a hover border would claim
                  otherwise. */}
              <p className="font-mono text-sm break-all">{video.tiktokUrl}</p>
              <p className="text-sm text-muted-foreground">
                {SUBMITTED_AT_LABEL}: {formatDeadlineUtc(video.submittedAt)}
              </p>

              {/* Where the review stands, per video (KAN-200). Mapped through
                  `labelForReviewStatus`, never the raw column: `pending` is a
                  database word, and the creator's question is who holds it next.
                  The instant is shown once there is one — a review that happened
                  has a date, and "when did they look at it" is the next thing a
                  creator asks after "did they". */}
              <p className="text-sm text-muted-foreground">
                {REVIEW_STATUS_LABEL}:{' '}
                {labelForReviewStatus(video.reviewStatus)}
                {video.reviewedAt
                  ? ` (${formatDeadlineUtc(video.reviewedAt)})`
                  : ''}
              </p>

              {/* The brand's own words, on the video they are about (KAN-200).
                  Present only while a rejection stands: `recordSubmission` clears
                  the note when the replacement lands, so a stale instruction never
                  follows a new video around. */}
              {video.rejectionReason ? (
                <div className="flex flex-col gap-1 pt-2">
                  <h4 className="text-sm font-medium">
                    {REJECTION_REASON_LABEL}
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    {video.rejectionReason}
                  </p>
                </div>
              ) : null}

              {/* The KAN-57 review's F2 fix — the reminder's promise, made real.
                  One form per video (F38), because the metrics API keys its
                  upsert by deliverable: a deal covering three videos owes three
                  sets of counts, and AC-026 renders them as three rows. Gated on
                  `canReportMetrics` — exactly the `{completed}` set the reminder
                  sweep selects from. */}
              {canReportMetrics(deal.status) ? (
                <div className="pt-3">
                  <MetricsForm deliverableId={video.id} />
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {/* KAN-46, AC-022 — the deliverable submission path. `canDeliver` is
          `{funded, revision_requested}`, read off the same transition table as
          the accept controls: a funded deal is what the creator may deliver
          against, and a rejected one is what they may re-deliver against. The
          form is client-side — it holds the URL field and posts to
          `/api/deals/{id}/deliverable`.

          It stays on screen for every video the deal covers (F38), so a creator
          three videos into a three-video deal submits through the same control
          they used for the first.

          Two different sentences, because the form is asking for two different
          things (KAN-200). A replacement for a refused video names it, since on a
          multi-video deal that is the only question worth answering. The next
          video in an unfinished delivery says why nothing has reached the brand
          yet — a submission that changed no visible status would otherwise read as
          a failure. Neither appears on the first video of a deal, where the form
          speaks for itself. */}
      {canDeliver(deal.status) ? (
        <div className="rounded-[24px] border border-neutral-200 bg-neutral-100/70 p-5 sm:p-6">
          <div className="flex flex-col gap-3">
            {rejectedIndex >= 0 ? (
              <p className="text-sm text-muted-foreground">
                {revisionRequestedMessage(videoHeading(rejectedIndex))}
              </p>
            ) : remaining > 0 && standing > 0 ? (
              <p className="text-sm text-muted-foreground">
                {REMAINING_VIDEOS_MESSAGE}
              </p>
            ) : null}
            <DeliverableForm dealId={deal.id} />
          </div>
        </div>
      ) : null}

      {/* AC-5. Last on the page: it is the reference a creator scrolls to, not
          the thing they came for. */}
      <div className="border-t border-neutral-200 pt-8">
        <DealHistory events={history} />
      </div>
    </div>
  );
}
