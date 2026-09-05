import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowSquareOut,
  CaretRight,
  TiktokLogo,
} from '@phosphor-icons/react/dist/ssr';
import { BdShell } from '@/components/brand/v4-shell';
import { CountUp } from '@/components/brand/dashboard-bits';
import { AudienceSection } from '@/components/creator/audience-section';
import {
  ApprovalRing,
  EarningsSteps,
  QueueFlow,
  ShowreelChart,
} from '@/components/creator/creator-viz';
import type { ReelVideo } from '@/components/creator/creator-viz';
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

/** One line of "what to do next" so the list earns its heading. */
function dealCue(
  deal: { status: string; videoCount: number; offerExpiresAt: Date | null },
  now: Date
): string {
  switch (deal.status) {
    case 'pending':
      return deal.offerExpiresAt
        ? `Reply — closes ${ageLabel(deal.offerExpiresAt, now)}`
        : 'Reply to the offer';
    case 'accepted':
      return 'Accepted — waiting on the brand to fund escrow';
    case 'funded':
      return deal.videoCount > 1
        ? `Post and submit ${deal.videoCount} videos`
        : 'Post your video and submit the link';
    case 'delivered':
      return 'In brand review — payment releases on approval';
    case 'revision_requested':
      return 'Fix and re-deliver — funds stay held for you';
    default:
      return 'Completed and paid';
  }
}

function compactNumber(value: number | null): string {
  if (value === null) return '—';
  return Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value);
}

function signedNumber(value: number | null, suffix = ''): string {
  if (value === null) return '—';
  if (value === 0) return `0${suffix}`;
  return `${value > 0 ? '+' : ''}${compactNumber(value)}${suffix}`;
}

/**
 * Creator dashboard (KAN-25, US-001) — the creator's own v4 identity, not a
 * brand-dashboard clone. Same tokens (paper, teal, mono, hairlines), new
 * vocabulary: notched ticket stats, a showreel bar chart (one bar per
 * delivered video), a stepped earnings staircase (every approved video is a
 * literal step up), an approval ring, and a vertical queue ladder.
 *
 * Both reads gate themselves: `requireRole` redirects, and
 * `readCreatorDashboard` runs `guard` internally and resolves the caller's
 * own profile id, so this page cannot ask for anyone else's deals (AC-6).
 */
