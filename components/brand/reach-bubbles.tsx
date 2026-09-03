'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

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

interface Node extends d3.SimulationNodeDatum {
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

    const campaigns: string[] = [];
    const campaignIndex = new Map<string, number>();
    for (const v of videos) {
      if (!campaignIndex.has(v.campaignId)) {
        campaignIndex.set(v.campaignId, campaigns.length);
        campaigns.push(v.campaignName);
      }
    }

    const centers = campaigns.map((_, i) => ({
      x: (W / campaigns.length) * (i + 0.5),
      y: (H - LABEL_BAND) / 2 + 4,
    }));

    // Unmeasured bubbles are sized at their campaign's average of measured
    // views (mock's `est`), falling back to the global average.
    const measured = videos.filter((v) => v.views !== null);
    const globalAvg =
      measured.length > 0
        ? measured.reduce((s, v) => s + (v.views ?? 0), 0) / measured.length
        : 1000;
    const campaignAvg = new Map<string, number>();
    for (const [cid] of campaignIndex) {
      const own = measured.filter((v) => v.campaignId === cid);
      campaignAvg.set(
        cid,
        own.length > 0
          ? own.reduce((s, v) => s + (v.views ?? 0), 0) / own.length
          : globalAvg
      );
    }

    const maxViews = Math.max(19000, ...measured.map((v) => v.views ?? 0));
    const size = d3.scaleSqrt([0, maxViews], [0, 32]);
    const tone = d3.scaleLinear([0, maxViews], [0.45, 1]);

    // Deterministic jitter (index-seeded) instead of Math.random(): the same
    // data always settles into the same swarm, render after render.
    const nodes: Node[] = videos.map((v, i) => {
      const c = campaignIndex.get(v.campaignId) ?? 0;
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

    const sim = d3
      .forceSimulation(nodes)
      .force('x', d3.forceX<Node>((d) => centers[d.c].x).strength(0.14))
      .force('y', d3.forceY<Node>((d) => centers[d.c].y).strength(0.12))
      .force(
        'collide',
        d3.forceCollide<Node>((d) => d.r + 2.5)
      )
      .stop();
    for (let i = 0; i < 260; i += 1) sim.tick();

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

    campaigns.forEach((name, i) => {
      const own = videos.filter((v) => campaignIndex.get(v.campaignId) === i);
      const withViews = own.filter((v) => v.views !== null).length;
      svg
        .append('text')
        .attr('x', centers[i].x)
        .attr('y', H - 16)
        .attr('text-anchor', 'middle')
        .attr('font-family', 'var(--font-bd-sans), Outfit, sans-serif')
        .attr('font-size', 11.5)
        .attr('font-weight', 600)
        .attr('fill', INK)
        .text(name.split(' ')[0]);
      svg
        .append('text')
        .attr('x', centers[i].x)
        .attr('y', H - 3)
        .attr('text-anchor', 'middle')
        .attr('font-family', 'var(--font-bd-mono), monospace')
        .attr('font-size', 9)
        .attr('fill', FAINT)
        .text(`${withViews}/${own.length} with views`);
    });

    const dots = svg
      .selectAll('circle.v')
      .data(nodes)
      .join('circle')
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('fill', (d) => (d.video.views === null ? 'url(#bd-hatch)' : BRAND))
      .attr('fill-opacity', (d) => (d.video.views === null ? 1 : tone(d.sized)))
      .attr('stroke', (d) => (d.video.views === null ? BRAND : 'white'))
      .attr('stroke-dasharray', (d) => (d.video.views === null ? '3 3' : null))
      .attr('stroke-width', (d) => (d.video.views === null ? 1.2 : 1.5))
      .style('cursor', 'default');

    if (reduce) {
      dots.attr('r', (d) => d.r);
    } else {
      dots
        .attr('r', 0)
        .transition()
        .duration(700)
        .delay((_, i) => 250 + i * 45)
        .ease(d3.easeBackOut.overshoot(1.4))
        .attr('r', (d) => d.r);
    }

    const svgNode = svg.node();
    const fmt = (n: number) => n.toLocaleString('en-US');
    dots
      .on('mousemove', function (_ev, d) {
        dots
          .transition()
          .duration(120)
          .attr('fill-opacity', (o) =>
            o === d ? 1 : o.video.views === null ? 0.4 : tone(o.sized) * 0.35
          );
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
          .transition()
          .duration(120)
          .attr('fill-opacity', (o) =>
            o.video.views === null ? 1 : tone(o.sized)
          );
        tip.style.opacity = '0';
      });

    return () => {
      sim.stop();
      svg.remove();
      tip.remove();
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
