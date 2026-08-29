import Link from 'next/link';
import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import { Chip } from '@/components/ui/chip';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/feedback/empty-state';
import { formatDeadlineUtc } from '@/lib/dates';
import { labelForStatus } from '@/lib/deals';
import { dealStatusTone } from '@/lib/deals/status-tone';
import { cn, textLinkFeedback } from '@/lib/utils';
import {
  AWAITING_DELIVERY_LABEL,
  CAMPAIGN_TOTAL_LABEL,
  METRIC_KEYS,
  METRIC_LABELS,
  NO_VIDEOS_DESCRIPTION,
  NO_VIDEOS_TITLE,
  PERFORMANCE_TITLE,
  STALE_LABEL,
  STALE_NOTE,
  SUBMITTED_LABEL,
  VIEW_POST_LABEL,
  coverageNote,
  formatMetricCount,
  metricsUpdatedLabel,
} from '@/lib/campaigns/performance';
import type {
  CampaignDealGroup,
  CampaignTotals,
  CampaignVideoRow,
} from '@/lib/campaigns/performance';
import { deliveryProgress, videoHeading } from '@/lib/deals/brand-detail';
import { formatEtb } from '@/lib/money';

/**
 * Per-video engagement and the campaign total (KAN-49, KAN-50, US-009, AC-026,
 * AC-027, NFR-011).
 *
 * A **server** component: nothing here is interactive, so it stays off the client
 * bundle and can import its copy straight from `lib/campaigns/performance.ts`
 * beside the query — unlike `review-actions.tsx`, which is `'use client'` and
 * therefore needs the leaf `lib/deals/copy.ts` to avoid dragging `pg` toward the
 * browser.
 *
 * **Cards with an inner grid, not a table.** The admin table in this repo
 * (`components/admin/awaiting-tier-list.tsx`) wraps
 * in `overflow-x-auto`, which scrolls sideways on a phone. That is fine for an
 * admin queue and wrong here (NFR-007) — `earnings-summary.tsx` says the same
 * thing about its own figures. So each deal is a card whose four counts stack on
 * mobile and go columnar from `sm:` up, with `tabular-nums` so a column of numbers
 * lines up.
 *
 * **There is no arithmetic in this file, and no wording decisions either.** Both
 * the totals and the money arrive summed — the totals from `toCampaignTotals`, the
 * money from the ledger — and `formatMetricCount`, `metricsUpdatedLabel`,
 * `coverageNote` and `formatEtb` are the only things between a value and the
 * screen. AC-026 asks the money figures to be read rather than recomputed and
 * AC-027 asks absence to be stated rather than rendered as a number; the way to
 * make both true of a component is to give it nothing to compute and no sentence
 * to compose.
 *
 * **A stale row keeps its numbers.** NFR-011 says clearly-marked stale metrics
 * render "instead of failing or hiding the row", so the marker is additive: the
 * counts stay, the timestamp relabels itself as the last confirmed one, and a
 * sentence explains which way the figures are wrong. Nothing in the MVP sets that
 * flag — see `metricsUpdatedLabel`.
 *
 * **One card per deal, one block of counts per video** (F38). AC-026 asks for "each
 * video shows views, likes, shares, and comments plus a campaign total", and the deal
 * card is what makes that renderable without misstating the money: `unit_price ×
 * video_count = total_price` describes the deal, so it is printed once, while the four
 * counts belong to a video and are printed per video. `toDealGroups` does the folding
 * — this file receives it already grouped, and still computes nothing.
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

function VideoMetrics({ video }: { video: CampaignVideoRow }) {
  // Composed in the module that owns the copy, so this file decides where the
  // sentence goes and never what it says. Null means nothing has been measured,
  // which the counts above already say — see `metricsUpdatedLabel`.
  const updated = metricsUpdatedLabel(video.lastUpdatedAt, video.stale);

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* AC-027 bullet 4. Beside the video's own numbers rather than over the
              whole deal, because it qualifies these counts and a deal can hold
              three videos measured at different times. The red tint rather than
              a colour alone — the word is what carries it. */}
          {video.stale ? <Chip tone="red">{STALE_LABEL}</Chip> : null}
        </div>

        {/* AC-026: each video links to its own live post. Shown as a link the
            brand chooses to follow, never an embed — the URL is stored and
            displayed and nothing here fetches it (Tech Spec §6.3). `rel` keeps
            the destination from getting a handle on the opener. */}
        {video.tiktokUrl ? (
          <a
            href={video.tiktokUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn(
              'inline-flex items-center gap-1.5 text-sm',
              textLinkFeedback
            )}
          >
            {VIEW_POST_LABEL}
            <ArrowSquareOut size={14} weight="regular" aria-hidden />
          </a>
        ) : null}
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

      {/* AC-027 bullet 4's second half: why the video still shows numbers it
          cannot vouch for. Above the timestamps, because it changes how the
          "Last confirmed" one should be read. */}
      {video.stale ? (
        <p className="text-xs text-muted-foreground">{STALE_NOTE}</p>
      ) : null}

      {/* Both timestamps on one line: when the video went up, and when its
          numbers were written (AC-027 bullet 3). Each is omitted rather than
          placeholdered when absent — a video with no metrics already says
          `Metrics pending` four times above, and a fifth empty field would add
          nothing. */}
      {video.submittedAt || updated ? (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {video.submittedAt ? (
            <span>
              {SUBMITTED_LABEL} {formatDeadlineUtc(video.submittedAt)}
            </span>
          ) : null}
          {updated ? <span>{updated}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

function DealCard({ deal }: { deal: CampaignDealGroup }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          {/* Into the deal's own review screen (KAN-68), which re-checks
              ownership in its own `where` rather than trusting this href. */}
          <Link
            href={`/deals/${deal.dealId}`}
            className={cn('text-lg font-semibold', textLinkFeedback)}
          >
            {deal.creatorHandle}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {/* The shared vocabulary from `lib/deals/groups.ts`, so this list
                and the deal screen cannot call one state two things. */}
            <Chip
              tone={dealStatusTone[deal.status] ?? 'gray'}
              className="capitalize"
            >
              {labelForStatus(deal.status)}
            </Chip>
            {/* AC-026's "tier price paid": the rate and what it came to. Both,
                not just the total — the rate is the tier's price snapshotted onto
                the deal at offer time (invariant 8), and it is the figure a brand
                compares between creators. Stated **once per deal**: printing it
                over each of three videos would show three times the money the
                campaign owes (F38). */}
            <span className="text-sm text-muted-foreground">
              {formatEtb(deal.unitPrice)} × {deal.videoCount} ={' '}
              <span className="font-medium text-foreground">
                {formatEtb(deal.totalPrice)}
              </span>
            </span>
            {/* How much of what was ordered has arrived. The reason a deal can
                show two sets of counts and no approval yet. */}
            <span className="text-sm text-muted-foreground">
              {deliveryProgress(deal.videos.length, deal.videoCount)}
            </span>
          </div>
        </div>

        {deal.videos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {AWAITING_DELIVERY_LABEL}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {deal.videos.map((video, index) => (
              <div key={video.deliverableId} className="flex flex-col gap-2">
                {/* Numbered only where the number distinguishes something. A
                    one-video deal has nothing to disambiguate, and "Video 1"
                    over a single set of counts is noise. */}
                {deal.videoCount > 1 ? (
                  <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {videoHeading(index)}
                  </h4>
                ) : null}
                <VideoMetrics video={video} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function VideoPerformance({
  deals,
  totals,
}: {
  deals: CampaignDealGroup[];
  totals: CampaignTotals;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold tracking-tight">
        {PERFORMANCE_TITLE}
      </h2>

      {deals.length === 0 ? (
        <EmptyState
          align="start"
          title={NO_VIDEOS_TITLE}
          description={NO_VIDEOS_DESCRIPTION}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {deals.map((deal) => (
              <li key={deal.dealId}>
                <DealCard deal={deal} />
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
