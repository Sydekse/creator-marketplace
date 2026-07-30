import { describe, it, expect, beforeEach } from 'vitest';
import { MockPaymentProvider } from '../lib/payment/mock-provider';
import { PaymentError } from '../lib/payment/types';

describe('MockPaymentProvider', () => {
  let provider: MockPaymentProvider;

  beforeEach(() => {
    provider = new MockPaymentProvider();
  });

  describe('hold', () => {
    it('returns a hold result with provider ref and timestamp', async () => {
      const result = await provider.hold(1000, 'key-1');
      expect(result.status).toBe('held');
      expect(result.providerRef).toMatch(/^mock_/);
      expect(result.heldAt).toBeTruthy();
    });

    it('deduplicates by idempotency key', async () => {
      const first = await provider.hold(1000, 'dup-key');
      const second = await provider.hold(9999, 'dup-key');
      expect(second.providerRef).toBe(first.providerRef);
      expect(second.heldAt).toBe(first.heldAt);
    });

    it('throws PaymentError when failNext is set', async () => {
      provider.setFailNext('hold');
      await expect(provider.hold(1000, 'key-2')).rejects.toThrow(PaymentError);
    });

    it('only fails once per setFailNext call', async () => {
      provider.setFailNext('hold');
      await expect(provider.hold(1000, 'key-3')).rejects.toThrow(PaymentError);
      const result = await provider.hold(1000, 'key-4');
      expect(result.status).toBe('held');
    });
  });

  describe('capturePayout', () => {
    it('captures a held amount', async () => {
      const hold = await provider.hold(5000, 'cap-key-1');
      const result = await provider.capturePayout(
        5000,
        hold.providerRef,
        'cap-key-2'
      );
      expect(result.status).toBe('captured');
      expect(result.providerRef).toBe(hold.providerRef);
    });

    it('throws on invalid hold ref', async () => {
      await expect(
        provider.capturePayout(100, 'nonexistent', 'cap-key-3')
      ).rejects.toThrow(PaymentError);
    });

    it('deduplicates by idempotency key', async () => {
      const hold = await provider.hold(3000, 'cap-dup-1');
      const first = await provider.capturePayout(
        3000,
        hold.providerRef,
        'cap-dup-2'
      );
      const second = await provider.capturePayout(999, 'some-ref', 'cap-dup-2');
      expect(second.providerRef).toBe(first.providerRef);
    });

    it('throws PaymentError when failNext is set', async () => {
      const hold = await provider.hold(2000, 'cap-fail-1');
      provider.setFailNext('capturePayout');
      await expect(
        provider.capturePayout(2000, hold.providerRef, 'cap-fail-2')
      ).rejects.toThrow(PaymentError);
    });
  });

  describe('releaseHold', () => {
    it('releases a held amount', async () => {
      const hold = await provider.hold(4000, 'rel-key-1');
      const result = await provider.releaseHold(hold.providerRef, 'rel-key-2');
      expect(result.status).toBe('released');
    });

    it('throws on invalid hold ref', async () => {
      await expect(
        provider.releaseHold('nonexistent', 'rel-key-3')
      ).rejects.toThrow(PaymentError);
    });

    it('deduplicates by idempotency key', async () => {
      const hold = await provider.hold(6000, 'rel-dup-1');
      const first = await provider.releaseHold(hold.providerRef, 'rel-dup-2');
      const second = await provider.releaseHold('some-ref', 'rel-dup-2');
      expect(second.providerRef).toBe(first.providerRef);
    });
  });

  describe('getStatus', () => {
    it('returns held status for a pending hold', async () => {
      const hold = await provider.hold(7000, 'stat-key-1');
      const status = await provider.getStatus(hold.providerRef);
      expect(status.state).toBe('held');
      expect(status.amount).toBe(7000);
    });

    it('returns captured status after capture', async () => {
      const hold = await provider.hold(8000, 'stat-key-2');
      await provider.capturePayout(8000, hold.providerRef, 'stat-key-3');
      const status = await provider.getStatus(hold.providerRef);
      expect(status.state).toBe('captured');
    });

    it('returns failed status for unknown ref', async () => {
      const status = await provider.getStatus('unknown');
      expect(status.state).toBe('failed');
      expect(status.errorMessage).toBeTruthy();
    });
  });

  describe('reset', () => {
    it('clears all state', async () => {
      await provider.hold(100, 'reset-key-1');
      provider.setFailNext('hold');
      provider.reset();
      const result = await provider.hold(200, 'reset-key-2');
      expect(result.status).toBe('held');
    });
  });
});
