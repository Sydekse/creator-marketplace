import { refreshCreatorStats } from '@/lib/creators/refresh-stats';
import type { RefreshStatsDeps } from '@/lib/creators/refresh-stats';
import { guard, toErrorResponse } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  errorResponse,
  validationError,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * `POST /api/creators/stats/refresh` — the creator's "Refresh my stats"
 * button (phase 3).
 *
 * A thin adapter over `refreshCreatorStats`, which owns the 24h rate limit,
 * the TikTok fetch, and the asymmetric tier rule (upgrades apply, downgrades
 * flag). This route only authorises and maps outcomes to the standard
 * envelope:
 *
 *   - `rate_limited` → 429 with a `Retry-After` header, so the client can say
 *     *when* rather than only *no*.
 *   - `fetch_failed` → 502: the failure is TikTok's, nothing was written, and
 *     the rate limit was deliberately not stamped — trying again is fine.
 *   - `not_linked` → 422: email sign-ups have no TikTok to pull from; their
 *     numbers are corrected by an admin, not by this button.
 *   - `no_profile` → 404: nothing to refresh before onboarding.
 *
 * No request body: everything the refresh needs is the session. That is also
 * the security argument — there is no id in the payload with which to refresh
 * (or probe) anybody else.
 */
export async function handleRefreshStats(
  deps?: Partial<RefreshStatsDeps>
): Promise<Response> {
  let userId: string;
  try {
    const ctx = await guard({ roles: ['creator'] });
    userId = ctx.user.id;
  } catch (error) {
    return toErrorResponse(error);
  }

  const result = await refreshCreatorStats(userId, deps);

  if (!result.ok) {
    switch (result.error) {
      case 'rate_limited':
        return Response.json(
          errorResponse(ErrorCode.STATS_REFRESH_RATE_LIMITED),
          {
            status: ErrorHttpStatus[ErrorCode.STATS_REFRESH_RATE_LIMITED],
            // Whole seconds, rounded up — a Retry-After of 0 would invite an
            // immediate retry that still loses.
            headers: {
              'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)),
            },
          }
        );
      case 'fetch_failed':
        return Response.json(errorResponse(ErrorCode.STATS_FETCH_FAILED), {
          status: ErrorHttpStatus[ErrorCode.STATS_FETCH_FAILED],
        });
      case 'not_linked':
        return Response.json(
          validationError({
            _root: ['Stats refresh is only available for TikTok sign-ins.'],
          }),
          { status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR] }
        );
      case 'no_profile':
        return Response.json(errorResponse(ErrorCode.NOT_FOUND), {
          status: ErrorHttpStatus[ErrorCode.NOT_FOUND],
        });
    }
  }

  // snake_case out, matching the onboarding response style (§4.2). The tier
  // change is included so the client can announce an upgrade without another
  // round trip; `flagged` deliberately renders the same as `unchanged` on the
  // creator's side — the review is the admin's until decided.
  return Response.json({
    follower_count: result.stats.followerCount,
    engagement_rate: result.stats.engagementRate,
    refreshed_at: result.refreshedAt.toISOString(),
    tier_change:
      result.tier.kind === 'upgraded'
        ? { kind: 'upgraded' as const, tier_name: result.tier.tierName }
        : { kind: 'unchanged' as const },
  });
}

/**
 * The exported handler takes no second argument on purpose — Next passes the
 * route context there, which would silently clobber a deps seam. Tests call
 * `handleRefreshStats` directly.
 */
export async function POST(): Promise<Response> {
  return handleRefreshStats();
}
