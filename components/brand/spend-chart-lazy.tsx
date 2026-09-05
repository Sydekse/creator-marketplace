'use client';

import dynamic from 'next/dynamic';

// Keep in sync with the viewBox constants in `spend-chart.tsx`.
const W = 860;
const H = 210;

/**
 * Client-side lazy wrapper for `SpendChart`, so the d3-* modules stay out of
 * the initial bundle. `ssr: false` must be requested from a client component
 * in the App Router, hence this thin file. The loading fallback is a copy of
 * the exact skeleton the component itself paints before its effect runs, so
 * there is zero visual change while the chunk loads.
 */
export const SpendChart = dynamic(
  () => import('./spend-chart').then((m) => m.SpendChart),
  {
    ssr: false,
    loading: () => (
      <div className="bd-viz" style={{ marginTop: 6 }}>
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
