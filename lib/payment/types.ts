/**
 * Abstract payment processor interface.
 *
 * All amounts are integer ETB santim (1 ETB = 100 santim).
 * Every mutation accepts an `idempotencyKey` — re-invoking with the same key
 * returns the original result without re-executing. Different methods that
 * share the same key are NOT deduplicated (each method's key space is
 * independent).
 *
 * Implementations must guard against illegal state transitions:
 *   held  → held      (allowed: partial capture reduces remaining amount)
 *   held  → captured  (allowed once, when remaining amount reaches 0)
 *   held  → released  (allowed once)
 *   captured/released → × (no further transitions)
 */
export interface PaymentProvider {
  /** Reserve `amount` santim. Returns a `providerRef` used in subsequent calls. */
  hold(amount: number, idempotencyKey: string): Promise<ProviderHoldResult>;

  /**
   * Transfer `amount` santim from the hold identified by `holdRef` to `recipient`.
   * `amount` must be ≤ the hold's original amount. Throws if the hold is not
   * in `held` state.
   */
  capturePayout(
    amount: number,
    recipient: string,
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderCaptureResult>;

  /** Release the entire hold identified by `holdRef`. Throws if not `held`. */
  releaseHold(
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderReleaseResult>;

  /** Query current state of a hold by its `providerRef`. */
  getStatus(providerRef: string): Promise<ProviderStatus>;
}

export interface ProviderHoldResult {
  providerRef: string;
  status: 'held';
  amount: number;
  heldAt: string;
}

export interface ProviderCaptureResult {
  providerRef: string;
  status: 'captured';
  capturedAt: string;
}

export interface ProviderReleaseResult {
  providerRef: string;
  status: 'released';
  releasedAt: string;
}

export interface ProviderStatus {
  providerRef: string;
  state: 'held' | 'captured' | 'released' | 'failed';
  amount: number;
  updatedAt: string;
  errorMessage?: string;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly code: PaymentErrorCode
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export type PaymentErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_REFERENCE'
  | 'DUPLICATE_IDEMPOTENCY'
  | 'INVALID_AMOUNT'
  | 'UNKNOWN';
