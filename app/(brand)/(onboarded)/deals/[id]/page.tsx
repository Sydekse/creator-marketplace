import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import { BdShell } from '@/components/brand/v4-shell';
import { DeadlineSection } from '@/components/deals/deadline-section';
import { DealHistory, DealProgressRail } from '@/components/deals/deal-history';
import { VideoHistory } from '@/components/deals/video-history';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import {
  ApproveDealButton,
  RejectVideoForm,
} from '@/components/deals/review-actions';
import { TiktokVideoCard } from '@/components/deals/tiktok-video-card';
import { formatDeadlineUtc } from '@/lib/dates';
import { canReview, labelForReviewStatus, labelForStatus } from '@/lib/deals';
import type { DealStatus } from '@/db/schema';
import {
  AWAITING_DELIVERABLE_MESSAGE,
  COMMISSION_LABEL,
  CREATOR_LABEL,
  DELIVERABLES_TITLE,
  deliveryProgress,
  externalRefundNote,
  NO_RIGHTS_TERMS_MESSAGE,
  PAYOUT_LABEL,
  REJECTION_REASON_LABEL,
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
import { REVISION_CATEGORY_LABELS } from '@/lib/deliverables/evidence';
import { selectVideoHistory } from '@/lib/deliverables/read-history';
import { parseTiktokVideoId } from '@/lib/deliverables/thumbnail';
import { formatEtb } from '@/lib/money';
import { cn } from '@/lib/utils';

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

function LedgerRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bd-ctled">
      <div>
        <span>{label}</span>
        <span className="bd-mono">{value}</span>
      </div>
    </div>
  );
}

/** Deal status → v4 chip tone, on the campaigns pages' chip vocabulary. */
const DEAL_TONE: Partial<Record<DealStatus, string>> = {
  pending: 'bd-capstatus--wait',
  accepted: 'bd-capstatus--wait',
  funded: 'bd-capstatus--live',
  delivered: 'bd-capstatus--live',
  revision_requested: 'bd-capstatus--wait',
  completed: 'bd-capstatus--done',
  declined: 'bd-capstatus--dead',
  expired: 'bd-capstatus--dead',
  refunded: 'bd-capstatus--dead',
};

/** Video review status → chip tone, same vocabulary as the deal chips. */
const REVIEW_TONE: Record<string, string> = {
  pending: 'bd-capstatus--wait',
  approved: 'bd-capstatus--done',
  rejected: 'bd-capstatus--dead',
};

