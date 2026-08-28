import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CaretRight } from '@phosphor-icons/react/dist/ssr';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { PageHeader } from '@/components/layout/page-header';
import { PayoutChart } from '@/components/creator/payout-chart';
import { SectionLabel } from '@/components/layout/section-label';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
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

  return (
    <div className="flex flex-col gap-10 py-4">
      <PageHeader
        label={<SectionLabel as="p">Offering deals as</SectionLabel>}
        title={<span className="break-words">{profile.companyName}</span>}
        action={
          <Link
            href="/brand/settings"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Edit name
          </Link>
        }
      />

      {dashboard.campaigns.total === 0 ? (
        /*
         * First run: with no campaigns there is nothing held in escrow and no
         * deliverable to review — both are campaign-derived — so the three
         * summary sections below would all render empty. Collapse to one
         * getting-started view that points at the two useful next steps.
         */
        <section className="rounded-[28px] border border-brand-ink/40 bg-brand-ink p-8 text-center text-neutral-50 shadow-[0_24px_60px_-32px_rgba(23,23,23,0.45)] sm:p-10">
          <p className="text-[13px] font-semibold tracking-[0.14em] text-brand-tint uppercase">
            First campaign
          </p>
          <h2 className="mt-4 font-display text-3xl font-medium tracking-tight">
            Create your first campaign
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-neutral-400">
            Set a budget and brief, then invite verified creators. Your escrow
            balance and review queue will appear here as work moves forward.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/campaigns/new"
              className={buttonVariants({ variant: 'default', size: 'sm' })}
            >
              Create a campaign
            </Link>
            <Link
              href="/discover"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Discover creators
            </Link>
          </div>
        </section>
      ) : (
        <>
          {/* Money is the thesis: the line, then the band. Spent tracks the
              ledger's outflow; held is what is still sitting in escrow. Same
              chart grammar as the creator dashboard (one line, hairline grid,
              brand ink) — a brand reading both sides should not learn two
              charts. */}
          <section className="surface-card surface-pop rounded-[28px] border border-neutral-200 p-5 shadow-[0_24px_60px_-40px_rgba(23,23,23,0.35)] sm:p-6">
            <PayoutChart
              label="Spend"
              note="Last 12 weeks"
              points={dashboard.spent}
            />
            <dl className="mt-8 grid gap-5 border-y border-neutral-200 py-5 sm:grid-cols-3 sm:divide-x sm:divide-neutral-200">
              <div className="flex flex-col gap-1">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                  Held in escrow
                </dt>
                <dd className="mt-1 font-mono text-3xl font-semibold tracking-[-0.04em] text-brand-ink tabular-nums">
                  {formatEtb(dashboard.money.held)}
                </dd>
              </div>
              <div className="flex flex-col gap-1 sm:pl-6">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                  Paid out
                </dt>
                <dd className="mt-1 font-mono text-2xl font-semibold tracking-[-0.04em] text-neutral-900 tabular-nums">
                  {formatEtb(dashboard.money.paidOut)}
                </dd>
              </div>
              <div className="flex flex-col gap-1 sm:pl-6">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                  Commission
                </dt>
                <dd className="mt-1 font-mono text-2xl font-semibold tracking-[-0.04em] text-neutral-900 tabular-nums">
                  {formatEtb(dashboard.money.commission)}
                </dd>
              </div>
            </dl>
          </section>

          {/* §13: the work — review queue first, campaign state under it. */}
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)] lg:items-start lg:gap-10">
            <section className="flex flex-col gap-3">
              <SectionLabel>Awaiting review</SectionLabel>
              {dashboard.awaitingReview.length === 0 ? (
                <div className="flex min-h-20 items-center rounded-2xl border border-dashed border-neutral-200 bg-[color-mix(in_oklch,var(--brand-tint)_45%,white)] px-4 py-3">
                  <p className="text-sm text-muted-foreground italic">
                    No deliverables waiting on your review
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {dashboard.awaitingReview.map((row) => (
                    <li key={row.dealId}>
                      <Link
                        href={`/deals/${row.dealId}`}
                        className="surface-pop group flex min-h-20 cursor-pointer flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border border-neutral-200 px-4 py-3 transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-smooth)] hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-20px_rgba(23,23,23,0.4)] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
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
                              'pointer-events-none transition-colors group-hover:bg-brand group-hover:text-neutral-50'
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
                    'mt-2 w-fit gap-1.5'
                  )}
                >
                  View all deals
                  <CaretRight size={12} weight="bold" aria-hidden />
                </Link>
              )}
            </section>

            <section className="surface-card surface-pop flex flex-col gap-3 rounded-[24px] border border-neutral-200 p-5 sm:p-6">
              <SectionLabel>Campaigns</SectionLabel>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-neutral-900 tabular-nums">
                  {dashboard.campaigns.total}{' '}
                  {dashboard.campaigns.total === 1 ? 'campaign' : 'campaigns'}
                </span>
                {Object.entries(dashboard.campaigns.byStatus)
                  .filter(([, count]) => count > 0)
                  .map(([status, count]) => (
                    <Chip
                      key={status}
                      tone={campaignStatusTone[status] ?? 'gray'}
                      size="sm"
                    >
                      {count} {campaignStatusLabel(status)}
                    </Chip>
                  ))}
              </div>
              <Link
                href="/campaigns"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'w-fit gap-1.5'
                )}
              >
                View all campaigns
                <CaretRight size={12} weight="bold" aria-hidden />
              </Link>
            </section>
          </div>
        </>
      )}

      <div className="flex items-center gap-3 border-t border-neutral-200 pt-8">
        <InitialsAvatar name={user.name ?? user.email} />
        <p className="text-sm text-muted-foreground">
          Signed in as {user.name ?? user.email}.
        </p>
      </div>
    </div>
  );
}
