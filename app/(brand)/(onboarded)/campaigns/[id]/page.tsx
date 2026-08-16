import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
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
  SETTLEMENT_NOTE,
  readCampaignPerformance,
} from '@/lib/campaigns/performance';
import {
  countAcceptedDeals,
  getCampaignForBrand,
} from '@/lib/campaigns/queries';
import { formatEtb } from '@/lib/money';

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
    <div className="mx-auto flex max-w-5xl flex-col gap-8 py-4">
      <Link
        href="/campaigns"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← Back to campaigns
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {campaign.name}
          </h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
            <Badge variant="secondary" className="capitalize">
              {campaign.status}
            </Badge>
            <span>•</span>
            <span>
              Created on{' '}
              {new Date(campaign.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
        </div>
        {campaign.status === 'draft' && (
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
            */}
            <ConfirmCampaignButton
              campaignId={campaign.id}
              itemCount={items.length}
            />
          </div>
        )}
        {/*
          AC-019. `confirmed` only: before it there is nothing accepted to hold,
          and after it the money is already held — `POST /fund` answers a second
          attempt with 409 `CAMPAIGN_NOT_FUNDABLE` regardless (AC bullet 7).
        */}
        {campaign.status === 'confirmed' && (
          <div className="flex items-start gap-3">
            <FundCampaignButton
              campaignId={campaign.id}
              acceptedCount={acceptedCount}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 flex flex-col gap-4">
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
              videos={performance.videos}
              totals={performance.totals}
            />
          ) : (
            <>
              <h2 className="text-xl font-semibold tracking-tight">
                Cart ({items.length})
              </h2>

              {items.length === 0 ? (
                <EmptyState
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
                        <CardContent className="p-6 flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <Link
                                href={`/discover/${item.creatorId}`}
                                className="font-semibold text-lg hover:underline"
                              >
                                {item.creator.tiktokHandle}
                              </Link>
                              {item.tier?.id && (
                                <Badge variant="outline" className="text-xs">
                                  {item.tier.name} Tier
                                </Badge>
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
                              <span className="font-medium">
                                {formatEtb(item.unitPrice)}
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm text-muted-foreground">
                                Videos
                              </span>
                              <span className="font-medium">
                                x{item.videoCount}
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm text-muted-foreground">
                                Total
                              </span>
                              <span className="font-semibold text-primary">
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

        <div className="md:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Budget Summary</CardTitle>
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
              <div className="pt-4 border-t border-border flex justify-between items-center">
                <span className="font-semibold">Remaining</span>
                <span className="font-semibold text-primary">
                  {formatEtb(available)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
