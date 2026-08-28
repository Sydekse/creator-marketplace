import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CaretRight } from '@phosphor-icons/react/dist/ssr';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { PayoutChart } from '@/components/creator/payout-chart';
import { SectionLabel } from '@/components/layout/section-label';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { listCampaignsByBrand } from '@/lib/campaigns/queries';
import { readBrandDashboard } from '@/lib/brands/dashboard';
import { cn } from '@/lib/utils';
import {
  campaignStatusLabel,
  campaignStatusTone,
} from '@/lib/campaigns/status';
import { formatEtb } from '@/lib/money';
import { TruncatedText } from '@/components/ui/truncated-text';
import { displayTiktokHandle } from '@/lib/creators/handle';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Brand dashboard (§13).
 *
 * Reachable only through the `(onboarded)` layout, so a brand who lands here
 * has a profile; one who does not was already redirected to `/brand/onboarding`
 * (AC-4).
 *
 * Shows campaign summaries, cross-campaign money totals (ledger-derived, never
 * recomputed), and deals awaiting review — the three things a brand needs on
 * login.
 */
export default async function BrandDashboardPage() {
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  if (!profile) redirect('/brand/onboarding');

  const dashboard = await readBrandDashboard();
  const recentCampaigns = (await listCampaignsByBrand(profile.id)).slice(0, 4);

  return (
    <div className="flex flex-col gap-8 py-4">
      <div className="flex flex-col gap-3 border-b border-neutral-200 pb-3 sm:gap-4 sm:pb-4">
        <p className="text-[11px] font-bold tracking-[0.12em] text-brand uppercase sm:text-[13px] sm:tracking-[0.14em]">
          Welcome back
        </p>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-2 gap-y-0.5 sm:gap-x-4 sm:gap-y-1">
          <div className="avatar-stack-circle row-span-2">
            <InitialsAvatar
              name={profile.companyName}
              className="!size-full rounded-full border-neutral-900 bg-neutral-900 text-neutral-50 shadow-none"
            />
          </div>
          <h1 className="page-title opener-title min-w-0">
            {profile.companyName}
          </h1>
          <Link
            href="/brand/settings"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'border-2'
            )}
          >
            Edit name
          </Link>
          <p className="col-span-2 col-start-2 text-xs text-neutral-600 sm:text-sm">
            {user.name ?? user.email}
          </p>
        </div>
      </div>

      <>
        {/* Money is the thesis: the line, then the band. Spent tracks the
              ledger's outflow; held is what is still sitting in escrow. Same
              chart grammar as the creator dashboard (one line, hairline grid,
              brand ink) — a brand reading both sides should not learn two
              charts. First-run (no campaigns) still uses this shell so the
              empty dashboard matches the working one. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)] lg:items-stretch">
          <section className="surface-card surface-pop flex h-full min-h-0 flex-col rounded-[28px] border-2 border-brand/40 p-5 sm:p-6">
            <PayoutChart
              label="Spend"
              note="Last 12 weeks"
              points={dashboard.spent}
            />
          </section>
          <dl className="flex h-full flex-col gap-4">
            <div className="flex min-h-0 flex-1 flex-col justify-center rounded-[24px] bg-[color-mix(in_oklch,var(--brand-tint)_70%,white)] px-4 py-4">
              <dt className="text-xs font-bold tracking-wide text-brand-ink uppercase">
                Held in escrow
              </dt>
              <dd className="mt-1 font-mono text-3xl font-bold tracking-[-0.04em] text-brand-ink tabular-nums">
                {formatEtb(dashboard.money.held)}
              </dd>
            </div>
            <div className="rounded-2xl bg-neutral-100 px-4 py-4">
              <dt className="text-xs font-bold tracking-wide text-neutral-500 uppercase">
                Paid out
              </dt>
              <dd className="mt-1 font-mono text-2xl font-bold tracking-[-0.04em] text-neutral-900 tabular-nums">
                {formatEtb(dashboard.money.paidOut)}
              </dd>
            </div>
            <div className="rounded-2xl bg-neutral-100 px-4 py-4">
              <dt className="text-xs font-bold tracking-wide text-neutral-500 uppercase">
                Commission
              </dt>
              <dd className="mt-1 font-mono text-2xl font-bold tracking-[-0.04em] text-neutral-900 tabular-nums">
                {formatEtb(dashboard.money.commission)}
              </dd>
            </div>
          </dl>
        </div>

        {/* §13: the work — same row language for queue and campaigns. */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)] lg:items-start">
          <section className="flex flex-col gap-4">
            <SectionLabel>Awaiting review</SectionLabel>
            {dashboard.awaitingReview.length === 0 ? (
              <div className="flex min-h-20 flex-col justify-center rounded-2xl border-2 border-dashed border-neutral-400 bg-background px-4 py-4">
                <p className="text-sm font-semibold text-neutral-900">
                  Nothing to review
                </p>
                <p className="mt-1 text-sm text-neutral-600">
                  Deliverables land here when a creator submits.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {dashboard.awaitingReview.map((row) => (
                  <li key={row.dealId}>
                    <Link
                      href={`/deals/${row.dealId}`}
                      className="surface-pop group flex min-h-20 cursor-pointer flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border-2 border-brand/25 px-4 py-3 transition-[transform,border-color] duration-200 ease-[var(--ease-smooth)] hover:-translate-y-0.5 hover:border-brand/50 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <InitialsAvatar name={row.creatorHandle} size="sm" />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <TruncatedText
                            text={displayTiktokHandle(row.creatorHandle)}
                            className="text-sm font-semibold text-neutral-900"
                          />
                          <span className="text-xs text-muted-foreground">
                            {row.campaignName} · {row.videoCount}{' '}
                            {row.videoCount === 1 ? 'video' : 'videos'}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-mono text-sm font-medium text-neutral-900 tabular-nums">
                          {formatEtb(row.totalPrice)}
                        </span>
                        <span
                          className={cn(
                            buttonVariants({
                              variant: 'outline',
                              size: 'xs',
                            }),
                            'pointer-events-none border-2 transition-colors group-hover:bg-brand group-hover:text-neutral-50'
                          )}
                        >
                          Review
                          <CaretRight size={12} weight="bold" aria-hidden />
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {dashboard.awaitingReview.length > 0 && (
              <Link
                href="/deals"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'dash-action mt-2 w-fit gap-1.5'
                )}
              >
                View all deals
                <CaretRight size={12} weight="bold" aria-hidden />
              </Link>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <SectionLabel>Campaigns</SectionLabel>
            {recentCampaigns.length === 0 ? (
              <div className="flex min-h-20 flex-col justify-center rounded-2xl border-2 border-dashed border-neutral-400 bg-background px-4 py-4">
                <p className="text-sm font-semibold text-neutral-900">
                  No campaigns yet
                </p>
                <p className="mt-1 text-sm text-neutral-600">
                  Set a budget and brief, then invite verified creators.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {recentCampaigns.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/campaigns/${row.id}`}
                      className="group flex min-h-20 cursor-pointer items-center justify-between gap-4 rounded-2xl border-2 border-neutral-300 bg-background px-4 py-3 transition-[transform,border-color] duration-200 ease-[var(--ease-smooth)] hover:-translate-y-0.5 hover:border-neutral-500 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <TruncatedText
                          text={row.name}
                          className="text-sm font-semibold text-neutral-900"
                        />
                        <Chip
                          tone={campaignStatusTone[row.status] ?? 'gray'}
                          size="sm"
                        >
                          {campaignStatusLabel(row.status)}
                        </Chip>
                      </div>
                      <span
                        className={cn(
                          buttonVariants({ variant: 'outline', size: 'xs' }),
                          'pointer-events-none border-2 transition-colors group-hover:bg-neutral-900 group-hover:text-neutral-50'
                        )}
                      >
                        Open
                        <CaretRight size={12} weight="bold" aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/campaigns/new"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'dash-action w-fit gap-1.5'
              )}
            >
              Create a campaign
              <CaretRight size={12} weight="bold" aria-hidden />
            </Link>
          </section>
        </div>
      </>
    </div>
  );
}
