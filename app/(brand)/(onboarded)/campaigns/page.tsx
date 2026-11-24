import Link from 'next/link';
import { redirect } from 'next/navigation';
import { bdMono, bdSans } from '@/lib/fonts';
import { CancelCampaignButton } from '@/components/campaign/cancel-campaign-button';
import { CampaignSort } from '@/components/campaign/campaign-sort';
import { requireRole } from '@/lib/auth';
import { getBrandProfileByUserId } from '@/lib/brands/queries';
import { listCampaignsWithProgress } from '@/lib/campaigns/queries';
import { campaignStatusLabel } from '@/lib/campaigns/status';
import {
  isCampaignSortKey,
  sortCampaignRows,
  type CampaignSortKey,
} from '@/lib/campaigns/sort';
import type { CampaignStatus } from '@/db/schema';
import { cn } from '@/lib/utils';

export const runtime = 'nodejs';

/**
 * Campaigns list page for brands (KAN-26, US-003, AC-007) — the v4 visual
 * language shared with the brand dashboard, with the list's own personality:
 *
 * - **Status-grouped sections** under editorial rulers (Active, Drafts,
 *   Closed) — a campaign's lifecycle stage is the
 *   first thing a brand scans for, so the grouping does the scanning.
 * - **Filmstrip delivery slots** — one tick per ordered video, filled as
 *   deliverables land. The product sells videos; the row shows videos.
 * - **Ledger-derived money** — the committed meter reads hold sums, never
 *   recomputed (invariant 4).
 *
 * Every campaign the brand owns, whatever its status — a confirmed campaign
 * is still theirs, and a draft-only list would drop it from view the moment
 * they sent its offers.
 */

const STATUS_TONE: Record<CampaignStatus, string> = {
  draft: 'bd-capstatus--draft',
  confirmed: 'bd-capstatus--wait',
  funded: 'bd-capstatus--live',
  in_progress: 'bd-capstatus--live',
  completed: 'bd-capstatus--done',
  cancelled: 'bd-capstatus--dead',
};

/** Row accent strip tone, the dashboard's left-border grammar. */
const STATUS_STRIP: Record<CampaignStatus, string> = {
  draft: 'bd-caprow--draft',
  confirmed: 'bd-caprow--wait',
  funded: 'bd-caprow--live',
  in_progress: 'bd-caprow--live',
  completed: 'bd-caprow--done',
  cancelled: 'bd-caprow--dead',
};

function birr(santim: number): number {
  return Math.round(santim / 100);
}

/** Compact age for the card meta: relative under a month, dated after. */
function campaignAge(createdAt: Date | string): string {
  const created = new Date(createdAt);
  const days = Math.floor((Date.now() - created.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 28) return `${Math.floor(days / 7)}w ago`;
  return created.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(created.getFullYear() !== new Date().getFullYear()
      ? { year: 'numeric' }
      : {}),
  });
}

type Row = Awaited<ReturnType<typeof listCampaignsWithProgress>>[number];

/** One tick per video, filled as deliverables land. Caps at 12 slots. */
function Filmstrip({ row }: { row: Row }) {
  const total = Math.max(row.orderedVideos || row.desiredVideos, 1);
  const done = Math.min(row.deliveredVideos, total);
  const slots = Math.min(total, 12);
  const filled = Math.round((done / total) * slots);
  return (
    <span
      className="bd-strip"
      role="img"
      aria-label={`${done} of ${total} videos delivered`}
    >
      {Array.from({ length: slots }, (_, i) => (
        <i key={i} className={i < filled ? 'bd-strip--on' : undefined} />
      ))}
      <span className="bd-stripnum bd-mono">
        {done}/{total}
      </span>
    </span>
  );
}

