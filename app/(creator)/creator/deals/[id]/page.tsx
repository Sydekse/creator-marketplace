import Link from 'next/link';
import { DeadlineSection } from '@/components/deals/deadline-section';
import { notFound } from 'next/navigation';
import { VideoHistory } from '@/components/deals/video-history';
import { selectVideoHistory } from '@/lib/deliverables/read-history';
import { REVISION_CATEGORY_LABELS } from '@/lib/deliverables/evidence';
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import { BdShell } from '@/components/brand/v4-shell';
import { DealHistory, DealProgressRail } from '@/components/deals/deal-history';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { MetricsForm } from '@/components/deals/metrics-form';
import { DeliverableForm } from '@/components/deals/deliverable-form';
import { TiktokVideoCard } from '@/components/deals/tiktok-video-card';
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
  videoHeading,
  readCreatorDeal,
} from '@/lib/deals/detail';
import { getDealHistory } from '@/lib/deals/queries';
import { parseTiktokVideoId } from '@/lib/deliverables/thumbnail';
import { formatEtb } from '@/lib/money';
import { isMoneyHeld } from '@/lib/payment/ledger';
import { cn } from '@/lib/utils';

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
 *
 * v4 conversion: shared creator shell and ruled detail layout; imported action,
 * history, and form components keep their behavior contracts.
 */

const DEAL_STATUS_CAP: Record<string, string> = {
  pending: 'bd-capstatus--wait',
  accepted: 'bd-capstatus--live',
  funded: 'bd-capstatus--live',
  delivered: 'bd-capstatus--wait',
  revision_requested: 'bd-capstatus--wait',
  completed: 'bd-capstatus--done',
  declined: 'bd-capstatus--dead',
  expired: 'bd-capstatus--dead',
  refunded: 'bd-capstatus--dead',
};

const REVIEW_ACCENT: Record<string, string> = {
  pending: 'bd-cr-video--wait',
  approved: 'bd-cr-video--done',
  rejected: 'bd-cr-video--wait',
};

