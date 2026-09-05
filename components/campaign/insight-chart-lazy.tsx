'use client';

import { Suspense, lazy, useSyncExternalStore } from 'react';
import type { InsightChartRow } from './insight-chart';

const Chart = lazy(() =>
  import('./insight-chart').then((m) => ({ default: m.InsightChart }))
);

interface InsightChartProps {
  rows: InsightChartRow[];
  primaryLabel: string;
  secondaryLabel?: string;
  unit: string;
}

/**
 * Client-side lazy wrapper for `InsightChart`, so recharts stays out of the
 * initial bundle. Unlike the d3 charts, `InsightChart` has no static skeleton
 * — its container height depends on the row count — so the fallback here is
 * the same sized, labelled container it renders, computed from the same
 * props. `next/dynamic`'s `loading` option cannot see props, hence
 * `lazy` + `Suspense` with a mounted guard standing in for `ssr: false`.
 */
const emptySubscribe = () => () => {};

export function InsightChart(props: InsightChartProps) {
  // False on the server and for hydration, true on the client afterwards —
  // the `ssr: false` equivalent, without an effect-driven re-render.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const { rows, primaryLabel, secondaryLabel } = props;
  // Keep in sync with the height formula in `insight-chart.tsx`.
  const height = Math.max(150, rows.length * (secondaryLabel ? 64 : 42) + 35);
  const fallback = (
    <div
      aria-label={`${primaryLabel}${secondaryLabel ? ` and ${secondaryLabel}` : ''}. Exact values follow.`}
      role="img"
      className="insight-visual min-w-0"
      style={{ height }}
    />
  );

  if (!mounted) return fallback;
  return (
    <Suspense fallback={fallback}>
      <Chart {...props} />
    </Suspense>
  );
}
