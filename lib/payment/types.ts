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
 *
 * Both `capturePayout` and `captureCommission` draw the remaining amount down,
 * so between them they take one deal's hold from `held` to `captured` — see
 * `captureCommission` for why the platform's leg is a method of its own.
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

  /**
   * Transfer the platform's commission out of the hold identified by `holdRef`.
   *
   * **This method is ours, not the specification's.** Neither the PRD, the tech
   * spec nor the KAN-40 spike describes the commission ever moving at the
   * provider: AC-023 says the funds are "released to the creator minus platform
   * commission" and never says where the commission goes, and the spec's only
   * documented call is `transfer(payout -> creator)`. So the commission used to
   * exist purely as a `commission` ledger row — our books said the platform took
   * its cut and the processor was never told, which left every hold stranded at
   * `held` with the commission slice outstanding forever.
   *
   * No `recipient`, unlike `capturePayout`. The platform is the only possible
   * destination, and the alternative — a second `capturePayout` addressed to a
   * platform account — needs an account identifier that no document defines and
   * that PRD Q3 defers past the MVP. An invented constant in the money path is
   * worse than a method that says what it does.
   *
   * `amount` must be ≤ the hold's remaining amount, and this throws if the hold
   * is not `held` — the same rules `capturePayout` follows, since both are
   * draws against the same remaining balance.
   */
  captureCommission(
    amount: number,
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderCaptureResult>;

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