export default async function CreatorDealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const deal = await readCreatorDeal(id);
  if (!deal) notFound();

  const history = await getDealHistory(id);
  const videoHistory = await selectVideoHistory(id);

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

  const rights = deal.rightsTerms ? (
    <UsageRightsCard terms={deal.rightsTerms} collapsed={!isPending} />
  ) : (
    <p className="text-sm text-muted-foreground">{NO_RIGHTS_TERMS_MESSAGE}</p>
  );

  return (
    <BdShell className="bd-cr bd-cr-dealdetail">
      <Link href="/creator/deals" className="bd-cdback bd-cr-back">
        <ArrowLeft size={14} weight="regular" aria-hidden />
        Back to your deals
      </Link>

      {/* Header as the offer sheet's masthead: identity left, the money and
          clock as a right-aligned status column — the mock's asymmetric
          pagehead, with the showreel sprocket strip running above. */}
      <header
        className="bd-cr-dealhead2 bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <div className="bd-cr-dealhead2-id">
          <InitialsAvatar
            name={deal.companyName}
            size="lg"
            className="bd-cdavatar size-16 sm:size-20"
          />
          <div className="bd-cdid">
            <p className="bd-eyebrow">Creator workspace</p>
            <h1 className="bd-h1">{deal.campaignName}</h1>
            <p className="bd-idfacts bd-cdmeta">
              <span
                className={cn(
                  'bd-capstatus',
                  DEAL_STATUS_CAP[deal.status] ?? 'bd-capstatus--draft'
                )}
              >
                {labelForStatus(deal.status)}
              </span>
              <span>{deal.companyName}</span>
            </p>
          </div>
        </div>
        <p className="bd-cr-dealhead2-status">
          {deal.status !== 'declined' && deal.status !== 'expired' ? (
            <span className="bd-cr-sline">
              You {deal.status === 'completed' ? 'earned' : 'earn'}{' '}
              <b className="bd-mono">{formatEtb(deal.expectedPayout)}</b>
              {deal.status === 'completed' ? '' : ' on approval'}
            </span>
          ) : null}
          <span className="bd-cr-sline">
            {OFFER_EXPIRY_LABEL}: <b className="bd-mono">{deadline}</b>
          </span>
        </p>
      </header>

      {/* The rail is the deal's state made visible — always rendered, even
          with no events, so a pending deal shows step 1 highlighted instead
          of a blank aside. */}
      <div
        className="bd-cr-progress bd-rise"
        style={{ '--i': 2 } as React.CSSProperties}
      >
        <DealProgressRail status={deal.status} events={history} />
      </div>

      <div
        className="bd-cr-detail-split bd-rise"
        style={{ '--i': 3 } as React.CSSProperties}
      >
        <div className="bd-cr-detail-main">
          {/* The vault — the deal's money as one composed statement. While
              the offer is open it reads as the equation (total − commission
              = payout); the moment funds are held it recomposes around the
              payout as the hero numeral, on the mock's escrow cell: ink-teal
              surface, radial sheen, the supporting figures as a quiet ledger
              beside it. */}
          {isMoneyHeld(deal.status) ? (
            <section className="bd-dv bd-dv--held">
              <div className="bd-dv-head">
                <span className="bd-dv-k">{DEAL_TERMS_TITLE}</span>
                <span className="bd-dv-note bd-mono">{FUNDS_HELD_LABEL}</span>
              </div>
              <div className="bd-dv-heldgrid">
                <div className="bd-dv-hero">
                  <span className="bd-dv-lab">{EXPECTED_PAYOUT_LABEL}</span>
                  <span className="bd-dv-heronum bd-mono">
                    {formatEtb(deal.expectedPayout)}
                  </span>
                  <span className="bd-dv-sub">
                    released when the brand approves your{' '}
                    {deal.videoCount === 1 ? 'video' : 'videos'}
                  </span>
                </div>
                <dl className="bd-dv-ledger">
                  <div>
                    <dt>{TOTAL_PRICE_LABEL}</dt>
                    <dd className="bd-mono">{formatEtb(deal.totalPrice)}</dd>
                  </div>
                  <div>
                    <dt>
                      {deal.videoCount}{' '}
                      {deal.videoCount === 1 ? 'video' : 'videos'} ×
                    </dt>
                    <dd className="bd-mono">{formatEtb(deal.unitPrice)}</dd>
                  </div>
                  <div>
                    <dt>{COMMISSION_LABEL}</dt>
                    <dd className="bd-mono">−{formatEtb(deal.commission)}</dd>
                  </div>
                </dl>
              </div>
              <p className="bd-dv-heldnote">{FUNDS_HELD_MESSAGE}</p>
            </section>
          ) : (
            <section className="bd-dv">
              <div className="bd-dv-head">
                <span className="bd-dv-k">{DEAL_TERMS_TITLE}</span>
                <span className="bd-dv-note bd-mono">
                  {OFFER_EXPIRY_LABEL}: {deadline}
                </span>
              </div>
              <div className="bd-dv-flow">
                <div className="bd-dv-cell">
                  <span className="bd-dv-lab">{TOTAL_PRICE_LABEL}</span>
                  <span className="bd-dv-num bd-mono">
                    {formatEtb(deal.totalPrice)}
                  </span>
                  <span className="bd-dv-sub">
                    {deal.videoCount}{' '}
                    {deal.videoCount === 1 ? 'video' : 'videos'} ×{' '}
                    {formatEtb(deal.unitPrice)}
                  </span>
                </div>
                <span className="bd-dv-arrow" aria-hidden="true">
                  −
                </span>
                <div className="bd-dv-cell">
                  <span className="bd-dv-lab">{COMMISSION_LABEL}</span>
                  <span className="bd-dv-num bd-mono">
                    {formatEtb(deal.commission)}
                  </span>
                  <span className="bd-dv-sub">withheld at approval</span>
                </div>
                <span className="bd-dv-arrow" aria-hidden="true">
                  =
                </span>
                <div className="bd-dv-cell bd-dv-cell--payout">
                  <span className="bd-dv-lab">{EXPECTED_PAYOUT_LABEL}</span>
                  <span className="bd-dv-num bd-mono">
                    {formatEtb(deal.expectedPayout)}
                  </span>
                  <span className="bd-dv-sub">{PAYOUT_ESTIMATE_NOTE}</span>
                </div>
              </div>
            </section>
          )}

          {/* The decision. While the offer is open this is the page's action;
              once answered it collapses to a one-line receipt instead of
              holding a whole chapter for a past-tense sentence. */}
          {isPending ? (
            <section className="bd-briefcard bd-cr-decisioncard">
              <div className="bd-capruler">
                <span className="bd-caprulertitle">Your decision</span>
                <span className="bd-caprulerline" aria-hidden="true" />
                <span className="bd-caprulernote">
                  Accept or decline while the offer is open
                </span>
              </div>
              <OfferActions
                dealId={deal.id}
                terms={deal.rightsTerms}
                deliveryWindowDays={deal.deliveryWindowDays}
              />
            </section>
          ) : (
            <p className="bd-cr-decisionline">
              {deal.status === 'declined' || deal.status === 'expired'
                ? labelForStatus(deal.status)
                : 'You accepted this offer and agreed to the usage-rights terms.'}
            </p>
          )}

          {/* The terms, under the decision they govern. */}
          {isPending ? rights : null}

          {/* What the creator submitted — the deal's own showreel: sprocket
              strip above, one film card per video with its mono frame index. */}
          {deal.deliverables.length > 0 ? (
            <section className="bd-cr-deliverables">
              <div className="bd-capruler">
                <span className="bd-caprulertitle">{DELIVERABLES_TITLE}</span>
                <span className="bd-caprulerline" aria-hidden="true" />
                {/* The progress is data, not garnish — it rides the count
                    slot, which stays visible when mobile sheds the note. */}
                <span className="bd-caprulercount bd-mono">
                  {deliveryProgress(standing, deal.videoCount)}
                </span>
              </div>

              {deal.deliverables.map((video) => (
                <div
                  key={video.id}
                  className={`bd-cr-video ${REVIEW_ACCENT[video.reviewStatus] ?? ''}`}
                >
                  {/* Same submitted-video frame the brand sees: stored
                      thumbnail first, in-app playback on demand, deliberate
                      TikTok open as fallback. */}
                  <TiktokVideoCard
                    tiktokUrl={video.tiktokUrl}
                    thumbnailUrl={video.thumbnailUrl}
                    tiktokVideoId={
                      video.tiktokVideoId ?? parseTiktokVideoId(video.tiktokUrl)
                    }
                    videoLabel={videoHeading(video.videoOrdinal - 1)}
                  />
                  <div className="bd-cr-video-copy">
                    <h3>
                      <span
                        className="bd-cr-frameidx bd-mono"
                        aria-hidden="true"
                      >
                        {String(video.videoOrdinal).padStart(2, '0')}
                      </span>
                      {videoHeading(video.videoOrdinal - 1)} · Version{' '}
                      {video.submissionVersion}
                    </h3>
                    <p className="bd-cr-video-meta">
                      {SUBMITTED_AT_LABEL}:{' '}
                      {formatDeadlineUtc(video.submittedAt)}
                    </p>
                    <p className="bd-cr-video-meta">
                      {REVIEW_STATUS_LABEL}:{' '}
                      {labelForReviewStatus(video.reviewStatus)}
                      {video.reviewedAt
                        ? ` (${formatDeadlineUtc(video.reviewedAt)})`
                        : ''}
                    </p>
                    {video.rejectionReason ? (
                      <div className="bd-cr-rejection">
                        <h4>{REJECTION_REASON_LABEL}</h4>
                        <p>{video.rejectionReason}</p>
                      </div>
                    ) : null}
                    {video.revisionCategory && (
                      <p className="bd-cr-video-meta">
                        {REVISION_CATEGORY_LABELS[video.revisionCategory]}
                      </p>
                    )}
                    <VideoHistory
                      events={videoHistory.filter(
                        (event) => event.deliverableId === video.id
                      )}
                      limited={video.historyCompleteness === 'legacy_baseline'}
                    />
                    {canReportMetrics(deal.status) ? (
                      <div className="bd-cr-metrics">
                        <MetricsForm
                          key={`${video.id}-${video.submissionVersion}`}
                          deliverableId={video.id}
                          expectedVersion={video.submissionVersion}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {/* KAN-160: the delivery agreement sits directly above the submit
              form — the deadline is the submission's clock, so the two read
              as one unit: here is when, here is where. */}
          <DeadlineSection dealId={id} />

          {/* The submission form, when the deal is in a state that takes one. */}
          {canDeliver(deal.status) ? (
            <div className="bd-briefcard bd-cr-submitcard">
              <div className="bd-capruler">
                <span className="bd-caprulertitle">Submit deliverable</span>
                <span className="bd-caprulerline" aria-hidden="true" />
                <span className="bd-caprulernote">
                  TikTok URL for brand review
                </span>
              </div>
              <div className="bd-cr-deliverform">
                {rejectedIndex >= 0 ? (
                  <p className="bd-cr-copy">
                    {revisionRequestedMessage(videoHeading(rejectedIndex))}
                  </p>
                ) : remaining > 0 && standing > 0 ? (
                  <p className="bd-cr-copy">{REMAINING_VIDEOS_MESSAGE}</p>
                ) : null}
                <DeliverableForm
                  key={`${deal.deliverables.length}-${deal.deliverables[rejectedIndex]?.submissionVersion ?? 0}`}
                  dealId={deal.id}
                  deliverableId={deal.deliverables[rejectedIndex]?.id ?? null}
                  expectedVersion={
                    deal.deliverables[rejectedIndex]?.submissionVersion ?? 0
                  }
                  expectedSubmitted={deal.deliverables.length}
                />
              </div>
              {/* Orientation, not decoration: the three things that happen
                  after the button, so the submit reads as a step in the money
                  flow the vault promised. */}
              <ol className="bd-cr-nextsteps" aria-label="What happens next">
                <li>
                  <b>01</b> Link recorded for the brand
                </li>
                <li>
                  <b>02</b> Brand reviews the video
                </li>
                <li>
                  <b>03</b> Approval releases your payout
                </li>
              </ol>
            </div>
          ) : null}
        </div>

        {/* Reference column: the audit trail, and the terms once they're
            settled reference rather than the decision. */}
        <aside className="bd-cr-detail-rail">
          <div className="bd-cr-sidecard">
            <DealHistory events={history} />
          </div>
          {isPending ? null : <div className="bd-cr-sidecard">{rights}</div>}
        </aside>
      </div>
    </BdShell>
  );
}