export default async function BrandDealReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const deal = await readBrandDeal(id);
  if (!deal) notFound();

  const history = await getDealHistory(id);
  const videoHistory = await selectVideoHistory(id);

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
    <BdShell>
      <div className="bd-rise" style={{ '--i': 0 } as React.CSSProperties}>
        <Link href={`/campaigns/${deal.campaignId}`} className="bd-cdback">
          <ArrowLeft size={16} weight="regular" aria-hidden />
          Back to {deal.campaignName}
        </Link>
      </div>

      <div
        className="bd-ctsplit bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <div className="bd-ctmain">
          <header className="bd-cdhead bd-dlhead">
            <InitialsAvatar
              name={deal.creatorHandle}
              image={deal.creatorImage}
              size="lg"
            />
            <div className="bd-cdid">
              <p className="bd-eyebrow">Deal</p>
              <h1 className="bd-h1">{deal.creatorHandle}</h1>
              <p className="bd-idfacts">
                {/* The shared vocabulary from `lib/deals/groups.ts`, not a second
                    set of words for the same nine statuses — its own docstring
                    anticipates this screen, and two views naming one state
                    differently is the kind of drift that is hard to notice. */}
                <span
                  className={cn(
                    'bd-capstatus',
                    DEAL_TONE[deal.status] ?? 'bd-capstatus--draft'
                  )}
                >
                  {labelForStatus(deal.status)}
                </span>
              </p>
            </div>
          </header>

          {/* The rail is the deal's state made visible — the same
              DealProgressRail the creator page renders, so both sides of one
              deal read its journey off an identical bar. Always rendered,
              even with no events, so a pending deal lights step 1 instead of
              showing a blank strip. */}
          <div className="bd-cr-progress">
            <DealProgressRail status={deal.status} events={history} />
          </div>

          {/* KAN-160: the delivery agreement sits between the journey rail
              and the videos — the deadline is what the submissions below are
              measured against. */}
          <DeadlineSection dealId={id} />

          {/* The submitted videos, one section each (F38). Shown as text rather
            than an embed or a preview: nothing on this page fetches the URL, so
            a hostile link cannot make the brand's browser talk to an arbitrary
            host (Tech Spec §6.3). The brand opens it deliberately, in a new
            tab, with `rel` set.

            The reject control sits inside each video's own section, so the
            reason the brand writes is unambiguously about the video above it —
            with three on a deal, one shared form would put the note on
            whichever row the server picked. */}
          {deal.deliverables.length > 0 ? (
            <section className="bd-dlvids">
              <div className="bd-capruler">
                <span className="bd-caprulertitle">{DELIVERABLES_TITLE}</span>
                <span className="bd-caprulerline" aria-hidden="true" />
                <span className="bd-caprulernote">
                  {deliveryProgress(standing, deal.videoCount)}
                </span>
              </div>

              {deal.deliverables.map((video) => (
                <div key={video.id} className="bd-dlvid">
                  {/* The shared submitted-video frame: our stored thumbnail when
                      present, TikTok's embed only after the brand asks for
                      playback, and a deliberate external open as the fallback. */}
                  <TiktokVideoCard
                    tiktokUrl={video.tiktokUrl}
                    thumbnailUrl={video.thumbnailUrl}
                    tiktokVideoId={
                      video.tiktokVideoId ?? parseTiktokVideoId(video.tiktokUrl)
                    }
                    videoLabel={videoHeading(video.videoOrdinal - 1)}
                  />
                  <div className="bd-dlvidbody">
                    <div className="bd-dlvidhead">
                      <h3>
                        {videoHeading(video.videoOrdinal - 1)} · Version{' '}
                        {video.submissionVersion}
                      </h3>
                      {/* The chip replaces a "Review status:" prose line — the
                        status is mapped, never the raw column, and reads at a
                        glance in the deal-chip vocabulary. */}
                      <span
                        className={cn(
                          'bd-capstatus',
                          REVIEW_TONE[video.reviewStatus] ??
                            'bd-capstatus--wait'
                        )}
                      >
                        {labelForReviewStatus(video.reviewStatus)}
                      </span>
                    </div>
                    <p className="bd-dlmeta">
                      {SUBMITTED_AT_LABEL}:{' '}
                      {formatDeadlineUtc(video.submittedAt)}
                      {video.reviewedAt
                        ? ` · Reviewed ${formatDeadlineUtc(video.reviewedAt)}`
                        : ''}
                    </p>
                    {/* AC-7 — what the brand asked for last time, so a resubmission
                      can be read against it. Present only once a rejection has
                      been recorded, and now on the one video it was about. */}
                    {video.rejectionReason ? (
                      <div className="bd-dlreason">
                        <h4>{REJECTION_REASON_LABEL}</h4>
                        <p>{video.rejectionReason}</p>
                      </div>
                    ) : null}
                    {/* KAN-157: the structured category the brand picked when
                        sending it back, beside the free-text reason. */}
                    {video.revisionCategory ? (
                      <p className="bd-dlmeta">
                        {REVISION_CATEGORY_LABELS[video.revisionCategory]}
                      </p>
                    ) : null}
                    {/* KAN-157: every submitted version of this video, so a
                        resubmission reads against what came before. */}
                    <VideoHistory
                      events={videoHistory.filter(
                        (event) => event.deliverableId === video.id
                      )}
                      limited={video.historyCompleteness === 'legacy_baseline'}
                    />
                    {/* AC-024, per video. Gated on the same `canReview` as the
                      deal-level approve: a deal the brand has already sent back is
                      with the creator, so there is nothing to send back a second
                      time. */}
                    {reviewable ? (
                      <div className="bd-dlreject">
                        <RejectVideoForm
                          dealId={deal.id}
                          deliverableId={video.id}
                          expectedVersion={video.submissionVersion}
                          videoLabel={videoHeading(video.videoOrdinal - 1)}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </section>
          ) : (
            <section className="bd-dlvids">
              <div className="bd-capruler">
                <span className="bd-caprulertitle">{DELIVERABLES_TITLE}</span>
                <span className="bd-caprulerline" aria-hidden="true" />
                <span className="bd-caprulernote">
                  {deliveryProgress(standing, deal.videoCount)}
                </span>
              </div>
              <div className="bd-emptyfeed bd-emptyfeed--center">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="4" y="5" width="16" height="14" rx="2.5" />
                  <path d="m10 9.5 5 2.5-5 2.5v-5Z" />
                </svg>
                <h3>Nothing to review yet</h3>
                <p>{AWAITING_DELIVERABLE_MESSAGE}</p>
              </div>
            </section>
          )}

          {/* AC-023, once per deal. `canReview` reads `LEGAL_TRANSITIONS`, so
            this control cannot outlive the edge that permits it — and because a
            deal only reaches `delivered` when every video it was paid for is in
            (F38), the button cannot appear over a partial delivery.

            Where it is absent the reason is a sentence, never a `title=`
            tooltip, which tells a touch user nothing. Which sentence is
            `reviewAbsenceMessage`'s decision (KAN-200) rather than a ternary
            chain here: the case order matters and the page is the wrong place
            to keep a rule worth testing. */}
          {reviewable ? (
            <ApproveDealButton
              dealId={deal.id}
              videoCount={deal.videoCount}
              expectedVersions={deal.deliverables.map((video) => ({
                id: video.id,
                submissionVersion: video.submissionVersion,
              }))}
            />
          ) : null}
          {absence ? <p className="bd-dlabsence">{absence}</p> : null}

          {/* KAN-99 §4: brand deal history — the same component the creator and
            admin pages use, so a brand can see *why* a deal is in its current
            state (who rejected, when, with what reason the money moved). */}
          <div className="bd-dlhistory">
            <DealHistory events={history} />
          </div>
        </div>

        {/* The deal's terms, in the money rail-card: one card, hairline-divided
            cells, the total as the big numeral. Sticky beside the review work
            on desktop, after it in the single-column collapse. */}
        <aside className="bd-caprail bd-ctrail bd-dlrail">
          <div className="bd-railcell bd-railcell--hero">
            <span className="bd-railk">{TOTAL_PRICE_LABEL}</span>
            <span className="bd-railv bd-mono">
              {formatEtb(deal.totalPrice)}
            </span>
            <span className="bd-railn">
              {deal.videoCount} {deal.videoCount === 1 ? 'video' : 'videos'} at{' '}
              {formatEtb(deal.unitPrice)} each
            </span>
          </div>

          <div className="bd-railcell bd-ctledger">
            <span className="bd-railk">Terms</span>
            <LedgerRow label={CREATOR_LABEL} value={deal.creatorHandle} />
            <LedgerRow
              label={VIDEO_COUNT_LABEL}
              value={String(deal.videoCount)}
            />
            <LedgerRow
              label={UNIT_PRICE_LABEL}
              value={formatEtb(deal.unitPrice)}
            />
            {/* AC-6 of KAN-35 — the version stamped on the deal, never the one
                currently in effect: a deal is governed by the text its creator
                accepted, and a later republication must not change what a
                signed agreement says. */}
            <LedgerRow
              label={RIGHTS_TERMS_LABEL}
              value={deal.rightsTermsVersion ?? NO_RIGHTS_TERMS_MESSAGE}
            />
          </div>

          {/* The split, once the ledger has computed it (KAN-70 PR 4). Only on
              a completed deal, and read from the ledger rather than recomputed
              from the rate — the transaction that released the money is the
              only source for how it split. */}
          {deal.settlement ? (
            <div className="bd-railcell bd-ctledger">
              <span className="bd-railk">Settlement</span>
              <LedgerRow
                label={PAYOUT_LABEL}
                value={formatEtb(deal.settlement.payout)}
              />
              <LedgerRow
                label={COMMISSION_LABEL}
                value={formatEtb(deal.settlement.commission)}
              />
            </div>
          ) : null}

          {/* The external leg of a refund, when one exists (KAN-70 PR 4, Chapa
              mode only) — the escrow refund is already in the deal history;
              this line is about the money's trip back to the brand's card. */}
          {deal.externalRefundStatus ? (
            <div className="bd-railcell">
              <p className="bd-dlrefund">
                {externalRefundNote(deal.externalRefundStatus)}
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </BdShell>
  );
}
