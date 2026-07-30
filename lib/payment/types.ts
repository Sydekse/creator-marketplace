export interface PaymentProvider {
  hold(amount: number, idempotencyKey: string): Promise<ProviderHoldResult>;

  capturePayout(
    amount: number,
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderCaptureResult>;

  releaseHold(
    holdRef: string,
    idempotencyKey: string
  ): Promise<ProviderReleaseResult>;

  getStatus(providerRef: string): Promise<ProviderStatus>;
}

export interface ProviderHoldResult {
  providerRef: string;
  status: 'held';
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
  | 'UNKNOWN';
