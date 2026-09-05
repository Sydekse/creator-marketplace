'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface InsightChartRow {
  id: string;
  label: string;
  primary: number | null;
  secondary?: number | null;
}

/** Exact values live in the adjacent server-rendered list, not in this island. */
export function InsightChart({
  rows,
  primaryLabel,
  secondaryLabel,
  unit,
}: {
  rows: InsightChartRow[];
  primaryLabel: string;
  secondaryLabel?: string;
  unit: string;
}) {
  const height = Math.max(150, rows.length * (secondaryLabel ? 64 : 42) + 35);
  return (
    <div
      aria-label={`${primaryLabel}${secondaryLabel ? ` and ${secondaryLabel}` : ''}. Exact values follow.`}
      role="img"
      className="insight-visual min-w-0"
      style={{ height }}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        initialDimension={{ width: 500, height }}
      >
        <BarChart
          data={rows}
          layout="vertical"
          accessibilityLayer
          margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
          barGap={4}
        >
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            unit={unit}
            domain={secondaryLabel ? [0, 100] : [0, 'auto']}
          />
          <YAxis
            type="category"
            dataKey="id"
            width={95}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--foreground)', fontSize: 11 }}
            tickFormatter={(id: string) =>
              rows.find((r) => r.id === id)?.label ?? id
            }
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            labelFormatter={(id) =>
              rows.find((r) => r.id === String(id))?.label ?? ''
            }
            contentStyle={{
              borderColor: 'var(--border)',
              borderRadius: 8,
              background: 'var(--card)',
              color: 'var(--foreground)',
            }}
          />
          <Bar
            dataKey="primary"
            name={primaryLabel}
            fill="var(--brand-strong)"
            radius={[0, 3, 3, 0]}
            maxBarSize={12}
            isAnimationActive={false}
          />
          {secondaryLabel && (
            <Bar
              dataKey="secondary"
              name={secondaryLabel}
              fill="var(--foreground)"
              radius={[0, 3, 3, 0]}
              maxBarSize={12}
              isAnimationActive={false}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
