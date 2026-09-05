import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  MagnifyingGlass,
  PencilSimple,
} from '@phosphor-icons/react/dist/ssr';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { readCampaignBudget } from '@/lib/campaigns/budget';
import { listCartItems } from '@/lib/campaigns/cart-queries';
import {
  HELD_IN_ESCROW_LABEL,
  HELD_IN_ESCROW_NOTE,
} from '@/lib/campaigns/constants';
import { readCampaignEscrow } from '@/lib/campaigns/escrow';
import {
  COMMISSION_LABEL,
  EMPTY_PERFORMANCE,
  PAID_OUT_LABEL,
  REFUNDED_LABEL,
  REFUNDED_NOTE,
  SETTLEMENT_NOTE,
  readCampaignPerformance,
} from '@/lib/campaigns/performance';
import {
  campaignStatusLabel,
  campaignStatusTone,
} from '@/lib/campaigns/status';
import {
  countAcceptedDeals,
  getCampaignForBrand,
  sumContractedVideos,
} from '@/lib/campaigns/queries';
import { getOpenFundingSession } from '@/lib/campaigns/fund-session';
import { paymentUxMode } from '@/lib/payment/gateway';
import { formatEtb } from '@/lib/money';

import { CancelCampaignButton } from '@/components/campaign/cancel-campaign-button';
import { ConfirmCampaignButton } from '@/components/campaign/confirm-campaign-button';
import { FundCampaignButton } from '@/components/campaign/fund-campaign-button';
import { FundCheckoutButton } from '@/components/campaign/fund-checkout-button';
import { PendingPaymentBanner } from '@/components/campaign/pending-payment-banner';
import { RemoveFromCartButton } from '@/components/campaign/remove-from-cart-button';
import { VideoPerformance } from '@/components/campaign/video-performance';
import { CampaignInsightsPanel } from '@/components/campaign/insights';
import { readCampaignInsights } from '@/lib/campaigns/insights';
import { EmptyState } from '@/components/feedback/empty-state';
import { MagneticLink } from '@/components/motion/magnetic-link';
import { StatusPulse } from '@/components/motion/status-pulse';
import { StaggerIn } from '@/components/motion/stagger-in';
import { TruncatedText } from '@/components/ui/truncated-text';
import { cn, textLinkFeedback } from '@/lib/utils';

export const runtime = 'nodejs';

/**
 * Campaign detail: the cart while it is a draft, the live deals and their
 * performance once it is not (KAN-30, KAN-68, KAN-49).
 *
 * **No money is computed here.** Every figure arrives summed from the ledger or
 * from `readCampaignBudget`, and `formatEtb` is the only arithmetic-shaped call in
 * the file (AC-026, invariant 4).
 */

function LedgerRow({
  label,
  value,
  note,
  strong = false,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span
          className={
            strong ? 'font-semibold text-neutral-50' : 'text-neutral-400'
          }
        >
          {label}
        </span>
        <span
          className={cn(
            'font-mono tabular-nums',
            strong ? 'font-semibold text-neutral-50' : 'text-neutral-50'
          )}
        >
          {value}
        </span>
      </div>
      {note ? (
        <p className="text-xs leading-relaxed text-neutral-500">{note}</p>
      ) : null}
    </div>
  );
}

