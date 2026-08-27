import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  MagnifyingGlass,
  PencilSimple,
} from '@phosphor-icons/react/dist/ssr';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { PageHeader } from '@/components/layout/page-header';
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
} from '@/lib/campaigns/queries';
import { formatEtb } from '@/lib/money';

import { CancelCampaignButton } from '@/components/campaign/cancel-campaign-button';
import { ConfirmCampaignButton } from '@/components/campaign/confirm-campaign-button';
import { FundCampaignButton } from '@/components/campaign/fund-campaign-button';
import { RemoveFromCartButton } from '@/components/campaign/remove-from-cart-button';
import { VideoPerformance } from '@/components/campaign/video-performance';
import { EmptyState } from '@/components/feedback/empty-state';
import { StaggerIn } from '@/components/motion/stagger-in';
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

  const [items, budget, escrowed, acceptedCount, performance] =
    await Promise.all([
      listCartItems(campaign.id),
      readCampaignBudget(campaign.id),
      settled ? readCampaignEscrow(campaign.id) : Promise.resolve(0),
      settled ? countAcceptedDeals(campaign.id) : Promise.resolve(0),
      settled
        ? readCampaignPerformance(campaign.id)
        : Promise.resolve(EMPTY_PERFORMANCE),
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
    <StaggerIn className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <Link
        href="/campaigns"
        className={cn(
          'inline-flex w-fit items-center gap-2 text-sm text-neutral-500',
          textLinkFeedback
        )}
      >
        <ArrowLeft size={16} weight="regular" aria-hidden />
        Back to campaigns
      </Link>

      <PageHeader
        label="Campaign"
        title={campaign.name}
        description={
          <>
            <Chip
              tone={campaignStatusTone[campaign.status] ?? 'gray'}
              className="mr-2 capitalize"
            >
              {campaignStatusLabel(campaign.status)}
            </Chip>
            Created on {created}
          </>
        }
        action={
          campaign.status === 'draft' && (
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
              />
              <CancelCampaignButton
                campaignId={campaign.id}
                campaignName={campaign.name}
              />
            </div>
          )
        }
      />

      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.8fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {settled ? (
            <VideoPerformance
              deals={performance.deals}
              totals={performance.totals}
            />
          ) : (
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
                <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col gap-4 py-5 transition-colors duration-200 ease-out hover:bg-neutral-100/60 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/discover/${item.creatorId}`}
                            className={cn(
                              'text-base font-semibold text-neutral-900',
                              textLinkFeedback
                            )}
                          >
                            {item.creator.tiktokHandle}
                          </Link>
                          {item.tier?.id ? (
                            <Chip tone="line">{item.tier.name} Tier</Chip>
                          ) : null}
                        </div>
                        <p className="text-sm capitalize text-neutral-500">
                          {item.creator.niche} creator
                        </p>
                      </div>

                      <div className="flex flex-wrap items-end gap-6 sm:items-center sm:justify-end">
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] font-semibold tracking-[0.14em] text-neutral-500 uppercase">
                            Rate
                          </span>
                          <span className="font-mono text-sm tabular-nums text-neutral-900">
                            {formatEtb(item.unitPrice)}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] font-semibold tracking-[0.14em] text-neutral-500 uppercase">
                            Videos
                          </span>
                          <span className="text-sm tabular-nums text-neutral-900">
                            x{item.videoCount}
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] font-semibold tracking-[0.14em] text-neutral-500 uppercase">
                            Total
                          </span>
                          <span className="font-mono text-sm font-medium tabular-nums text-neutral-900">
                            {formatEtb(item.totalPrice)}
                          </span>
                        </div>
                        <RemoveFromCartButton
                          campaignId={campaign.id}
                          creatorId={item.creatorId}
                          creatorHandle={item.creator.tiktokHandle}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <aside className="lg:sticky lg:top-24">
          <section className="flex flex-col gap-5 rounded-[24px] bg-neutral-900 p-6 text-neutral-50 shadow-[0_24px_60px_-28px_rgba(23,23,23,0.45)] sm:p-7">
            <p className="text-[13px] font-semibold tracking-[0.14em] text-neutral-300 uppercase">
              Budget summary
            </p>

            <div className="flex flex-col gap-4">
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

            <div className="border-t border-neutral-700 pt-4">
              <LedgerRow
                label="Remaining"
                value={formatEtb(available)}
                strong
              />
            </div>

            {campaign.status === 'confirmed' ? (
              <div className="border-t border-neutral-700 pt-4">
                <FundCampaignButton
                  campaignId={campaign.id}
                  acceptedCount={acceptedCount}
                  size="lg"
                />
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </StaggerIn>
  );
}
