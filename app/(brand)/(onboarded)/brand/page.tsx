import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { EmptyState } from '@/components/feedback/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { readBrandDashboard } from '@/lib/brands/dashboard';
import {
  campaignStatusLabel,
  campaignStatusTone,
} from '@/lib/campaigns/status';
import { formatEtb } from '@/lib/money';

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
    <div className="mx-auto flex max-w-2xl flex-col gap-10 py-4">
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
        <EmptyState
          title="Create your first campaign"
          description="Set a budget and a brief, fund it in escrow, and book verified creators. Your escrow balance and the deals awaiting your review will show up here."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
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
          }
        />
      ) : (
        <>
          {/* §13: Campaign summary */}
          <section className="flex flex-col gap-4">
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
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              View all campaigns →
            </Link>
          </section>

          {/* §13: Money totals — ledger-derived */}
          <section className="flex flex-col gap-4 border-t border-border pt-8">
            <h2 className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
              Money
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                  Held in escrow
                </dt>
                <dd className="font-mono text-sm tabular-nums">
                  {formatEtb(dashboard.money.held)}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                  Paid out
                </dt>
                <dd className="font-mono text-sm tabular-nums">
                  {formatEtb(dashboard.money.paidOut)}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">
                  Commission
                </dt>
                <dd className="font-mono text-sm tabular-nums">
                  {formatEtb(dashboard.money.commission)}
                </dd>
              </div>
            </dl>
          </section>

          {/* §13: Deals awaiting review */}
          <section className="flex flex-col gap-4 border-t border-border pt-8">
            <h2 className="text-[13px] font-semibold tracking-[0.14em] text-brand uppercase">
              Awaiting review
            </h2>
            {dashboard.awaitingReview.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No deliverables waiting on your review.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {dashboard.awaitingReview.map((row) => (
                  <li key={row.dealId}>
                    <Link
                      href={`/deals/${row.dealId}`}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md px-2 py-3 -mx-2 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <InitialsAvatar name={row.creatorHandle} size="sm" />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium">
                            @{row.creatorHandle}
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
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                View all deals →
              </Link>
            )}
          </section>
        </>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-8">
        <InitialsAvatar name={user.name ?? user.email} />
        <p className="text-sm text-muted-foreground">
          Signed in as {user.name ?? user.email}.
        </p>
      </div>
    </div>
  );
}