/** Rich card for in-flight campaigns — the 2-up grid's unit. */
function CampaignCard({ row }: { row: Row }) {
  const pct = Math.min(
    100,
    row.budget > 0 ? (row.committed / row.budget) * 100 : 0
  );
  return (
    <Link
      href={`/campaigns/${row.id}`}
      className={cn('bd-capcard', STATUS_STRIP[row.status])}
      aria-label={`Open ${row.name}`}
    >
      <div className="bd-capcardhead">
        <h2>{row.name}</h2>
        <span className={cn('bd-capstatus', STATUS_TONE[row.status])}>
          {campaignStatusLabel(row.status)}
        </span>
      </div>
      <p className="bd-capgoal">
        {row.goal ??
          `Created ${new Date(row.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}`}
      </p>

      <div className="bd-capcardbody">
        <div className="bd-caprowline">
          <span className="bd-caplab">Videos</span>
          <Filmstrip row={row} />
        </div>
        <div className="bd-caprowline">
          <span className="bd-caplab">Budget</span>
          <span className="bd-bar">
            <i style={{ width: `${pct}%` }} />
          </span>
        </div>
      </div>

      <div className="bd-capcardfoot">
        <span className="bd-mnum">
          <b>{birr(row.committed).toLocaleString('en-US')}</b>
          <span className="bd-factdim">
            {' '}
            / {birr(row.budget).toLocaleString('en-US')} ETB committed
          </span>
        </span>
        <span className="bd-captime bd-mono">{campaignAge(row.createdAt)}</span>
        <span className="bd-capgo" aria-hidden="true">
          <span className="bd-capgolabel">Open</span>
          <span className="bd-capgoarrow">→</span>
        </span>
      </div>
    </Link>
  );
}

