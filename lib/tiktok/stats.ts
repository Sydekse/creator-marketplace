import { auth } from '@/lib/auth';
import { MAX_ENGAGEMENT_RATE } from '@/lib/config/creator-profile';

/**
 * TikTok Display API reads for onboarding prefill and auto-tiering (phase 2).
 *
 * Everything here is best-effort by design: the caller is the onboarding flow,
 * and a creator must always be able to finish onboarding even when TikTok is
 * down, a scope was not granted, or the sandbox refuses a call. Every failure
 * path returns null rather than throwing — the form then falls back to the
 * editable manual fields, exactly the email-sign-up experience.
 *
 * Scopes this reads under (requested in `lib/auth.ts`):
 *   - `user.info.stats`  → follower_count
 *   - `video.list`       → per-video like/comment/share/view counts
 */

const USER_INFO_URL =
  'https://open.tiktokapis.com/v2/user/info/?fields=follower_count,bio_description,avatar_url,is_verified';
const VIDEO_LIST_URL =
  'https://open.tiktokapis.com/v2/video/list/?fields=like_count,comment_count,share_count,view_count';

/** How many recent videos the engagement average is computed over. */
const VIDEO_SAMPLE_SIZE = 20;

export interface TiktokStats {
  /** From user.info.stats; null when the scope or the field is unavailable. */
  followerCount: number | null;
  /**
   * Average of (likes+comments+shares)/views over the creator's recent
   * videos, as a percentage string matching `numeric(5,2)` (e.g. "4.20").
   * Null when video.list is unavailable or every sampled video has 0 views.
   */
  engagementRate: string | null;
  /**
   * The creator's current profile picture as a signed TikTok CDN URL —
   * short-lived (~24–48h), so callers copy it into blob storage rather than
   * persist it directly. Null when user.info is unavailable.
   */
  avatarUrl: string | null;
}

interface VideoCounts {
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  view_count?: number;
}

/**
 * Engagement rate over a video sample, in percent with 2 decimals.
 *
 * Per-video ratio first, then averaged — a viral outlier should count as one
 * good video, not swamp the mean the way summing all interactions over all
 * views would. Zero-view videos carry no signal (0/0) and are skipped rather
 * than counted as 0%, which would punish a fresh repost.
 *
 * Exported for tests; pure on purpose.
 */
export function engagementFromVideos(videos: VideoCounts[]): string | null {
  const ratios: number[] = [];
  for (const v of videos) {
    const views = v.view_count ?? 0;
    if (!Number.isFinite(views) || views <= 0) continue;
    const interactions =
      (v.like_count ?? 0) + (v.comment_count ?? 0) + (v.share_count ?? 0);
    if (!Number.isFinite(interactions) || interactions < 0) continue;
    ratios.push(interactions / views);
  }
  if (ratios.length === 0) return null;
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  // Clamped to the same ceiling `createCreatorSchema` enforces on typed
  // values, so an API-sourced rate always round-trips through the form's
  // client-side parse. Interactions can legitimately outnumber views
  // (duet/share chains); the ladder does not distinguish above the cap.
  const percent = Math.min(mean * 100, MAX_ENGAGEMENT_RATE);
  return percent.toFixed(2);
}

async function tiktokAccessToken(userId: string): Promise<string | null> {
  try {
    // Refreshes against TikTok when the stored token is expired — Login Kit
    // access tokens live 24h, so anything but the sign-up session needs this.
    const token = await auth.api.getAccessToken({
      body: { providerId: 'tiktok', userId },
    });
    return token?.accessToken ?? null;
  } catch {
    return null;
  }
}

interface UserInfoFields {
  followerCount: number | null;
  avatarUrl: string | null;
}

async function fetchUserInfo(accessToken: string): Promise<UserInfoFields> {
  try {
    const res = await fetch(USER_INFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      // Fresh numbers each onboarding; this is not a cacheable read.
      cache: 'no-store',
    });
    if (!res.ok) return { followerCount: null, avatarUrl: null };
    const body = (await res.json()) as {
      data?: { user?: { follower_count?: number; avatar_url?: string } };
    };
    const count = body.data?.user?.follower_count;
    const avatar = body.data?.user?.avatar_url;
    return {
      followerCount:
        typeof count === 'number' &&
        Number.isFinite(count) &&
        Number.isInteger(count) &&
        count >= 0
          ? count
          : null,
      // Only https URLs are worth carrying; anything else cannot be an
      // avatar the UI would load.
      avatarUrl:
        typeof avatar === 'string' && avatar.startsWith('https://')
          ? avatar
          : null,
    };
  } catch {
    return { followerCount: null, avatarUrl: null };
  }
}

async function fetchEngagementRate(
  accessToken: string
): Promise<string | null> {
  try {
    const res = await fetch(VIDEO_LIST_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ max_count: VIDEO_SAMPLE_SIZE }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { videos?: VideoCounts[] };
    };
    const videos = body.data?.videos;
    if (!Array.isArray(videos)) return null;
    return engagementFromVideos(videos);
  } catch {
    return null;
  }
}

/**
 * The creator's live TikTok numbers, or null when the account has no usable
 * TikTok link at all. Partial results are normal — e.g. stats granted but no
 * public videos yields `{ followerCount: n, engagementRate: null }` — and the
 * caller treats each field independently.
 */
export async function fetchTiktokStats(
  userId: string
): Promise<TiktokStats | null> {
  const accessToken = await tiktokAccessToken(userId);
  if (!accessToken) return null;

  const [{ followerCount, avatarUrl }, engagementRate] = await Promise.all([
    fetchUserInfo(accessToken),
    fetchEngagementRate(accessToken),
  ]);
  // Avatar alone is not "stats": returning a result here would let a refresh
  // stamp and overwrite real follower/engagement numbers with nulls.
  if (followerCount === null && engagementRate === null) return null;
  return { followerCount, engagementRate, avatarUrl };
}
