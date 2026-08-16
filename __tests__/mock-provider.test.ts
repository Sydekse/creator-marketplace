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

  describe('captureCommission', () => {
    // The platform's leg (KAN-68, F21). Every guard mirrors `capturePayout`
    // because both draw against the same remaining balance — the difference is
    // only that the platform needs no recipient.

    it('reduces the remaining amount and leaves the hold held', async () => {
      const hold = await provider.hold(3000, 'com-1');
      await provider.captureCommission(450, hold.providerRef, 'com-2');

      const status = await provider.getStatus(hold.providerRef);
      expect(status.amount).toBe(2550);
      expect(status.state).toBe('held');
    });

    it('takes a hold to captured together with the payout leg', async () => {
      // The property F21 exists for: the two legs between them drain the hold, so
      // it reaches the terminal state the contract documents instead of sitting at
      // `held` with the commission outstanding forever.
      const hold = await provider.hold(100_000, 'both-1');
      await provider.capturePayout(
        85_000,
        'creator_abc',
        hold.providerRef,
        'both-payout'
      );
      expect(await provider.getStatus(hold.providerRef)).toMatchObject({
        state: 'held',
        amount: 15_000,
      });

      await provider.captureCommission(15_000, hold.providerRef, 'both-comm');
      expect(await provider.getStatus(hold.providerRef)).toMatchObject({
        state: 'captured',
        amount: 0,
      });
    });

    it('throws on an unknown ref', async () => {
      await expect(
        provider.captureCommission(100, 'unknown', 'com-unknown')
      ).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    });

    it('refuses a hold that is not held', async () => {
      const hold = await provider.hold(1000, 'com-rel-1');
      await provider.releaseHold(hold.providerRef, 'com-rel-2');
      await expect(
        provider.captureCommission(100, hold.providerRef, 'com-rel-3')
      ).rejects.toThrow(/expected 'held'/);
    });

    it('refuses more than the remaining amount', async () => {
      const hold = await provider.hold(1000, 'com-exc-1');
      await provider.capturePayout(
        900,
        'creator_abc',
        hold.providerRef,
        'com-exc-2'
      );
      // 200 is under the original hold and over what is left of it.
      await expect(
        provider.captureCommission(200, hold.providerRef, 'com-exc-3')
      ).rejects.toThrow('INSUFFICIENT_FUNDS');
    });

    it('refuses a zero amount', async () => {
      // Which is why the ledger skips this leg when the commission rounds to
      // zero — reachable at a 0% rate or a very small total.
      const hold = await provider.hold(1000, 'com-zero-1');
      await expect(
        provider.captureCommission(0, hold.providerRef, 'com-zero-2')
      ).rejects.toThrow('INVALID_AMOUNT');
    });

    it('deduplicates an identical retry by idempotency key', async () => {
      const hold = await provider.hold(1000, 'com-dup-1');
      const first = await provider.captureCommission(
        150,
        hold.providerRef,
        'com-dup-2'
      );
      const second = await provider.captureCommission(
        150,
        hold.providerRef,
        'com-dup-2'
      );

      expect(second).toEqual(first);
      // The replay did not move money a second time.
      expect(await provider.getStatus(hold.providerRef)).toMatchObject({
        amount: 850,
      });
    });

    it('rejects the same key with a different amount', async () => {
      const hold = await provider.hold(1000, 'com-arg-1');
      await provider.captureCommission(150, hold.providerRef, 'com-arg-2');
      await expect(
        provider.captureCommission(200, hold.providerRef, 'com-arg-2')
      ).rejects.toThrow('DUPLICATE_IDEMPOTENCY');
    });

    it('surfaces an injected failure without touching the hold', async () => {
      const hold = await provider.hold(1000, 'com-fail-1');
      provider.setFailNext('captureCommission');

      await expect(
        provider.captureCommission(150, hold.providerRef, 'com-fail-2')
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });

      expect(await provider.getStatus(hold.providerRef)).toMatchObject({
        state: 'held',
        amount: 1000,
      });
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

    it('keeps the two capture legs in separate key spaces', async () => {
      // A deal's two legs are keyed off one method-level UUID, so they differ
      // only by suffix today — but if a caller ever handed both the same key,
      // neither may replay the other's cached result.
      const hold = await provider.hold(1000, 'legs-1');
      await provider.capturePayout(
        850,
        'creator_abc',
        hold.providerRef,
        'same-key'
      );
      await provider.captureCommission(150, hold.providerRef, 'same-key');

      expect(await provider.getStatus(hold.providerRef)).toMatchObject({
        state: 'captured',
        amount: 0,
      });
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