export default async function CampaignCartPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  if (!profile) redirect('/brand/onboarding');

  const campaign = await getCampaignForBrand(id, profile.id);
  if (!campaign) notFound();

  const settled = campaign.status !== 'draft';
  const PageFrame = settled ? 'div' : StaggerIn;
  const BackLink = settled ? Link : MagneticLink;
  // Which money rails the fund control drives (KAN-70): `mock` funds in one
  // POST; anything else leaves for Chapa's hosted checkout, and a campaign
  // with an open checkout shows the resume/cancel banner instead of a button.
  const uxMode = paymentUxMode();
  // Ordered so the draft-only-block assertion in cancel-campaign.test.ts keeps
  // its anchor: the page's first `campaign.status === 'confirmed' &&` must
  // remain the JSX action block, not this flag.
  const chapaMode = uxMode !== 'mock' && campaign.status === 'confirmed';

  const [
    items,
    budget,
    escrowed,
    acceptedCount,
    performance,
    openSession,
    contractedVideos,
    insights,
  ] = await Promise.all([
    listCartItems(campaign.id),
    readCampaignBudget(campaign.id),
    settled ? readCampaignEscrow(campaign.id) : Promise.resolve(0),
    settled ? countAcceptedDeals(campaign.id) : Promise.resolve(0),
    settled
      ? readCampaignPerformance(campaign.id)
      : Promise.resolve(EMPTY_PERFORMANCE),
    chapaMode ? getOpenFundingSession(campaign.id) : Promise.resolve(null),
    // Drafts have no deals by definition — skip the query, not just the label.
    campaign.status === 'draft'
      ? Promise.resolve(0)
      : sumContractedVideos(campaign.id),
    settled ? readCampaignInsights(campaign.id) : Promise.resolve(null),
  ]);

  const { committed, available } = budget ?? {
    committed: 0,
    available: campaign.budget,
  };

  const created = new Date(campaign.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <PageFrame className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <BackLink
        href="/campaigns"
        className="group inline-flex w-fit items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm text-neutral-700 transition-[border-color,background-color,color,transform] duration-200 ease-[var(--ease-smooth)] hover:border-neutral-300 hover:bg-white hover:text-neutral-900 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <ArrowLeft
          size={14}
          weight="regular"
          aria-hidden
          className="transition-transform duration-200 ease-[var(--ease-smooth)] group-hover:-translate-x-0.5"
        />
        Back to campaigns
      </BackLink>

      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.9fr)] lg:gap-16">
        <div className="flex min-w-0 flex-col gap-10">
          <header className="flex flex-col gap-5">
            <p className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
              Campaign
            </p>
            <h1 className="page-title max-w-[18ch]">{campaign.name}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-neutral-500">
              <Chip
                tone={campaignStatusTone[campaign.status] ?? 'gray'}
                className="capitalize"
              >
                {settled ? (
                  <span
                    className="mr-1.5 inline-flex size-1.5 rounded-full bg-current"
                    aria-hidden
                  />
                ) : (
                  <StatusPulse className="mr-1.5" />
                )}
                {campaignStatusLabel(campaign.status)}
              </Chip>
              <span>Opened {created}</span>
              <span className="font-mono tabular-nums text-neutral-700">
                {contractedVideos > 0
                  ? `${contractedVideos} of ${campaign.desiredVideos} videos contracted`
                  : `${campaign.desiredVideos} videos planned`}
              </span>
            </div>
            {campaign.goal ? (
              <p className="max-w-[62ch] text-base leading-relaxed text-neutral-600">
                {campaign.goal}
              </p>
            ) : null}
            {campaign.status === 'draft' && (
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/campaigns/${campaign.id}/edit`}
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'gap-1.5'
                  )}
                >
                  <PencilSimple size={14} weight="regular" aria-hidden />
                  Edit brief
                </Link>
                <Link
                  href="/discover"
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'gap-1.5'
                  )}
                >
                  <MagnifyingGlass size={14} weight="regular" aria-hidden />
                  Find creators
                </Link>
                <ConfirmCampaignButton
                  campaignId={campaign.id}
                  itemCount={items.length}
                  deliveryWindowDays={campaign.deliveryWindowDays}
                />
                <CancelCampaignButton
                  campaignId={campaign.id}
                  campaignName={campaign.name}
                />
              </div>
            )}
            <div className="border-b border-neutral-200" aria-hidden="true" />
          </header>

          {settled ? null : (
            <>
              <h2 className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
                Cart ({items.length})
              </h2>

              {items.length === 0 ? (
                <EmptyState
                  align="start"
                  title="Your cart is empty"
                  description="Browse the marketplace to find creators and add them to this campaign."
                  action={
                    <Link
                      href="/discover"
                      className={buttonVariants({
                        variant: 'default',
                        size: 'sm',
                      })}
                    >
                      Browse creators
                    </Link>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[42rem]">
                    <div className="grid grid-cols-[2rem_1.75rem_minmax(8rem,1fr)_7rem_3.5rem_7.5rem_auto] items-center gap-x-3 border-b border-neutral-200 px-1 py-2 text-[11px] font-semibold tracking-[0.14em] text-neutral-500 uppercase">
                      <span aria-hidden className="block min-h-px" />
                      <span aria-hidden className="block min-h-px" />
                      <span className="whitespace-nowrap">Creator</span>
                      <span className="whitespace-nowrap text-right">Rate</span>
                      <span className="whitespace-nowrap text-right">
                        Videos
                      </span>
                      <span className="whitespace-nowrap text-right">
                        Total
                      </span>
                      <span aria-hidden className="block min-h-px" />
                    </div>
                    <ul className="divide-y divide-neutral-200 border-b border-neutral-200">
                      {items.map((item, index) => (
                        <li
                          key={item.id}
                          className="grid grid-cols-[2rem_1.75rem_minmax(8rem,1fr)_7rem_3.5rem_7.5rem_auto] items-center gap-x-3 px-1 py-3 transition-colors duration-200 ease-[var(--ease-smooth)] hover:bg-neutral-100/70"
                        >
                          <span className="font-mono text-[11px] tabular-nums text-neutral-400">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <InitialsAvatar
                            name={item.creator.tiktokHandle}
                            image={item.creator.image}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <Link
                                href={`/discover/${item.creatorId}`}
                                className={cn('min-w-0', textLinkFeedback)}
                              >
                                <TruncatedText
                                  text={item.creator.tiktokHandle}
                                  className="text-sm font-semibold text-neutral-900"
                                />
                              </Link>
                              {item.tier?.id ? (
                                <Chip
                                  tone="line"
                                  className="shrink-0 whitespace-nowrap"
                                >
                                  {item.tier.name}
                                </Chip>
                              ) : null}
                            </div>
                            <TruncatedText
                              text={item.creator.niche}
                              className="text-xs capitalize text-neutral-500"
                            />
                          </div>
                          <span className="text-right font-mono text-sm whitespace-nowrap tabular-nums text-neutral-900">
                            {formatEtb(item.unitPrice)}
                          </span>
                          <span className="text-right font-mono text-sm whitespace-nowrap tabular-nums text-neutral-900">
                            ×{item.videoCount}
                          </span>
                          <span className="text-right font-mono text-sm font-medium whitespace-nowrap tabular-nums text-neutral-900">
                            {formatEtb(item.totalPrice)}
                          </span>
                          <RemoveFromCartButton
                            campaignId={campaign.id}
                            creatorId={item.creatorId}
                            creatorHandle={item.creator.tiktokHandle}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <aside className="lg:sticky lg:top-24">
          <section className="flex flex-col gap-6 rounded-[24px] bg-neutral-900 p-6 text-neutral-50 shadow-[0_24px_60px_-28px_rgba(23,23,23,0.45)] sm:p-8">
            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-semibold tracking-[0.14em] text-neutral-300 uppercase">
                Remaining
              </p>
              <p className="font-mono text-3xl font-medium tracking-tight text-neutral-50 tabular-nums sm:text-4xl">
                {formatEtb(available)}
              </p>
            </div>

            <div className="flex flex-col gap-4 border-t border-neutral-700 pt-5">
              <LedgerRow
                label="Total budget"
                value={formatEtb(campaign.budget)}
              />
              <LedgerRow
                label={
                  campaign.status === 'draft' ? 'Running total' : 'Committed'
                }
                value={formatEtb(committed)}
              />
              {escrowed > 0 ? (
                <LedgerRow
                  label={HELD_IN_ESCROW_LABEL}
                  value={formatEtb(escrowed)}
                  note={HELD_IN_ESCROW_NOTE}
                />
              ) : null}
              {performance.settlement.paidOut > 0 ? (
                <>
                  <LedgerRow
                    label={PAID_OUT_LABEL}
                    value={formatEtb(performance.settlement.paidOut)}
                  />
                  <LedgerRow
                    label={COMMISSION_LABEL}
                    value={formatEtb(performance.settlement.commission)}
                    note={SETTLEMENT_NOTE}
                  />
                </>
              ) : null}
              {performance.settlement.refunded > 0 ? (
                <LedgerRow
                  label={REFUNDED_LABEL}
                  value={formatEtb(performance.settlement.refunded)}
                  note={REFUNDED_NOTE}
                />
              ) : null}
            </div>

            {campaign.status === 'confirmed' ? (
              <div className="border-t border-neutral-700 pt-5">
                {!chapaMode ? (
                  <FundCampaignButton
                    campaignId={campaign.id}
                    acceptedCount={acceptedCount}
                    size="lg"
                  />
                ) : openSession ? (
                  <PendingPaymentBanner
                    campaignId={campaign.id}
                    checkoutUrl={openSession.checkoutUrl}
                  />
                ) : (
                  <FundCheckoutButton
                    campaignId={campaign.id}
                    acceptedCount={acceptedCount}
                    formattedTotal={formatEtb(committed)}
                    testMode={uxMode === 'chapa-test'}
                    size="lg"
                  />
                )}
              </div>
            ) : null}
          </section>
        </aside>
      </div>
      {settled && insights && <CampaignInsightsPanel insights={insights} />}
      {settled ? (
        <VideoPerformance
          deals={performance.deals}
          totals={performance.totals}
        />
      ) : null}
    </PageFrame>
  );
}
