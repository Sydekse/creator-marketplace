import { describe, expect, it, vi } from 'vitest';
import {
  REFRESH_MIN_INTERVAL_MS,
  refreshCreatorStats,
} from '@/lib/creators/refresh-stats';
import type { RefreshStatsDeps } from '@/lib/creators/refresh-stats';
import type { TierCandidate } from '@/lib/creators/tier-assignment';
import type { NotifyDeps } from '@/lib/notifications/notify';
import type { Tx } from '@/lib/authz';

/**
 * Unit tests for the phase-3 stats refresh (`lib/creators/refresh-stats.ts`).
 *
 * Everything is faked at the seams the module declares: profile read, link
 * check, TikTok fetch, the tier ladder, and the notification transaction. The
 * asymmetry under test is the point of the module — upgrades apply and mail,
 * downgrades only flag.
 */

const NOW = new Date('2026-09-01T12:00:00.000Z');

const TIERS: TierCandidate[] = [
  {
    id: 'tier-mid',
    name: 'Mid',
    pricePerVideo: 400_000,
    minFollowers: 50_000,
    minEngagement: '3.00',
    active: true,
  },
  {
    id: 'tier-micro',
    name: 'Micro',
    pricePerVideo: 150_000,
    minFollowers: 10_000,
    minEngagement: '2.00',
    active: true,
  },
];

/**
 * A tx fake that records every `update().set()` payload, notify row, and
 * metric snapshot. Snapshot inserts (recognised by their `capturedAt`) are
 * kept apart from notification rows so assertions about "what was the
 * creator told" are not polluted by the history row every refresh writes.
 */
function fakeTx() {
  const updates: Record<string, unknown>[] = [];
  const rows: unknown[] = [];
  const snapshots: unknown[] = [];
  const tx = {
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        updates.push(payload);
        return { where: vi.fn(async () => {}) };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: unknown) => {
        if (row !== null && typeof row === 'object' && 'capturedAt' in row) {
          snapshots.push(row);
        } else {
          rows.push(row);
        }
        return { returning: async () => [{ id: 'n-1' }] };
      }),
    })),
  } as unknown as Tx;
  return { tx, updates, rows, snapshots };
}

function refreshDeps(overrides: Partial<RefreshStatsDeps> = {}) {
  const { tx, updates, rows, snapshots } = fakeTx();
  const recorded = { updates, rows, snapshots, committed: false };

  const notifyDeps = {
    db: {
      transaction: async <T>(fn: (t: Tx) => Promise<T>): Promise<T> => {
        const result = await fn(tx);
        recorded.committed = true;
        return result;
      },
    },
    provider: null,
    render: async () => ({ subject: '', text: '', html: '' }),
    log: { info: vi.fn(), error: vi.fn() },
    sleep: async () => {},
  } as unknown as NotifyDeps;

  const deps: Partial<RefreshStatsDeps> = {
    loadProfile: async () => ({
      id: 'profile-1',
      tierId: null,
      statsRefreshedAt: null,
    }),
    linkedHandle: async () => '@selam',
    fetchStats: async () => ({
      followerCount: 12_000,
      engagementRate: '2.50',
      avatarUrl: null,
    }),
    now: () => NOW,
    notifyDeps,
    assignTierDeps: { loadTiers: async () => TIERS },
    ...overrides,
  };
  return { deps, recorded };
}

