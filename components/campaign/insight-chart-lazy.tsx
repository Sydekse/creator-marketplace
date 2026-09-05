'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { InsightChart as ChartComponent } from './insight-chart';

const Chart = dynamic(
  () => import('./insight-chart').then((m) => m.InsightChart),
  { ssr: false }
);

export function InsightChart(
  props: Omit<ComponentProps<typeof ChartComponent>, 'height'>
) {
  const { rows, primaryLabel, secondaryLabel } = props;
  const height = Math.max(150, rows.length * (secondaryLabel ? 64 : 42) + 35);
  // Recharts initially paints no chart. Keep its sized, labelled frame visible
  // while the chunk loads, without a separate hydration state.
  return (
    <div
      aria-label={`${primaryLabel}${secondaryLabel ? ` and ${secondaryLabel}` : ''}. Exact values follow.`}
      role="img"
      className="insight-visual min-w-0"
      style={{ height }}
    >
      <Chart {...props} height={height} />
    </div>
  );
}
