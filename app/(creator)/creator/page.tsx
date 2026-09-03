import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowSquareOut,
  CaretRight,
  TiktokLogo,
} from '@phosphor-icons/react/dist/ssr';
import { BdPageHead, BdShell } from '@/components/brand/v4-shell';
import { AudienceSection } from '@/components/creator/audience-section';
import { EarningsSummary } from '@/components/creator/earnings-summary';
import { PayoutChart } from '@/components/creator/payout-chart';
import { RefreshStatsButton } from '@/components/creator/refresh-stats-button';
import { TierPricing } from '@/components/creator/tier-pricing';
import { VerificationStatus } from '@/components/creator/verification-status';
import { SectionLabel } from '@/components/layout/section-label';
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

const DASH_DEAL_ACCENT: Record<string, string> = {
  pending: 'bd-cr-dashdeal--wait',
  accepted: 'bd-cr-dashdeal--live',
  funded: 'bd-cr-dashdeal--live',
  delivered: 'bd-cr-dashdeal--wait',
  revision_requested: 'bd-cr-dashdeal--wait',
  completed: 'bd-cr-dashdeal--done',
};

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
 *
 * v4 conversion: only the page shell, masthead, rulers, and wrapper surfaces
 * moved to `.bd`; chart/client islands keep their data and component contracts.
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
    <BdShell className="bd-cr bd-cr-dashboard">
      <BdPageHead
        eyebrow="Creator workspace"
        title="Creator dashboard"
        facts={
          <>
            <b>{profile.tiktokHandle}</b> ·{' '}
            {NICHE_LABELS[profile.niche as Niche] ?? profile.niche} ·{' '}
            <span className="bd-mono">
              {formatFollowerCount(profile.followerCount)}
            </span>{' '}
            followers
          </>
        }
        ruled
      />
      <div
        className="bd-cr-dashboardbody bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <section className="bd-cr-chapter">
          <div className="bd-capruler">
            <span className="bd-caprulertitle">Account state</span>
            <span className="bd-caprulerline" aria-hidden="true" />
            <span className="bd-caprulernote">
              Verification and pricing gate
            </span>
          </div>
          <VerificationStatus
            status={profile.status}
            tiktokHandle={profile.tiktokHandle}
            hasTier={profile.tierId !== null}
            name={user.name ?? user.email}
            image={user.image}
          />
        </section>

        <section className="bd-cr-chapter">
          <div className="bd-capruler">
            <span className="bd-caprulertitle">Workspace pulse</span>
            <span className="bd-caprulerline" aria-hidden="true" />
            <span className="bd-caprulernote">Money and profile signal</span>
          </div>
          {/* Top pair — payout card and the stacked profile card, equal height. */}
          <div className="bd-cr-dashboardgrid">
            {/* AC-3. Thesis sits beside the profile, not above it.
              `--payout-scale` is the one knob for the whole money block: zoom
              scales everything inside proportionally (chart, figures, padding)
              without touching a single child. 1 is the designed size. */}
            <section
              className="bd-cr-dashboardpanel bd-cr-dashboardpanel--payout"
              style={{ zoom: 'var(--payout-scale, 0.9)' }}
            >
              <PayoutChart points={dashboard.payouts} minHeight="13rem" />
              <div className="bd-cr-dashboardpanel-foot">
                <EarningsSummary earnings={dashboard.earnings} headed={false} />
              </div>
              {/* KAN-70 PR 3: the wallet exists only where a payout rail does —
                in mock mode there is nothing to withdraw through. */}
              {paymentUxMode() !== 'mock' ? (
                <Link
                  href="/creator/wallet"
                  className="bd-btn bd-btn--ghost bd-cr-inlinebtn"
                >
                  Open your wallet <CaretRight size={14} weight="bold" />
                </Link>
              ) : null}
            </section>

            <section className="bd-cr-dashboardpanel bd-cr-profilepanel">
              <div className="bd-cr-panelhead">
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
              <dl className="bd-cr-profilefacts">
                <div>
                  <dt className="bd-cdfactlab">Niche</dt>
                  <dd className="bd-cdfactval">
                    {NICHE_LABELS[profile.niche as Niche] ?? profile.niche}
                  </dd>
                </div>
                <div>
                  <dt className="bd-cdfactlab">Followers</dt>
                  <dd className="bd-cdfactval bd-mono">
                    {formatFollowerCount(profile.followerCount)}
                  </dd>
                </div>
                <div className="bd-cr-profilefactwide">
                  <dt className="bd-cdfactlab">Engagement rate</dt>
                  <dd className="bd-cdfactval bd-mono">
                    {formatEngagementRate(profile.engagementRate)}
                  </dd>
                  <p className="bd-cdfacthint">{ENGAGEMENT_RATE_HINT}</p>
                </div>
              </dl>
              <AudienceSection audience={readAudience(profile.audience)} />
              {profileUrl ? (
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="bd-btn bd-btn--ghost bd-cr-widebtn"
                >
                  <TiktokLogo size={16} weight="regular" aria-hidden />
                  {VIEW_ON_TIKTOK_LABEL}
                  <ArrowSquareOut size={14} weight="regular" aria-hidden />
                </a>
              ) : null}
            </section>
          </div>
        </section>

        {/* Bottom row — rate and impact, side by side. The impact card shows
            whenever the creator has submitted videos at all; the empty state
            inside it fills the card rather than leaving it half-blank. */}
        <section className="bd-cr-chapter">
          <div className="bd-capruler">
            <span className="bd-caprulertitle">Rate and impact</span>
            <span className="bd-caprulerline" aria-hidden="true" />
            <span className="bd-caprulernote">
              Pricing and published results
            </span>
          </div>
          <div className="bd-cr-dashboardgrid bd-cr-dashboardgrid--even">
            <section className="bd-cr-dashboardpanel">
              <TierPricing
                tier={tier}
                profile={profile}
                status={profile.status}
                provisional={provisional}
              />
            </section>
            <section className="bd-cr-dashboardpanel bd-cr-dashboardpanel--impact">
              <SectionLabel>Your impact</SectionLabel>
              {dashboard.metrics.totalVideos === 0 ? (
                <div className="bd-emptyfeed">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 7h14v10H5z" />
                    <path d="M10 10l4 2-4 2z" />
                    <path d="M8 20h8" />
                  </svg>
                  <h3>No videos yet</h3>
                  <p>
                    Your views, likes, shares, and comments across every
                    delivered video will show up here once a deal is completed.
                  </p>
                </div>
              ) : dashboard.metrics.measuredVideos > 0 ? (
                <>
                  <dl className="bd-cr-impactfacts">
                    {(
                      [
                        ['Views', dashboard.metrics.views],
                        ['Likes', dashboard.metrics.likes],
                        ['Shares', dashboard.metrics.shares],
                        ['Comments', dashboard.metrics.comments],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label}>
                        <dt className="bd-cdfactlab">{label}</dt>
                        <dd className="bd-cdfactval bd-mono">
                          {value === null ? '—' : value.toLocaleString('en-US')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="bd-cr-copy">
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
                <div className="bd-emptyfeed">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 17h14" />
                    <path d="M8 17V9" />
                    <path d="M12 17V6" />
                    <path d="M16 17v-4" />
                  </svg>
                  <h3>Nothing recorded yet</h3>
                  <p>
                    You have {dashboard.metrics.totalVideos}{' '}
                    {dashboard.metrics.totalVideos === 1
                      ? 'submitted video'
                      : 'submitted videos'}{' '}
                    waiting for metrics. Record views, likes, shares, and
                    comments and they show up here.
                  </p>
                </div>
              )}
              {dashboard.unmeasuredDealIds.length > 0 ? (
                <Link
                  href={`/creator/deals/${dashboard.unmeasuredDealIds[0]}`}
                  className="bd-btn bd-btn--ghost bd-cr-inlinebtn"
                >
                  Record metrics
                  <CaretRight size={12} weight="bold" aria-hidden />
                </Link>
              ) : null}
            </section>
          </div>
        </section>
        {/* Attention row — expiring offers only, above the work list. */}
        {dashboard.expiringOffers.length > 0 ? (
          <section className="bd-cr-chapter">
            <div className="bd-capruler">
              <span className="bd-caprulertitle">Expiring soon</span>
              <span className="bd-caprulerline" aria-hidden="true" />
              <span className="bd-caprulernote">Offers needing a reply</span>
            </div>
            <ul className="bd-cr-dashlist bd-cr-dashlist--warm">
              {dashboard.expiringOffers.slice(0, 3).map((offer) => (
                <li key={offer.id}>
                  <Link
                    href={`/creator/deals/${offer.id}`}
                    className="bd-cr-dashdeal bd-cr-dashdeal--wait"
                  >
                    <span className="bd-cr-dashdeal-title">
                      {offer.campaignName}
                    </span>
                    <span className="bd-cr-dashdeal-meta bd-mono">
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
        <section className="bd-cr-chapter">
          <div className="bd-capruler">
            <span className="bd-caprulertitle">Requires your attention</span>
            <span className="bd-caprulerline" aria-hidden="true" />
            {openDeals.length > 0 ? (
              <span className="bd-caprulercount bd-mono">
                {openDeals.length} {openDeals.length === 1 ? 'deal' : 'deals'}
              </span>
            ) : null}
          </div>
          {dashboard.isEmpty ? (
            <div className="bd-emptyfeed">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7.5h14" />
                <path d="M6.5 7.5v10h11v-10" />
                <path d="M9 11h6" />
                <path d="M9 14h4" />
              </svg>
              <h3>{bookable ? NO_DEALS_TITLE : NOT_BOOKABLE_TITLE}</h3>
              <p>
                {bookable
                  ? NO_DEALS_DESCRIPTION
                  : tiktokLinked
                    ? NOT_BOOKABLE_TIKTOK_DESCRIPTION
                    : NOT_BOOKABLE_DESCRIPTION}
              </p>
            </div>
          ) : openDeals.length === 0 ? (
            <div className="bd-emptyfeed">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5.5 12h13" />
                <path d="M7.5 8.5l4 4-4 4" />
                <path d="M12.5 8.5l4 4-4 4" />
              </svg>
              <h3>Nothing waiting on you</h3>
              <p>Open deals stay on Your deals until a brand needs a reply.</p>
              <Link href="/creator/deals" className="bd-btn bd-btn--ghost">
                View deals
              </Link>
            </div>
          ) : (
            <ul className="bd-cr-dashlist">
              {openDeals.map((deal) => (
                <li key={deal.id}>
                  <Link
                    href={`/creator/deals/${deal.id}`}
                    className={cn(
                      'bd-cr-dashdeal',
                      DASH_DEAL_ACCENT[deal.status] ?? 'bd-cr-dashdeal--dead'
                    )}
                  >
                    <div className="bd-cr-dashdeal-main">
                      <p className="bd-cr-dashdeal-title">
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
                    <div className="bd-cr-dashdeal-end">
                      <span className="bd-cr-dashdeal-money bd-mono">
                        {formatEtb(deal.totalPrice)}
                      </span>
                      <CaretRight
                        size={14}
                        weight="bold"
                        aria-hidden
                        className="bd-cr-dashdeal-arrow"
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
              className="bd-btn bd-btn--ghost bd-cr-inlinebtn"
            >
              View deals
              <CaretRight size={12} weight="bold" aria-hidden />
            </Link>
          ) : null}
        </section>
      </div>
    </BdShell>
  );
}
