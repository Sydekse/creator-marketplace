import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/feedback/empty-state';
import { formatDeadlineUtc } from '@/lib/dates';
import { labelForStatus } from '@/lib/deals';
import {
  AWAITING_DELIVERY_LABEL,
  CAMPAIGN_TOTAL_LABEL,
  METRIC_KEYS,
  METRIC_LABELS,
  NO_VIDEOS_DESCRIPTION,
  NO_VIDEOS_TITLE,
  PERFORMANCE_TITLE,
  VIEW_POST_LABEL,
  coverageNote,
  formatMetricCount,
} from '@/lib/campaigns/performance';
import type {
  CampaignTotals,
  CampaignVideoRow,
} from '@/lib/campaigns/performance';
import { formatEtb } from '@/lib/money';

/**
 * Per-video engagement and the campaign total (KAN-49, US-009, AC-026).
 *
 * A **server** component: nothing here is interactive, so it stays off the client
 * bundle and can import its copy straight from `lib/campaigns/performance.ts`
 * beside the query — unlike `review-actions.tsx`, which is `'use client'` and
 * therefore needs the leaf `lib/deals/copy.ts` to avoid dragging `pg` toward the
 * browser.
 *
 * **Cards with an inner grid, not a table.** The two tables in this repo
 * (`components/admin/verification-queue.tsx`, `awaiting-tier-list.tsx`) both wrap
 * in `overflow-x-auto`, which scrolls sideways on a phone. That is fine for an
 * admin queue and wrong here (NFR-007) — `earnings-summary.tsx` says the same
 * thing about its own figures. So each deal is a card whose four counts stack on
 * mobile and go columnar from `sm:` up, with `tabular-nums` so a column of numbers
 * lines up.
 *
 * **There is no arithmetic in this file.** Both the totals and the money arrive
 * summed — the totals from `toCampaignTotals`, the money from the ledger — and
 * `formatMetricCount` and `formatEtb` are the only things between a number and the
 * screen. AC-026 asks the money figures to be read rather than recomputed, and the
 * way to make that true of a component is to give it nothing to compute with.
 *
 * **One row per deal**, which is what the data supports. See `performance.ts` and
 * **F38**: a deal can only ever carry one submitted video and one set of counts,
 * so "each video" and "each deal" coincide only because campaigns are being kept
 * to one video per creator.
 */

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function VideoRow({ video }: { video: CampaignVideoRow }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            {/* Into the deal's own review screen (KAN-68), which re-checks
                ownership in its own `where` rather than trusting this href. */}
            <Link
              href={`/deals/${video.dealId}`}
              className="text-lg font-semibold hover:underline"
            >
              {video.creatorHandle}
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              {/* The shared vocabulary from `lib/deals/groups.ts`, so this list
                  and the deal screen cannot call one state two things. */}
              <Badge variant="secondary">{labelForStatus(video.status)}</Badge>
              {/* AC-026's "tier price paid": the rate and what it came to. Both,
                  not just the total — the rate is the tier's price snapshotted onto
                  the deal at offer time (invariant 8), and it is the figure a brand
                  compares between creators. They coincide only while deals are one
                  video each (F38), so showing the total alone would hide the
                  multiplier the moment that changes. */}
              <span className="text-sm text-muted-foreground">
                {formatEtb(video.unitPrice)} × {video.videoCount} ={' '}
                <span className="font-medium text-foreground">
                  {formatEtb(video.totalPrice)}
                </span>
              </span>
            </div>
          </div>

          {/* AC-026: each row links to the live post. Shown as a link the brand
              chooses to follow, never an embed — the URL is stored and displayed
              and nothing here fetches it (Tech Spec §6.3). `rel` keeps the
              destination from getting a handle on the opener. */}
          {video.tiktokUrl ? (
            <a
              href={video.tiktokUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-sm underline-offset-4 hover:underline"
            >
              {VIEW_POST_LABEL} ↗
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">
              {AWAITING_DELIVERY_LABEL}
            </span>
          )}
        </div>

        {/* Two up on a phone, four from `sm:` — no fixed widths, nothing that
            scrolls sideways (NFR-007). */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {METRIC_KEYS.map((key) => (
            <Metric
              key={key}
              label={METRIC_LABELS[key]}
              value={formatMetricCount(video[key])}
            />
          ))}
        </dl>

        {video.submittedAt ? (
          <p className="text-xs text-muted-foreground">
            Submitted {formatDeadlineUtc(video.submittedAt)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function VideoPerformance({
  videos,
  totals,
}: {
  videos: CampaignVideoRow[];
  totals: CampaignTotals;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold tracking-tight">
        {PERFORMANCE_TITLE}
      </h2>

      {videos.length === 0 ? (
        <EmptyState
          title={NO_VIDEOS_TITLE}
          description={NO_VIDEOS_DESCRIPTION}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {videos.map((video) => (
              <li key={video.dealId}>
                <VideoRow video={video} />
              </li>
            ))}
          </ul>

          {/* AC-026's "plus a campaign total". Its own card rather than a row in
              the list, because it is a different kind of thing and a brand should
              not have to work out which card is the sum. */}
          <Card>
            <CardContent className="flex flex-col gap-4 p-6">
              <h3 className="text-sm font-medium">{CAMPAIGN_TOTAL_LABEL}</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                {METRIC_KEYS.map((key) => (
                  <Metric
                    key={key}
                    label={METRIC_LABELS[key]}
                    value={formatMetricCount(totals[key])}
                  />
                ))}
              </dl>
              {/* Which videos the figures above actually cover. A total over 2 of
                  5 videos is a different claim from a total over all 5, and
                  without this line the number reads as complete. */}
              <p className="text-xs text-muted-foreground">
                {coverageNote(totals.measuredVideos, totals.totalVideos)}
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
