import { formatEtb } from '@/lib/money';
import type { PayoutPoint } from '@/lib/creators/payout-series';

/**
 * Creator-side data visuals (v4 creator identity pass).
 *
 * Deliberately not the brand dashboard's vocabulary: no bubble swarm, no
 * smooth spend curve. The creator's graphs are built around their mental
 * model — "my videos are a showreel, every approved video is a step up":
 *
 *  - `ShowreelChart` — one rounded bar per delivered video, dashed ghosts
 *    for videos still awaiting metrics.
 *  - `EarningsSteps` — cumulative payouts drawn as a staircase (step-after),
 *    a dot on every step where money landed.
 *  - `ApprovalRing` — first-pass approval rate as a ring gauge.
 *
 * All three are server-rendered SVG: no hooks, no client bundle. Hover
 * detail rides on native `<title>` tooltips; entrance motion is pure CSS
 * (`bd-crx-*` classes in globals.css) behind `prefers-reduced-motion`.
 */

export interface ReelVideo {
  id: string;
  name: string;
  views: number | null;
  likes: number | null;
  when: string;
  /** Deep link to the TikTok video; the whole bar column is the anchor. */
  url: string;
  /** Stored thumbnail; shown inside the hover tooltip when present. */
  thumb: string | null;
  /** True while the brand has not yet approved the video. */
  inReview: boolean;
}

function compact(value: number | null): string {
  if (value === null) return '—';
  return Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value);
}

const REEL_W = 1160;
const REEL_H = 158;
const REEL_BASE = 116;
const REEL_TOP = 26;

/**
 * Themed hover tooltip, drawn inside the SVG so it needs no client JS.
 * Rendered inside a `.bd-crx-spot` group after the chart marks so it always
 * paints on top; CSS reveals it on hover. `k` scales the box for charts
 * whose viewBox renders smaller than 1:1.
 */