export default async function CreatorDashboardPage() {
  const user = await requireRole('creator');
  if (needsCredentials(user)) redirect('/creator/credentials');

  const row = await getCreatorProfileWithTier(user.id);
  if (!row) redirect('/creator/onboarding');

  const { profile, tier } = row;

  // Independent reads, started together: the dashboard, the TikTok session
  // check, and — only for an untiered creator — the tier-candidate list.
  const tierCandidatesPromise = tier === null ? listTierCandidates() : null;
  const [dashboard, linkedHandle, tierCandidates] = await Promise.all([
    readCreatorDashboard(),
    sessionTiktokHandle(user.id),
    tierCandidatesPromise,
  ]);
  // Null means no profile row, which the redirect above has already ruled out.
  if (!dashboard) redirect('/creator/onboarding');

  // Preview the tier an untiered creator would be assigned (KAN-23) — the
  // same rule assignment itself runs.
  const provisional =
    tierCandidates !== null ? selectTier(tierCandidates, profile) : null;

  const bookable = isBookable({ ...profile, tierActive: tier?.active ?? null });
  const profileUrl = tiktokProfileUrl(profile.tiktokHandle);
  const tiktokLinked = linkedHandle !== null;
  const now = new Date();

  // Urgency order for the attention list: work that blocks payment first,
  // then offers by soonest expiry, then deals waiting on the creator, and
  // review states (nothing to do) last.
  const ATTENTION_RANK: Record<string, number> = {
    revision_requested: 0,
    pending: 1,
    funded: 2,
    accepted: 3,
    delivered: 4,
  };
  const openDeals = dashboard.groups
    .filter(
      (group) =>
        group.group === 'pending' ||
        group.group === 'in_progress' ||
        group.group === 'awaiting_approval'
    )
    .flatMap((group) => group.deals)
    .sort((left, right) => {
      const rank =
        (ATTENTION_RANK[left.status] ?? 9) -
        (ATTENTION_RANK[right.status] ?? 9);
      if (rank !== 0) return rank;
      const leftExpiry = left.offerExpiresAt
        ? left.offerExpiresAt.getTime()
        : Number.POSITIVE_INFINITY;
      const rightExpiry = right.offerExpiresAt
        ? right.offerExpiresAt.getTime()
        : Number.POSITIVE_INFINITY;
      return leftExpiry - rightExpiry;
    })
    .slice(0, 5);
  const groupCount = (name: (typeof dashboard.groups)[number]['group']) =>
    dashboard.groups.find((group) => group.group === name)?.count ?? 0;

  const a = dashboard.actions;
  const m = dashboard.metrics;
  const totalViews = m.views ?? 0;

  const reelVideos: ReelVideo[] = dashboard.topVideos.map((video) => ({
    id: video.deliverableId,
    name: video.campaignName,
    views: video.views,
    likes: video.likes,
    when: ageLabel(video.submittedAt),
    url: video.tiktokUrl,
    thumb: video.thumbnailUrl,
    inReview: video.reviewStatus === 'pending',
  }));

  // Engagement mix — proportions of recorded likes/shares/comments.
  const mixParts = [
    { label: 'Likes', value: m.likes ?? 0, cls: 'bd-crx-mix--likes' },
    { label: 'Shares', value: m.shares ?? 0, cls: 'bd-crx-mix--shares' },
    { label: 'Comments', value: m.comments ?? 0, cls: 'bd-crx-mix--comments' },
  ];
  const mixTotal = mixParts.reduce((s, p) => s + p.value, 0);

  const payouts = dashboard.payouts;
  const paidOut = dashboard.earnings.paidOut;
  const earnedThisWeek =
    payouts.length > 1
      ? payouts[payouts.length - 1].paidOut -
        payouts[payouts.length - 2].paidOut
      : (payouts[payouts.length - 1]?.paidOut ?? 0);

  // Engagement gained in the last seven days, for the standing footnote.
  const liftParts = [
    { label: 'likes', value: dashboard.weeklyLift.likes },
    { label: 'shares', value: dashboard.weeklyLift.shares },
    { label: 'comments', value: dashboard.weeklyLift.comments },
  ].filter((part) => part.value !== null && part.value !== 0);

  // The queue ladder — one rung per stage, hot on the first rung with work.
  const rungs = [
    {
      num: '01',
      label: 'Reply to offers',
      note: 'accept or decline before expiry',
      count: a.pendingOffers,
      href: '/creator/deals#pending',
    },
    {
      num: '02',
      label: 'Post and submit',
      note:
        a.needsRevision > 0
          ? `incl. ${a.needsRevision} with changes requested`
          : 'funded deals waiting on your video',
      count: a.readyToDeliver + a.needsRevision,
      href: '/creator/deals#in_progress',
    },
    {
      num: '03',
      label: 'In brand review',
      note: 'payment releases on approval',
      count: groupCount('awaiting_approval'),
      href: '/creator/deals#awaiting_approval',
    },
    {
      num: '04',
      label: 'Record metrics',
      note: 'keep your showreel honest',
      count: a.needsMetrics,
      href:
        dashboard.unmeasuredDealIds.length > 0
          ? `/creator/deals/${dashboard.unmeasuredDealIds[0]}`
          : '/creator/deals#completed',
    },
  ];
  const hotRung = rungs.findIndex((r) => r.count > 0);
  const alertItems =
    (dashboard.expiringOffers.length > 0 ? 1 : 0) +
    (a.needsRevision > 0 ? 1 : 0);

  return (
    <BdShell className="bd-cr bd-crx">
      {/* ---------- hero: identity + ticket stats ---------- */}
      <div
        className="bd-crx-hero bd-rise"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        <VerificationStatus
          status={profile.status}
          tiktokHandle={profile.tiktokHandle}
          hasTier={profile.tierId !== null}
          name={user.name ?? user.email}
          image={user.image}
        />
        <div className="bd-crx-tickets" aria-label="Account pulse">
          <div className="bd-crx-ticket">
            <span className="bd-crx-tk">Paid out</span>
            <span className="bd-crx-tv bd-mono">{formatEtb(paidOut)}</span>
            <span className="bd-crx-ts">net of commission</span>
          </div>
          <div className="bd-crx-ticket bd-crx-ticket--amber">
            <span className="bd-crx-tk">In escrow</span>
            <span className="bd-crx-tv bd-mono">
              {formatEtb(dashboard.earnings.inEscrow)}
            </span>
            <span className="bd-crx-ts">releases on approval</span>
          </div>
          <div className="bd-crx-ticket">
            <span className="bd-crx-tk">Followers</span>
            <span className="bd-crx-tv bd-mono">
              {formatFollowerCount(profile.followerCount)}
            </span>
            <span className="bd-crx-ts">
              {dashboard.growth.followersDelta !== null
                ? `${signedNumber(dashboard.growth.followersDelta)} since ${
                    dashboard.growth.previousAt
                      ? ageLabel(dashboard.growth.previousAt, now).replace(
                          /^in /,
                          ''
                        )
                      : 'last refresh'
                  }`
                : 'refresh stats to track growth'}
            </span>
          </div>
        </div>
      </div>

      {/* ---------- actions ---------- */}
      <div
        className="bd-actions bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <Link className="bd-btn bd-btn--primary" href="/creator/deals">
          Your deals
        </Link>
        {paymentUxMode() !== 'mock' ? (
          <Link className="bd-btn bd-btn--ghost" href="/creator/wallet">
            Open your wallet
          </Link>
        ) : null}
        {profileUrl ? (
          <a
            className="bd-btn bd-btn--ghost"
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            <TiktokLogo size={16} weight="regular" aria-hidden />
            {VIEW_ON_TIKTOK_LABEL}
          </a>
        ) : null}
      </div>

      {/* ---------- body: work column left, profile rail right ---------- */}
      <div className="bd-crx-body">
        <div className="bd-capruler bd-crx-mainhead">
          <span className="bd-caprulertitle">Performance overview</span>
        </div>
        {/* ---------- showreel ---------- */}
        <section
          className="bd-crx-reel bd-rise"
          style={{ '--i': 2 } as React.CSSProperties}
        >
          <div className="bd-crx-reelhead">
            <div>
              <span className="bd-crx-k">Showreel</span>
              <div className="bd-crx-reelviews">
                <span className="bd-crx-reelnum bd-mono">
                  <CountUp value={totalViews} />
                </span>
                <span className="bd-crx-reelunit">views collected</span>
              </div>
            </div>
            <span className="bd-crx-covertag bd-mono">
              {m.measuredVideos}/{m.totalVideos} measured
            </span>
          </div>
          {dashboard.topVideos.length === 0 ? (
            <div className="bd-crx-reelghost">
              <div className="bd-crx-ghostframes" aria-hidden="true">
                <i></i>
                <i></i>
                <i></i>
                <i></i>
              </div>
              <div className="bd-crx-ghostcopy">
                <h3>Your showreel starts with one video</h3>
                <p>
                  Every video you deliver becomes a frame here, ranked by the
                  views it collects. Brands read this as your track record.
                </p>
                <Link className="bd-btn bd-btn--primary" href="/creator/deals">
                  {bookable ? 'Check your offers' : 'View your deals'}
                </Link>
              </div>
            </div>
          ) : (
            <>
              <ShowreelChart videos={reelVideos} />
              {mixTotal > 0 ? (
                <div className="bd-crx-mixwrap">
                  <span className="bd-crx-mixlab">Engagement mix</span>
                  <div className="bd-crx-mixband" aria-hidden="true">
                    {mixParts.map((part) =>
                      part.value > 0 ? (
                        <i
                          key={part.label}
                          className={part.cls}
                          style={{ width: `${(part.value / mixTotal) * 100}%` }}
                        />
                      ) : null
                    )}
                  </div>
                  <div className="bd-crx-mixlegend">
                    {mixParts.map((part) => (
                      <span key={part.label} className="bd-crx-mixkey">
                        <i className={part.cls} aria-hidden="true" />
                        {part.label}{' '}
                        <b className="bd-mono">{compactNumber(part.value)}</b>
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="bd-crx-reelnote">
                  Engagement splits appear once likes, shares, and comments are
                  recorded{a.needsMetrics > 0 ? ' — you have some due.' : '.'}
                </p>
              )}
            </>
          )}
        </section>

        {/* ---------- triptych: earnings / queue / standing ---------- */}
        <div className="bd-crx-triptych">
          <section
            className="bd-crx-card bd-crx-card--earn bd-rise"
            style={{ '--i': 3 } as React.CSSProperties}
          >
            <div className="bd-crx-cardhead">
              <span className="bd-crx-k">Earnings staircase</span>
              {earnedThisWeek > 0 && (
                <span className="bd-crx-weektag bd-mono">
                  +{formatEtb(earnedThisWeek)} this week
                </span>
              )}
            </div>
            {paidOut > 0 && payouts.length > 1 ? (
              <>
                <EarningsSteps points={payouts} />
                <p className="bd-crx-cardfoot">
                  Every step is an approved video.{' '}
                  <b>{formatEtb(dashboard.earnings.inEscrow)}</b> still held in
                  escrow.
                </p>
              </>
            ) : (
              <div className="bd-crx-stepghost">
                <svg viewBox="0 0 200 72" aria-hidden="true">
                  <path d="M8 62 H56 V44 H104 V26 H152 V12 H192" />
                </svg>
                <p>
                  <b>Your first approved video draws the first step.</b> Payouts
                  stack into a staircase here, week by week.
                </p>
              </div>
            )}
          </section>

          <section
            className="bd-crx-card bd-crx-card--queue bd-rise"
            style={{ '--i': 4 } as React.CSSProperties}
          >
            <div className="bd-crx-cardhead">
              <span className="bd-crx-k">The queue</span>
              <span className="bd-crx-covertag bd-mono">
                {groupCount('completed')} paid
              </span>
            </div>
            {rungs.some((r) => r.count > 0) && (
              <QueueFlow counts={rungs.map((r) => r.count)} hot={hotRung} />
            )}
            <ol className="bd-crx-ladder">
              {rungs.map((rung, i) => (
                <li
                  key={rung.num}
                  className={cn(
                    'bd-crx-rung',
                    i === hotRung && 'bd-crx-rung--hot',
                    rung.count === 0 && 'bd-crx-rung--idle'
                  )}
                  style={{ '--i': i } as React.CSSProperties}
                >
                  <span className="bd-crx-rungcopy">
                    <b>{rung.label}</b>
                    <small>{rung.note}</small>
                  </span>
                  <span className="bd-crx-rungcount bd-mono">{rung.count}</span>
                  <Link
                    className="bd-crx-runggo"
                    href={rung.href}
                    aria-label={rung.label}
                  >
                    →
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          <section
            className="bd-crx-card bd-crx-card--standing bd-rise"
            style={{ '--i': 5 } as React.CSSProperties}
          >
            <div className="bd-crx-cardhead">
              <span className="bd-crx-k">Standing</span>
            </div>
            <div className="bd-crx-ringwrap">
              <ApprovalRing rate={dashboard.reliability.approvalRate} />
            </div>
            <dl className="bd-crx-facts">
              <div>
                <dt>Brands worked with</dt>
                <dd className="bd-mono">
                  {dashboard.relationships.brandsWorkedWith}
                </dd>
              </div>
              <div>
                <dt>Booked you again</dt>
                <dd className="bd-mono">
                  {dashboard.relationships.repeatBrands}
                </dd>
              </div>
              <div>
                <dt>Avg. turnaround</dt>
                <dd className="bd-mono">
                  {dashboard.reliability.avgSubmitDays !== null
                    ? `${Math.round(dashboard.reliability.avgSubmitDays)}d`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Revision rate</dt>
                <dd className="bd-mono">
                  {dashboard.reliability.revisionRate !== null
                    ? `${Math.round(dashboard.reliability.revisionRate * 100)}%`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Reach this week</dt>
                <dd className="bd-mono">
                  {signedNumber(dashboard.weeklyLift.views)}
                </dd>
              </div>
            </dl>
            {liftParts.length > 0 ? (
              <p className="bd-crx-cardfoot">
                This week:{' '}
                {liftParts
                  .map(
                    (part) => `${signedNumber(part.value ?? 0)} ${part.label}`
                  )
                  .join(' · ')}
              </p>
            ) : null}
          </section>
        </div>

        {/* ---------- profile and rate (right rail on desktop) ---------- */}
        <section
          className="bd-cr-chapter bd-crx-aside bd-rise"
          style={{ '--i': 6 } as React.CSSProperties}
        >
          <div className="bd-capruler">
            <span className="bd-caprulertitle">Account overview</span>
          </div>
          {alertItems > 0 && (
            <section className="bd-crx-card bd-crx-card--act">
              <div className="bd-crx-cardhead">
                <span className="bd-crx-k">Action needed</span>
                <span className="bd-crx-acttag bd-mono">
                  {dashboard.expiringOffers.length + a.needsRevision}
                </span>
              </div>
              <div className="bd-crx-actlist">
                {dashboard.expiringOffers.slice(0, 3).map((offer) => (
                  <Link
                    key={offer.id}
                    className="bd-crx-act bd-crx-act--flag"
                    href={`/creator/deals/${offer.id}`}
                  >
                    <span className="bd-crx-actmain">
                      <b>{offer.campaignName}</b>
                      <small>{expiryLabel(offer.offerExpiresAt, now)}</small>
                    </span>
                    <span className="bd-crx-actgo" aria-hidden="true">
                      →
                    </span>
                  </Link>
                ))}
                {dashboard.expiringOffers.length > 3 && (
                  <Link className="bd-crx-actmore" href="/creator/deals">
                    +{dashboard.expiringOffers.length - 3} more expiring offers
                  </Link>
                )}
                {a.needsRevision > 0 && (
                  <Link
                    className="bd-crx-act bd-crx-act--pay"
                    href="/creator/deals"
                  >
                    <span className="bd-crx-actmain">
                      <b>
                        {a.needsRevision === 1
                          ? 'A brand asked for changes'
                          : `${a.needsRevision} videos need changes`}
                      </b>
                      <small>Funds stay held while you re-deliver.</small>
                    </span>
                    <span className="bd-crx-actgo" aria-hidden="true">
                      →
                    </span>
                  </Link>
                )}
              </div>
              <p className="bd-crx-cardfoot">
                Unanswered offers close on their own.
              </p>
            </section>
          )}
          {alertItems > 0 && <hr className="bd-crx-rule" />}
          <div className="bd-cr-dashboardgrid">
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
                    {dashboard.growth.engagementDelta !== null &&
                    dashboard.growth.engagementDelta !== 0 ? (
                      <span className="bd-crx-erdelta bd-mono">
                        {dashboard.growth.engagementDelta > 0 ? '+' : ''}
                        {dashboard.growth.engagementDelta.toFixed(2)} since last
                        refresh
                      </span>
                    ) : null}
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

            <section className="bd-cr-dashboardpanel bd-cr-profilepanel">
              <TierPricing
                tier={tier}
                profile={profile}
                status={profile.status}
                provisional={provisional}
              />
            </section>
          </div>
        </section>

        {/* ---------- open deals ---------- */}
        <section
          className="bd-cr-chapter bd-crx-attn bd-rise"
          style={{ '--i': 7 } as React.CSSProperties}
        >
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
                      <div className="bd-cr-dashdeal-copy">
                        <p className="bd-cr-dashdeal-title">
                          {deal.campaignName}
                        </p>
                        <p className="bd-cr-dashdeal-meta">
                          {dealCue(deal, now)}
                        </p>
                      </div>
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

        <p className="bd-signoff">
          {dashboard.isEmpty
            ? 'Your profile is live — offers land here the moment a brand books you.'
            : "That's everything for today."}
        </p>
      </div>
    </BdShell>
  );
}
