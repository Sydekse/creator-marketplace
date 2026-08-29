import { describe, expect, it } from 'vitest';
import { engagementFromVideos } from '../lib/tiktok/stats';
import { MAX_ENGAGEMENT_RATE } from '../lib/config/creator-profile';

/**
 * KAN-39 phase 2 — the engagement math behind auto-filled onboarding stats.
 *
 * Only the pure half is tested here. `fetchTiktokStats` is two HTTP calls and
 * a token read, every failure of which must degrade to `null` — asserted at
 * the integration level by onboarding falling back to editable fields, not by
 * mocking `fetch` into agreeing with itself.
 */
describe('engagementFromVideos', () => {
  it('averages per-video ratios, not the pooled totals', () => {
    // Pooled: (10+100)/(100+10_000) = 1.09%. Per-video: (10% + 1%) / 2 = 5.5%.
    // The per-video mean is the spec — one viral outlier is one good video.
    const rate = engagementFromVideos([
      { like_count: 10, view_count: 100 },
      { like_count: 100, view_count: 10_000 },
    ]);
    expect(rate).toBe('5.50');
  });

  it('counts likes, comments and shares as interactions', () => {
    const rate = engagementFromVideos([
      { like_count: 2, comment_count: 1, share_count: 1, view_count: 100 },
    ]);
    expect(rate).toBe('4.00');
  });

  it('returns a fixed two-decimal string for numeric(5,2)', () => {
    const rate = engagementFromVideos([{ like_count: 1, view_count: 3 }]);
    expect(rate).toBe('33.33');
  });

  it('skips zero-view videos instead of counting them as 0%', () => {
    // A fresh repost has no signal, not a bad one — including it would drag
    // the mean down for posting recently.
    const rate = engagementFromVideos([
      { like_count: 5, view_count: 100 },
      { like_count: 0, view_count: 0 },
    ]);
    expect(rate).toBe('5.00');
  });

  it('returns null when there is nothing to measure', () => {
    expect(engagementFromVideos([])).toBeNull();
    expect(engagementFromVideos([{ view_count: 0 }])).toBeNull();
    expect(engagementFromVideos([{}])).toBeNull();
  });

  it('treats missing counts as zero, not as NaN', () => {
    expect(engagementFromVideos([{ view_count: 100 }])).toBe('0.00');
  });

  it('clamps to the schema ceiling so the value round-trips the form parse', () => {
    // Share chains can push interactions past views. numeric(5,2) would hold
    // 999.99, but createCreatorSchema caps typed values at 100 — an API value
    // above that would fail the very validation it is meant to prefill.
    const rate = engagementFromVideos([{ like_count: 500, view_count: 100 }]);
    expect(rate).toBe(MAX_ENGAGEMENT_RATE.toFixed(2));
  });

  it('ignores a negative interaction count rather than producing one', () => {
    const rate = engagementFromVideos([
      { like_count: -5, view_count: 100 },
      { like_count: 10, view_count: 100 },
    ]);
    expect(rate).toBe('10.00');
  });
});