describe('refreshCreatorStats', () => {
  it('reports no_profile when the user has not onboarded', async () => {
    const { deps } = refreshDeps({ loadProfile: async () => null });
    await expect(refreshCreatorStats('u1', deps)).resolves.toEqual({
      ok: false,
      error: 'no_profile',
    });
  });

  it('rejects email sign-ups — nothing to pull from', async () => {
    const { deps, recorded } = refreshDeps({ linkedHandle: async () => null });
    await expect(refreshCreatorStats('u1', deps)).resolves.toEqual({
      ok: false,
      error: 'not_linked',
    });
    expect(recorded.committed).toBe(false);
  });

  it('rate-limits a second refresh inside 24 hours, with the wait remaining', async () => {
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    const fetchStats = vi.fn();
    const { deps } = refreshDeps({
      loadProfile: async () => ({
        id: 'profile-1',
        tierId: null,
        statsRefreshedAt: oneHourAgo,
      }),
      fetchStats,
    });

    await expect(refreshCreatorStats('u1', deps)).resolves.toEqual({
      ok: false,
      error: 'rate_limited',
      retryAfterMs: REFRESH_MIN_INTERVAL_MS - 60 * 60 * 1000,
    });
    // Rejected before spending a TikTok API call.
    expect(fetchStats).not.toHaveBeenCalled();
  });

  it('accepts a refresh once the window has passed', async () => {
    const yesterdayAndABit = new Date(
      NOW.getTime() - REFRESH_MIN_INTERVAL_MS - 1
    );
    const { deps } = refreshDeps({
      loadProfile: async () => ({
        id: 'profile-1',
        tierId: null,
        statsRefreshedAt: yesterdayAndABit,
      }),
    });
    const result = await refreshCreatorStats('u1', deps);
    expect(result.ok).toBe(true);
  });

  it('lets the cron bypass the rate limit via ignoreRateLimit', async () => {
    const justNow = new Date(NOW.getTime() - 1000);
    const { deps } = refreshDeps({
      loadProfile: async () => ({
        id: 'profile-1',
        tierId: null,
        statsRefreshedAt: justNow,
      }),
      ignoreRateLimit: true,
    });
    const result = await refreshCreatorStats('u1', deps);
    expect(result.ok).toBe(true);
  });

  it('reports fetch_failed without stamping — the retry stays open', async () => {
    const { deps, recorded } = refreshDeps({ fetchStats: async () => null });
    await expect(refreshCreatorStats('u1', deps)).resolves.toEqual({
      ok: false,
      error: 'fetch_failed',
    });
    // No transaction opened: nothing written, nothing to lock the creator out.
    expect(recorded.committed).toBe(false);
    expect(recorded.updates).toEqual([]);
  });

  it('writes the fetched numbers and the stamp in one update', async () => {
    const { deps, recorded } = refreshDeps();
    const result = await refreshCreatorStats('u1', deps);

    expect(result).toMatchObject({ ok: true, refreshedAt: NOW });
    expect(recorded.updates[0]).toEqual({
      followerCount: 12_000,
      engagementRate: '2.50',
      statsRefreshedAt: NOW,
      tierReviewAt: null,
    });
    expect(recorded.committed).toBe(true);
  });

  it('re-stores the avatar when the fetch carries one', async () => {
    // TikTok's avatar URLs die in ~24–48h; this per-refresh copy into blob
    // storage is what keeps the picture alive between weekly cron runs.
    const storeAvatar = vi.fn(async () => 'https://blob/avatar.jpg');
    const { deps } = refreshDeps({
      fetchStats: async () => ({
        followerCount: 12_000,
        engagementRate: '2.50',
        avatarUrl: 'https://p16.tiktokcdn.com/avatar.jpeg',
      }),
      storeAvatar,
    });

    await expect(refreshCreatorStats('u1', deps)).resolves.toMatchObject({
      ok: true,
    });
    expect(storeAvatar).toHaveBeenCalledWith(
      'u1',
      'https://p16.tiktokcdn.com/avatar.jpeg'
    );
  });

  it('skips the avatar store when TikTok returned none', async () => {
    const storeAvatar = vi.fn(async () => null);
    const { deps } = refreshDeps({ storeAvatar });

    await expect(refreshCreatorStats('u1', deps)).resolves.toMatchObject({
      ok: true,
    });
    expect(storeAvatar).not.toHaveBeenCalled();
  });

  it('upgrades an untiered creator and emails them', async () => {
    const { deps, recorded } = refreshDeps();
    const result = await refreshCreatorStats('u1', deps);

    expect(result).toMatchObject({
      ok: true,
      tier: { kind: 'upgraded', tierId: 'tier-micro', tierName: 'Micro' },
    });
    // Second update is assignTier writing tier_id through the same tx.
    expect(recorded.updates[1]).toEqual({ tierId: 'tier-micro' });
    expect(recorded.rows).toEqual([
      expect.objectContaining({
        userId: 'u1',
        type: 'tier_upgraded',
        payload: {
          creatorProfileId: 'profile-1',
          tierName: 'Micro',
          pricePerVideo: 150_000,
        },
      }),
    ]);
  });

  it('upgrades a tiered creator whose new numbers clear a higher band', async () => {
    const { deps, recorded } = refreshDeps({
      loadProfile: async () => ({
        id: 'profile-1',
        tierId: 'tier-micro',
        statsRefreshedAt: null,
      }),
      fetchStats: async () => ({
        followerCount: 80_000,
        engagementRate: '4.00',
        avatarUrl: null,
      }),
    });
    const result = await refreshCreatorStats('u1', deps);

    expect(result).toMatchObject({
      ok: true,
      tier: { kind: 'upgraded', tierId: 'tier-mid', tierName: 'Mid' },
    });
    expect(recorded.updates[1]).toEqual({ tierId: 'tier-mid' });
  });

  it('keeps the same band silently and clears any standing flag', async () => {
    const { deps, recorded } = refreshDeps({
      loadProfile: async () => ({
        id: 'profile-1',
        tierId: 'tier-micro',
        statsRefreshedAt: null,
      }),
      fetchStats: async () => ({
        followerCount: 15_000,
        engagementRate: '2.20',
        avatarUrl: null,
      }),
    });
    const result = await refreshCreatorStats('u1', deps);

    expect(result).toMatchObject({ ok: true, tier: { kind: 'unchanged' } });
    // The numbers support the held tier again — flag cleared, no re-assign,
    // no email.
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0]).toMatchObject({ tierReviewAt: null });
    expect(recorded.rows).toEqual([]);
    // Every successful refresh writes one history point for the growth chart.
    expect(recorded.snapshots).toEqual([
      expect.objectContaining({
        creatorId: 'profile-1',
        followerCount: 15_000,
        engagementRate: '2.20',
        source: 'tiktok',
      }),
    ]);
  });

  it('flags a downgrade for admin review and keeps the tier', async () => {
    const { deps, recorded } = refreshDeps({
      loadProfile: async () => ({
        id: 'profile-1',
        tierId: 'tier-mid',
        statsRefreshedAt: null,
      }),
      // Numbers now select Micro — a drop, so: flag, keep Mid, say nothing.
      fetchStats: async () => ({
        followerCount: 12_000,
        engagementRate: '2.50',
        avatarUrl: null,
      }),
    });
    const result = await refreshCreatorStats('u1', deps);

    expect(result).toMatchObject({ ok: true, tier: { kind: 'flagged' } });
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0]).toMatchObject({ tierReviewAt: NOW });
    expect(recorded.rows).toEqual([]);
  });

  it('flags a tiered creator whose new numbers match no band at all', async () => {
    const { deps, recorded } = refreshDeps({
      loadProfile: async () => ({
        id: 'profile-1',
        tierId: 'tier-micro',
        statsRefreshedAt: null,
      }),
      fetchStats: async () => ({
        followerCount: 500,
        engagementRate: '0.50',
        avatarUrl: null,
      }),
    });
    const result = await refreshCreatorStats('u1', deps);

    expect(result).toMatchObject({ ok: true, tier: { kind: 'flagged' } });
    expect(recorded.updates[0]).toMatchObject({ tierReviewAt: NOW });
  });

  it('leaves an untiered creator below every band unflagged', async () => {
    const { deps, recorded } = refreshDeps({
      fetchStats: async () => ({
        followerCount: 500,
        engagementRate: '0.50',
        avatarUrl: null,
      }),
    });
    const result = await refreshCreatorStats('u1', deps);

    // Nothing to review: no tier held, none earned. Still surfaces on
    // /admin/tiers as untiered, which is the existing manual path.
    expect(result).toMatchObject({ ok: true, tier: { kind: 'unchanged' } });
    expect(recorded.updates[0]).toMatchObject({ tierReviewAt: null });
    expect(recorded.rows).toEqual([]);
  });
});
