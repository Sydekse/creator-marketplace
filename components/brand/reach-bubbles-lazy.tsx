'use client';

import dynamic from 'next/dynamic';

// Keep in sync with the viewBox constants in `reach-bubbles.tsx`.
const W = 680;
const H = 252;

/**
 * Client-side lazy wrapper for `ReachBubbles`, so the d3-* modules stay out of
 * the initial bundle. `ssr: false` must be requested from a client component
 * in the App Router, hence this thin file. The loading fallback is a copy of
 * the exact skeleton the component itself paints before its effect runs, so
 * there is zero visual change while the chunk loads.
 */
export const ReachBubbles = dynamic(
  () => import('./reach-bubbles').then((m) => m.ReachBubbles),
  {
    ssr: false,
    loading: () => (
      <div className="bd-viz">
        <div
          data-skel
          className="bd-skel"
          style={{ aspectRatio: `${W} / ${H}` }}
          aria-hidden="true"
        />
      </div>
    ),
  }
);
