import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import { DealHistory } from '@/components/deals/deal-history';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import {
  ApproveDealButton,
  RejectVideoForm,
} from '@/components/deals/review-actions';
import { Chip } from '@/components/ui/chip';
import { PageHeader } from '@/components/layout/page-header';
import { formatDeadlineUtc } from '@/lib/dates';
import { canReview, labelForReviewStatus, labelForStatus } from '@/lib/deals';
import { dealStatusTone } from '@/lib/deals/status-tone';
import {
  AWAITING_DELIVERABLE_MESSAGE,
  CREATOR_LABEL,
  DELIVERABLES_TITLE,
  deliveryProgress,
  NO_RIGHTS_TERMS_MESSAGE,
  REJECTION_REASON_LABEL,
  REVIEW_STATUS_LABEL,
  reviewAbsenceMessage,
  RIGHTS_TERMS_LABEL,
  standingVideoCount,
  SUBMITTED_AT_LABEL,
  TOTAL_PRICE_LABEL,
  UNIT_PRICE_LABEL,
  VIDEO_COUNT_LABEL,
  videoHeading,
  readBrandDeal,
} from '@/lib/deals/brand-detail';
import { getDealHistory } from '@/lib/deals/queries';
import { formatEtb } from '@/lib/money';
import { cn, textLinkFeedback } from '@/lib/utils';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * One deal, for the brand deciding whether to approve it (KAN-68, US-008,
 * AC-023, AC-024).
 *
 * `params` is a Promise and has to be awaited — the Next 16 shape, per
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`.
 *
 * This route is what closes the loop. Wave 12 shipped `POST /approve` and
 * `POST /reject` with nothing anywhere that could call them, so every transition
 * in `fund -> deliver -> approve -> pay` existed in code while the chain could not
 * be walked in a browser. AC-023 and AC-024 both open with "given a brand reviews
 * a delivered video", which is this page.
 *
 * Lives at `/deals/[id]` rather than under `campaigns/[id]/` so the delivery
 * notification's CTA is one id deep — its payload carries a `dealId` and no
 * `campaignId`, so nesting would have meant changing the payload to build the
 * link. Inside `(onboarded)`, whose layout redirects a brand with no profile.
 *
 * Nothing here computes money. `formatEtb` is the only arithmetic-shaped call, and
 * the payout split is the ledger's to derive at approval time from the deal's own
 * snapshotted rate (invariant 8) — quoting an expected payout on this screen would
 * be a second source for a figure the transaction is about to compute.
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

export default async function BrandDealReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const deal = await readBrandDeal(id);
  if (!deal) notFound();

  const history = await getDealHistory(id);

  const reviewable = canReview(deal.status);

  /**
   * Why the review controls are absent, or `null` when they are on screen
   * (KAN-200).
   *
   * The decision is `reviewAbsenceMessage`'s, not this page's: the order the four
   * cases are tested in is load-bearing — a deal sent back for changes is both
   * "full" and "short" at once — and it is worth a test of its own.
   */
  const absence = reviewAbsenceMessage(deal);

  /**
   * How much of the delivery stands (KAN-200). Not `deliverables.length`: a video
   * the brand sent back keeps its row, so the raw length claimed a two-video deal
   * was fully delivered while the brand was waiting on its own rejection.
   */
  const standing = standingVideoCount(deal.deliverables);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 py-4">
      <Link
        href={`/campaigns/${deal.campaignId}`}
        className="inline-flex w-fit items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm text-neutral-700 transition-[border-color,box-shadow,color] duration-200 ease-[var(--ease-smooth)] hover:border-neutral-300 hover:text-neutral-900 hover:shadow-[0_12px_24px_-16px_rgba(23,23,23,0.35)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <ArrowLeft size={14} weight="regular" aria-hidden />
        Back to {deal.campaignName}
      </Link>

      <div className="flex items-start gap-5">
        <InitialsAvatar name={deal.creatorHandle} size="lg" />
        <PageHeader
          label="Deal"
          title={deal.creatorHandle}
          description={
            /* The shared vocabulary from `lib/deals/groups.ts`, not a second set
               of words for the same nine statuses — its own docstring anticipates
               this screen, and two views naming one state differently is the kind
               of drift that is hard to notice. */
            <Chip tone={dealStatusTone[deal.status]} size="md">
              {labelForStatus(deal.status)}
            </Chip>
          }
          className="min-w-0 flex-1"
        />
      </div>

      <section>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-y border-neutral-200 py-6 sm:grid-cols-3">
          <Fact label={CREATOR_LABEL} value={deal.creatorHandle} />
          <Fact label={VIDEO_COUNT_LABEL} value={String(deal.videoCount)} />
          <Fact label={UNIT_PRICE_LABEL} value={formatEtb(deal.unitPrice)} />
          <Fact label={TOTAL_PRICE_LABEL} value={formatEtb(deal.totalPrice)} />
          {/* AC-6 of KAN-35, which had no screen to live on until this one. The
              version stamped on the deal, never the one currently in effect: a
              deal is governed by the text its creator accepted, and a later
              republication must not change what a signed agreement says. */}
          <Fact
            label={RIGHTS_TERMS_LABEL}
            value={deal.rightsTermsVersion ?? NO_RIGHTS_TERMS_MESSAGE}
          />
        </dl>
      </section>

      {/* The submitted videos, one section each (F38). Shown as text rather than
          an embed or a preview: nothing on this page fetches the URL, so a hostile
          link cannot make the brand's browser talk to an arbitrary host (Tech Spec
          §6.3). The brand opens it deliberately, in a new tab, with `rel` set.

          The reject control sits inside each video's own section, so the reason the
          brand writes is unambiguously about the video above it — with three on a
          deal, one shared form would put the note on whichever row the server
          picked. */}
      {deal.deliverables.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">{DELIVERABLES_TITLE}</h2>
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
              <a
                href={video.tiktokUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={cn('font-mono text-sm break-all', textLinkFeedback)}
              >
                {video.tiktokUrl}
              </a>
              <p className="text-sm text-muted-foreground">
                {SUBMITTED_AT_LABEL}: {formatDeadlineUtc(video.submittedAt)}
              </p>
              {/* Two paragraphs, not one nested inside the other (KAN-200). The
                  review line was a `<p>` inside a `<p>`, which is invalid HTML —
                  the browser closes the outer one at the inner tag, so React warns
                  on hydration and the rendered tree is not the one written here.

                  And the status is mapped, never the raw column: this printed
                  `pending` to a brand, which is a database word for "you have not
                  looked at it yet". */}
              <p className="text-sm text-muted-foreground">
                {REVIEW_STATUS_LABEL}:{' '}
                {labelForReviewStatus(video.reviewStatus)}
                {video.reviewedAt
                  ? ` (${formatDeadlineUtc(video.reviewedAt)})`
                  : ''}
              </p>
              {/* AC-7 — what the brand asked for last time, so a resubmission can
                  be read against it. Present only once a rejection has been
                  recorded, and now on the one video it was about. */}
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
              {/* AC-024, per video. Gated on the same `canReview` as the deal-level
                  approve: a deal the brand has already sent back is with the
                  creator, so there is nothing to send back a second time. */}
              {reviewable ? (
                <div className="pt-2">
                  <RejectVideoForm
                    dealId={deal.id}
                    deliverableId={video.id}
                    videoLabel={videoHeading(index)}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          {AWAITING_DELIVERABLE_MESSAGE}
        </p>
      )}

      {/* AC-023, once per deal. `canReview` reads `LEGAL_TRANSITIONS`, so this
          control cannot outlive the edge that permits it — and because a deal only
          reaches `delivered` when every video it was paid for is in (F38), the
          button cannot appear over a partial delivery.

          Where it is absent the reason is a sentence, never a `title=` tooltip,
          which tells a touch user nothing. Which sentence is
          `reviewAbsenceMessage`'s decision (KAN-200) rather than a ternary chain
          here: the case order matters and the page is the wrong place to keep a
          rule worth testing. */}
      {reviewable ? (
        <ApproveDealButton dealId={deal.id} videoCount={deal.videoCount} />
      ) : null}
      {absence ? (
        <p className="text-sm text-muted-foreground">{absence}</p>
      ) : null}

      {/* KAN-99 §4: brand deal history — the same component the creator and
          admin pages use, so a brand can see *why* a deal is in its current
          state (who rejected, when, with what reason the money moved). */}
      <div className="border-t border-neutral-200 pt-8">
        <DealHistory events={history} />
      </div>
    </div>
  );
}
