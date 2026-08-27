import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { PageHeader } from '@/components/layout/page-header';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { readBrandDashboard } from '@/lib/brands/dashboard';
import {
  campaignStatusLabel,
  campaignStatusTone,
} from '@/lib/campaigns/status';
import { formatEtb } from '@/lib/money';
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
    <div className="mx-auto flex max-w-6xl flex-col gap-12 py-4">
      <PageHeader
        label="Offering deals as"
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
        <section className="rounded-[28px] border border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-50 shadow-[0_24px_60px_-32px_rgba(23,23,23,0.45)] sm:p-10">
          <p className="text-[13px] font-semibold tracking-[0.14em] text-neutral-300 uppercase">
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
          {/* §13: Campaign summary */}
          <section className="rounded-[28px] border border-neutral-200 bg-neutral-50 p-6 sm:p-8">
            <h2 className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
              Campaigns
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
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
              className="mt-3 inline-flex rounded-full border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-500 hover:text-neutral-900 active:scale-[0.98]"
            >
              View all campaigns →
            </Link>
          </section>

          {/* §13: Money totals — ledger-derived */}
          <section className="rounded-[28px] border border-neutral-800 bg-neutral-900 p-6 text-neutral-50 sm:p-8">
            <h2 className="text-[13px] font-semibold tracking-[0.14em] text-neutral-300 uppercase">
              Money
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <dt className="text-xs tracking-wide text-neutral-400 uppercase">
                  Held in escrow
                </dt>
                <dd className="mt-1 font-mono text-base tabular-nums">
                  {formatEtb(dashboard.money.held)}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs tracking-wide text-neutral-400 uppercase">
                  Paid out
                </dt>
                <dd className="mt-1 font-mono text-base tabular-nums">
                  {formatEtb(dashboard.money.paidOut)}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs tracking-wide text-neutral-400 uppercase">
                  Commission
                </dt>
                <dd className="mt-1 font-mono text-base tabular-nums">
                  {formatEtb(dashboard.money.commission)}
                </dd>
              </div>
            </dl>
          </section>

          {/* §13: Deals awaiting review */}
          <section className="border-t border-neutral-200 pt-8">
            <h2 className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
              Awaiting review
            </h2>
            {dashboard.awaitingReview.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No deliverables waiting on your review.
              </p>
            ) : (
              <ul className="mt-5 divide-y divide-neutral-200 border-y border-neutral-200">
                {dashboard.awaitingReview.map((row) => (
                  <li key={row.dealId}>
                    <Link
                      href={`/deals/${row.dealId}`}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2 py-4 transition-all duration-300 ease-out hover:bg-neutral-100/60 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:outline-none sm:px-4"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <InitialsAvatar name={row.creatorHandle} size="sm" />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-semibold text-neutral-900">
                            {displayTiktokHandle(row.creatorHandle)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {row.campaignName} · {row.videoCount}{' '}
                            {row.videoCount === 1 ? 'video' : 'videos'}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-mono text-sm tabular-nums">
                          {formatEtb(row.totalPrice)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Review
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
                className="mt-5 inline-flex rounded-full border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-neutral-500 hover:text-neutral-900 active:scale-[0.98]"
              >
                View all deals →
              </Link>
            )}
          </section>
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
