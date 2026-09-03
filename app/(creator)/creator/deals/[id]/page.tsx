import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Play } from '@phosphor-icons/react/dist/ssr';
import { BdShell } from '@/components/brand/v4-shell';
import { DealHistory, DealProgressRail } from '@/components/deals/deal-history';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
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

function Fact({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className={cn('bd-cdfact', accent && 'bd-cr-termfact--accent')}>
      <dt className="bd-cdfactlab">{label}</dt>
      <dd className="bd-cdfactval bd-mono">{value}</dd>
      {hint ? <p className="bd-cdfacthint">{hint}</p> : null}
    </div>
  );
}

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

      {/* Header: name + state, then the rail that shows where it stands. */}
      <header
        className="bd-cdhead bd-cr-dealhead bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
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
            <span className="bd-factdim">·</span>
            <span>
              {OFFER_EXPIRY_LABEL}: {deadline}
            </span>
          </p>
        </div>
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
          {/* The money — the page's reason to exist, in the v4 big-numeral
              fact ledger rather than a promotional slab. */}
          <section className="bd-cr-chapter">
            <div className="bd-capruler">
              <span className="bd-caprulertitle">{DEAL_TERMS_TITLE}</span>
              <span className="bd-caprulerline" aria-hidden="true" />
              <span className="bd-caprulernote">
                {OFFER_EXPIRY_LABEL}: {deadline}
              </span>
            </div>
            <dl className="bd-cdfacts bd-cr-termsfacts">
              <Fact
                label={EXPECTED_PAYOUT_LABEL}
                value={formatEtb(deal.expectedPayout)}
                hint={PAYOUT_ESTIMATE_NOTE}
                accent
              />
              <Fact label={VIDEO_COUNT_LABEL} value={String(deal.videoCount)} />
              <Fact
                label={UNIT_PRICE_LABEL}
                value={formatEtb(deal.unitPrice)}
              />
              <Fact
                label={TOTAL_PRICE_LABEL}
                value={formatEtb(deal.totalPrice)}
              />
              <Fact
                label={COMMISSION_LABEL}
                value={formatEtb(deal.commission)}
              />
            </dl>
          </section>

          {/* The decision — always on the page. Pending deals get the
              accept/decline controls; answered deals keep the same white
              card so the hierarchy does not collapse after accept. */}
          <section className="bd-briefcard bd-cr-decisioncard">
            <div className="bd-capruler">
              <span className="bd-caprulertitle">Your decision</span>
              <span className="bd-caprulerline" aria-hidden="true" />
              <span className="bd-caprulernote">
                Accept or decline while the offer is open
              </span>
            </div>
            {isPending ? (
              <OfferActions dealId={deal.id} terms={deal.rightsTerms} />
            ) : (
              <p className="bd-cr-copy">
                {deal.status === 'declined' || deal.status === 'expired'
                  ? labelForStatus(deal.status)
                  : 'You accepted this offer and agreed to the usage-rights terms.'}
              </p>
            )}
          </section>

          {/* The terms, under the decision they govern. */}
          {isPending ? rights : null}

          {/* KAN-43, AC-019 item 6 — the creator's half of "both parties can see
          that money is held". Above the deliver button on purpose: the money
          being held is why the creator is willing to start work. */}
          {isMoneyHeld(deal.status) ? (
            <section className="bd-caprail bd-cr-heldrail">
              <div className="bd-railcell">
                <span className="bd-railk">{FUNDS_HELD_LABEL}</span>
                <span className="bd-railv bd-mono">
                  {formatEtb(deal.totalPrice)}
                </span>
                <span className="bd-railn">{FUNDS_HELD_MESSAGE}</span>
              </div>
            </section>
          ) : null}

          {/* What the creator submitted — one card per video, with the
              thumbnail frame the landing mockup established. */}
          {deal.deliverables.length > 0 ? (
            <section className="bd-cr-deliverables">
              <div className="bd-capruler">
                <span className="bd-caprulertitle">{DELIVERABLES_TITLE}</span>
                <span className="bd-caprulerline" aria-hidden="true" />
                <span className="bd-caprulernote">
                  {deliveryProgress(standing, deal.videoCount)}
                </span>
              </div>

              {deal.deliverables.map((video, index) => (
                <div
                  key={video.id}
                  className={`bd-cr-video ${REVIEW_ACCENT[video.reviewStatus] ?? ''}`}
                >
                  {/* The 9:16 frame the landing page's deliverable mockup
                      established — same shape, real data. */}
                  <div className="bd-cr-video-frame">
                    <span className="bd-cr-video-play">
                      <Play size={12} weight="fill" aria-hidden />
                    </span>
                  </div>
                  <div className="bd-cr-video-copy">
                    <h3>{videoHeading(index)}</h3>
                    <p className="bd-cr-video-url bd-mono">{video.tiktokUrl}</p>
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
                    {canReportMetrics(deal.status) ? (
                      <div className="bd-cr-metrics">
                        <MetricsForm deliverableId={video.id} />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </section>
          ) : null}

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
                <DeliverableForm dealId={deal.id} />
              </div>
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
