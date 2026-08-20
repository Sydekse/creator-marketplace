import { InMemoryHoldStore } from './hold-store';
import type { HoldRecord, HoldStore } from './hold-store';
import type {
  PaymentProvider,
  ProviderHoldResult,
  ProviderCaptureResult,
  ProviderReleaseResult,
  ProviderStatus,
} from './types';
import { PaymentError } from './types';

type IdempotencyRecord =
  ProviderHoldResult | ProviderCaptureResult | ProviderReleaseResult;

export class MockPaymentProvider implements PaymentProvider {
  private idempotency = new Map<
    string,
    { args: string; result: IdempotencyRecord }
  >();
  private failNext = new Map<string, true>();

  /**
   * Holds live in `store`; the other two maps stay in memory (KAN-200).
   *
   * That asymmetry is the whole point rather than a half-finished job. A hold is
   * read by a *later request* — funding places it and approval draws it down — so
   * it has to outlive the instance. An idempotency key is not: every caller in
   * `lib/payment/ledger.ts` mints one with `crypto.randomUUID()` at the top of
   * the call, outside the transaction, so a key is only ever replayed inside one
   * request's own serialization-failure retry loop (spike §5.3). Persisting them
   * would add a table that nothing could ever read a second time. `failNext` is a
   * test and e2e affordance and is armed per process by construction.
   *
   * The default keeps every existing construction site — `db/seed.ts`,
   * `tests/integration/helpers.ts`, and every unit test — working unchanged and
   * database-free. Only `getPaymentProvider()` passes a `PgHoldStore`.
   */
  constructor(private readonly store: HoldStore = new InMemoryHoldStore()) {}

  setFailNext(method: string): void {
    this.failNext.set(method, true);
  }

  clearFailNext(method: string): void {
    this.failNext.delete(method);
  }

  async reset(): Promise<void> {
    await this.store.clear();
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

  /**
   * The hold at `holdRef`, or the refusal that stops the caller's transaction.
   *
   * Extracted at its third caller (KAN-200) — `capturePayout`,
   * `captureCommission` and `releaseHold` open with the same two guards, and the
   * store made each of them two statements longer. The guards are what keep the
   * provider's documented transition table honest (`types.ts`: nothing leaves
   * `captured` or `released`), so having one copy of them is the point rather
   * than a saving.
   *
   * The returned record is a copy — `HoldStore.get` guarantees that — so mutating
   * it changes nothing until the caller writes it back with `store.put`.
   */
  private async loadHeld(holdRef: string): Promise<HoldRecord> {
    const record = await this.store.get(holdRef);
    if (!record) {
      throw new PaymentError('Hold not found', 'INVALID_REFERENCE');
    }

    if (record.state !== 'held') {
      throw new PaymentError(
        `Hold is in state '${record.state}', expected 'held'`,
        'INVALID_REFERENCE'
      );
    }

    return record;
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

    await this.store.put(providerRef, {
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

    const record = await this.loadHeld(holdRef);

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
    await this.store.put(holdRef, record);

    const result: ProviderCaptureResult = {
      providerRef: holdRef,
      status: 'captured',
      capturedAt: now,
    };

    this.setIdempotency('capturePayout', idempotencyKey, args, result);
    return result;
  }

  /**
   * The platform's leg of a payout (KAN-68, F21).
   *
   * `capturePayout` minus the recipient — see `PaymentProvider.captureCommission`
   * for why the platform needs no identifier. Every guard is the same, because
   * both methods draw against the same remaining balance: a positive integer
   * amount, a hold that is still `held`, and no draw larger than what is left.
   *
   * Its idempotency key space is independent of `capturePayout`'s, so a deal's
   * two legs cannot replay each other's cached result even if they were somehow
   * handed the same key.
   */
  async captureCommission(
    amount: number,
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderCaptureResult> {
    this.assertValidAmount(amount);

    const args = { amount, holdRef };
    const cached = this.checkIdempotency<ProviderCaptureResult>(
      'captureCommission',
      idempotencyKey,
      args
    );
    if (cached) return cached;

    if (this.failNext.has('captureCommission')) {
      this.failNext.delete('captureCommission');
      throw new PaymentError(
        'Mock commission capture failed',
        'PROVIDER_UNAVAILABLE'
      );
    }

    const record = await this.loadHeld(holdRef);

    if (amount > record.amount) {
      throw new PaymentError(
        'INSUFFICIENT_FUNDS: Commission amount exceeds hold amount',
        'INSUFFICIENT_FUNDS'
      );
    }

    const now = new Date().toISOString();
    record.amount -= amount;
    if (record.amount === 0) {
      record.state = 'captured';
    }
    record.updatedAt = now;
    await this.store.put(holdRef, record);

    const result: ProviderCaptureResult = {
      providerRef: holdRef,
      status: 'captured',
      capturedAt: now,
    };

    this.setIdempotency('captureCommission', idempotencyKey, args, result);
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

    const record = await this.loadHeld(holdRef);

    const now = new Date().toISOString();
    record.state = 'released';
    record.updatedAt = now;
    await this.store.put(holdRef, record);

    const result: ProviderReleaseResult = {
      providerRef: holdRef,
      status: 'released',
      releasedAt: now,
    };

    this.setIdempotency('releaseHold', idempotencyKey, args, result);
    return result;
  }

  async getStatus(providerRef: string): Promise<ProviderStatus> {
    const record = await this.store.get(providerRef);
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
