import { describe, expect, it } from 'vitest';
import {
  PAYOUT_SERIES_WEEKS,
  buildCumulativeWeeklyPayouts,
  mondayUtc,
} from '../lib/creators/payout-series';
import { payoutEventsQuery } from '../lib/creators/dashboard';

const CREATOR_PROFILE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('buildCumulativeWeeklyPayouts', () => {
  it('fills twelve weeks and carries earlier payouts as the baseline', () => {
    const now = new Date('2026-08-27T12:00:00Z');
    const points = buildCumulativeWeeklyPayouts(
      [
        { createdAt: new Date('2026-01-10T00:00:00Z'), paidOut: 100_000 },
        { createdAt: new Date('2026-08-26T00:00:00Z'), paidOut: 50_000 },
      ],
      now
    );

    expect(points).toHaveLength(PAYOUT_SERIES_WEEKS);
    expect(points[0].paidOut).toBe(100_000);
    expect(points[points.length - 1].paidOut).toBe(150_000);
  });

  it('ignores non-positive amounts', () => {
    const now = new Date('2026-08-27T12:00:00Z');
    const points = buildCumulativeWeeklyPayouts(
      [{ createdAt: now, paidOut: 0 }],
      now,
      4
    );
    expect(points.every((point) => point.paidOut === 0)).toBe(true);
  });

  it('lands a date on Monday UTC', () => {
    expect(mondayUtc(new Date('2026-08-27T12:00:00Z')).getUTCDay()).toBe(1);
  });
});

describe('payoutEventsQuery', () => {
  const { sql, params } = payoutEventsQuery(CREATOR_PROFILE_ID).toSQL();

  it('reads only release_payout rows for one creator', () => {
    expect(params).toContain('release_payout');
    expect(sql).toContain('"creator_id"');
    expect(params).toContain(CREATOR_PROFILE_ID);
  });

  it('joins deal inner so campaign-level funding is not attributed', () => {
    expect(sql).toMatch(/inner join/i);
  });
});
