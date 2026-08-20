import { describe, expect, it } from 'vitest';
import { cancelCampaign } from '../lib/campaigns/cancel';
import type { CancelCampaignDeps } from '../lib/campaigns/cancel';
import { ForbiddenError } from '../lib/authz';

/**
 * KAN-99 §5 — campaign cancel (draft/confirmed only).
 */

const BRAND_PROFILE_ID = '66666666-6666-4666-8666-666666666666';
const CAMPAIGN_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_BRAND_ID = '77777777-7777-4777-8777-777777777777';

function fakeDb(row: { id: string; status: string; brandId: string } | null) {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(row ? [row] : []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  };

  return {
    db: {
      transaction: async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as CancelCampaignDeps['db'],
  };
}

function alwaysAllow() {
  return async () => ({ user: { id: 'u', role: 'brand' as const } } as never);
}

function alwaysDeny() {
  return async () => {
    throw new ForbiddenError('no session');
  };
}

describe('cancelCampaign', () => {
  it('cancels a draft campaign', async () => {
    const { db } = fakeDb({
      id: CAMPAIGN_ID,
      status: 'draft',
      brandId: BRAND_PROFILE_ID,
    });

    const result = await cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      db,
      guard: alwaysAllow(),
    });

    expect(result).toEqual({ ok: true, status: 'cancelled' });
  });

  it('cancels a confirmed campaign', async () => {
    const { db } = fakeDb({
      id: CAMPAIGN_ID,
      status: 'confirmed',
      brandId: BRAND_PROFILE_ID,
    });

    const result = await cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      db,
      guard: alwaysAllow(),
    });

    expect(result).toEqual({ ok: true, status: 'cancelled' });
  });

  it('refuses to cancel a funded campaign', async () => {
    const { db } = fakeDb({
      id: CAMPAIGN_ID,
      status: 'funded',
      brandId: BRAND_PROFILE_ID,
    });

    const result = await cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      db,
      guard: alwaysAllow(),
    });

    expect(result).toEqual({ ok: false, reason: 'not_cancellable' });
  });

  it('refuses to cancel a completed campaign', async () => {
    const { db } = fakeDb({
      id: CAMPAIGN_ID,
      status: 'completed',
      brandId: BRAND_PROFILE_ID,
    });

    const result = await cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      db,
      guard: alwaysAllow(),
    });

    expect(result).toEqual({ ok: false, reason: 'not_cancellable' });
  });

  it('returns not_found when the campaign does not exist', async () => {
    const { db } = fakeDb(null);

    const result = await cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      db,
      guard: alwaysAllow(),
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_found when the brand does not own the campaign', async () => {
    const { db } = fakeDb({
      id: CAMPAIGN_ID,
      status: 'draft',
      brandId: OTHER_BRAND_ID,
    });

    const result = await cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
      db,
      guard: alwaysAllow(),
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('throws when the guard denies the role', async () => {
    const { db } = fakeDb({
      id: CAMPAIGN_ID,
      status: 'draft',
      brandId: BRAND_PROFILE_ID,
    });

    await expect(
      cancelCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, {
        db,
        guard: alwaysDeny(),
      })
    ).rejects.toThrow();
  });
});
