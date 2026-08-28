import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowSquareOut,
  CaretRight,
  TiktokLogo,
} from '@phosphor-icons/react/dist/ssr';
import { AudienceSection } from '@/components/creator/audience-section';
import { EarningsSummary } from '@/components/creator/earnings-summary';
import { PayoutChart } from '@/components/creator/payout-chart';
import { TierPricing } from '@/components/creator/tier-pricing';
import { VerificationStatus } from '@/components/creator/verification-status';
import { EmptyState } from '@/components/feedback/empty-state';
import { SectionLabel } from '@/components/layout/section-label';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/utils';
import { formatEtb } from '@/lib/money';
import { labelForStatus } from '@/lib/deals/groups';
import { needsCredentials, requireRole } from '@/lib/auth';
import {
  ENGAGEMENT_RATE_HINT,
  NICHE_LABELS,
} from '@/lib/config/creator-profile';
import type { Niche } from '@/lib/config/creator-profile';
import {
  NOT_BOOKABLE_DESCRIPTION,
  NOT_BOOKABLE_TITLE,
  NO_DEALS_DESCRIPTION,
  NO_DEALS_TITLE,
  readCreatorDashboard,
} from '@/lib/creators/dashboard';
import {
  VIEW_ON_TIKTOK_LABEL,
  formatEngagementRate,
  formatFollowerCount,
} from '@/lib/creators/profile-facts';
import { readAudience } from '@/lib/creators/detail';
import { tiktokProfileUrl } from '@/lib/creators/handle';
import { getCreatorProfileWithTier, isBookable } from '@/lib/creators/queries';
import { listTierCandidates, selectTier } from '@/lib/creators/tier-assignment';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Creator dashboard (KAN-25, US-001; laid out as one on KAN-200).
 *
 * One place for the three things a creator runs their side of the marketplace
 * from: where their verification stands and what they are priced at (AC-1),
 * what deals they have and what state each is in (AC-2), and what they have
 * been paid (AC-3).
 *
 * A creator with no profile has nothing to see here, so this is also the funnel
 * into onboarding: signing up lands on `/creator`, which sends them straight to
 * the form (US-001).
 *
 * Both reads gate themselves. `requireRole` below is the navigation gate — it
 * redirects rather than throws, which is the right behaviour for someone who
 * followed a link — and `readCreatorDashboard` runs `guard` again inside the
 * module and resolves the creator's own profile id from the session. AC-6 is
 * that second layer's: this page cannot ask for anyone else's deals because the
 * function takes no id to ask with (NFR-005).
 *
 * **Two columns, and which side a thing goes on is the point (KAN-200).** This
 * was seven `border-t` sections stacked in a `max-w-2xl` column, in submission
 * order — profile facts, audience, pricing, earnings, deals — so a creator
 * checking on a deal scrolled past everything they had already told us. It read
 * as a filled-in form. The structure now follows `(brand)/brand/page.tsx`, which
 * is the in-repo precedent: `PageHeader`, teal section labels, and **work on the
 * left, reference on the right** — money and deals are what changes without the
 * creator doing anything, and their own profile is what does not.
 *
 * One column below `lg:`, with the work first (NFR-007). On a phone the
 * right-hand column falls underneath rather than beside, which is the correct
 * order for the same reason it is the correct side.
 */
