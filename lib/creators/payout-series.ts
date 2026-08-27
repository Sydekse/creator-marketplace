/**
 * Cumulative weekly payouts for the creator dashboard chart.
 *
 * The amounts must already be ledger payouts (positive santim). This module
 * only buckets and accumulates — it does not split a deal or invent money.
 */

export const PAYOUT_SERIES_WEEKS = 12;

export interface PayoutEvent {
  createdAt: Date;
  paidOut: number;
}

export interface PayoutPoint {
  /** Monday 00:00 UTC of the bucket, ISO date. */
  weekStart: string;
  label: string;
  paidOut: number;
}

export function mondayUtc(value: Date): Date {
  const day = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
  const weekday = day.getUTCDay();
  const shift = weekday === 0 ? -6 : 1 - weekday;
  day.setUTCDate(day.getUTCDate() + shift);
  return day;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function weekLabel(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(value);
}

export function buildCumulativeWeeklyPayouts(
  events: readonly PayoutEvent[],
  now: Date,
  weeks = PAYOUT_SERIES_WEEKS
): PayoutPoint[] {
  const end = mondayUtc(now);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (weeks - 1) * 7);

  const byWeek = new Map<string, number>();
  let running = 0;
  for (const event of events) {
    if (event.paidOut <= 0) continue;
    const week = mondayUtc(event.createdAt);
    if (week < start) {
      running += event.paidOut;
      continue;
    }
    if (week > end) continue;
    const key = isoDate(week);
    byWeek.set(key, (byWeek.get(key) ?? 0) + event.paidOut);
  }

  const points: PayoutPoint[] = [];
  for (let i = 0; i < weeks; i += 1) {
    const week = new Date(start);
    week.setUTCDate(start.getUTCDate() + i * 7);
    const key = isoDate(week);
    running += byWeek.get(key) ?? 0;
    points.push({
      weekStart: key,
      label: weekLabel(week),
      paidOut: running,
    });
  }
  return points;
}
