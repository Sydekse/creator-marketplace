import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InsightChart,
  type InsightChartRow,
} from '@/components/campaign/insight-chart';

const chart = vi.hoisted(() => ({
  axis: vi.fn(),
  tooltip: vi.fn(),
  bars: vi.fn(),
  data: vi.fn(),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: unknown }) => children,
  BarChart: (props: { children: unknown }) => {
    chart.data(props);
    return props.children;
  },
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: (props: unknown) => {
    chart.axis(props);
    return null;
  },
  Tooltip: (props: unknown) => {
    chart.tooltip(props);
    return null;
  },
  Bar: (props: unknown) => {
    chart.bars(props);
    return null;
  },
}));

function render(rows: InsightChartRow[], secondaryLabel?: string) {
  renderToStaticMarkup(
    createElement(InsightChart, {
      rows,
      primaryLabel: 'Views',
      secondaryLabel,
      unit: '%',
      height: 200,
    })
  );
  return {
    tick: chart.axis.mock.lastCall![0].tickFormatter as (id: string) => string,
    label: chart.tooltip.mock.lastCall![0].labelFormatter as (
      id: unknown
    ) => string,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('indexed insight labels', () => {
  it('preserves first matching IDs, empty labels, fallbacks, and row order', () => {
    const rows: InsightChartRow[] = [
      { id: 'b', label: 'First', primary: null },
      { id: 'a', label: '', primary: 0 },
      { id: 'b', label: 'Later duplicate', primary: 5 },
      { id: '42', label: 'Numeric', primary: 42 },
    ];
    const { tick, label } = render(rows);
    for (const id of ['b', 'a', '42', 'missing']) {
      expect(tick(id)).toBe(rows.find((row) => row.id === id)?.label ?? id);
      expect(label(id)).toBe(rows.find((row) => row.id === id)?.label ?? '');
    }
    expect(label(42)).toBe('Numeric');
    expect(chart.data.mock.lastCall![0].data).toBe(rows);
    expect(chart.bars).toHaveBeenCalledTimes(1);
    expect(chart.bars.mock.lastCall![0].isAnimationActive).toBe(false);
  });

  it('does not scan rows during repeated format calls', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: String(i),
      label: `Creator ${i}`,
      primary: i,
    }));
    const find = vi.spyOn(rows, 'find');
    const { tick, label } = render(rows, 'Budget');
    for (const row of rows) {
      expect(tick(row.id)).toBe(row.label);
      expect(label(row.id)).toBe(row.label);
    }
    expect(find).not.toHaveBeenCalled();
    expect(chart.bars).toHaveBeenCalledTimes(2);
    expect(render([{ ...rows[0], label: 'Updated' }]).tick('0')).toBe(
      'Updated'
    );
  });
});