export default async function CreatorDashboardPage() {
  const user = await requireRole('creator');
  if (needsCredentials(user)) redirect('/creator/credentials');

  const row = await getCreatorProfileWithTier(user.id);
  if (!row) redirect('/creator/onboarding');

  const { profile, tier } = row;

  const dashboard = await readCreatorDashboard();
  // Null means no profile row, which the redirect above has already ruled out.
  // Narrowing rather than asserting keeps that an ordinary branch.
  if (!dashboard) redirect('/creator/onboarding');

  // For an untiered creator, work out the tier they *would* be assigned on their
  // current numbers, so the pricing block can preview it instead of implying they
  // failed to qualify (tier assignment has simply not run yet — KAN-23). Reuses
  // the exact rule assignment uses, so the preview and the eventual assignment
  // agree. Skipped once tiered: the price then comes from the tier row.
  const provisional =
    tier === null ? selectTier(await listTierCandidates(), profile) : null;

  const bookable = isBookable({ ...profile, tierActive: tier?.active ?? null });
  const profileUrl = tiktokProfileUrl(profile.tiktokHandle);
  const openDeals = dashboard.groups
    .filter(
      (group) =>
        group.group === 'pending' ||
        group.group === 'in_progress' ||
        group.group === 'awaiting_approval'
    )
    .flatMap((group) => group.deals)
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-8 py-4">
      <VerificationStatus
        status={profile.status}
        tiktokHandle={profile.tiktokHandle}
        hasTier={profile.tierId !== null}
        name={user.name ?? user.email}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)] lg:items-stretch">
        {/* AC-3. Thesis sits beside the profile, not above it. */}
        <section className="surface-card surface-pop flex h-full min-h-0 flex-col rounded-[28px] border-2 border-brand/40 p-5 sm:p-6">
          <PayoutChart points={dashboard.payouts} />
          <div className="mt-8 shrink-0">
            <EarningsSummary earnings={dashboard.earnings} headed={false} />
          </div>
        </section>

        {/* Right: profile then rate, stacked against the chart. */}
        <aside className="flex h-full flex-col justify-between gap-4">
          <section className="flex flex-col gap-4 rounded-[24px] border-2 border-neutral-300 bg-background p-4">
            <SectionLabel>Your profile</SectionLabel>
            <dl className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <dt className="text-[11px] font-semibold tracking-[0.12em] text-neutral-500 uppercase">
                  Niche
                </dt>
                <dd className="text-sm font-semibold text-neutral-900">
                  {NICHE_LABELS[profile.niche as Niche] ?? profile.niche}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-[11px] font-semibold tracking-[0.12em] text-neutral-500 uppercase">
                  Followers
                </dt>
                <dd className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
                  {formatFollowerCount(profile.followerCount)}
                </dd>
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <dt className="text-[11px] font-semibold tracking-[0.12em] text-neutral-500 uppercase">
                  Engagement rate
                </dt>
                <dd className="font-mono text-sm font-semibold text-neutral-900 tabular-nums">
                  {formatEngagementRate(profile.engagementRate)}
                </dd>
                <p className="text-xs leading-snug text-muted-foreground">
                  {ENGAGEMENT_RATE_HINT}
                </p>
              </div>
            </dl>
            <AudienceSection audience={readAudience(profile.audience)} />
            {profileUrl ? (
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'dash-action w-full gap-1.5'
                )}
              >
                <TiktokLogo size={16} weight="regular" aria-hidden />
                {VIEW_ON_TIKTOK_LABEL}
                <ArrowSquareOut size={14} weight="regular" aria-hidden />
              </a>
            ) : null}
          </section>

          <section className="rounded-[24px] border-2 border-brand/20 bg-[color-mix(in_oklch,var(--brand-tint)_42%,white)] p-4">
            <TierPricing
              tier={tier}
              profile={profile}
              status={profile.status}
              provisional={provisional}
            />
          </section>
        </aside>
      </div>

      {/* AC-2. Work list under the chart+profile pair. */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Needs you</SectionLabel>
        {dashboard.isEmpty ? (
          <div className="flex min-h-20 flex-col justify-center rounded-2xl border-2 border-dashed border-neutral-400 bg-background px-4 py-4">
            <EmptyState
              align="start"
              title={bookable ? NO_DEALS_TITLE : NOT_BOOKABLE_TITLE}
              description={
                bookable ? NO_DEALS_DESCRIPTION : NOT_BOOKABLE_DESCRIPTION
              }
            />
          </div>
        ) : openDeals.length === 0 ? (
          <div className="flex min-h-20 flex-col justify-center rounded-2xl border-2 border-dashed border-neutral-400 bg-background px-4 py-4">
            <p className="text-sm font-semibold text-neutral-900">
              Nothing waiting on you
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              Open deals stay on Your deals until a brand needs a reply.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {openDeals.map((deal) => (
              <li key={deal.id}>
                <Link
                  href={`/creator/deals/${deal.id}`}
                  className="group flex min-h-20 cursor-pointer flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border-2 border-neutral-300 bg-background px-4 py-3 transition-[transform,border-color] duration-200 ease-[var(--ease-smooth)] hover:-translate-y-0.5 hover:border-brand/50 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="truncate text-sm font-semibold text-neutral-900">
                      {deal.campaignName}
                    </p>
                    <Chip
                      tone={
                        deal.status === 'pending' ||
                        deal.status === 'revision_requested' ||
                        deal.status === 'delivered'
                          ? 'amber'
                          : deal.status === 'funded' ||
                              deal.status === 'accepted'
                            ? 'teal'
                            : 'gray'
                      }
                      size="sm"
                    >
                      {labelForStatus(deal.status)}
                    </Chip>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-mono text-sm font-medium text-neutral-900 tabular-nums">
                      {formatEtb(deal.totalPrice)}
                    </span>
                    <span
                      className={cn(
                        buttonVariants({ variant: 'outline', size: 'xs' }),
                        'pointer-events-none border-2 transition-colors group-hover:bg-neutral-900 group-hover:text-neutral-50'
                      )}
                    >
                      Open
                      <CaretRight size={12} weight="bold" aria-hidden />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {!dashboard.isEmpty ? (
          <Link
            href="/creator/deals"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'dash-action mt-1 w-fit gap-1.5'
            )}
          >
            View deals
            <CaretRight size={12} weight="bold" aria-hidden />
          </Link>
        ) : null}
      </section>
    </div>
  );
}
