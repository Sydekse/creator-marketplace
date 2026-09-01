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
import { RefreshStatsButton } from '@/components/creator/refresh-stats-button';
import { TierPricing } from '@/components/creator/tier-pricing';
import { VerificationStatus } from '@/components/creator/verification-status';
import { EmptyState } from '@/components/feedback/empty-state';
import { SectionLabel } from '@/components/layout/section-label';
import { buttonVariants } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/utils';
import { formatEtb } from '@/lib/money';
import { ageLabel, expiryLabel } from '@/lib/dates';
import { labelForStatus } from '@/lib/deals/groups';
import { needsCredentials, requireRole } from '@/lib/auth';
import {
  ENGAGEMENT_RATE_HINT,
  NICHE_LABELS,
} from '@/lib/config/creator-profile';
import type { Niche } from '@/lib/config/creator-profile';
import {
  NOT_BOOKABLE_DESCRIPTION,
  NOT_BOOKABLE_TIKTOK_DESCRIPTION,
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
import { sessionTiktokHandle } from '@/lib/creators/credentials';
import { tiktokProfileUrl } from '@/lib/creators/handle';
import { getCreatorProfileWithTier, isBookable } from '@/lib/creators/queries';
import { listTierCandidates, selectTier } from '@/lib/creators/tier-assignment';
import { paymentUxMode } from '@/lib/payment/gateway';

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
  // TikTok-linked accounts get the self-serve refresh (phase 3); email
  // sign-ups have nothing to pull from — their numbers are the admin's to
  // correct, so the button never renders for them.
  const tiktokLinked = (await sessionTiktokHandle(user.id)) !== null;
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
      {' '}
      <VerificationStatus
        status={profile.status}
        tiktokHandle={profile.tiktokHandle}
        hasTier={profile.tierId !== null}
        name={user.name ?? user.email}
        image={user.image}
      />
      <div className="flex flex-col gap-6">
        {/* Top pair — payout card and the stacked profile card, equal height. */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)] lg:items-stretch">
          {/* AC-3. Thesis sits beside the profile, not above it.
              `--payout-scale` is the one knob for the whole money block: zoom
              scales everything inside proportionally (chart, figures, padding)
              without touching a single child. 1 is the designed size. */}
          <section
            className="surface-card surface-pop flex h-full min-h-0 flex-col rounded-[24px] border border-brand/40 p-5 sm:p-6"
            style={{ zoom: 'var(--payout-scale, 0.9)' }}
          >
            <PayoutChart points={dashboard.payouts} minHeight="13rem" />
            <div className="mt-4 shrink-0">
              <EarningsSummary earnings={dashboard.earnings} headed={false} />
            </div>
            {/* KAN-70 PR 3: the wallet exists only where a payout rail does —
                in mock mode there is nothing to withdraw through. */}
            {paymentUxMode() !== 'mock' ? (
              <Link
                href="/creator/wallet"
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-ink underline-offset-4 hover:underline"
              >
                Open your wallet <CaretRight size={14} weight="bold" />
              </Link>
            ) : null}
          </section>

          <section className="flex h-full flex-col justify-between gap-4 rounded-[24px] border border-neutral-200 bg-background p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>Your profile</SectionLabel>
              {tiktokLinked ? (
                <RefreshStatsButton
                  lastRefreshedLabel={
                    profile.statsRefreshedAt
                      ? ageLabel(profile.statsRefreshedAt)
                      : null
                  }
                />
              ) : null}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div className="flex flex-col gap-1">
                <dt className="text-[11px] font-semibold tracking-[0.12em] text-neutral-600 uppercase">
                  Niche
                </dt>
                <dd className="font-display text-lg font-medium tracking-tight text-neutral-900">
                  {NICHE_LABELS[profile.niche as Niche] ?? profile.niche}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-[11px] font-semibold tracking-[0.12em] text-neutral-600 uppercase">
                  Followers
                </dt>
                <dd className="font-display text-lg font-medium tracking-tight text-neutral-900 tabular-nums">
                  {formatFollowerCount(profile.followerCount)}
                </dd>
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <dt className="text-[11px] font-semibold tracking-[0.12em] text-neutral-600 uppercase">
                  Engagement rate
                </dt>
                <dd className="font-display text-lg font-medium tracking-tight text-neutral-900 tabular-nums">
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
                  'dash-action w-full gap-2'
                )}
              >
                <TiktokLogo size={16} weight="regular" aria-hidden />
                {VIEW_ON_TIKTOK_LABEL}
                <ArrowSquareOut size={14} weight="regular" aria-hidden />
              </a>
            ) : null}
          </section>
        </div>

        {/* Bottom row — rate and impact, side by side. The impact card shows
            whenever the creator has submitted videos at all; the empty state
            inside it fills the card rather than leaving it half-blank. */}
        <div className="grid gap-8 lg:grid-cols-2">
          <section className="rounded-[24px] border border-neutral-200 bg-background p-4 sm:p-5">
            <TierPricing
              tier={tier}
              profile={profile}
              status={profile.status}
              provisional={provisional}
            />
          </section>
          <section className="flex flex-col gap-4 rounded-[24px] border border-brand/30 bg-[color-mix(in_oklch,var(--brand-tint)_52%,white)] p-4 sm:p-5">
            <SectionLabel>Your impact</SectionLabel>
            {dashboard.metrics.totalVideos === 0 ? (
              <div className="flex flex-1 flex-col items-start justify-center gap-3 py-4">
                <p className="text-sm font-medium text-neutral-900">
                  No videos yet.
                </p>
                <p className="text-sm leading-relaxed text-neutral-700">
                  Your views, likes, shares, and comments across every delivered
                  video will show up here once a deal is completed.
                </p>
              </div>
            ) : dashboard.metrics.measuredVideos > 0 ? (
              <>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                  {(
                    [
                      ['Views', dashboard.metrics.views],
                      ['Likes', dashboard.metrics.likes],
                      ['Shares', dashboard.metrics.shares],
                      ['Comments', dashboard.metrics.comments],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex flex-col gap-1">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600">
                        {label}
                      </dt>
                      <dd className="font-display text-xl font-medium tracking-tight text-neutral-900 tabular-nums sm:text-2xl">
                        {value === null ? '—' : value.toLocaleString('en-US')}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-muted-foreground">
                  Recorded across {dashboard.metrics.measuredVideos} of{' '}
                  {dashboard.metrics.totalVideos}{' '}
                  {dashboard.metrics.totalVideos === 1 ? 'video' : 'videos'}
                  {dashboard.unmeasuredDealIds.length > 0
                    ? ` · ${dashboard.unmeasuredDealIds.length} still pending`
                    : ''}
                  .
                </p>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-start justify-center gap-3 py-4">
                <p className="text-sm font-medium text-neutral-900">
                  Nothing recorded yet.
                </p>
                <p className="text-sm leading-relaxed text-neutral-700">
                  You have {dashboard.metrics.totalVideos}{' '}
                  {dashboard.metrics.totalVideos === 1
                    ? 'submitted video'
                    : 'submitted videos'}{' '}
                  waiting for metrics. Record views, likes, shares, and comments
                  and they show up here.
                </p>
              </div>
            )}
            {dashboard.unmeasuredDealIds.length > 0 ? (
              <Link
                href={`/creator/deals/${dashboard.unmeasuredDealIds[0]}`}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'dash-action mt-auto w-fit gap-2'
                )}
              >
                Record metrics
                <CaretRight size={12} weight="bold" aria-hidden />
              </Link>
            ) : null}
          </section>
        </div>
      </div>
      {/* Attention row — expiring offers only, above the work list. */}
      {dashboard.expiringOffers.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-[24px] border border-[color-mix(in_oklch,var(--status-pending-foreground)_35%,var(--border))] bg-[color-mix(in_oklch,var(--status-pending)_42%,white)] p-4 sm:p-5">
          <SectionLabel>Expiring soon</SectionLabel>
          <ul className="flex flex-col gap-1">
            {dashboard.expiringOffers.slice(0, 3).map((offer) => (
              <li key={offer.id}>
                <Link
                  href={`/creator/deals/${offer.id}`}
                  className="group flex items-center justify-between gap-4 rounded-lg px-1 py-1.5 text-sm transition-colors duration-200 ease-[var(--ease-smooth)] hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                >
                  <span className="truncate font-medium text-neutral-900">
                    {offer.campaignName}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-status-pending-foreground">
                    {expiryLabel(offer.offerExpiresAt, new Date())}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {/* AC-2. Work list under the cards — formal heading, no pill, and the
          list rows announce themselves as rows rather than links pretending to
          be buttons. */}
      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4 border-b border-neutral-200 pb-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand-ink">
            Requires your attention
          </h2>
          {openDeals.length > 0 ? (
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {openDeals.length} {openDeals.length === 1 ? 'deal' : 'deals'}
            </span>
          ) : null}
        </div>
        {dashboard.isEmpty ? (
          <div className="flex min-h-20 flex-col justify-center rounded-2xl border border-dashed border-neutral-300 bg-background px-4 py-4">
            <EmptyState
              align="start"
              title={bookable ? NO_DEALS_TITLE : NOT_BOOKABLE_TITLE}
              description={
                bookable
                  ? NO_DEALS_DESCRIPTION
                  : tiktokLinked
                    ? NOT_BOOKABLE_TIKTOK_DESCRIPTION
                    : NOT_BOOKABLE_DESCRIPTION
              }
            />
          </div>
        ) : openDeals.length === 0 ? (
          <div className="flex min-h-20 flex-col justify-center rounded-2xl border border-dashed border-neutral-300 bg-background px-4 py-4">
            <p className="text-sm font-semibold text-neutral-900">
              Nothing waiting on you
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              Open deals stay on Your deals until a brand needs a reply.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
            {openDeals.map((deal) => (
              <li key={deal.id}>
                <Link
                  href={`/creator/deals/${deal.id}`}
                  className="group flex items-center justify-between gap-x-6 gap-y-2 px-1 py-3 transition-colors duration-200 ease-[var(--ease-smooth)] hover:bg-neutral-100/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <p className="truncate text-sm font-semibold text-neutral-900 group-hover:underline group-hover:underline-offset-4">
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
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-sm font-medium text-neutral-900 tabular-nums">
                      {formatEtb(deal.totalPrice)}
                    </span>
                    <CaretRight
                      size={14}
                      weight="bold"
                      aria-hidden
                      className="text-neutral-400 transition-all duration-200 ease-[var(--ease-smooth)] group-hover:translate-x-0.5 group-hover:text-neutral-900"
                    />
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
              'dash-action w-fit gap-2'
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
