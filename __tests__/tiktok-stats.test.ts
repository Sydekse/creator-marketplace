import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engagementFromVideos, fetchTiktokStats } from '../lib/tiktok/stats';
import { MAX_ENGAGEMENT_RATE } from '../lib/config/creator-profile';

vi.mock('@/lib/auth', () => ({
  auth: { api: { getAccessToken: vi.fn() } },
}));

import { auth } from '@/lib/auth';

const getAccessToken = vi.mocked(auth.api.getAccessToken);

/**
 * KAN-39 phase 2 — the engagement math behind auto-filled onboarding stats,
 * and the degrade-to-null contract of `fetchTiktokStats`: a creator must be
 * able to finish onboarding through the manual fields no matter how TikTok
 * fails, so every token/HTTP/shape failure must come back as null, never as
 * a thrown error.
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

/** A minimal Response stand-in — only what stats.ts reads. */
function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

function userInfoBody(followerCount: unknown) {
  return { data: { user: { follower_count: followerCount } } };
}

function videoListBody(videos: unknown) {
  return { data: { videos } };
}

/** The full shape better-auth's getAccessToken resolves with. */
function token(accessToken: string) {
  return {
    accessToken,
    accessTokenExpiresAt: undefined,
    scopes: [] as string[],
    idToken: undefined,
  };
}

describe('fetchTiktokStats', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    getAccessToken.mockReset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Wires the two endpoints to their responses by URL. */
  function respondWith(userInfo: Response, videoList: Response) {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes('/user/info/') ? userInfo : videoList
    );
  }

  it('returns both numbers when both endpoints answer', async () => {
    getAccessToken.mockResolvedValue(token('tok'));
    respondWith(
      jsonResponse(userInfoBody(12_345)),
      jsonResponse(videoListBody([{ like_count: 5, view_count: 100 }]))
    );

    await expect(fetchTiktokStats('user-1')).resolves.toEqual({
      followerCount: 12_345,
      engagementRate: '5.00',
    });
  });

  it('sends the token as a bearer header to both endpoints', async () => {
    getAccessToken.mockResolvedValue(token('tok'));
    respondWith(jsonResponse(userInfoBody(1)), jsonResponse(videoListBody([])));

    await fetchTiktokStats('user-1');

    for (const [, init] of fetchMock.mock.calls) {
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer tok'
      );
    }
  });

  it('returns null without calling TikTok when there is no token', async () => {
    // The email sign-up path: no tiktok account row at all.
    getAccessToken.mockResolvedValue(null as never);

    await expect(fetchTiktokStats('user-1')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when the token read throws (expired, revoked, refresh failed)', async () => {
    getAccessToken.mockRejectedValue(new Error('invalid_grant'));

    await expect(fetchTiktokStats('user-1')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades to a partial result when only one endpoint fails', async () => {
    // Sandbox reality: user.info.stats granted, but no public videos or the
    // video.list call refused. Each field is independent.
    getAccessToken.mockResolvedValue(token('tok'));
    respondWith(jsonResponse(userInfoBody(500)), jsonResponse({}, false));

    await expect(fetchTiktokStats('user-1')).resolves.toEqual({
      followerCount: 500,
      engagementRate: null,
    });
  });

  it('returns null when both endpoints fail — no half-empty object', async () => {
    getAccessToken.mockResolvedValue(token('tok'));
    respondWith(jsonResponse({}, false), jsonResponse({}, false));

    await expect(fetchTiktokStats('user-1')).resolves.toBeNull();
  });

  it('returns null when fetch itself rejects (network down)', async () => {
    getAccessToken.mockResolvedValue(token('tok'));
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(fetchTiktokStats('user-1')).resolves.toBeNull();
  });

  it.each([
    ['a string', '12k'],
    ['a negative number', -1],
    ['a non-integer', 1.5],
    ['missing', undefined],
  ])('rejects a follower count that is %s', async (_label, count) => {
    getAccessToken.mockResolvedValue(token('tok'));
    respondWith(
      jsonResponse(userInfoBody(count)),
      jsonResponse(videoListBody([{ like_count: 1, view_count: 100 }]))
    );

    await expect(fetchTiktokStats('user-1')).resolves.toEqual({
      followerCount: null,
      engagementRate: '1.00',
    });
  });

  it('treats a malformed video list as no engagement signal', async () => {
    getAccessToken.mockResolvedValue(token('tok'));
    respondWith(
      jsonResponse(userInfoBody(100)),
      jsonResponse(videoListBody('not-an-array'))
    );

    await expect(fetchTiktokStats('user-1')).resolves.toEqual({
      followerCount: 100,
      engagementRate: null,
    });
  });

  it('treats an unparseable JSON body as a failed call', async () => {
    getAccessToken.mockResolvedValue(token('tok'));
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response);

    await expect(fetchTiktokStats('user-1')).resolves.toBeNull();
  });
});
