import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  latestPendingThumbnailSubmission,
  scheduleThumbnailRefresh,
} from '@/lib/deliverables/thumbnail-refresh';

const NOW = new Date('2026-09-06T00:00:00Z').getTime();
const video = {
  thumbnailUrl: null,
  tiktokVideoId: null,
  submittedAt: new Date(NOW),
};

describe('bounded thumbnail refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('refreshes once per page at 2, 5, 10, 20, 40 and 60 seconds, then stops', () => {
    const refresh = vi.fn();
    const pending = latestPendingThumbnailSubmission([video, video, video]);
    scheduleThumbnailRefresh(pending, refresh);
    for (const delay of [2_000, 3_000, 5_000, 10_000, 20_000, 20_000]) {
      const calls = refresh.mock.calls.length;
      vi.advanceTimersByTime(delay - 1);
      expect(refresh).toHaveBeenCalledTimes(calls);
      vi.advanceTimersByTime(1);
      expect(refresh).toHaveBeenCalledTimes(calls + 1);
    }
    vi.advanceTimersByTime(3_600_000);
    expect(refresh).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not restart its budget after an RSC refresh or remount', () => {
    const refresh = vi.fn();
    const stop = scheduleThumbnailRefresh(NOW, refresh);
    vi.advanceTimersByTime(10_000);
    stop();
    scheduleThumbnailRefresh(NOW, refresh);
    vi.advanceTimersByTime(50_000);
    expect(refresh).toHaveBeenCalledTimes(6);
    scheduleThumbnailRefresh(NOW, refresh);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels all remaining reads when the component unmounts', () => {
    const refresh = vi.fn();
    const stop = scheduleThumbnailRefresh(NOW, refresh);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops after a subsequent read contains the thumbnail and resolved video id', () => {
    const refresh = vi.fn();
    const stop = scheduleThumbnailRefresh(
      latestPendingThumbnailSubmission([video]),
      refresh
    );
    vi.advanceTimersByTime(2_000);
    const enriched = {
      ...video,
      thumbnailUrl: 'https://blob/cover.jpg',
      tiktokVideoId: '123',
    };
    stop();
    expect(latestPendingThumbnailSubmission([enriched])).toBeNull();
    scheduleThumbnailRefresh(
      latestPendingThumbnailSubmission([enriched]),
      refresh
    );
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh bounded window for replacement submissions', () => {
    vi.advanceTimersByTime(120_000);
    expect(latestPendingThumbnailSubmission([video])).toBe(NOW);
    const replacement = { ...video, submittedAt: new Date(Date.now()) };
    const refresh = vi.fn();
    scheduleThumbnailRefresh(
      latestPendingThumbnailSubmission([replacement]),
      refresh
    );
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([null, NaN, NOW + 1, NOW - 60_000])(
    'never polls absent, invalid, future or expired submissions: %s',
    (submittedAt) => {
      scheduleThumbnailRefresh(submittedAt, vi.fn());
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('keeps the manual-refresh state for partial enrichment and expired failures', () => {
    expect(latestPendingThumbnailSubmission([])).toBeNull();
    expect(
      latestPendingThumbnailSubmission([{ ...video, tiktokVideoId: '123' }])
    ).toBe(NOW);
    expect(
      latestPendingThumbnailSubmission([
        { ...video, thumbnailUrl: 'https://blob/cover.jpg' },
      ])
    ).toBe(NOW);
    vi.advanceTimersByTime(120_000);
    expect(latestPendingThumbnailSubmission([video])).toBe(NOW);
  });
});
