import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChapaGateway,
  gatewayModeForKey,
  getPaymentGateway,
  paymentUxMode,
  resetPaymentGatewayCache,
} from '@/lib/payment/gateway';
import { ChapaClient } from '@/lib/chapa/client';

/**
 * Gateway selection tests (KAN-70).
 *
 * The contract every caller relies on: no CHAPA_SECRET_KEY → null gateway →
 * today's mock flow, untouched. A key selects Chapa, and the key's own
 * prefix decides test vs live for UI hints.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  resetPaymentGatewayCache();
});

describe('getPaymentGateway', () => {
  it('is null when CHAPA_SECRET_KEY is unset (mock mode)', () => {
    vi.stubEnv('CHAPA_SECRET_KEY', '');
    resetPaymentGatewayCache();
    expect(getPaymentGateway()).toBeNull();
    expect(paymentUxMode()).toBe('mock');
  });

  it('selects a test-mode Chapa gateway for a CHASECK_TEST- key', () => {
    vi.stubEnv('CHAPA_SECRET_KEY', 'CHASECK_TEST-abc');
    resetPaymentGatewayCache();
    const gateway = getPaymentGateway();
    expect(gateway).toBeInstanceOf(ChapaGateway);
    expect(gateway?.mode).toBe('chapa-test');
    expect(paymentUxMode()).toBe('chapa-test');
  });

  it('caches the instance across calls', () => {
    vi.stubEnv('CHAPA_SECRET_KEY', 'CHASECK_TEST-abc');
    resetPaymentGatewayCache();
    expect(getPaymentGateway()).toBe(getPaymentGateway());
  });
});

describe('gatewayModeForKey', () => {
  it.each([
    ['CHASECK_TEST-abc123', 'chapa-test'],
    ['CHASECK-abc123', 'chapa-live'],
  ] as const)('%s → %s', (key, mode) => {
    expect(gatewayModeForKey(key)).toBe(mode);
  });
});

describe('ChapaGateway', () => {
  it('brands the checkout with the campaign name at the funding edge', async () => {
    const initialize = vi
      .spyOn(ChapaClient.prototype, 'initializeTransaction')
      .mockResolvedValue({ checkoutUrl: 'https://checkout.chapa.co/x/1' });
    const gateway = new ChapaGateway(
      new ChapaClient('CHASECK_TEST-abc'),
      'chapa-test'
    );

    const result = await gateway.createFundingCheckout({
      txRef: 'cmfund_1',
      amountSantim: 250_000,
      email: 'brand@example.com',
      firstName: 'Bete',
      returnUrl: 'https://app.example.com/return',
      campaignName: 'Summer Launch',
    });

    expect(result.checkoutUrl).toBe('https://checkout.chapa.co/x/1');
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        txRef: 'cmfund_1',
        amountSantim: 250_000,
        title: 'Creator Marketplace',
        description: 'Fund campaign: Summer Launch',
      })
    );
    initialize.mockRestore();
  });

  it('delegates each verification and money-out edge to the Chapa client', async () => {
    const gateway = new ChapaGateway(
      new ChapaClient('CHASECK_TEST-abc'),
      'chapa-test'
    );

    const verifiedTx = {
      status: 'success',
      amountSantim: 250_000,
      currency: 'ETB',
      txRef: 'cmfund_1',
      providerRef: 'APq/x',
      mode: 'test',
    } as const;
    const verifyTransaction = vi
      .spyOn(ChapaClient.prototype, 'verifyTransaction')
      .mockResolvedValue(verifiedTx);
    await expect(gateway.verifyFunding('cmfund_1')).resolves.toBe(verifiedTx);
    expect(verifyTransaction).toHaveBeenCalledWith('cmfund_1');

    const banks = [
      {
        id: 130,
        name: 'Abay Bank',
        slug: 'abay_bank',
        code: '130',
        accountLength: 16,
        isMobileMoney: false,
      },
    ];
    vi.spyOn(ChapaClient.prototype, 'listBanks').mockResolvedValue(banks);
    await expect(gateway.listBanks()).resolves.toBe(banks);

    const createTransfer = vi
      .spyOn(ChapaClient.prototype, 'createTransfer')
      .mockResolvedValue({ providerRef: 'tr-1' });
    const transferOptions = {
      txRef: 'cmwd_1',
      amountSantim: 10_000,
      accountName: 'Alem T',
      accountNumber: '0900123456',
      bankCode: '855',
    };
    await expect(gateway.sendTransfer(transferOptions)).resolves.toEqual({
      providerRef: 'tr-1',
    });
    expect(createTransfer).toHaveBeenCalledWith(transferOptions);

    const verifiedTransfer = {
      status: 'success',
      amountSantim: 10_000,
      txRef: 'cmwd_1',
      providerRef: 'tr-1',
    } as const;
    const verifyTransfer = vi
      .spyOn(ChapaClient.prototype, 'verifyTransfer')
      .mockResolvedValue(verifiedTransfer);
    await expect(gateway.verifyTransfer('cmwd_1')).resolves.toBe(
      verifiedTransfer
    );
    expect(verifyTransfer).toHaveBeenCalledWith('cmwd_1');

    const refund = vi
      .spyOn(ChapaClient.prototype, 'refund')
      .mockResolvedValue(undefined);
    await gateway.refund({ txRef: 'cmfund_1', amountSantim: 50_000 });
    expect(refund).toHaveBeenCalledWith({
      txRef: 'cmfund_1',
      amountSantim: 50_000,
    });

    vi.restoreAllMocks();
  });
});
