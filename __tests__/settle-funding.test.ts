import { describe, expect, it, vi } from 'vitest';
import { settleFundingSession } from '@/lib/campaigns/settle-funding';
import type { SettleFundingDeps } from '@/lib/campaigns/settle-funding';
import { ChapaError } from '@/lib/chapa/client';
import type { VerifiedTransaction } from '@/lib/chapa/client';
import type { PaymentGateway } from '@/lib/payment/gateway';
import { LedgerError } from '@/lib/payment/ledger';
import { ErrorCode } from '@/lib/validation';

/**
 * Settlement tests (KAN-70) — the money rules for turning a paid checkout
 * into held escrow.
 *
 * The security invariants each get a case: value only after API re-verify;
 * exact amount, currency, tx_ref and mode all checked; duplicate deliveries
 * no-op; a paid-but-unfundable session fails loudly with nothing credited;
 * and the two-settler race resolves to exactly one hold.
 */

const TX_REF = 'cmfund_00000000-0000-4000-8000-000000000001';
const CAMPAIGN_ID = 'c0000000-0000-4000-8000-000000000001';
const BRAND_USER = 'u0000000-0000-4000-8000-000000000001';

const goodVerify: VerifiedTransaction = {
  status: 'success',
  amountSantim: 250_000,
  currency: 'ETB',
  txRef: TX_REF,
  providerRef: 'CHA-1',
  mode: 'test',
};

function fakeGateway(
  verify: () => Promise<VerifiedTransaction>,
  mode: 'chapa-test' | 'chapa-live' = 'chapa-test'
): PaymentGateway {
  return {
    mode,
    createFundingCheckout: vi.fn(),
    verifyFunding: vi.fn(verify),
    listBanks: vi.fn(),
    sendTransfer: vi.fn(),
    verifyTransfer: vi.fn(),
    refund: vi.fn(),
  };
}

function makeDeps(overrides?: Partial<SettleFundingDeps>): SettleFundingDeps {
  return {
    getSession: vi.fn().mockResolvedValue({
      id: 's1',
      campaignId: CAMPAIGN_ID,
      amount: 250_000,
      status: 'initialized',
      campaignName: 'Summer',
      campaignStatus: 'confirmed',
      brandUserId: BRAND_USER,
    }),
    claimSession: vi.fn().mockResolvedValue(true),
    markConsumed: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    hold: vi.fn().mockResolvedValue({ dealCount: 2, totalHeld: 250_000 }),
    getCampaignStatus: vi.fn().mockResolvedValue('confirmed'),
    gateway: () => fakeGateway(() => Promise.resolve(goodVerify)),
    notify: vi.fn().mockResolvedValue(undefined),
    logFailure: vi.fn(),
    ...overrides,
  };
}

