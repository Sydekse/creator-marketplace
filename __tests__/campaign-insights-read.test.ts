import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { ForbiddenError, guard, type AuthzContext } from '@/lib/authz';
import { readCampaignInsights } from '@/lib/campaigns/insights';
import { sumSettledByCampaign } from '@/lib/payment/escrow';

vi.mock('@/db', () => ({ db: { transaction: vi.fn() } }));
vi.mock('@/lib/authz', () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  guard: vi.fn(),
}));
vi.mock('@/lib/payment/escrow', () => ({
  sumSettledByCampaign: vi.fn(),
}));

const campaignId = '11111111-1111-4111-8111-111111111111';
const brandId = '22222222-2222-4222-8222-222222222222';
const authorized: AuthzContext = {
  user: {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Owner',
    email: 'owner@example.com',
    role: 'brand',
  },
  brandProfileId: brandId,
  creatorProfileId: null,
};

function emptySnapshot(owned = true) {
  let queryIndex = 0;
  const tx = {
    select: vi.fn(() => {
      const rows = queryIndex++ === 0 && owned ? [{ id: campaignId }] : [];
      const chain = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        then: (resolve: (value: typeof rows) => unknown) =>
          Promise.resolve(rows).then(resolve),
      };
      return chain;
    }),
  };
  vi.mocked(db.transaction).mockImplementation(async (callback) =>
    callback(tx as unknown as Parameters<typeof callback>[0])
  );
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(guard).mockResolvedValue(authorized);
  vi.mocked(sumSettledByCampaign).mockResolvedValue({
    paidOut: 0,
    commission: 0,
    refunded: 0,
  });
});

describe('campaign insights read boundary', () => {
  it.each(['', 'not-a-uuid', `${campaignId}' OR true --`])(
    'rejects malformed campaign ID %j before authentication or database access',
    async (id) => {
      await expect(readCampaignInsights(id)).rejects.toBeInstanceOf(
        ForbiddenError
      );
      expect(guard).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    }
  );

  it('uses the default guard with a brand-only campaign ownership requirement', async () => {
    emptySnapshot();
    await readCampaignInsights(campaignId);
    expect(guard).toHaveBeenCalledExactlyOnceWith({
      roles: ['brand'],
      resource: { kind: 'campaign', id: campaignId },
    });
  });

  it('does not query after the guard denies access', async () => {
    const denial = new ForbiddenError('No session');
    vi.mocked(guard).mockRejectedValueOnce(denial);
    await expect(readCampaignInsights(campaignId)).rejects.toBe(denial);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('denies a guard context without a brand profile before opening a transaction', async () => {
    vi.mocked(guard).mockResolvedValueOnce({
      ...authorized,
      brandProfileId: null,
    });
    await expect(readCampaignInsights(campaignId)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('stops before history and settlement when snapshot ownership no longer matches', async () => {
    const tx = emptySnapshot(false);
    await expect(readCampaignInsights(campaignId)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(sumSettledByCampaign).not.toHaveBeenCalled();
  });

  it('keeps settlement tenant-scoped on the same read-only snapshot when there are no creators', async () => {
    const tx = emptySnapshot();
    vi.mocked(sumSettledByCampaign).mockResolvedValueOnce({
      paidOut: 70,
      commission: 30,
      refunded: 25,
    });
    const result = await readCampaignInsights(campaignId);
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
    expect(sumSettledByCampaign).toHaveBeenCalledExactlyOnceWith(
      campaignId,
      tx,
      brandId
    );
    expect(tx.select).toHaveBeenCalledTimes(3);
    expect(result.campaign).toMatchObject({
      deals: [],
      creators: [],
      settled: 100,
      refunded: 25,
    });
    expect(result.history.creators).toEqual([]);
    expect(Number.isFinite(Date.parse(result.asOf))).toBe(true);
  });

  it('propagates database failure rather than returning misleading empty insight totals', async () => {
    const failure = new Error('database unavailable');
    vi.mocked(db.transaction).mockRejectedValueOnce(failure);
    await expect(readCampaignInsights(campaignId)).rejects.toBe(failure);
  });
});
