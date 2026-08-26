import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export const runtime = 'nodejs';

/**
 * Campaign detail: the cart while it is a draft, the live deals and their
 * performance once it is not (KAN-30, KAN-68, KAN-49).
 *
 * Shows the campaign's budget and what has happened to it — committed, held in
 * escrow, paid out, and taken as commission — beside either the cart being built
 * or the videos that were delivered against it.
 *
 * **No money is computed here.** Every figure arrives summed from the ledger or
 * from `readCampaignBudget`, and `formatEtb` is the only arithmetic-shaped call in
 * the file (AC-026, invariant 4).
 */
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

  // `readCampaignEscrow`, `countAcceptedDeals` and `readCampaignPerformance` are
  // only asked for once the campaign has left `draft`. A draft has no deals and no
  // ledger entries, so every answer is known to be zero or empty — and running them
  // anyway would put three queries on the page that carries the cart, which is the
  // one a brand loads repeatedly while shopping.
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

  // `getCampaignForBrand` already returned this campaign for this brand, so the
  // guarded read above cannot miss. Falling back to the campaign's own ceiling
  // with nothing committed keeps the type honest without a second `notFound()`
  // for a case that is unreachable.
  const { committed, available } = budget ?? {
    committed: 0,
    available: campaign.budget,
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 py-4">
      <Link
        href="/campaigns"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Back to campaigns
      </Link>

      <PageHeader
        title={campaign.name}
        description={
          <>
            <Chip
              tone={campaignStatusTone[campaign.status] ?? 'gray'}
              className="mr-2 capitalize"
            >
              {campaignStatusLabel(campaign.status)}
            </Chip>
            Created on{' '}
            {new Date(campaign.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </>
        }
        action={
          campaign.status === 'draft' && (
            <div className="flex items-start gap-3">
              <Link
                href={`/campaigns/${campaign.id}/edit`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Edit brief
              </Link>
              <Link
                href="/discover"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Find creators
              </Link>
              {/*
              AC-016. Draft only, and disabled on an empty cart — both are
              courtesies. `POST /confirm` re-checks the status, the ownership,
              the cart and the budget ceiling regardless (NFR-005, AC-014).
            */}{' '}
              <ConfirmCampaignButton
                campaignId={campaign.id}
                itemCount={items.length}
              />
              {/*
                KAN-200. Last, and after the confirm: it is the one control here
                that does not reverse, so it does not sit where a brand aiming for
                "Send offers" can reach it by overshooting.

                Draft only. `POST /cancel` accepts `confirmed` as well, but
                cancelling then withdraws offers creators are holding and nothing
                notifies them — that is a product decision, not a button.
              */}
              <CancelCampaignButton
                campaignId={campaign.id}
                campaignName={campaign.name}
              />
            </div>
          )
        }
      />
      {/*
        AC-019. `confirmed` only: before it there is nothing accepted to hold,
        and after it the money is already held — `POST /fund` answers a second
        attempt with 409 `CAMPAIGN_NOT_FUNDABLE` regardless (AC bullet 7).

        The button lives at the foot of the Budget Summary card, not marooned
        between the header and the grid: the brand commits money while looking
        at the figures, so the control belongs with them. Full-width and `lg` —
        the action that moves the campaign's whole budget is the primary call
        on this page, and `sm` read as a secondary beside it.
      */}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.8fr)]">
        <div className="flex flex-col gap-4 lg:col-span-1">
          {/*
            The cart and the delivered videos are the same creators at two
            different stages, so the page shows one or the other rather than both.
            Before confirmation the cart is the editable thing; after it the cart
            is frozen and the videos are what actually happened.

            KAN-49 replaced the deals list that stood here with the performance
            section: it renders the same rows — creator, status, video count, price,
            a link into each deal — plus the four engagement counts and the campaign
            total AC-026 asks for. Two lists of the same creators, one with numbers
            and one without, is the duplication this ternary exists to prevent.
          */}
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
                <ul className="flex flex-col gap-4">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Card>
                        <CardContent className="flex flex-col items-start justify-between gap-6 p-5 sm:flex-row sm:items-center">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/discover/${item.creatorId}`}
                                className="font-semibold text-lg hover:underline"
                              >
                                {item.creator.tiktokHandle}
                              </Link>
                              {item.tier?.id && (
                                <Chip tone="line">{item.tier.name} Tier</Chip>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground capitalize">
                              {item.creator.niche} creator
                            </p>
                          </div>

                          <div className="flex items-center gap-8 text-right">
                            <div className="flex flex-col">
                              <span className="text-sm text-muted-foreground">
                                Rate
                              </span>
                              <span className="font-mono text-sm">
                                {formatEtb(item.unitPrice)}
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm text-muted-foreground">
                                Videos
                              </span>
                              <span className="text-sm">
                                x{item.videoCount}
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm text-muted-foreground">
                                Total
                              </span>
                              <span className="font-mono text-sm text-neutral-900">
                                {formatEtb(item.totalPrice)}
                              </span>
                            </div>
                            {/*
                              Draft only (AC-015): once the campaign is confirmed
                              the offers exist, and withdrawing one is the
                              decline/cancel path, not this. The endpoint refuses
                              it either way — hiding the button is the courtesy,
                              the 409 is the rule.
                            */}
                            <RemoveFromCartButton
                              campaignId={campaign.id}
                              creatorId={item.creatorId}
                              creatorHandle={item.creator.tiktokHandle}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="lg:col-span-1">
          <Card className="sticky top-20 shadow-none">
            <CardHeader>
              <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Budget summary
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Total Budget</span>
                <span className="font-medium">
                  {formatEtb(campaign.budget)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                {/*
                  Two labels because there are two sources (see
                  `readCampaignBudget`): the cart while the campaign is a draft,
                  the live deals once offers exist. "Running Total" over a
                  deals-derived figure would name the wrong thing — and it is the
                  figure that no longer counts a declined offer (AC-018).
                */}
                <span className="text-muted-foreground">
                  {campaign.status === 'draft' ? 'Running Total' : 'Committed'}
                </span>
                <span className="font-medium">{formatEtb(committed)}</span>
              </div>
              {/*
                AC-019 item 6, brand side. Shown only once something is actually
                held: a "0.00 ETB held" row on a campaign nobody has funded reads
                as a fact about the escrow rather than the absence of one.

                Summed from `ledger_entry`, not from the deals — a separate figure
                from `Committed` above on purpose. The two agree while every
                accepted deal is funded and diverge exactly when they should: a
                confirmed campaign commits its budget with nothing held yet, and an
                approved deliverable pays out, leaving it committed and spent but no
                longer held (spike §6's `budget = available + escrowed + spent`).
              */}
              {escrowed > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      {HELD_IN_ESCROW_LABEL}
                    </span>
                    <span className="font-medium">{formatEtb(escrowed)}</span>
                  </div>
                  {/* AC-021, stated rather than left to be inferred from a label. */}
                  <p className="text-xs text-muted-foreground">
                    {HELD_IN_ESCROW_NOTE}
                  </p>
                </div>
              )}
              {/*
                AC-026's money half: what has actually left escrow, and where it
                went. Both figures are summed from `ledger_entry` by
                `sumSettledByCampaign` — the rows the payout transaction wrote —
                never re-derived from a rate here. `computeSplit` is deliberately
                not imported into this file.

                Shown together and only once something has been paid, on the same
                reasoning as the escrow row above: a "0.00 ETB paid out" pair on a
                campaign nobody has approved reads as a fact rather than the absence
                of one. They appear as a pair because either alone invites the wrong
                sum — the commission is a slice of the same money, not a charge on
                top of it, which is what the note says.
              */}
              {performance.settlement.paidOut > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      {PAID_OUT_LABEL}
                    </span>
                    <span className="font-medium">
                      {formatEtb(performance.settlement.paidOut)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      {COMMISSION_LABEL}
                    </span>
                    <span className="font-medium">
                      {formatEtb(performance.settlement.commission)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {SETTLEMENT_NOTE}
                  </p>
                </div>
              )}
              {/*
                KAN-51, brand side. A refund puts a deal's held money back into
                the brand's available budget (`refundDeal`), which is why `Held`
                drops and `Remaining` rises with no line to explain it — this is
                that line.

                Summed from `ledger_entry` by `sumSettledByCampaign`, never
                re-derived here, like every other figure on this card. Shown only
                once something has actually been refunded, the `escrowed > 0`
                precedent: a "0.00 ETB refunded" row on a campaign with no dispute
                reads as a fact rather than the absence of one. Placed after paid
                out because both are money that has left escrow; its note says
                this one came back rather than being spent, so the two are not
                summed into one loss.
              */}
              {performance.settlement.refunded > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">
                      {REFUNDED_LABEL}
                    </span>
                    <span className="font-medium">
                      {formatEtb(performance.settlement.refunded)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {REFUNDED_NOTE}
                  </p>
                </div>
              )}
              <div className="pt-4 border-t border-border flex justify-between items-center">
                <span className="font-semibold">Remaining</span>
                <span className="font-semibold text-primary">
                  {formatEtb(available)}
                </span>
              </div>

              {/* The money action sits at the bottom of the card that shows
                  the money, right-aligned under the Remaining row — see the
                  note where the confirmed block used to live above the grid. */}
              {campaign.status === 'confirmed' && (
                <div className="border-t border-border pt-4">
                  <FundCampaignButton
                    campaignId={campaign.id}
                    acceptedCount={acceptedCount}
                    size="lg"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