/** Compact ledger row for drafts and closed campaigns. */
function CampaignRow({ row, index }: { row: Row; index: number }) {
  const pct = Math.min(
    100,
    row.budget > 0 ? (row.committed / row.budget) * 100 : 0
  );
  return (
    <div className={cn('bd-caprow', STATUS_STRIP[row.status])}>
      <span className="bd-capidx bd-mono">
        {String(index + 1).padStart(2, '0')}
      </span>
      <div className="bd-capmain">
        <div className="bd-capname">
          <h2>{row.name}</h2>
          <span className={cn('bd-capstatus', STATUS_TONE[row.status])}>
            {campaignStatusLabel(row.status)}
          </span>
        </div>
        <p className="bd-capgoal">
          {row.goal ??
            `Created ${new Date(row.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}`}
        </p>
      </div>

      <div className="bd-capprogress">
        <div className="bd-caprowline">
          <span className="bd-caplab">Videos</span>
          <Filmstrip row={row} />
        </div>
        <div className="bd-caprowline">
          <span className="bd-caplab">Budget</span>
          <span className="bd-bar">
            <i style={{ width: `${pct}%` }} />
          </span>
          <span className="bd-mnum">
            <b>{birr(row.committed).toLocaleString('en-US')}</b>
            <span className="bd-factdim">
              {' '}
              / {birr(row.budget).toLocaleString('en-US')} ETB
            </span>
          </span>
        </div>
      </div>

      <div className="bd-capacts">
        {row.status === 'draft' ? (
          <>
            <Link className="bd-go" href={`/campaigns/${row.id}/edit`}>
              <span className="bd-golabel">Edit brief </span>→
            </Link>
            <CancelCampaignButton
              campaignId={row.id}
              campaignName={row.name}
              context="list"
            />
          </>
        ) : (
          <Link
            className="bd-go"
            href={`/campaigns/${row.id}`}
            aria-label={`Open ${row.name}`}
          >
            <span className="bd-golabel">Open </span>→
          </Link>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  note,
  rows,
  rise,
}: {
  title: string;
  note: string;
  rows: Row[];
  rise: number;
}) {
  if (rows.length === 0) return null;
  return (
    <section
      className="bd-capsection bd-rise"
      style={{ '--i': rise } as React.CSSProperties}
    >
      <div className="bd-capruler">
        <span className="bd-caprulertitle">{title}</span>
        <span className="bd-caprulerline" aria-hidden="true" />
        <span className="bd-caprulernote">{note}</span>
        <span className="bd-caprulercount bd-mono">
          {rows.length} {rows.length === 1 ? 'campaign' : 'campaigns'}
        </span>
      </div>
      <div>
        {rows.map((row, i) => (
          <CampaignRow key={row.id} row={row} index={i} />
        ))}
      </div>
    </section>
  );
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const user = await requireRole('brand');
  const profile = await getBrandProfileByUserId(user.id);
  if (!profile) redirect('/brand/onboarding');

  const { sort: sortParam } = await searchParams;
  const sort: CampaignSortKey = isCampaignSortKey(sortParam)
    ? sortParam
    : 'newest';

  const campaigns = sortCampaignRows(
    await listCampaignsWithProgress(profile.id),
    sort
  );

  const inFlight = campaigns.filter(
    (c) =>
      c.status === 'funded' ||
      c.status === 'in_progress' ||
      c.status === 'confirmed'
  );
  const drafts = campaigns.filter((c) => c.status === 'draft');
  const closed = campaigns.filter(
    (c) => c.status === 'completed' || c.status === 'cancelled'
  );

  const totalBudget = campaigns
    .filter((c) => c.status !== 'cancelled')
    .reduce((s, c) => s + c.budget, 0);
  const totalCommitted = campaigns.reduce((s, c) => s + c.committed, 0);
  const totalOrdered = campaigns.reduce((s, c) => s + c.orderedVideos, 0);
  const totalDelivered = campaigns.reduce((s, c) => s + c.deliveredVideos, 0);

  return (
    <div className={cn('bd', bdSans.variable, bdMono.variable)}>
      {/* ---------- page header ---------- */}
      <header
        className="bd-pagehead bd-rise"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        <div>
          <p className="bd-eyebrow">Brand workspace</p>
          <h1 className="bd-h1">Campaigns</h1>
          {campaigns.length > 0 ? (
            <p className="bd-idfacts">
              <b>{campaigns.length}</b>{' '}
              {campaigns.length === 1 ? 'campaign' : 'campaigns'} ·{' '}
              <b>{birr(totalCommitted).toLocaleString('en-US')}</b>
              <span className="bd-factdim">
                {' '}
                / {birr(totalBudget).toLocaleString('en-US')}
              </span>{' '}
              ETB committed · <b>{totalDelivered}</b>
              <span className="bd-factdim">/{totalOrdered}</span> videos
              delivered
            </p>
          ) : (
            <p className="bd-idfacts">
              Your campaign briefs and their progress live here.
            </p>
          )}
        </div>
        <div className="bd-headact">
          <Link className="bd-btn bd-btn--primary" href="/campaigns/new">
            New campaign
          </Link>
          {campaigns.length > 0 && <CampaignSort />}
        </div>
      </header>

      {campaigns.length === 0 ? (
        <div className="bd-rise" style={{ '--i': 2 } as React.CSSProperties}>
          <div className="bd-emptyfeed">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="5" width="16" height="15" rx="2.5" />
              <path d="M8 3.5V7M16 3.5V7M4 10.5h16" />
            </svg>
            <h3>No campaigns yet</h3>
            <p>
              Create your first campaign brief with a budget and goals to start
              discovering and booking creators. Everything you order is held
              securely until you approve the work.
            </p>
            <Link className="bd-btn bd-btn--primary" href="/campaigns/new">
              Create your first campaign
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Active: rich cards in an asymmetric split — the card
              grid carries the work, the rail carries the portfolio. */}
          {inFlight.length > 0 && (
            <section
              className="bd-capsection bd-rise"
              style={{ '--i': 2 } as React.CSSProperties}
            >
              <div className="bd-capruler">
                <span className="bd-caprulerline" aria-hidden="true" />
                <span className="bd-caprulernote">
                  Funded campaigns and campaigns pending payment
                </span>
                <span className="bd-caprulercount bd-mono">
                  {inFlight.length}{' '}
                  {inFlight.length === 1 ? 'campaign' : 'campaigns'}
                </span>
              </div>
              <div className="bd-capsplit">
                <aside className="bd-caprail">
                  <div className="bd-railcell">
                    <span className="bd-railk">Committed</span>
                    <span className="bd-railv bd-mono">
                      {birr(totalCommitted).toLocaleString('en-US')}
                      <span className="bd-raildim"> ETB</span>
                    </span>
                    <span className="bd-railbar" aria-hidden="true">
                      <i
                        style={{
                          width: `${Math.min(100, totalBudget > 0 ? (totalCommitted / totalBudget) * 100 : 0)}%`,
                        }}
                      />
                    </span>
                    <span className="bd-railn">
                      of {birr(totalBudget).toLocaleString('en-US')} ETB
                      budgeted
                    </span>
                  </div>
                  <div className="bd-railcell">
                    <span className="bd-railk">Videos delivered</span>
                    <span className="bd-railv bd-mono">
                      {totalDelivered}
                      <span className="bd-raildim">/{totalOrdered}</span>
                    </span>
                    <span className="bd-railbar" aria-hidden="true">
                      <i
                        style={{
                          width: `${Math.min(100, totalOrdered > 0 ? (totalDelivered / totalOrdered) * 100 : 0)}%`,
                        }}
                      />
                    </span>
                    <span className="bd-railn">
                      across {inFlight.length} active{' '}
                      {inFlight.length === 1 ? 'campaign' : 'campaigns'}
                    </span>
                  </div>
                  <div className="bd-railcell">
                    <span className="bd-railk">Drafts waiting</span>
                    <span className="bd-railv bd-mono">{drafts.length}</span>
                    {drafts.length > 0 ? (
                      <ul className="bd-raildrafts">
                        {drafts.slice(0, 3).map((d) => (
                          <li key={d.id}>
                            <Link
                              className="bd-raildraft"
                              href={`/campaigns/${d.id}/edit`}
                            >
                              <span
                                className="bd-draftdot"
                                aria-hidden="true"
                              />
                              <span className="bd-raildraftname">{d.name}</span>
                              <span className="bd-raildraftgo">
                                Edit <span aria-hidden="true">→</span>
                              </span>
                            </Link>
                          </li>
                        ))}
                        {drafts.length > 3 && (
                          <li className="bd-railn">
                            and {drafts.length - 3} more
                          </li>
                        )}
                      </ul>
                    ) : (
                      <span className="bd-railn">
                        every brief has been sent
                      </span>
                    )}
                  </div>
                  <p className="bd-railfoot">
                    Every committed birr is held until you approve the work.
                  </p>
                </aside>
                <div className="bd-capgrid">
                  {inFlight.map((row) => (
                    <CampaignCard key={row.id} row={row} />
                  ))}
                  {closed.length === 0 && (
                    <p className="bd-signoff bd-signoff--grid">
                      That&apos;s every campaign you own.
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}
          {/* Drafts ride in the sticky rail when the active split is on
              screen; the section renders only when there is no split. */}
          {inFlight.length === 0 && (
            <Section
              title="Drafts"
              note="Briefs that have not sent offers yet"
              rows={drafts}
              rise={3}
            />
          )}
          <Section
            title="Closed"
            note="Completed and cancelled campaigns"
            rows={closed}
            rise={4}
          />
          <p
            className={
              inFlight.length > 0 && closed.length === 0
                ? 'bd-signoff bd-signoff--page'
                : 'bd-signoff'
            }
          >
            {inFlight.length > 0
              ? "That's every campaign you own."
              : 'Send offers on a draft to make it active.'}
          </p>
        </>
      )}
    </div>
  );
}