function ChartTip({
  cx,
  top,
  lines,
  chartW,
  k = 1,
  img = null,
}: {
  cx: number;
  top: number;
  lines: string[];
  chartW: number;
  k?: number;
  /** Optional thumbnail drawn on the tooltip's left edge. */
  img?: string | null;
}) {
  const imgW = img ? 38 * k : 0;
  const imgGap = img ? 9 * k : 0;
  const w =
    Math.max(...lines.map((l) => l.length)) * 6.1 * k + 20 * k + imgW + imgGap;
  const h = Math.max(
    (lines.length * 14 + 12) * k,
    img ? (14 + 38 * (16 / 9)) * k : 0
  );
  const x = Math.min(Math.max(cx - w / 2, 6), Math.max(chartW - w - 6, 6));
  const above = top - h - 9 * k;
  const y = above < 4 ? top + 12 * k : above;
  return (
    <g className="bd-crx-tip" aria-hidden="true">
      <rect
        className="bd-crx-tipbox"
        x={x}
        y={y}
        width={w}
        height={h}
        rx={9 * k}
      />
      {img ? (
        <image
          href={img}
          x={x + 7 * k}
          y={y + 7 * k}
          width={imgW}
          height={h - 14 * k}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : null}
      {lines.map((line, i) => (
        <text
          key={`${i}-${line}`}
          className={i === 0 ? 'bd-crx-tiplead' : 'bd-crx-tiptext'}
          x={x + 10 * k + imgW + imgGap}
          y={y + (17 + i * 14) * k}
          style={{ fontSize: (i === 0 ? 10.5 : 9.5) * k }}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

export function ShowreelChart({ videos }: { videos: ReelVideo[] }) {
  const n = videos.length;
  if (n === 0) return null;

  const max = Math.max(...videos.map((v) => v.views ?? 0), 1);
  const slot = (REEL_W - 48) / n;
  const barW = Math.min(76, Math.max(30, slot - 40));
  const span = REEL_BASE - REEL_TOP;

  return (
    <svg
      className="bd-crx-reelsvg"
      viewBox={`0 0 ${REEL_W} ${REEL_H}`}
      role="img"
      aria-label={`Showreel: ${n} delivered videos ranked by views`}
    >
      <line
        className="bd-crx-axis"
        x1="24"
        x2={REEL_W - 24}
        y1={REEL_BASE}
        y2={REEL_BASE}
      />
      <line
        className="bd-crx-grid"
        x1="24"
        x2={REEL_W - 24}
        y1={REEL_TOP + span / 2}
        y2={REEL_TOP + span / 2}
      />
      {videos.map((video, i) => {
        const x = 24 + i * slot + (slot - barW) / 2;
        const measured = video.views !== null;
        const h = measured
          ? Math.max(10, ((video.views ?? 0) / max) * span)
          : span * 0.36;
        const y = REEL_BASE - h;
        return (
          <g
            key={video.id}
            className="bd-crx-bar"
            style={{ '--i': i } as React.CSSProperties}
          >
            <rect
              className={
                measured ? 'bd-crx-barfill' : 'bd-crx-barfill bd-crx-barghost'
              }
              x={x}
              y={y}
              width={barW}
              height={h}
              rx="9"
            />
            <text className="bd-crx-barval" x={x + barW / 2} y={y - 9}>
              {measured ? compact(video.views) : '—'}
            </text>
            <text className="bd-crx-baridx" x={x + barW / 2} y={REEL_BASE + 17}>
              {String(i + 1).padStart(2, '0')}
            </text>
            <text
              className="bd-crx-barname"
              x={x + barW / 2}
              y={REEL_BASE + 32}
            >
              {video.name.length > 12
                ? `${video.name.slice(0, 11)}…`
                : video.name}
            </text>
          </g>
        );
      })}
      {/* hover spots painted last so tooltips ride above every bar */}
      {videos.map((video, i) => {
        const xh = 24 + i * slot;
        const measured = video.views !== null;
        const h = measured
          ? Math.max(10, ((video.views ?? 0) / max) * span)
          : span * 0.36;
        return (
          <a
            key={`spot-${video.id}`}
            className="bd-crx-spot"
            href={video.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            aria-label={`Open ${video.name} on TikTok`}
          >
            <rect
              className="bd-crx-hit"
              x={xh}
              y={REEL_TOP - 22}
              width={slot}
              height={REEL_BASE + 34 - (REEL_TOP - 22)}
            />
            <ChartTip
              cx={xh + slot / 2}
              top={REEL_BASE - h}
              chartW={REEL_W}
              img={video.thumb}
              lines={(measured
                ? [
                    video.name,
                    `${compact(video.views)} views · ${compact(video.likes)} likes`,
                    video.when,
                  ]
                : [video.name, 'metrics pending', video.when]
              ).concat(video.inReview ? ['still in brand review'] : [])}
            />
          </a>
        );
      })}
    </svg>
  );
}

const STEP_W = 720;
const STEP_H = 150;
const STEP_PAD = { top: 14, right: 16, bottom: 24, left: 16 };

export function EarningsSteps({ points }: { points: PayoutPoint[] }) {
  const n = points.length;
  if (n === 0) return null;

  const max = Math.max(...points.map((p) => p.paidOut), 1);
  const innerW = STEP_W - STEP_PAD.left - STEP_PAD.right;
  const innerH = STEP_H - STEP_PAD.top - STEP_PAD.bottom;
  const baseline = STEP_PAD.top + innerH;
  const x = (i: number) =>
    STEP_PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => STEP_PAD.top + innerH - (v / max) * innerH;

  // Step-after staircase: hold each week's value, rise at the next payout.
  let line = `M ${x(0).toFixed(1)} ${y(points[0].paidOut).toFixed(1)}`;
  for (let i = 1; i < n; i += 1) {
    line += ` H ${x(i).toFixed(1)} V ${y(points[i].paidOut).toFixed(1)}`;
  }
  const area = `${line} L ${x(n - 1).toFixed(1)} ${baseline} L ${x(0).toFixed(1)} ${baseline} Z`;

  return (
    <svg
      className="bd-crx-stepsvg"
      viewBox={`0 0 ${STEP_W} ${STEP_H}`}
      role="img"
      aria-label="Cumulative payouts over the last twelve weeks, drawn as steps"
    >
      <line
        className="bd-crx-axis"
        x1={STEP_PAD.left}
        x2={STEP_W - STEP_PAD.right}
        y1={baseline}
        y2={baseline}
      />
      <line
        className="bd-crx-grid"
        x1={STEP_PAD.left}
        x2={STEP_W - STEP_PAD.right}
        y1={STEP_PAD.top + innerH / 2}
        y2={STEP_PAD.top + innerH / 2}
      />
      <path className="bd-crx-steparea" d={area} />
      <path className="bd-crx-stepline" d={line} pathLength={1} />
      {points.map((point, i) => {
        const rose =
          i === 0 ? point.paidOut > 0 : point.paidOut > points[i - 1].paidOut;
        if (!rose) return null;
        return (
          <circle
            key={point.weekStart}
            className="bd-crx-stepdot"
            style={{ '--i': i } as React.CSSProperties}
            cx={x(i)}
            cy={y(point.paidOut)}
            r="4.5"
          />
        );
      })}
      {points.map((point, i) => {
        const rose =
          i === 0 ? point.paidOut > 0 : point.paidOut > points[i - 1].paidOut;
        if (!rose) return null;
        return (
          <g key={`spot-${point.weekStart}`} className="bd-crx-spot">
            <circle
              className="bd-crx-hit"
              cx={x(i)}
              cy={y(point.paidOut)}
              r="16"
            />
            <ChartTip
              cx={x(i)}
              top={y(point.paidOut) - 5}
              chartW={STEP_W}
              k={1.35}
              lines={[point.label, `${formatEtb(point.paidOut)} total`]}
            />
          </g>
        );
      })}
      <text className="bd-crx-steplab" x={STEP_PAD.left} y={STEP_H - 6}>
        {points[0].label}
      </text>
      <text
        className="bd-crx-steplab bd-crx-steplab--end"
        x={STEP_W - STEP_PAD.right}
        y={STEP_H - 6}
      >
        {points[n - 1].label}
      </text>
    </svg>
  );
}

const RING_SIZE = 104;
const RING_R = 41;
const RING_C = 2 * Math.PI * RING_R;

const FLOW_W = 320;
const FLOW_H = 58;

/**
 * The queue's embedded funnel — one slab per stage, height proportional to
 * how much work sits there, with a dashed step line tracing the drop.
 * Decorative texture for the dark queue card; the ladder below carries the
 * numbers and links.
 */
export function QueueFlow({
  counts,
  hot = -1,
}: {
  counts: number[];
  hot?: number;
}) {
  const n = counts.length;
  if (n === 0) return null;

  const max = Math.max(...counts, 1);
  const slot = FLOW_W / n;
  const barW = Math.min(58, slot - 14);
  const base = FLOW_H - 5;
  const span = base - 10;

  const tops = counts.map((count, i) => ({
    cx: i * slot + slot / 2,
    y: base - (count > 0 ? Math.max(6, (count / max) * span) : 3),
  }));
  let line = `M ${(tops[0].cx - barW / 2).toFixed(1)} ${tops[0].y.toFixed(1)} H ${(tops[0].cx + barW / 2).toFixed(1)}`;
  for (let i = 1; i < n; i += 1) {
    line += ` L ${(tops[i].cx - barW / 2).toFixed(1)} ${tops[i].y.toFixed(1)} H ${(tops[i].cx + barW / 2).toFixed(1)}`;
  }

  return (
    <svg
      className="bd-crx-flowsvg"
      viewBox={`0 0 ${FLOW_W} ${FLOW_H}`}
      aria-hidden="true"
    >
      <line
        className="bd-crx-flowaxis"
        x1="2"
        x2={FLOW_W - 2}
        y1={base}
        y2={base}
      />
      {counts.map((count, i) => {
        const h = base - tops[i].y;
        return (
          <rect
            key={i}
            className={
              i === hot
                ? 'bd-crx-flowbar bd-crx-flowbar--hot'
                : 'bd-crx-flowbar'
            }
            style={{ '--i': i } as React.CSSProperties}
            x={tops[i].cx - barW / 2}
            y={tops[i].y}
            width={barW}
            height={h}
            rx="4"
          />
        );
      })}
      <path className="bd-crx-flowline" d={line} />
    </svg>
  );
}

export function ApprovalRing({ rate }: { rate: number | null }) {
  const pct = rate === null ? null : Math.round(rate * 100);
  const offset = RING_C * (1 - (pct ?? 0) / 100);

  return (
    <svg
      className="bd-crx-ringsvg"
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      role="img"
      aria-label={
        pct === null
          ? 'First-pass approval rate: no reviews yet'
          : `First-pass approval rate: ${pct} percent`
      }
    >
      <title>
        {pct === null
          ? 'Appears after your first review'
          : `${pct}% of your videos approved without changes`}
      </title>
      <circle
        className="bd-crx-ringtrack"
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_R}
      />
      {pct !== null ? (
        <circle
          className="bd-crx-ringfill"
          style={
            {
              '--ring-c': RING_C,
              '--ring-off': offset,
            } as React.CSSProperties
          }
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_R}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      ) : (
        <circle
          className="bd-crx-ringghost"
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_R}
        />
      )}
      <text className="bd-crx-ringval" x={RING_SIZE / 2} y={RING_SIZE / 2 - 1}>
        {pct === null ? '—' : `${pct}%`}
      </text>
      <text className="bd-crx-ringlab" x={RING_SIZE / 2} y={RING_SIZE / 2 + 16}>
        first pass
      </text>
    </svg>
  );
}
