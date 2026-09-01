import { describe, expect, it, vi } from 'vitest';
import {
  cancelFundingSession,
  createFundingSession,
} from '@/lib/campaigns/fund-session';
import type { FundingSessionDeps } from '@/lib/campaigns/fund-session';
import { ChapaError } from '@/lib/chapa/client';
import type { PaymentGateway } from '@/lib/payment/gateway';

/**
 * Funding-session creation tests (KAN-70).
 *
 * The session is the redirect flow's only state, so the tests concentrate on
 * what may open one (a confirmed, owned campaign with accepted deals and no
 * session already open), what the checkout is asked for (the server-summed
 * total, never a client figure), and how the open-session race resolves
 * (resume the winner, abandon our orphan checkout).
 */

const CAMPAIGN_ID = 'c0000000-0000-4000-8000-000000000001';
const BRAND_ID = 'b0000000-0000-4000-8000-000000000001';
const PAYER = { email: 'brand@example.com', name: 'Bete' };
const ORIGIN = 'https://app.example.com';

function fakeGateway(overrides?: Partial<PaymentGateway>): PaymentGateway {
  return {
    mode: 'chapa-test',
    createFundingCheckout: vi
      .fn()
      .mockResolvedValue({ checkoutUrl: 'https://checkout.chapa.co/x/1' }),
    verifyFunding: vi.fn(),
    listBanks: vi.fn(),
    sendTransfer: vi.fn(),
    verifyTransfer: vi.fn(),
    refund: vi.fn(),
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<FundingSessionDeps>): FundingSessionDeps {
  return {
    getCampaign: vi
      .fn()
      .mockResolvedValue({
        id: CAMPAIGN_ID,
        name: 'Summer',
        status: 'confirmed',
      }),
    sumAcceptedDeals: vi.fn().mockResolvedValue({ total: 250_000, count: 2 }),
    getOpenSession: vi.fn().mockResolvedValue(null),
    insertSession: vi.fn().mockResolvedValue('inserted'),
    gateway: () => fakeGateway(),
    logFailure: vi.fn(),
    ...overrides,
  };
}

function create(deps: FundingSessionDeps) {
  return createFundingSession(CAMPAIGN_ID, BRAND_ID, PAYER, ORIGIN, deps);
}

describe('createFundingSession', () => {
  it('answers gateway_unavailable in mock mode without touching the campaign', async () => {
    const deps = makeDeps({ gateway: () => null });
    const result = await create(deps);
    expect(result).toEqual({ ok: false, reason: 'gateway_unavailable' });
    expect(deps.getCampaign).not.toHaveBeenCalled();
  });

  it('answers not_found for a campaign the brand does not own', async () => {
    const deps = makeDeps({ getCampaign: vi.fn().mockResolvedValue(null) });
    expect(await create(deps)).toEqual({ ok: false, reason: 'not_found' });
  });

  it.each(['draft', 'funded', 'completed', 'cancelled'])(
    'answers not_fundable for a %s campaign',
    async (status) => {
      const deps = makeDeps({
        getCampaign: vi
          .fn()
          .mockResolvedValue({ id: CAMPAIGN_ID, name: 'Summer', status }),
      });
      expect(await create(deps)).toEqual({ ok: false, reason: 'not_fundable' });
    }
  );

  it('resumes an open session instead of opening a second checkout', async () => {
    const gateway = fakeGateway();
    const deps = makeDeps({
      gateway: () => gateway,
      getOpenSession: vi.fn().mockResolvedValue({
        txRef: 'cmfund_existing',
        checkoutUrl: 'https://checkout.chapa.co/x/old',
        amount: 100_000,
      }),
    });
    const result = await create(deps);
    expect(result).toEqual({
      ok: true,
      txRef: 'cmfund_existing',
      checkoutUrl: 'https://checkout.chapa.co/x/old',
      amount: 100_000,
      resumed: true,
    });
    expect(gateway.createFundingCheckout).not.toHaveBeenCalled();
    expect(deps.insertSession).not.toHaveBeenCalled();
  });

  it('answers no_accepted_deals when nothing is accepted', async () => {
    const deps = makeDeps({
      sumAcceptedDeals: vi.fn().mockResolvedValue({ total: 0, count: 0 }),
    });
    expect(await create(deps)).toEqual({
      ok: false,
      reason: 'no_accepted_deals',
    });
  });

  it('opens a checkout for the server-summed total and records the session', async () => {
    const gateway = fakeGateway();
    const deps = makeDeps({ gateway: () => gateway });
    const result = await create(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.resumed).toBe(false);
    expect(result.amount).toBe(250_000);
    expect(result.txRef).toMatch(/^cmfund_[0-9a-f-]{36}$/);
    expect(result.checkoutUrl).toBe('https://checkout.chapa.co/x/1');

    expect(gateway.createFundingCheckout).toHaveBeenCalledWith({
      txRef: result.txRef,
      amountSantim: 250_000,
      email: 'brand@example.com',
      firstName: 'Bete',
      returnUrl: `${ORIGIN}/campaigns/${CAMPAIGN_ID}/funding/${result.txRef}`,
      campaignName: 'Summer',
    });
    expect(deps.insertSession).toHaveBeenCalledWith({
      campaignId: CAMPAIGN_ID,
      brandId: BRAND_ID,
      txRef: result.txRef,
      amount: 250_000,
      checkoutUrl: 'https://checkout.chapa.co/x/1',
    });
  });

  it('falls back to "Brand" when the payer has no name', async () => {
    const gateway = fakeGateway();
    const deps = makeDeps({ gateway: () => gateway });
    await createFundingSession(
      CAMPAIGN_ID,
      BRAND_ID,
      { email: 'brand@example.com', name: null },
      ORIGIN,
      deps
    );
    expect(gateway.createFundingCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Brand' })
    );
  });

  it('maps a Chapa failure to gateway_unavailable, logged, nothing written', async () => {
    const deps = makeDeps({
      gateway: () =>
        fakeGateway({
          createFundingCheckout: vi
            .fn()
            .mockRejectedValue(new ChapaError('down', 'UNAVAILABLE')),
        }),
    });
    expect(await create(deps)).toEqual({
      ok: false,
      reason: 'gateway_unavailable',
    });
    expect(deps.logFailure).toHaveBeenCalled();
    expect(deps.insertSession).not.toHaveBeenCalled();
  });

  it('rethrows a non-Chapa initialize failure after logging it', async () => {
    const boom = new Error('connection pool exhausted');
    const deps = makeDeps({
      gateway: () =>
        fakeGateway({
          createFundingCheckout: vi.fn().mockRejectedValue(boom),
        }),
    });
    await expect(create(deps)).rejects.toBe(boom);
    expect(deps.logFailure).toHaveBeenCalled();
  });

  it('resumes the winner when the insert loses the one-open-session race', async () => {
    const deps = makeDeps({
      insertSession: vi.fn().mockResolvedValue('conflict'),
      getOpenSession: vi
        .fn()
        .mockResolvedValueOnce(null) // the pre-insert read
        .mockResolvedValueOnce({
          txRef: 'cmfund_winner',
          checkoutUrl: 'https://checkout.chapa.co/x/w',
          amount: 250_000,
        }),
    });
    const result = await create(deps);
    expect(result).toEqual({
      ok: true,
      txRef: 'cmfund_winner',
      checkoutUrl: 'https://checkout.chapa.co/x/w',
      amount: 250_000,
      resumed: true,
    });
  });

  it('answers not_fundable when the conflicting session already settled', async () => {
    const deps = makeDeps({
      insertSession: vi.fn().mockResolvedValue('conflict'),
      getOpenSession: vi.fn().mockResolvedValue(null),
    });
    expect(await create(deps)).toEqual({ ok: false, reason: 'not_fundable' });
  });
});

describe('cancelFundingSession', () => {
  it('answers not_found for a campaign the brand does not own', async () => {
    const result = await cancelFundingSession(CAMPAIGN_ID, BRAND_ID, {
      getCampaign: vi.fn().mockResolvedValue(null),
      expireOpenSession: vi.fn(),
    });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it.each([true, false])(
    'passes through whether anything was open (%s)',
    async (wasOpen) => {
      const expireOpenSession = vi.fn().mockResolvedValue(wasOpen);
      const result = await cancelFundingSession(CAMPAIGN_ID, BRAND_ID, {
        getCampaign: vi
          .fn()
          .mockResolvedValue({
            id: CAMPAIGN_ID,
            name: 'S',
            status: 'confirmed',
          }),
        expireOpenSession,
      });
      expect(result).toEqual({ ok: true, cancelled: wasOpen });
      expect(expireOpenSession).toHaveBeenCalledWith(CAMPAIGN_ID);
    }
  );
});
