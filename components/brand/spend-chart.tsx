'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

/**
 * The 12-week spend line — a 1:1 port of the v4 mock's D3 block: monotone
 * curve over a soft gradient area, crosshair focus with a mono tooltip, and a
 * dash-draw-in on load (skipped under `prefers-reduced-motion`).
 *
 * Client-only leaf like `ReachBubbles`: DOM work stays inside the effect, the
 * server renders a matching aspect-ratio skeleton, and the effect swaps it —
 * no layout shift, no SSR hazards.
 */

export interface SpendPoint {
  /** Short week label, e.g. "15 Jun". */
  week: string;
  /** Cumulative spend in whole ETB. */
  value: number;
}

const BRAND = 'oklch(0.44 0.11 185)';
const LINE = 'oklch(0.92 0.004 220)';
const FAINT = 'oklch(0.52 0.01 220)';

const W = 860;
const H = 210;
const M = { t: 14, r: 12, b: 26, l: 12 };

export function SpendChart({ points }: { points: SpendPoint[] }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || points.length < 2) return;

    const reduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    const weeks = points.map((p) => p.week);
    const maxValue = Math.max(...points.map((p) => p.value), 1);

    host.querySelector('[data-skel]')?.remove();

    const tip = document.createElement('div');
    tip.className = 'bd-tip';
    host.appendChild(tip);

    const svg = d3
      .select(host)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img')
      .attr(
        'aria-label',
        `Cumulative spend over the last ${points.length} weeks, from ${weeks[0]} to ${weeks[weeks.length - 1]}`
      )
      .style('width', '100%')
      .style('height', 'auto');

    const x = d3.scalePoint(weeks, [M.l, W - M.r]);
    const y = d3.scaleLinear([0, maxValue], [H - M.b, M.t]);

    const grad = svg
      .append('defs')
      .append('linearGradient')
      .attr('id', 'bd-sg')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', 1);
    grad
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', BRAND)
      .attr('stop-opacity', 0.35);
    grad
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', BRAND)
      .attr('stop-opacity', 0);

    svg
      .append('line')
      .attr('x1', M.l)
      .attr('x2', W - M.r)
      .attr('y1', y(0))
      .attr('y2', y(0))
      .attr('stroke', LINE);
    svg
      .append('line')
      .attr('x1', M.l)
      .attr('x2', W - M.r)
      .attr('y1', y(maxValue / 2))
      .attr('y2', y(maxValue / 2))
      .attr('stroke', LINE)
      .attr('stroke-dasharray', '3 5');

    const area = d3
      .area<SpendPoint>()
      .x((d) => x(d.week) ?? 0)
      .y0(y(0))
      .y1((d) => y(d.value))
      .curve(d3.curveMonotoneX);
    const line = d3
      .line<SpendPoint>()
      .x((d) => x(d.week) ?? 0)
      .y((d) => y(d.value))
      .curve(d3.curveMonotoneX);

    svg
      .append('path')
      .datum(points)
      .attr('d', area)
      .attr('fill', 'url(#bd-sg)');
    const path = svg
      .append('path')
      .datum(points)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', BRAND)
      .attr('stroke-width', 3)
      .attr('stroke-linecap', 'round');

    if (!reduce) {
      const node = path.node();
      if (node) {
        const len = node.getTotalLength();
        path
          .attr('stroke-dasharray', len)
          .attr('stroke-dashoffset', len)
          .transition()
          .duration(1300)
          .ease(d3.easeCubicOut)
          .attr('stroke-dashoffset', 0);
      }
    }

    svg
      .append('text')
      .attr('x', M.l)
      .attr('y', H - 8)
      .attr('font-family', 'var(--font-bd-mono), monospace')
      .attr('font-size', 10)
      .attr('fill', FAINT)
      .text(weeks[0]);
    svg
      .append('text')
      .attr('x', W - M.r)
      .attr('y', H - 8)
      .attr('text-anchor', 'end')
      .attr('font-family', 'var(--font-bd-mono), monospace')
      .attr('font-size', 10)
      .attr('fill', FAINT)
      .text(weeks[weeks.length - 1]);

    const focus = svg.append('g').style('opacity', 0);
    focus
      .append('line')
      .attr('y1', M.t)
      .attr('y2', y(0))
      .attr('stroke', BRAND)
      .attr('stroke-opacity', 0.5);
    focus
      .append('circle')
      .attr('r', 5)
      .attr('fill', '#fff')
      .attr('stroke', BRAND)
      .attr('stroke-width', 2.5);

    const fmt = (n: number) => n.toLocaleString('en-US');
    svg
      .append('rect')
      .attr('x', M.l)
      .attr('y', M.t)
      .attr('width', W - M.l - M.r)
      .attr('height', H - M.t - M.b)
      .attr('fill', 'transparent')
      .on('mousemove', (ev: MouseEvent) => {
        const [mx] = d3.pointer(ev);
        const i = Math.max(
          0,
          Math.min(
            weeks.length - 1,
            Math.round((mx - M.l) / ((W - M.l - M.r) / (weeks.length - 1)))
          )
        );
        const d = points[i];
        const px = x(d.week) ?? 0;
        focus.style('opacity', 1);
        focus.select('line').attr('x1', px).attr('x2', px);
        focus.select('circle').attr('cx', px).attr('cy', y(d.value));
        const svgNode = svg.node();
        if (!svgNode) return;
        const hostRect = host.getBoundingClientRect();
        const svgRect = svgNode.getBoundingClientRect();
        tip.style.left = `${svgRect.left - hostRect.left + (px / W) * svgRect.width}px`;
        tip.style.top = `${svgRect.top - hostRect.top + (y(d.value) / H) * svgRect.height}px`;
        tip.style.opacity = '1';
        tip.innerHTML = `<small>${d.week}</small>${fmt(d.value)}.00 ETB`;
      })
      .on('mouseleave', () => {
        focus.style('opacity', 0);
        tip.style.opacity = '0';
      });

    return () => {
      svg.remove();
      tip.remove();
    };
  }, [points]);

  return (
    <div ref={hostRef} className="bd-viz" style={{ marginTop: 6 }}>
      <div
        data-skel
        className="bd-skel"
        style={{ aspectRatio: `${W} / ${H}` }}
        aria-hidden="true"
      />
    </div>
  );
}
