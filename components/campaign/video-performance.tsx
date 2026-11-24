import Link from 'next/link';
import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import { formatDeadlineUtc } from '@/lib/dates';
import { labelForStatus } from '@/lib/deals';
import type { DealStatus } from '@/db/schema';
import { cn, textLinkFeedback } from '@/lib/utils';
import {
  AWAITING_DELIVERY_LABEL,
  CAMPAIGN_TOTAL_LABEL,
  METRIC_KEYS,
  METRIC_LABELS,
  METRICS_PENDING,
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

/** Deal status → v4 chip tone, the campaigns pages' chip vocabulary. */
const DEAL_TONE: Partial<Record<DealStatus, string>> = {
  pending: 'bd-capstatus--wait',
  accepted: 'bd-capstatus--wait',
  funded: 'bd-capstatus--live',
  delivered: 'bd-capstatus--live',
  revision_requested: 'bd-capstatus--wait',
  completed: 'bd-capstatus--done',
  declined: 'bd-capstatus--dead',
  expired: 'bd-capstatus--dead',
  refunded: 'bd-capstatus--dead',
};

function Metric({ label, value }: { label: string; value: string }) {
  // Unmeasured cells shrink to a whisper: the sentence repeated four times is
  // structure, not information, so it must not weigh like a numeral.
  return (
    <div className="bd-vpmetric">
      <dt>{label}</dt>
      <dd className={cn('bd-mono', value === METRICS_PENDING && 'bd-vpwait')}>
        {value}
      </dd>
    </div>
  );
}

function VideoMetrics({ video }: { video: CampaignVideoRow }) {
  // Composed in the module that owns the copy, so this file decides where the
  // sentence goes and never what it says. Null means nothing has been measured,
  // which the counts above already say — see `metricsUpdatedLabel`.
  const updated = metricsUpdatedLabel(video.lastUpdatedAt, video.stale);

  return (
    <div className="bd-vpvideo">
      {/* AC-027 bullet 4. Beside the video's own numbers rather than over the
          whole deal, because it qualifies these counts and a deal can hold
          three videos measured at different times. The amber ground rather
          than a colour alone — the word is what carries it. */}
      {video.stale ? (
        <div className="bd-vpvideohead">
          <span className="bd-capstatus bd-capstatus--wait">{STALE_LABEL}</span>
        </div>
      ) : null}

      {/* Two up on a phone, four from `sm:` — no fixed widths, nothing that
          scrolls sideways (NFR-007). */}
      <dl className="bd-vpmetrics">
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
      {video.stale ? <p className="bd-vpnote">{STALE_NOTE}</p> : null}

      {/* One footer line: the timestamps at the left, the outbound link at the
          right — beside the facts it opens, not orphaned above the numbers.
          AC-026: each video links to its own live post, shown as a link the
          brand chooses to follow, never an embed — the URL is stored and
          displayed and nothing here fetches it (Tech Spec §6.3). `rel` keeps
          the destination from getting a handle on the opener. Each timestamp
          is omitted rather than placeholdered when absent — a video with no
          metrics already says `Metrics pending` four times above. */}
      {video.submittedAt || updated || video.tiktokUrl ? (
        <p className="bd-vpnote bd-vpstamps">
          {video.submittedAt ? (
            <span>
              {SUBMITTED_LABEL} {formatDeadlineUtc(video.submittedAt)}
            </span>
          ) : null}
          {updated ? <span>{updated}</span> : null}
          {video.tiktokUrl ? (
            <a
              href={video.tiktokUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={cn('bd-vplink', textLinkFeedback)}
            >
              {VIEW_POST_LABEL}
              <ArrowSquareOut size={14} weight="regular" aria-hidden />
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function DealCard({ deal }: { deal: CampaignDealGroup }) {
  return (
    <article className="bd-vpcard">
      <div className="bd-vpcardhead">
        {/* Into the deal's own review screen (KAN-68), which re-checks
            ownership in its own `where` rather than trusting this href. */}
        <Link
          href={`/deals/${deal.dealId}`}
          className={cn('bd-vphandle', textLinkFeedback)}
        >
          {deal.creatorHandle}
        </Link>
        {/* The shared vocabulary from `lib/deals/groups.ts`, so this list
            and the deal screen cannot call one state two things. */}
        <span
          className={cn(
            'bd-capstatus',
            DEAL_TONE[deal.status] ?? 'bd-capstatus--draft'
          )}
        >
          {labelForStatus(deal.status)}
        </span>
        {/* The explicit way in — the handle link above stays, but a card
            this size earns a visible affordance (same grammar as the deals
            inbox cards). */}
        <Link href={`/deals/${deal.dealId}`} className="bd-vpgo">
          Open deal{' '}
          <span className="bd-dicardarrow" aria-hidden="true">
            →
          </span>
        </Link>
      </div>
      <p className="bd-vpterms">
        {/* AC-026's "tier price paid": the rate and what it came to. Both,
            not just the total — the rate is the tier's price snapshotted onto
            the deal at offer time (invariant 8), and it is the figure a brand
            compares between creators. Stated **once per deal**: printing it
            over each of three videos would show three times the money the
            campaign owes (F38). */}
        <span className="bd-mono">
          {formatEtb(deal.unitPrice)} × {deal.videoCount} ={' '}
          <b>{formatEtb(deal.totalPrice)}</b>
        </span>
        {/* How much of what was ordered has arrived. The reason a deal can
            show two sets of counts and no approval yet. */}
        <span className="bd-factdim">
          {deliveryProgress(deal.videos.length, deal.videoCount)}
        </span>
      </p>

      {deal.videos.length === 0 ? (
        <p className="bd-vpawaiting">{AWAITING_DELIVERY_LABEL}</p>
      ) : (
        <div className="bd-vpvideos">
          {deal.videos.map((video, index) => (
            <div key={video.deliverableId} className="bd-vpvideoslot">
              {/* Numbered only where the number distinguishes something. A
                  one-video deal has nothing to disambiguate, and "Video 1"
                  over a single set of counts is noise. */}
              {deal.videoCount > 1 ? <h4>{videoHeading(index)}</h4> : null}
              <VideoMetrics video={video} />
            </div>
          ))}
        </div>
      )}
    </article>
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
    <section className="bd-vpsection">
      <div className="bd-capruler">
        <span className="bd-caprulertitle">{PERFORMANCE_TITLE}</span>
        <span className="bd-caprulerline" aria-hidden="true" />
        <span className="bd-caprulernote">
          Per-video engagement, one card per deal
        </span>
      </div>

      {deals.length === 0 ? (
        <div className="bd-emptyfeed">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="5" width="16" height="14" rx="2.5" />
            <path d="m10 9.5 5 2.5-5 2.5v-5Z" />
          </svg>
          <h3>{NO_VIDEOS_TITLE}</h3>
          <p>{NO_VIDEOS_DESCRIPTION}</p>
        </div>
      ) : (
        <>
          <ul className="bd-vplist">
            {deals.map((deal) => (
              <li key={deal.dealId}>
                <DealCard deal={deal} />
              </li>
            ))}
          </ul>

          {/* AC-026's "plus a campaign total". Its own card rather than a row in
              the list, because it is a different kind of thing and a brand should
              not have to work out which card is the sum. */}
          <section className="bd-vptotal">
            <h3>{CAMPAIGN_TOTAL_LABEL}</h3>
            <dl className="bd-vpmetrics">
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
            <p className="bd-vpnote">
              {coverageNote(totals.measuredVideos, totals.totalVideos)}
            </p>
          </section>
        </>
      )}
    </section>
  );
}
