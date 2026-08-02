import type {
  PaymentProvider,
  ProviderHoldResult,
  ProviderCaptureResult,
  ProviderReleaseResult,
  ProviderStatus,
} from './types';
import { PaymentError } from './types';

interface HoldRecord {
  amount: number;
  state: ProviderStatus['state'];
  createdAt: string;
  updatedAt: string;
}

type IdempotencyRecord =
  ProviderHoldResult | ProviderCaptureResult | ProviderReleaseResult;

export class MockPaymentProvider implements PaymentProvider {
  private holds = new Map<string, HoldRecord>();
  private idempotency = new Map<
    string,
    { args: string; result: IdempotencyRecord }
  >();
  private failNext = new Map<string, true>();

  setFailNext(method: string): void {
    this.failNext.set(method, true);
  }

  clearFailNext(method: string): void {
    this.failNext.delete(method);
  }

  reset(): void {
    this.holds.clear();
    this.idempotency.clear();
    this.failNext.clear();
  }

  private assertValidAmount(amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new PaymentError(
        'INVALID_AMOUNT: Amount must be a positive integer',
        'INVALID_AMOUNT'
      );
    }
  }

  private idempotencyKey(method: string, key: string): string {
    return `${method}:${key}`;
  }

  /**
   * Returns the cached result for `key`, or null on first use.
   *
   * A key replayed with the *same* arguments is a retry — §5.3 of the KAN-40
   * spike retries serialization failures up to three times, and each attempt
   * reuses the key — so the original result is returned without re-executing.
   *
   * A key replayed with *different* arguments is a caller bug, not a retry. The
   * request being made is not the request that was executed, so returning the
   * original result would report success for work that never happened. Throw
   * instead, and let the caller's transaction roll back.
   *
   * `args` is compared by JSON serialisation. Every call site builds its literal
   * with the same key order, so the encoding is stable.
   */
  private checkIdempotency<T extends IdempotencyRecord>(
    method: string,
    key: string,
    args: unknown
  ): T | null {
    const cached = this.idempotency.get(this.idempotencyKey(method, key));
    if (!cached) return null;

    if (cached.args !== JSON.stringify(args)) {
      throw new PaymentError(
        'DUPLICATE_IDEMPOTENCY: Idempotency key reused with different arguments',
        'DUPLICATE_IDEMPOTENCY'
      );
    }

    return cached.result as T;
  }

  private setIdempotency<T extends IdempotencyRecord>(
    method: string,
    key: string,
    args: unknown,
    result: T
  ): void {
    this.idempotency.set(this.idempotencyKey(method, key), {
      args: JSON.stringify(args),
      result,
    });
  }

  async hold(
    amount: number,
    idempotencyKey: string
  ): Promise<ProviderHoldResult> {
    this.assertValidAmount(amount);

    const args = { amount };
    const cached = this.checkIdempotency<ProviderHoldResult>(
      'hold',
      idempotencyKey,
      args
    );
    if (cached) return cached;

    if (this.failNext.has('hold')) {
      this.failNext.delete('hold');
      throw new PaymentError('Mock hold failed', 'INSUFFICIENT_FUNDS');
    }

    const providerRef = `mock_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    this.holds.set(providerRef, {
      amount,
      state: 'held',
      createdAt: now,
      updatedAt: now,
    });

    const result: ProviderHoldResult = {
      providerRef,
      status: 'held',
      amount,
      heldAt: now,
    };

    this.setIdempotency('hold', idempotencyKey, args, result);
    return result;
  }

  async capturePayout(
    amount: number,
    recipient: string,
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderCaptureResult> {
    this.assertValidAmount(amount);

    const args = { amount, recipient, holdRef };
    const cached = this.checkIdempotency<ProviderCaptureResult>(
      'capturePayout',
      idempotencyKey,
      args
    );
    if (cached) return cached;

    if (this.failNext.has('capturePayout')) {
      this.failNext.delete('capturePayout');
      throw new PaymentError('Mock capture failed', 'PROVIDER_UNAVAILABLE');
    }

    const record = this.holds.get(holdRef);
    if (!record) {
      throw new PaymentError('Hold not found', 'INVALID_REFERENCE');
    }

    if (record.state !== 'held') {
      throw new PaymentError(
        `Hold is in state '${record.state}', expected 'held'`,
        'INVALID_REFERENCE'
      );
    }

    if (amount > record.amount) {
      throw new PaymentError(
        'INSUFFICIENT_FUNDS: Capture amount exceeds hold amount',
        'INSUFFICIENT_FUNDS'
      );
    }

    const now = new Date().toISOString();
    record.amount -= amount;
    if (record.amount === 0) {
      record.state = 'captured';
    }
    record.updatedAt = now;

    const result: ProviderCaptureResult = {
      providerRef: holdRef,
      status: 'captured',
      capturedAt: now,
    };

    this.setIdempotency('capturePayout', idempotencyKey, args, result);
    return result;
  }

  async releaseHold(
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderReleaseResult> {
    const args = { holdRef };
    const cached = this.checkIdempotency<ProviderReleaseResult>(
      'releaseHold',
      idempotencyKey,
      args
    );
    if (cached) return cached;

    if (this.failNext.has('releaseHold')) {
      this.failNext.delete('releaseHold');
      throw new PaymentError('Mock release failed', 'PROVIDER_UNAVAILABLE');
    }

    const record = this.holds.get(holdRef);
    if (!record) {
      throw new PaymentError('Hold not found', 'INVALID_REFERENCE');
    }

    if (record.state !== 'held') {
      throw new PaymentError(
        `Hold is in state '${record.state}', expected 'held'`,
        'INVALID_REFERENCE'
      );
    }

    const now = new Date().toISOString();
    record.state = 'released';
    record.updatedAt = now;

    const result: ProviderReleaseResult = {
      providerRef: holdRef,
      status: 'released',
      releasedAt: now,
    };

    this.setIdempotency('releaseHold', idempotencyKey, args, result);
    return result;
  }

  async getStatus(providerRef: string): Promise<ProviderStatus> {
    const record = this.holds.get(providerRef);
    if (!record) {
      throw new PaymentError('Hold not found', 'INVALID_REFERENCE');
    }

    return {
      providerRef,
      state: record.state,
      amount: record.amount,
      updatedAt: record.updatedAt,
    };
  }
}
