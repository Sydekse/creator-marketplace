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
});
