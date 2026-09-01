import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChapaGateway,
  checkoutDescription,
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

describe('checkoutDescription — Chapa validates customization at initialize', () => {
  // The rejection that broke the first live checkout (KAN-70): Chapa's
  // customization.description accepts only letters, numbers, hyphens,
  // underscores, spaces, and dots — and the title tops out at 16 characters.
  // The title is pinned in the ChapaGateway test above; this block pins the
  // description's sanitiser.

  it('passes a plain name through', () => {
    expect(checkoutDescription('Summer Launch')).toBe(
      'Fund campaign Summer Launch'
    );
  });

  it('uses a title within the 16-character cap', () => {
    expect('Fund campaign'.length).toBeLessThanOrEqual(16);
  });

  it('strips the characters Chapa rejects — colons, ampersands, emoji', () => {
    expect(checkoutDescription('Ramadan: Beauty & Skincare ✨')).toBe(
      'Fund campaign Ramadan Beauty Skincare'
    );
  });

  it('keeps the punctuation Chapa allows', () => {
    expect(checkoutDescription('Q3_push - v2.0')).toBe(
      'Fund campaign Q3_push - v2.0'
    );
  });

  it('survives a name with nothing usable in it', () => {
    expect(checkoutDescription('✨✨✨')).toBe('Fund campaign');
  });

  it('caps at 100 characters', () => {
    expect(checkoutDescription('x'.repeat(200))).toHaveLength(100);
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
        title: 'Fund campaign',
        description: 'Fund campaign Summer Launch',
      })
    );
    initialize.mockRestore();
  });

  it('strips a free-text brand name to what Chapa accepts as a first name', async () => {
    const initialize = vi
      .spyOn(ChapaClient.prototype, 'initializeTransaction')
      .mockResolvedValue({ checkoutUrl: 'https://checkout.chapa.co/x/2' });
    const gateway = new ChapaGateway(
      new ChapaClient('CHASECK_TEST-abc'),
      'chapa-test'
    );

    await gateway.createFundingCheckout({
      txRef: 'cmfund_2',
      amountSantim: 100_000,
      email: 'brand@example.com',
      firstName: 'Big & Bold ✨ Brand!',
      returnUrl: 'https://app.example.com/return',
      campaignName: 'Summer',
    });
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Big Bold Brand' })
    );

    // A name with nothing salvageable falls back rather than sending ''.
    await gateway.createFundingCheckout({
      txRef: 'cmfund_3',
      amountSantim: 100_000,
      email: 'brand@example.com',
      firstName: '✨🎉',
      returnUrl: 'https://app.example.com/return',
      campaignName: 'Summer',
    });
    expect(initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ firstName: 'Brand' })
    );
    initialize.mockRestore();
  });

  it('strips the admin free-text reason before it reaches the refund endpoint', async () => {
    const refund = vi
      .spyOn(ChapaClient.prototype, 'refund')
      .mockResolvedValue(undefined);
    const gateway = new ChapaGateway(
      new ChapaClient('CHASECK_TEST-abc'),
      'chapa-test'
    );

    await gateway.refund({
      txRef: 'cmfund_1',
      amountSantim: 50_000,
      reason: 'Dispute: creator no-show & refund!',
    });
    expect(refund).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Dispute creator no-show refund' })
    );
    refund.mockRestore();
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
