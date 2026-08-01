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
    { key: string; result: IdempotencyRecord }
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

  private checkIdempotency<T extends IdempotencyRecord>(
    method: string,
    key: string
  ): T | null {
    const cached = this.idempotency.get(this.idempotencyKey(method, key));
    return (cached?.result ?? null) as T | null;
  }

  private setIdempotency<T extends IdempotencyRecord>(
    method: string,
    key: string,
    result: T
  ): void {
    this.idempotency.set(this.idempotencyKey(method, key), {
      key,
      result,
    });
  }

  async hold(
    amount: number,
    idempotencyKey: string
  ): Promise<ProviderHoldResult> {
    this.assertValidAmount(amount);

    const cached = this.checkIdempotency<ProviderHoldResult>(
      'hold',
      idempotencyKey
    );
    if (cached) {
      if (cached.amount !== amount) {
        throw new PaymentError(
          'DUPLICATE_IDEMPOTENCY: Idempotency key reused with different arguments',
          'DUPLICATE_IDEMPOTENCY'
        );
      }
      return cached;
    }

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

    this.setIdempotency('hold', idempotencyKey, result);
    return result;
  }

  async capturePayout(
    amount: number,
    _recipient: string,
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderCaptureResult> {
    this.assertValidAmount(amount);

    const cached = this.checkIdempotency<ProviderCaptureResult>(
      'capturePayout',
      idempotencyKey
    );
    if (cached) {
      return cached;
    }

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

    this.setIdempotency('capturePayout', idempotencyKey, result);
    return result;
  }

  async releaseHold(
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderReleaseResult> {
    const cached = this.checkIdempotency<ProviderReleaseResult>(
      'releaseHold',
      idempotencyKey
    );
    if (cached) {
      return cached;
    }

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

    this.setIdempotency('releaseHold', idempotencyKey, result);
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
