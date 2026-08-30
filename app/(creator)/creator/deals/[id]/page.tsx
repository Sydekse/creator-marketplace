import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Play } from '@phosphor-icons/react/dist/ssr';
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
import { Chip } from '@/components/ui/chip';
import { SectionLabel } from '@/components/layout/section-label';
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

function Fact({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={
          accent
            ? 'font-sans text-base font-bold tracking-[-0.02em] text-brand-ink tabular-nums'
            : 'font-mono text-sm font-medium text-neutral-900 tabular-nums'
        }
      >
        {value}
      </dd>
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

  const rights = deal.rightsTerms ? (
    <UsageRightsCard terms={deal.rightsTerms} collapsed={!isPending} />
  ) : (
    <p className="text-sm text-muted-foreground">{NO_RIGHTS_TERMS_MESSAGE}</p>
  );

  return (
    <div className="flex flex-col gap-8 py-4">
      <Link
        href="/creator/deals"
        className="group inline-flex w-fit items-center gap-1.5 text-sm font-medium text-neutral-600 transition-colors duration-200 ease-out hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        <ArrowLeft
          size={14}
          weight="regular"
          aria-hidden
          className="transition-transform duration-200 ease-out group-hover:-translate-x-0.5"
        />
        Back to your deals
      </Link>

      {/* Header: name + state, then the rail that shows where it stands. */}
      <header className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <InitialsAvatar name={deal.companyName} size="sm" />
            <span className="text-sm font-medium text-neutral-800">
              {deal.companyName}
            </span>
            <Chip
              tone={dealStatusTone[deal.status]}
              size="md"
              className="px-3.5 py-1.5 text-[13px] font-semibold tracking-[0.06em]"
            >
              {labelForStatus(deal.status)}
            </Chip>
          </div>
          <h1 className="page-title tracking-tight">{deal.campaignName}</h1>
        </div>

        {/* The rail is the deal's state made visible — always rendered, even
            with no events, so a pending deal shows step 1 highlighted instead
            of a blank aside. */}
        <div className="animate-rise-in rounded-[24px] border border-neutral-200 bg-background px-4 py-5 sm:px-6">
          <DealProgressRail status={deal.status} events={history} />
        </div>

        <div className="border-b border-neutral-200" aria-hidden="true" />
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.75fr)] lg:items-start lg:gap-8">
        <div className="flex flex-col gap-6">
          {/* The money — the page's reason to exist, wearing the dashboard's
              payout-card surface: full teal wash, brand border, and the
              expected payout in a white inset panel inside it. */}
          <section className="surface-pop animate-rise-in-1 rounded-[24px] border border-brand/40 p-5 shadow-[0_24px_60px_-28px_rgba(23,23,23,0.25)] sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <SectionLabel>{DEAL_TERMS_TITLE}</SectionLabel>
              <p className="font-mono text-xs text-muted-foreground">
                {OFFER_EXPIRY_LABEL}: {deadline}
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-1 rounded-2xl border border-neutral-200 bg-background px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {EXPECTED_PAYOUT_LABEL}
              </p>
              <p className="font-sans text-3xl font-bold tracking-[-0.04em] text-brand-ink tabular-nums">
                {formatEtb(deal.expectedPayout)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {PAYOUT_ESTIMATE_NOTE}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 pt-5 sm:grid-cols-4">
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
          <section className="animate-rise-in-2 flex flex-col gap-4 rounded-[24px] border border-neutral-200 bg-background p-5 shadow-[0_16px_40px_-24px_rgba(23,23,23,0.2)] sm:p-6">
            <SectionLabel>Your decision</SectionLabel>
            {isPending ? (
              <OfferActions dealId={deal.id} terms={deal.rightsTerms} />
            ) : (
              <p className="text-sm leading-relaxed text-neutral-700">
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
            <section className="surface-pop rounded-[24px] border border-brand/40 p-5 sm:p-6">
              <SectionLabel>{FUNDS_HELD_LABEL}</SectionLabel>
              <p className="mt-4 font-display text-4xl font-medium tracking-tight text-neutral-900 sm:text-5xl">
                {formatEtb(deal.totalPrice)}
              </p>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                {FUNDS_HELD_MESSAGE}
              </p>
            </section>
          ) : null}

          {/* What the creator submitted — one card per video, with the
              thumbnail frame the landing mockup established. */}
          {deal.deliverables.length > 0 ? (
            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <SectionLabel>{DELIVERABLES_TITLE}</SectionLabel>
                <p className="text-sm text-muted-foreground">
                  {deliveryProgress(standing, deal.videoCount)}
                </p>
              </div>

              {deal.deliverables.map((video, index) => (
                <div
                  key={video.id}
                  className="flex gap-5 rounded-[20px] border border-neutral-200 bg-background p-5"
                >
                  {/* The 9:16 frame the landing page's deliverable mockup
                      established — same shape, real data. */}
                  <div className="grid aspect-[9/16] w-24 shrink-0 place-items-center rounded-xl border border-neutral-200 bg-neutral-100">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-deep">
                      <Play
                        size={12}
                        weight="fill"
                        className="text-neutral-50"
                        aria-hidden
                      />
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <h3 className="text-sm font-medium">
                      {videoHeading(index)}
                    </h3>
                    <p className="font-mono text-xs break-all text-muted-foreground">
                      {video.tiktokUrl}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {SUBMITTED_AT_LABEL}:{' '}
                      {formatDeadlineUtc(video.submittedAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {REVIEW_STATUS_LABEL}:{' '}
                      {labelForReviewStatus(video.reviewStatus)}
                      {video.reviewedAt
                        ? ` (${formatDeadlineUtc(video.reviewedAt)})`
                        : ''}
                    </p>
                    {video.rejectionReason ? (
                      <div className="flex flex-col gap-1 border-t border-neutral-200 pt-2">
                        <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-destructive">
                          {REJECTION_REASON_LABEL}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {video.rejectionReason}
                        </p>
                      </div>
                    ) : null}
                    {canReportMetrics(deal.status) ? (
                      <div className="pt-2">
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
            <div className="rounded-[24px] border border-neutral-200 bg-background p-5 sm:p-6">
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
        </div>

        {/* Reference column: the audit trail, and the terms once they're
            settled reference rather than the decision. */}
        <aside className="flex flex-col gap-6 lg:sticky lg:top-28">
          <DealHistory events={history} />
          {isPending ? null : rights}
        </aside>
      </div>
    </div>
  );
}
