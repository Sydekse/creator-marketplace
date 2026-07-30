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
  private idempotency = new Map<string, IdempotencyRecord>();
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

  async hold(
    amount: number,
    idempotencyKey: string
  ): Promise<ProviderHoldResult> {
    const cached = this.idempotency.get(idempotencyKey);
    if (cached && cached.status === 'held') {
      return cached as ProviderHoldResult;
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
      heldAt: now,
    };

    this.idempotency.set(idempotencyKey, result);
    return result;
  }

  async capturePayout(
    amount: number,
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderCaptureResult> {
    const cached = this.idempotency.get(idempotencyKey);
    if (cached && cached.status === 'captured') {
      return cached as ProviderCaptureResult;
    }

    if (this.failNext.has('capturePayout')) {
      this.failNext.delete('capturePayout');
      throw new PaymentError('Mock capture failed', 'PROVIDER_UNAVAILABLE');
    }

    const record = this.holds.get(holdRef);
    if (!record) {
      throw new PaymentError('Hold not found', 'INVALID_REFERENCE');
    }

    const now = new Date().toISOString();
    record.state = 'captured';
    record.updatedAt = now;

    const result: ProviderCaptureResult = {
      providerRef: holdRef,
      status: 'captured',
      capturedAt: now,
    };

    this.idempotency.set(idempotencyKey, result);
    return result;
  }

  async releaseHold(
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderReleaseResult> {
    const cached = this.idempotency.get(idempotencyKey);
    if (cached && cached.status === 'released') {
      return cached as ProviderReleaseResult;
    }

    if (this.failNext.has('releaseHold')) {
      this.failNext.delete('releaseHold');
      throw new PaymentError('Mock release failed', 'PROVIDER_UNAVAILABLE');
    }

    const record = this.holds.get(holdRef);
    if (!record) {
      throw new PaymentError('Hold not found', 'INVALID_REFERENCE');
    }

    const now = new Date().toISOString();
    record.state = 'released';
    record.updatedAt = now;

    const result: ProviderReleaseResult = {
      providerRef: holdRef,
      status: 'released',
      releasedAt: now,
    };

    this.idempotency.set(idempotencyKey, result);
    return result;
  }

  async getStatus(providerRef: string): Promise<ProviderStatus> {
    const record = this.holds.get(providerRef);
    if (!record) {
      return {
        providerRef,
        state: 'failed',
        amount: 0,
        updatedAt: new Date().toISOString(),
        errorMessage: 'Hold not found',
      };
    }

    return {
      providerRef,
      state: record.state,
      amount: record.amount,
      updatedAt: record.updatedAt,
    };
  }
}
