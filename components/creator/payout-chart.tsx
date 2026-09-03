'use client';

import { useId, useMemo, useState } from 'react';
import { SectionLabel } from '@/components/layout/section-label';
import type { PayoutPoint } from '@/lib/creators/payout-series';
import { formatEtb } from '@/lib/money';

const WIDTH = 720;
const HEIGHT = 260;
const PAD = { top: 16, right: 8, bottom: 32, left: 8 };

function smoothPath(
  coords: Array<{ x: number; y: number }>,
  closeY?: number
): string {
  if (coords.length === 0) return '';
  if (coords.length === 1) {
    const only = coords[0];
    if (closeY === undefined) return `M ${only.x} ${only.y}`;
    return `M ${only.x} ${closeY} L ${only.x} ${only.y} L ${only.x} ${closeY} Z`;
  }

  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i === 0 ? i : i - 1];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    // Clamp the control points to the segment's own vertical range. Catmull-Rom
    // tangents overshoot a steep final rise, which pushed the curve above the
    // top padding and clipped the stroke at the viewBox edge.
    const yMin = Math.min(p1.y, p2.y);
    const yMax = Math.max(p1.y, p2.y);
    const cp1y = Math.min(yMax, Math.max(yMin, p1.y + (p2.y - p0.y) / 6));
    const cp2y = Math.min(yMax, Math.max(yMin, p2.y - (p3.y - p1.y) / 6));
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  if (closeY !== undefined) {
    const last = coords[coords.length - 1];
    const first = coords[0];
    d += ` L ${last.x.toFixed(1)} ${closeY} L ${first.x.toFixed(1)} ${closeY} Z`;
  }
  return d;
}

export function PayoutChart({
  points,
  label = 'Payouts',
  note = 'Last 12 weeks · net',
  minHeight = '13rem',
}: {
  points: PayoutPoint[];
  label?: React.ReactNode;
  note?: React.ReactNode;
  /**
   * The chart area's floor height — the payout card's size knob. The card
   * above passes it so the whole money block is tuned from one place.
   */
  minHeight?: string;
}) {
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(0, ...points.map((point) => point.paidOut));
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const baseline = PAD.top + innerH;

  const coords = useMemo(
    () =>
      points.map((point, index) => {
        const x =
          PAD.left +
          (points.length <= 1
            ? innerW / 2
            : (index / (points.length - 1)) * innerW);
        const y =
          PAD.top + innerH - (max === 0 ? 0 : (point.paidOut / max) * innerH);
        return { x, y, point };
      }),
    [innerH, innerW, max, points]
  );

  const line = useMemo(() => smoothPath(coords), [coords]);
  const area = useMemo(() => smoothPath(coords, baseline), [baseline, coords]);
  const hover = active === null ? null : coords[active];
  const focus = hover ?? coords[coords.length - 1];

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel>{label}</SectionLabel>
        <p className="inline-flex w-fit rounded-full bg-neutral-50 px-3 py-1 font-mono text-[11px] font-medium tracking-wide text-neutral-700 uppercase shadow-[0_0_0_2px_rgba(23,23,23,0.1)]">
          {note}
        </p>
      </div>

      <div
        className="relative shrink-0"
        style={{ height: minHeight }}
        onMouseLeave={() => setActive(null)}
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label="Cumulative payouts over the last twelve weeks"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.42" />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={baseline}
            y2={baseline}
            className="stroke-neutral-200"
            strokeWidth="1"
          />
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={PAD.top + innerH / 2}
            y2={PAD.top + innerH / 2}
            className="stroke-neutral-200/80"
            strokeWidth="1"
            strokeDasharray="3 5"
          />

          {area ? <path d={area} fill={`url(#${gradientId})`} /> : null}
          {line ? (
            <path
              d={line}
              fill="none"
              className="payout-stroke stroke-brand"
              strokeWidth="3.25"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}

          {focus ? (
            <g>
              <line
                x1={focus.x}
                x2={focus.x}
                y1={PAD.top}
                y2={baseline}
                className="stroke-brand/55"
                strokeWidth="1"
              />
              <circle
                cx={focus.x}
                cy={focus.y}
                r="5"
                className="fill-neutral-50 stroke-brand"
                strokeWidth="2.5"
              />
            </g>
          ) : null}

          {coords.map((c, index) => (
            <rect
              key={`${c.point.weekStart}-hit`}
              x={c.x - innerW / Math.max(points.length, 1) / 2}
              y={PAD.top}
              width={innerW / Math.max(points.length, 1)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setActive(index)}
            />
          ))}

          {points.map((point, index) =>
            index === 0 || index === points.length - 1 ? (
              <text
                key={`${point.weekStart}-label`}
                x={coords[index].x}
                y={HEIGHT - 8}
                textAnchor={index === 0 ? 'start' : 'end'}
                className="fill-neutral-600 font-mono text-[10px]"
              >
                {point.label}
              </text>
            ) : null
          )}
        </svg>
      </div>

      <p className="font-mono text-sm font-medium text-brand-ink tabular-nums">
        {focus
          ? `${focus.point.label} · ${formatEtb(focus.point.paidOut)}`
          : 'No payouts yet'}
      </p>
    </div>
  );
}
