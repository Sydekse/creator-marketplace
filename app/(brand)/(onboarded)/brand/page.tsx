import Link from 'next/link';
import { redirect } from 'next/navigation';
import { bdMono, bdSans } from '@/lib/fonts';
import { CountUp, Greeting } from '@/components/brand/dashboard-bits';
import { ReachBubbles } from '@/components/brand/reach-bubbles';
import type { ReachVideo } from '@/components/brand/reach-bubbles';
import { SpendChart } from '@/components/brand/spend-chart';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { readBrandDashboard } from '@/lib/brands/dashboard';
import { displayTiktokHandle } from '@/lib/creators/handle';
import { formatEtb } from '@/lib/money';
import { cn } from '@/lib/utils';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Brand dashboard (§13) — the v4 design, implemented 1:1 from the approved
 * mock (session artifacts brand-app-v4.html / brand-app-v4-empty.html).
 *
 * The page is a scoped visual island: the `.bd` wrapper carries the mock's
 * exact fonts (Outfit + JetBrains Mono, self-hosted by next/font) and oklch
 * tokens, so no other page shifts. All styling lives in the `.bd` layer of
 * `globals.css`; the two D3 charts are isolated client leaves.
 *
 * Reachable only through the `(onboarded)` layout, so a brand who lands here
 * has a profile; one who does not was already redirected (AC-4). Every number
 * is ledger- or query-derived in `readBrandDashboard` — nothing recomputed
 * here beyond display arithmetic.
 */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function relativeTime(from: Date, now: Date): string {
  const days = Math.floor((now.getTime() - from.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
}

function daysUntil(to: Date, now: Date): string {
  const days = Math.max(
    0,
    Math.ceil((to.getTime() - now.getTime()) / 86_400_000)
  );
  return days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
}

/** Whole-birr display for chart-adjacent figures. */
function birr(santim: number): number {
  return Math.round(santim / 100);
}

export default async function BrandDashboardPage() {
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  if (!profile) redirect('/brand/onboarding');

  const d = await readBrandDashboard();
  const now = new Date();

  const empty = d.campaigns.total === 0;

  // Reach figures — null-disciplined: only measured videos count views.
  const measured = d.reachVideos.filter((v) => v.views !== null);
  const totalViews = measured.reduce((s, v) => s + (v.views ?? 0), 0);
  const distinctCreators = new Set(d.reachVideos.map((v) => v.creatorHandle))
    .size;
  const deliveredCount = d.reachVideos.length;

  // Funnel: sent → accepted → awaiting review → completed.
  const s = d.dealsByStatus;
  const acceptedFamily =
    s.accepted +
    s.funded +
    s.delivered +
    s.revision_requested +
    s.completed +
    s.refunded;
  const offersSent = acceptedFamily + s.pending + s.declined + s.expired;
  const responded = acceptedFamily + s.declined + s.expired;
  const acceptanceRate =
    responded > 0 ? Math.round((acceptedFamily / responded) * 1000) / 10 : null;

  // Spend series (cumulative weekly, ledger-sourced), last 12 weeks.
  const spendPoints = d.spent.slice(-12).map((p) => ({
    week: p.label,
    value: birr(p.paidOut),
  }));
  const grossSpend =
    d.spent.length > 0 ? d.spent[d.spent.length - 1].paidOut : 0;
  const fundedThisWeek =
    d.spent.length > 1
      ? d.spent[d.spent.length - 1].paidOut -
        d.spent[d.spent.length - 2].paidOut
      : grossSpend;
  const costPerView =
    totalViews > 0 ? (grossSpend / 100 / totalViews).toFixed(3) : null;

  // Escrow sparkline: the last 8 cumulative points, normalized to the max.
  const sparkSource = d.spent.slice(-8).map((p) => p.paidOut);
  const sparkMax = Math.max(...sparkSource, 1);
  const spark = sparkSource.map((v) => Math.max(8, (v / sparkMax) * 100));

  const reachVideos: ReachVideo[] = d.reachVideos.map((v) => ({
    deliverableId: v.deliverableId,
    campaignId: v.campaignId,
    campaignName: v.campaignName,
    creatorHandle: displayTiktokHandle(v.creatorHandle),
    views: v.views,
    likes: v.likes,
    shares: v.shares,
    comments: v.comments,
    when: relativeTime(v.submittedAt, now),
  }));

  return (
    <div className={cn('bd', bdSans.variable, bdMono.variable)}>
      {/* ---------- page header ---------- */}
      <header
        className="bd-pagehead bd-rise"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        <div className="bd-idrow">
          <span className="bd-pfp">{initials(profile.companyName)}</span>
          <div>
            <p className="bd-eyebrow">
              <Greeting />
            </p>
            <h1 className="bd-h1">{profile.companyName}</h1>
            {empty ? (
              <p className="bd-idfacts">
                Your account is ready. Everything below fills in as you work.
              </p>
            ) : (
              <p className="bd-idfacts">
                <b>{distinctCreators}</b> creators · <b>{d.campaigns.total}</b>{' '}
                campaigns · <b>{d.orderedVideos}</b> videos ordered
              </p>
            )}
          </div>
        </div>
        <p className="bd-statusline">
          {d.awaitingReview.length > 0 ? (
            <span className="bd-sline">
              <b>
                {d.awaitingReview.length}{' '}
                {d.awaitingReview.length === 1 ? 'video' : 'videos'}
              </b>{' '}
              await your review.
            </span>
          ) : (
            <span className="bd-sline">Nothing needs your review yet.</span>
          )}
        </p>
      </header>

      {/* ---------- actions ---------- */}
      <div
        className="bd-actions bd-rise"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        <Link className="bd-btn bd-btn--primary" href="/campaigns/new">
          New campaign
        </Link>
        <Link className="bd-btn bd-btn--ghost" href="/discover">
          Discover creators
        </Link>
      </div>

      {/* ---------- conditional alerts ---------- */}
      {(d.pendingFunding || d.flaggedDeal) && (
        <div
          className="bd-alerts bd-rise"
          style={{ '--i': 1 } as React.CSSProperties}
        >
          {d.pendingFunding && (
            <div className="bd-al bd-al--pay">
              <span>
                <b>Payment in progress.</b>{' '}
                <span className="bd-aldetail">
                  Your {formatEtb(d.pendingFunding.amount)} deposit for{' '}
                  {d.pendingFunding.campaignName} is being confirmed. Your
                  balance will update automatically once it clears.
                </span>
                <span className="bd-albrief">
                  {formatEtb(d.pendingFunding.amount)} ·{' '}
                  {d.pendingFunding.campaignName}
                </span>
              </span>
              <Link href="/campaigns" aria-label="Check payment status">
                <span className="bd-allabel">Check status</span>
                <span className="bd-alarrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </div>
          )}
          {d.flaggedDeal && (
            <div className="bd-al bd-al--flag">
              <span>
                <b>1 deal under review.</b>{' '}
                <span className="bd-aldetail">
                  {displayTiktokHandle(d.flaggedDeal.creatorHandle)} on{' '}
                  {d.flaggedDeal.campaignName} is being reviewed by our team.
                  The payment stays on hold until the review is complete.
                </span>
                <span className="bd-albrief">
                  {displayTiktokHandle(d.flaggedDeal.creatorHandle)} ·{' '}
                  {d.flaggedDeal.campaignName} · payment on hold
                </span>
              </span>
              <Link href="/deals" aria-label="View deal under review">
                <span className="bd-allabel">View deal</span>
                <span className="bd-alarrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ---------- bento ---------- */}
      <div className="bd-bento">
        <section
          className="bd-cell bd-cell--reach bd-rise"
          style={{ '--i': 2 } as React.CSSProperties}
        >
          <div className="bd-krow">
            <span className="bd-k">People reached</span>
            <span className="bd-range">All campaigns · to date</span>
          </div>
          {empty || deliveredCount === 0 ? (
            <>
              <div className="bd-v bd-mono bd-zero">0</div>
              <div className="bd-ghostwrap">
                <div className="bd-ghostb" aria-hidden="true">
                  <i></i>
                  <i></i>
                  <i></i>
                </div>
                <h3>No reach to show yet</h3>
                <p>
                  Each video you order appears here as a bubble, sized by the
                  views it collects. Reach starts counting when your first video
                  is delivered.
                </p>
                <Link className="bd-btn bd-btn--primary" href="/campaigns/new">
                  Create a campaign
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="bd-v bd-mono">
                <CountUp value={totalViews} />
              </div>
              <span className="bd-cover">
                View data for {measured.length} of {deliveredCount} videos
              </span>
              <ReachBubbles videos={reachVideos} />
              <p className="bd-legend">
                One bubble per ordered video, sized by views and grouped by
                campaign. Dashed bubbles are awaiting view data. Hover for the
                full breakdown.
              </p>
            </>
          )}
        </section>

        <div className="bd-bside">
          <section
            className="bd-cell bd-cell--escrow bd-rise"
            style={{ '--i': 3 } as React.CSSProperties}
          >
            <span className="bd-k">On hold for active deals</span>
            <div className="bd-v bd-mono">{formatEtb(d.money.held)}</div>
            <p className="bd-s">
              {d.money.held > 0
                ? 'Released only on your approval.'
                : 'When you fund a deal, the amount is held here and released only on your approval.'}
            </p>
            {spark.length > 1 && (
              <div className="bd-spark" aria-hidden="true">
                {spark.map((h, i) => (
                  <i
                    key={i}
                    className={i === spark.length - 1 ? 'bd-hi' : undefined}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            )}
          </section>

          <section
            className="bd-cell bd-cell--plain bd-rise"
            style={{ '--i': 4 } as React.CSSProperties}
          >
            <span className="bd-k">Completed payments</span>
            {d.money.paidOut + d.money.commission + d.money.refunded > 0 ? (
              <div className="bd-minirows">
                <div className="bd-minirow">
                  <span className="bd-mk">Paid out</span>
                  <span className="bd-mv">
                    {formatEtb(d.money.paidOut).replace(' ETB', '')}
                  </span>
                </div>
                <div className="bd-minirow">
                  <span className="bd-mk">Commission</span>
                  <span className="bd-mv">
                    {formatEtb(d.money.commission).replace(' ETB', '')}
                  </span>
                </div>
                <div className="bd-minirow">
                  <span className="bd-mk">Refunded</span>
                  <span className="bd-mv">
                    {formatEtb(d.money.refunded).replace(' ETB', '')}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="bd-v bd-mono bd-zero" aria-label="None yet">
                  —
                </div>
                <p className="bd-s">No payments yet.</p>
              </>
            )}
          </section>

          <section
            className="bd-cell bd-cell--amber bd-rise"
            style={{ '--i': 4 } as React.CSSProperties}
          >
            <span className="bd-k">Offers expiring</span>
            {d.expiringOffers.length > 0 ? (
              <div className="bd-exlist">
                {d.expiringOffers.map((o) => (
                  <div className="bd-exrow" key={o.dealId}>
                    <b>{displayTiktokHandle(o.creatorHandle)}</b>
                    <span className="bd-eta">
                      {daysUntil(o.expiresAt, now)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="bd-v bd-mono bd-zero" aria-label="None yet">
                  —
                </div>
                <p className="bd-s">No open offers.</p>
                <Link className="bd-golink" href="/discover">
                  Browse creators to send one →
                </Link>
              </>
            )}
          </section>

          <section
            className="bd-cell bd-cell--plain bd-rise"
            style={{ '--i': 5 } as React.CSSProperties}
          >
            <span className="bd-k">Videos delivered</span>
            <div
              className={cn('bd-v bd-mono', d.orderedVideos === 0 && 'bd-zero')}
            >
              {deliveredCount}
              <span style={{ color: 'var(--bd-faint)', fontSize: 18 }}>
                /{d.orderedVideos}
              </span>
            </div>
            <p className="bd-s">
              {d.orderedVideos > deliveredCount
                ? `${d.orderedVideos - deliveredCount} in production.`
                : 'Delivery progress shows up here.'}
            </p>
          </section>

          <section
            className="bd-cell bd-cell--plain bd-rise"
            style={{ '--i': 5 } as React.CSSProperties}
          >
            <span className="bd-k">Deals completed</span>
            <div className={cn('bd-v bd-mono', s.completed === 0 && 'bd-zero')}>
              {s.completed}
            </div>
            <p className="bd-s">
              {s.completed > 0
                ? 'Approved and paid in full.'
                : 'Your finished deals build a track record here.'}
            </p>
          </section>
        </div>
      </div>

      {/* ---------- spend spread ---------- */}
      <div className="bd-spread">
        <section
          className="bd-spendcard bd-rise"
          style={{ '--i': 5 } as React.CSSProperties}
        >
          <div className="bd-spendhead">
            <div className="bd-left">
              <h2>Spend</h2>
              <span className="bd-big">{formatEtb(grossSpend)}</span>
              {fundedThisWeek > 0 && (
                <span className="bd-delta">
                  +{birr(fundedThisWeek).toLocaleString('en-US')} this week
                </span>
              )}
            </div>
            <span className="bd-range">Last 12 weeks</span>
          </div>
          {spendPoints.length > 1 && grossSpend > 0 ? (
            <>
              <SpendChart points={spendPoints} />
              <p className="bd-chartfoot">
                Every payment is held securely until <b>you approve the work</b>
                .
              </p>
            </>
          ) : (
            <div className="bd-emptychart">
              <p>
                <b>No spend yet.</b> Fund your first deal and your weekly spend
                history draws itself here.
              </p>
            </div>
          )}
        </section>

        <aside
          className="bd-marginalia bd-rise"
          style={{ '--i': 6 } as React.CSSProperties}
        >
          {empty ? (
            <>
              <div className="bd-mstep">
                <span className="bd-n">01</span>
                <div>
                  <h4>Create a campaign</h4>
                  <p>Set a brief, budget, and the kind of videos you want.</p>
                </div>
              </div>
              <div className="bd-mstep">
                <span className="bd-n bd-dim">02</span>
                <div>
                  <h4>Order from creators</h4>
                  <p>
                    Send offers to creators whose audience fits your product.
                  </p>
                </div>
              </div>
              <div className="bd-mstep">
                <span className="bd-n bd-dim">03</span>
                <div>
                  <h4>Approve and pay</h4>
                  <p>
                    Review each delivered video. Payment is released only when
                    you approve.
                  </p>
                </div>
              </div>
              <p className="bd-mfoot">
                Payments are held securely from funding to your approval.
              </p>
            </>
          ) : (
            <>
              <div className="bd-mstat">
                <span className="bd-smk">Funded this week</span>
                <span className="bd-smv bd-mono">
                  {fundedThisWeek > 0 ? `+${formatEtb(fundedThisWeek)}` : '—'}
                </span>
                <span className="bd-smn">
                  {fundedThisWeek > 0
                    ? 'held for newly funded deals'
                    : 'no deals funded this week'}
                </span>
              </div>
              <div className="bd-mstat">
                <span className="bd-smk">New reach this week</span>
                <span className="bd-smv bd-mono">
                  {d.newViewsThisWeek !== null
                    ? d.newViewsThisWeek.toLocaleString('en-US')
                    : '—'}
                </span>
                <span className="bd-smn">
                  {d.newViewsThisWeek !== null
                    ? 'views gained across measured videos'
                    : 'appears once a week of view history exists'}
                </span>
              </div>
              <div className="bd-mstat">
                <span className="bd-smk">Cost per view</span>
                <span className="bd-smv bd-mono">
                  {costPerView !== null ? `${costPerView} ETB` : '—'}
                </span>
                <span className="bd-smn">
                  {costPerView !== null
                    ? `across ${measured.length} videos with view data`
                    : 'appears once videos report views'}
                </span>
              </div>
              <p className="bd-mfoot">
                Payments are released only after you approve the delivered
                video.
              </p>
            </>
          )}
        </aside>
      </div>

      {/* ---------- work split ---------- */}
      <div className="bd-worksplit">
        <div
          className="bd-worklabel bd-rise"
          style={{ '--i': 6 } as React.CSSProperties}
        >
          <h2>Requires your attention</h2>
          {d.awaitingReview.length > 0 || d.expiringOffers.length > 0 ? (
            <p>
              Deliverables awaiting your review, and offers approaching expiry.
            </p>
          ) : (
            <p>
              Nothing yet. Deliveries to review and offers nearing expiry will
              queue here.
            </p>
          )}
          {offersSent > 0 && (
            <div className="bd-funnelwrap">
              <div className="bd-flowline">
                <span className="bd-fnode">
                  <span className="bd-num bd-mono">{offersSent}</span>
                  <span className="bd-lab">offers sent</span>
                </span>
                <span className="bd-farrow" aria-hidden="true">
                  →
                </span>
                <span className="bd-fnode">
                  <span className="bd-num bd-mono">{acceptedFamily}</span>
                  <span className="bd-lab">accepted</span>
                </span>
                <span className="bd-farrow" aria-hidden="true">
                  →
                </span>
                <span
                  className={cn(
                    'bd-fnode',
                    d.awaitingReview.length > 0 && 'bd-fnode--hot'
                  )}
                >
                  <span className="bd-num bd-mono">
                    {d.awaitingReview.length}
                  </span>
                  <span className="bd-lab">awaiting review</span>
                </span>
                <span className="bd-farrow" aria-hidden="true">
                  →
                </span>
                <span className="bd-fnode">
                  <span className="bd-num bd-mono">{s.completed}</span>
                  <span className="bd-lab">completed</span>
                </span>
              </div>
              {acceptanceRate !== null && (
                <div className="bd-rateblock">
                  <div className="bd-raterow">
                    <span className="bd-ratefig bd-mono">
                      {acceptanceRate}%
                    </span>
                    <span className="bd-ratelab">
                      of your offers get accepted
                    </span>
                  </div>
                  <span className="bd-ratebar" aria-hidden="true">
                    <i style={{ width: `${Math.min(100, acceptanceRate)}%` }} />
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bd-rise" style={{ '--i': 7 } as React.CSSProperties}>
          {d.awaitingReview.length > 0 || d.expiringOffers.length > 0 ? (
            <div>
              {d.awaitingReview.map((r) => (
                <div className="bd-feedrow" key={r.dealId}>
                  <span className="bd-kind bd-kind--rev">REVIEW</span>
                  <span className="bd-what">
                    <b>{displayTiktokHandle(r.creatorHandle)}</b> delivered{' '}
                    {r.videoCount === 1 ? 'a video' : `${r.videoCount} videos`}{' '}
                    for <b>{r.campaignName}</b>
                  </span>
                  <span className="bd-sum">{formatEtb(r.totalPrice)}</span>
                  <Link
                    className="bd-go"
                    href={`/deals/${r.dealId}`}
                    aria-label="Review delivery"
                  >
                    <span className="bd-golabel">Review </span>→
                  </Link>
                </div>
              ))}
              {d.expiringOffers.map((o) => (
                <div className="bd-feedrow" key={o.dealId}>
                  <span className="bd-kind bd-kind--exp">EXPIRES</span>
                  <span className="bd-what">
                    Offer to <b>{displayTiktokHandle(o.creatorHandle)}</b>{' '}
                    expires in {daysUntil(o.expiresAt, now)}
                  </span>
                  <span className="bd-sum">{daysUntil(o.expiresAt, now)}</span>
                  <Link
                    className="bd-go"
                    href={`/deals/${o.dealId}`}
                    aria-label="Open offer"
                  >
                    <span className="bd-golabel">Open offer </span>→
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <div className="bd-emptyfeed">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12h4l2 5 4-10 2 5h4" />
              </svg>
              <h3>No activity yet</h3>
              <p>
                Offer replies, video deliveries, and payment events will appear
                here the moment they happen.
                {empty && ' Start by finding creators who fit your brand.'}
              </p>
              {empty && (
                <Link className="bd-btn bd-btn--ghost" href="/discover">
                  Discover creators
                </Link>
              )}
            </div>
          )}

          {d.budgets.length > 0 && (
            <div className="bd-budgets">
              {d.budgets.map((b) => {
                const pct = Math.min(
                  100,
                  b.budget > 0 ? (b.committed / b.budget) * 100 : 0
                );
                return (
                  <div className="bd-meter" key={b.campaignId}>
                    <span className="bd-nm">{b.name}</span>
                    <span className="bd-bar">
                      <i
                        className={pct > 90 ? 'bd-hot' : undefined}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="bd-mnum">
                      <b>{birr(b.committed).toLocaleString('en-US')}</b> /{' '}
                      {birr(b.budget).toLocaleString('en-US')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <p className="bd-signoff">
        {empty
          ? 'Your first campaign is the only step that needs you today.'
          : "That's everything for today."}
      </p>
    </div>
  );
}
