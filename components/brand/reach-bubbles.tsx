'use client';

import { useEffect, useRef } from 'react';
import { easeBackOut } from 'd3-ease';
import {
  forceCollide,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from 'd3-force';
import { scaleLinear, scaleSqrt } from 'd3-scale';
import { select } from 'd3-selection';
// Side-effect import: patches `.transition()` onto d3 selections.
import 'd3-transition';
import {
  settleReachSimulation,
  summarizeReachVideos,
} from './reach-bubbles-layout';

/**
 * The reach bubble swarm — a 1:1 port of the v4 mock's D3 block. One bubble
 * per ordered video, force-clustered by campaign; dashed hatch means "no view
 * data yet" (AC-027's null discipline made visible), sized at the campaign
 * average so the swarm's shape stays honest about what it knows.
 *
 * Client-only leaf: the force simulation, transitions, and tooltip all need
 * the DOM, so everything runs inside the effect — nothing touches `document`
 * at module scope (SSR-safe on Vercel). The server renders the aspect-ratio
 * skeleton in place; the effect swaps it for the chart, so nothing shifts.
 */

export interface ReachVideo {
  deliverableId: string;
  campaignId: string;
  campaignName: string;
  creatorHandle: string;
  views: number | null;
  likes: number | null;
  shares: number | null;
  comments: number | null;
  /** Preformatted "2 days ago"-style label, built server-side. */
  when: string | null;
}

const BRAND = 'oklch(0.44 0.11 185)';
const LINE = 'oklch(0.92 0.004 220)';
const FAINT = 'oklch(0.52 0.01 220)';
const INK = 'oklch(0.22 0.005 220)';

const W = 680;
const H = 252;
const LABEL_BAND = 30;

interface Node extends SimulationNodeDatum {
  c: number;
  r: number;
  video: ReachVideo;
  sized: number;
  x: number;
  y: number;
}

export function ReachBubbles({ videos }: { videos: ReachVideo[] }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || videos.length === 0) return;

    const reduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    const {
      campaigns: campaignStats,
      globalAvg,
      maxViews,
    } = summarizeReachVideos(videos);
    const campaigns = Array.from(campaignStats.values());

    const centers = campaigns.map((_, i) => ({
      x: (W / campaigns.length) * (i + 0.5),
      y: (H - LABEL_BAND) / 2 + 4,
    }));

    // Unmeasured bubbles are sized at their campaign's average of measured
    // views (mock's `est`), falling back to the global average.
    const campaignAvg = new Map<string, number>();
    for (const [cid, stats] of campaignStats) {
      campaignAvg.set(
        cid,
        stats.measured > 0 ? stats.views / stats.measured : globalAvg
      );
    }

    const size = scaleSqrt([0, maxViews], [0, 32]);
    const tone = scaleLinear([0, maxViews], [0.45, 1]);

    // Deterministic jitter (index-seeded) instead of Math.random(): the same
    // data always settles into the same swarm, render after render.
    const nodes: Node[] = videos.map((v, i) => {
      const c = campaignStats.get(v.campaignId)?.index ?? 0;
      const sized = v.views ?? campaignAvg.get(v.campaignId) ?? globalAvg;
      return {
        c,
        video: v,
        sized,
        r: size(sized),
        x: centers[c].x + (((i * 37) % 30) - 15),
        y: centers[c].y + (((i * 53) % 30) - 15),
      };
    });

    const sim = forceSimulation(nodes)
      .force('x', forceX<Node>((d) => centers[d.c].x).strength(0.14))
      .force('y', forceY<Node>((d) => centers[d.c].y).strength(0.12))
      .force(
        'collide',
        forceCollide<Node>((d) => d.r + 2.5)
      )
      .stop();
    const skeleton = host.querySelector<HTMLElement>('[data-skel]');
    let disposeChart: (() => void) | undefined;
    const cancelLayout = settleReachSimulation(sim, () => {
      if (skeleton) skeleton.hidden = true;

      const tip = document.createElement('div');
      tip.className = 'bd-tip';
      host.appendChild(tip);

      const svg = select(host)
        .append('svg')
        .attr('viewBox', `0 0 ${W} ${H}`)
        .attr('role', 'img')
        .attr(
          'aria-label',
          `Reach by video: ${videos.length} ordered videos grouped by campaign, bubble size proportional to views`
        )
        .style('width', '100%')
        .style('height', 'auto');

      const pat = svg
        .append('defs')
        .append('pattern')
        .attr('id', 'bd-hatch')
        .attr('width', 6)
        .attr('height', 6)
        .attr('patternTransform', 'rotate(45)')
        .attr('patternUnits', 'userSpaceOnUse');
      pat
        .append('rect')
        .attr('width', 6)
        .attr('height', 6)
        .attr('fill', 'oklch(0.96 0.02 185)');
      pat
        .append('line')
        .attr('y2', 6)
        .attr('stroke', BRAND)
        .attr('stroke-opacity', 0.4)
        .attr('stroke-width', 1.5);

      campaigns.forEach((campaign, i) => {
        svg
          .append('text')
          .attr('x', centers[i].x)
          .attr('y', H - 16)
          .attr('text-anchor', 'middle')
          .attr('font-family', 'var(--font-bd-sans), Outfit, sans-serif')
          .attr('font-size', 11.5)
          .attr('font-weight', 600)
          .attr('fill', INK)
          .text(campaign.name.split(' ')[0]);
        svg
          .append('text')
          .attr('x', centers[i].x)
          .attr('y', H - 3)
          .attr('text-anchor', 'middle')
          .attr('font-family', 'var(--font-bd-mono), monospace')
          .attr('font-size', 9)
          .attr('fill', FAINT)
          .text(`${campaign.measured}/${campaign.total} with views`);
      });

      const dots = svg
        .selectAll('circle.v')
        .data(nodes)
        .join('circle')
        .attr('cx', (d) => d.x)
        .attr('cy', (d) => d.y)
        .attr('fill', (d) =>
          d.video.views === null ? 'url(#bd-hatch)' : BRAND
        )
        .attr('fill-opacity', (d) =>
          d.video.views === null ? 1 : tone(d.sized)
        )
        .attr('stroke', (d) => (d.video.views === null ? BRAND : 'white'))
        .attr('stroke-dasharray', (d) =>
          d.video.views === null ? '3 3' : null
        )
        .attr('stroke-width', (d) => (d.video.views === null ? 1.2 : 1.5))
        .style('cursor', 'default');

      if (reduce) {
        dots.attr('r', (d) => d.r);
      } else {
        dots
          .attr('r', 0)
          .transition('entrance')
          .duration(700)
          .delay((_, i) => 250 + i * 45)
          .ease(easeBackOut.overshoot(1.4))
          .attr('r', (d) => d.r);
      }

      const svgNode = svg.node();
      const fmt = (n: number) => n.toLocaleString('en-US');
      dots
        .on('mouseenter', function (_ev, d) {
          dots
            .transition('hover')
            .duration(120)
            .attr('fill-opacity', (o) =>
              o === d ? 1 : o.video.views === null ? 0.4 : tone(o.sized) * 0.35
            );
        })
        .on('mousemove', function (_ev, d) {
          if (!svgNode) return;
          const hostRect = host.getBoundingClientRect();
          const svgRect = svgNode.getBoundingClientRect();
          tip.style.left = `${svgRect.left - hostRect.left + (d.x / W) * svgRect.width}px`;
          tip.style.top = `${svgRect.top - hostRect.top + ((d.y - d.r) / H) * svgRect.height}px`;
          tip.style.opacity = '1';
          const v = d.video;
          tip.innerHTML =
            v.views === null
              ? `<small>${v.campaignName} · ${v.creatorHandle}</small>view data pending · sized at campaign avg`
              : `<small>${v.campaignName} · ${v.creatorHandle}${v.when ? ` · ${v.when}` : ''}</small>${fmt(v.views)} views<br>${fmt(v.likes ?? 0)} likes · ${fmt(v.shares ?? 0)} shares · ${fmt(v.comments ?? 0)} comments`;
        })
        .on('mouseleave', () => {
          dots
            .transition('hover')
            .duration(120)
            .attr('fill-opacity', (o) =>
              o.video.views === null ? 1 : tone(o.sized)
            );
          tip.style.opacity = '0';
        });

      disposeChart = () => {
        dots.interrupt('entrance').interrupt('hover');
        svg.remove();
        tip.remove();
      };
    });

    return () => {
      cancelLayout();
      disposeChart?.();
      if (skeleton) skeleton.hidden = false;
    };
  }, [videos]);

  return (
    <div ref={hostRef} className="bd-viz">
      <div
        data-skel
        className="bd-skel"
        style={{ aspectRatio: `${W} / ${H}` }}
        aria-hidden="true"
      />
    </div>
  );
}

export { LINE as REACH_LINE_COLOR };
