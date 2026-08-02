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
      const second = await provider.hold(1000, 'dup-key');
      expect(second.providerRef).toBe(first.providerRef);
      expect(second.heldAt).toBe(first.heldAt);
    });

    it('throws DUPLICATE_IDEMPOTENCY when key reused with different amount', async () => {
      await provider.hold(1000, 'mis-key');
      await expect(provider.hold(9999, 'mis-key')).rejects.toThrow(
        'DUPLICATE_IDEMPOTENCY'
      );
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

    it('rejects non-integer amount', async () => {
      await expect(provider.hold(10.5, 'int-1')).rejects.toThrow(
        'INVALID_AMOUNT'
      );
    });

    it('rejects negative amount', async () => {
      await expect(provider.hold(-5000, 'neg-1')).rejects.toThrow(
        'INVALID_AMOUNT'
      );
    });

    it('rejects zero amount', async () => {
      await expect(provider.hold(0, 'zero-1')).rejects.toThrow(
        'INVALID_AMOUNT'
      );
    });
  });

  describe('capturePayout', () => {
    it('captures a held amount', async () => {
      const hold = await provider.hold(5000, 'cap-key-1');
      const result = await provider.capturePayout(
        5000,
        'creator_abc',
        hold.providerRef,
        'cap-key-2'
      );
      expect(result.status).toBe('captured');
      expect(result.providerRef).toBe(hold.providerRef);
    });

    it('throws on invalid hold ref', async () => {
      await expect(
        provider.capturePayout(100, 'creator_abc', 'nonexistent', 'cap-key-3')
      ).rejects.toThrow(PaymentError);
    });

    it('rejects capture when hold is already captured', async () => {
      const hold = await provider.hold(5000, 'st-c1');
      await provider.capturePayout(
        5000,
        'creator_abc',
        hold.providerRef,
        'st-c2'
      );
      await expect(
        provider.capturePayout(100, 'creator_abc', hold.providerRef, 'st-c3')
      ).rejects.toThrow(/expected 'held'/);
    });

    it('rejects capture when hold is already released', async () => {
      const hold = await provider.hold(5000, 'st-r1');
      await provider.releaseHold(hold.providerRef, 'st-r2');
      await expect(
        provider.capturePayout(100, 'creator_abc', hold.providerRef, 'st-r3')
      ).rejects.toThrow(/expected 'held'/);
    });

    it('rejects capture exceeding hold amount', async () => {
      const hold = await provider.hold(1000, 'exc-1');
      await expect(
        provider.capturePayout(2000, 'creator_abc', hold.providerRef, 'exc-2')
      ).rejects.toThrow('INSUFFICIENT_FUNDS');
    });

    it('partial capture reduces remaining amount', async () => {
      const hold = await provider.hold(3000, 'part-1');
      await provider.capturePayout(
        1000,
        'creator_abc',
        hold.providerRef,
        'part-2'
      );
      const status = await provider.getStatus(hold.providerRef);
      expect(status.amount).toBe(2000);
      expect(status.state).toBe('held');
    });

    it('full capture marks state captured', async () => {
      const hold = await provider.hold(3000, 'full-1');
      await provider.capturePayout(
        3000,
        'creator_abc',
        hold.providerRef,
        'full-2'
      );
      const status = await provider.getStatus(hold.providerRef);
      expect(status.amount).toBe(0);
      expect(status.state).toBe('captured');
    });

    it('deduplicates an identical retry by idempotency key', async () => {
      const hold = await provider.hold(3000, 'cap-dup-1');
      const first = await provider.capturePayout(
        3000,
        'creator_abc',
        hold.providerRef,
        'cap-dup-2'
      );
      const second = await provider.capturePayout(
        3000,
        'creator_abc',
        hold.providerRef,
        'cap-dup-2'
      );
      expect(second.providerRef).toBe(first.providerRef);
      expect(second.capturedAt).toBe(first.capturedAt);
    });

    it('does not re-execute on an identical retry', async () => {
      const hold = await provider.hold(3000, 'cap-once-1');
      await provider.capturePayout(
        1000,
        'creator_abc',
        hold.providerRef,
        'cap-once-2'
      );
      await provider.capturePayout(
        1000,
        'creator_abc',
        hold.providerRef,
        'cap-once-2'
      );
      // Draining the hold twice would leave 1000. The replay must be a no-op.
      const status = await provider.getStatus(hold.providerRef);
      expect(status.amount).toBe(2000);
    });

    it('throws DUPLICATE_IDEMPOTENCY when key reused with a different amount', async () => {
      const hold = await provider.hold(5000, 'cap-mis-1');
      await provider.capturePayout(
        1000,
        'creator_abc',
        hold.providerRef,
        'cap-mis-2'
      );
      await expect(
        provider.capturePayout(
          2000,
          'creator_abc',
          hold.providerRef,
          'cap-mis-2'
        )
      ).rejects.toThrow('DUPLICATE_IDEMPOTENCY');
    });

    it('throws DUPLICATE_IDEMPOTENCY when key reused with a different recipient', async () => {
      const hold = await provider.hold(5000, 'cap-rcp-1');
      await provider.capturePayout(
        1000,
        'creator_abc',
        hold.providerRef,
        'cap-rcp-2'
      );
      await expect(
        provider.capturePayout(
          1000,
          'creator_xyz',
          hold.providerRef,
          'cap-rcp-2'
        )
      ).rejects.toThrow('DUPLICATE_IDEMPOTENCY');
    });

    it('throws DUPLICATE_IDEMPOTENCY when key reused against a different hold', async () => {
      const first = await provider.hold(1000, 'cap-ref-1');
      const second = await provider.hold(5000, 'cap-ref-2');
      await provider.capturePayout(
        1000,
        'creator_abc',
        first.providerRef,
        'cap-ref-3'
      );
      await expect(
        provider.capturePayout(
          1000,
          'creator_abc',
          second.providerRef,
          'cap-ref-3'
        )
      ).rejects.toThrow('DUPLICATE_IDEMPOTENCY');

      // The mismatched request must not have moved money on the second hold.
      const status = await provider.getStatus(second.providerRef);
      expect(status.state).toBe('held');
      expect(status.amount).toBe(5000);
    });

    it('throws PaymentError when failNext is set', async () => {
      const hold = await provider.hold(2000, 'cap-fail-1');
      provider.setFailNext('capturePayout');
      await expect(
        provider.capturePayout(
          2000,
          'creator_abc',
          hold.providerRef,
          'cap-fail-2'
        )
      ).rejects.toThrow(PaymentError);
    });

    it('rejects non-integer amount', async () => {
      const hold = await provider.hold(1000, 'ci-1');
      await expect(
        provider.capturePayout(10.5, 'creator_abc', hold.providerRef, 'ci-2')
      ).rejects.toThrow('INVALID_AMOUNT');
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

    it('rejects release when hold is already captured', async () => {
      const hold = await provider.hold(5000, 'rs-c1');
      await provider.capturePayout(
        5000,
        'creator_abc',
        hold.providerRef,
        'rs-c2'
      );
      await expect(
        provider.releaseHold(hold.providerRef, 'rs-c3')
      ).rejects.toThrow(/expected 'held'/);
    });

    it('rejects release when hold is already released', async () => {
      const hold = await provider.hold(5000, 'rs-r1');
      await provider.releaseHold(hold.providerRef, 'rs-r2');
      await expect(
        provider.releaseHold(hold.providerRef, 'rs-r3')
      ).rejects.toThrow(/expected 'held'/);
    });

    it('deduplicates an identical retry by idempotency key', async () => {
      const hold = await provider.hold(6000, 'rel-dup-1');
      const first = await provider.releaseHold(hold.providerRef, 'rel-dup-2');
      const second = await provider.releaseHold(hold.providerRef, 'rel-dup-2');
      expect(second.providerRef).toBe(first.providerRef);
      expect(second.releasedAt).toBe(first.releasedAt);
    });

    it('throws DUPLICATE_IDEMPOTENCY when key reused against a different hold', async () => {
      const first = await provider.hold(6000, 'rel-mis-1');
      const second = await provider.hold(7000, 'rel-mis-2');
      await provider.releaseHold(first.providerRef, 'rel-mis-3');
      await expect(
        provider.releaseHold(second.providerRef, 'rel-mis-3')
      ).rejects.toThrow('DUPLICATE_IDEMPOTENCY');

      // The second hold must be untouched by the rejected replay.
      const status = await provider.getStatus(second.providerRef);
      expect(status.state).toBe('held');
      expect(status.amount).toBe(7000);
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
      await provider.capturePayout(
        8000,
        'creator_abc',
        hold.providerRef,
        'stat-key-3'
      );
      const status = await provider.getStatus(hold.providerRef);
      expect(status.state).toBe('captured');
      expect(status.amount).toBe(0);
    });

    it('returns held status after partial capture', async () => {
      const hold = await provider.hold(5000, 'stat-part-1');
      await provider.capturePayout(
        2000,
        'creator_abc',
        hold.providerRef,
        'stat-part-2'
      );
      const status = await provider.getStatus(hold.providerRef);
      expect(status.state).toBe('held');
      expect(status.amount).toBe(3000);
    });

    it('throws on unknown ref', async () => {
      await expect(provider.getStatus('unknown')).rejects.toThrow(PaymentError);
    });
  });

  describe('idempotency cross-method', () => {
    it('does not deduplicate across different methods with same key', async () => {
      const hold = await provider.hold(5000, 'cross-1');
      await provider.capturePayout(
        5000,
        'creator_abc',
        hold.providerRef,
        'cross-key'
      );
      const secondHold = await provider.hold(3000, 'cross-key');
      expect(secondHold.status).toBe('held');
      expect(secondHold.providerRef).not.toBe(hold.providerRef);
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