describe('settleFundingSession', () => {
  it('answers not_found in mock mode and for unknown tx_refs', async () => {
    expect(
      (await settleFundingSession(TX_REF, makeDeps({ gateway: () => null })))
        .outcome
    ).toBe('not_found');
    expect(
      (
        await settleFundingSession(
          TX_REF,
          makeDeps({ getSession: vi.fn().mockResolvedValue(null) })
        )
      ).outcome
    ).toBe('not_found');
  });

  it('no-ops on a consumed session — the idempotency Chapa retries demand', async () => {
    const deps = makeDeps({
      getSession: vi.fn().mockResolvedValue({
        id: 's1',
        campaignId: CAMPAIGN_ID,
        amount: 250_000,
        status: 'consumed',
        campaignName: 'Summer',
        campaignStatus: 'funded',
        brandUserId: BRAND_USER,
      }),
    });
    const result = await settleFundingSession(TX_REF, deps);
    expect(result.outcome).toBe('already_consumed');
    expect(deps.hold).not.toHaveBeenCalled();
    expect(deps.claimSession).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  // Chapa's hosted checkout retries in place — same tx_ref, new charge — so
  // `failed` is a claim the verify endpoint may overrule (a declined card
  // followed by a successful telebirr attempt is a legitimate sequence).
  it('recovers a failed session when verify says success — the in-place retry', async () => {
    const deps = makeDeps({
      getSession: vi.fn().mockResolvedValue({
        id: 's1',
        campaignId: CAMPAIGN_ID,
        amount: 250_000,
        status: 'failed',
        campaignName: 'Summer',
        campaignStatus: 'confirmed',
        brandUserId: BRAND_USER,
      }),
    });
    const result = await settleFundingSession(TX_REF, deps);
    expect(result.outcome).toBe('consumed');
    expect(deps.claimSession).toHaveBeenCalledWith(TX_REF, 'CHA-1');
    expect(deps.hold).toHaveBeenCalled();
    expect(deps.markConsumed).toHaveBeenCalled();
  });

  it('a failed session that verify still calls failed stays failed', async () => {
    const deps = makeDeps({
      getSession: vi.fn().mockResolvedValue({
        id: 's1',
        campaignId: CAMPAIGN_ID,
        amount: 250_000,
        status: 'failed',
        campaignName: 'Summer',
        campaignStatus: 'confirmed',
        brandUserId: BRAND_USER,
      }),
      gateway: () =>
        fakeGateway(() => Promise.resolve({ ...goodVerify, status: 'failed' })),
    });
    const result = await settleFundingSession(TX_REF, deps);
    expect(result.outcome).toBe('failed');
    expect(deps.hold).not.toHaveBeenCalled();
    expect(deps.claimSession).not.toHaveBeenCalled();
  });

  it.each([
    ['REJECTED (checkout never paid)', new ChapaError('no tx', 'REJECTED')],
    [
      'UNAVAILABLE (verify endpoint down)',
      new ChapaError('down', 'UNAVAILABLE'),
    ],
  ])('%s from verify → pending, nothing written', async (_desc, error) => {
    const deps = makeDeps({
      gateway: () => fakeGateway(() => Promise.reject(error)),
    });
    const result = await settleFundingSession(TX_REF, deps);
    expect(result.outcome).toBe('pending');
    expect(deps.claimSession).not.toHaveBeenCalled();
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it('a pending charge is pending, not failed', async () => {
    const deps = makeDeps({
      gateway: () =>
        fakeGateway(() =>
          Promise.resolve({ ...goodVerify, status: 'pending' })
        ),
    });
    expect((await settleFundingSession(TX_REF, deps)).outcome).toBe('pending');
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it('a failed charge fails the session', async () => {
    const deps = makeDeps({
      gateway: () =>
        fakeGateway(() => Promise.resolve({ ...goodVerify, status: 'failed' })),
    });
    const result = await settleFundingSession(TX_REF, deps);
    expect(result.outcome).toBe('failed');
    expect(deps.markFailed).toHaveBeenCalledWith(TX_REF, 'charge failed');
    expect(deps.hold).not.toHaveBeenCalled();
  });

  it.each([
    ['amount', { ...goodVerify, amountSantim: 249_999 }],
    ['inexact amount', { ...goodVerify, amountSantim: null }],
    ['currency', { ...goodVerify, currency: 'USD' }],
    ['tx_ref', { ...goodVerify, txRef: 'cmfund_other' }],
    ['mode', { ...goodVerify, mode: 'live' }],
  ] as const)(
    'refuses value on a %s mismatch — failed, logged, never held',
    async (_what, verified) => {
      const deps = makeDeps({
        gateway: () => fakeGateway(() => Promise.resolve(verified)),
      });
      const result = await settleFundingSession(TX_REF, deps);
      expect(result.outcome).toBe('failed');
      expect(deps.logFailure).toHaveBeenCalled();
      expect(deps.markFailed).toHaveBeenCalled();
      expect(deps.hold).not.toHaveBeenCalled();
      expect(deps.notify).not.toHaveBeenCalled();
    }
  );

  it('tolerates an absent mode field', async () => {
    const deps = makeDeps({
      gateway: () =>
        fakeGateway(() => Promise.resolve({ ...goodVerify, mode: null })),
    });
    expect((await settleFundingSession(TX_REF, deps)).outcome).toBe('consumed');
  });

  it('holds escrow, consumes the session and notifies the brand', async () => {
    const deps = makeDeps();
    const result = await settleFundingSession(TX_REF, deps);

    expect(result).toEqual({
      outcome: 'consumed',
      campaignId: CAMPAIGN_ID,
      dealCount: 2,
      totalHeld: 250_000,
    });
    expect(deps.claimSession).toHaveBeenCalledWith(TX_REF, 'CHA-1');
    expect(deps.hold).toHaveBeenCalledWith(CAMPAIGN_ID, BRAND_USER);
    expect(deps.markConsumed).toHaveBeenCalledWith(TX_REF);
    expect(deps.notify).toHaveBeenCalledWith(BRAND_USER, 'campaign_funded', {
      campaignId: CAMPAIGN_ID,
      campaignTitle: 'Summer',
      dealCount: 2,
      totalHeld: 250_000,
    });
  });

  it.each(['expired', 'verified'])(
    'a %s session is still settleable — paid money is honoured',
    async (status) => {
      const deps = makeDeps({
        getSession: vi.fn().mockResolvedValue({
          id: 's1',
          campaignId: CAMPAIGN_ID,
          amount: 250_000,
          status,
          campaignName: 'Summer',
          campaignStatus: 'confirmed',
          brandUserId: BRAND_USER,
        }),
      });
      expect((await settleFundingSession(TX_REF, deps)).outcome).toBe(
        'consumed'
      );
    }
  );

  it('yields to a concurrent settler who consumed first', async () => {
    const deps = makeDeps({
      claimSession: vi.fn().mockResolvedValue(false),
      getSession: vi
        .fn()
        .mockResolvedValueOnce({
          id: 's1',
          campaignId: CAMPAIGN_ID,
          amount: 250_000,
          status: 'initialized',
          campaignName: 'Summer',
          campaignStatus: 'confirmed',
          brandUserId: BRAND_USER,
        })
        .mockResolvedValueOnce({
          id: 's1',
          campaignId: CAMPAIGN_ID,
          amount: 250_000,
          status: 'consumed',
          campaignName: 'Summer',
          campaignStatus: 'funded',
          brandUserId: BRAND_USER,
        }),
    });
    const result = await settleFundingSession(TX_REF, deps);
    expect(result.outcome).toBe('already_consumed');
    expect(deps.hold).not.toHaveBeenCalled();
  });

  it('recognises the race loser: NOT_FUNDABLE against a funded campaign is success', async () => {
    const deps = makeDeps({
      hold: vi
        .fn()
        .mockRejectedValue(
          new LedgerError('not fundable', ErrorCode.CAMPAIGN_NOT_FUNDABLE)
        ),
      getCampaignStatus: vi.fn().mockResolvedValue('funded'),
    });
    const result = await settleFundingSession(TX_REF, deps);
    expect(result.outcome).toBe('already_consumed');
    expect(deps.markConsumed).toHaveBeenCalledWith(TX_REF);
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it('fails loudly when money arrived but the campaign is no longer fundable', async () => {
    const deps = makeDeps({
      hold: vi
        .fn()
        .mockRejectedValue(
          new LedgerError('not fundable', ErrorCode.CAMPAIGN_NOT_FUNDABLE)
        ),
      getCampaignStatus: vi.fn().mockResolvedValue('cancelled'),
    });
    const result = await settleFundingSession(TX_REF, deps);
    expect(result.outcome).toBe('failed');
    expect(deps.logFailure).toHaveBeenCalled();
    expect(deps.markFailed).toHaveBeenCalledWith(
      TX_REF,
      `hold failed: ${ErrorCode.CAMPAIGN_NOT_FUNDABLE}`
    );
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('rethrows an unrecognised hold failure after failing the session', async () => {
    const boom = new Error('pool exhausted');
    const deps = makeDeps({ hold: vi.fn().mockRejectedValue(boom) });
    await expect(settleFundingSession(TX_REF, deps)).rejects.toBe(boom);
    expect(deps.markFailed).toHaveBeenCalledWith(TX_REF, 'hold failed');
    expect(deps.logFailure).toHaveBeenCalled();
  });
});
