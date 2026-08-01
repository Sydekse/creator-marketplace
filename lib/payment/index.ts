export { PaymentError } from './types';
export type {
  PaymentProvider,
  ProviderHoldResult,
  ProviderCaptureResult,
  ProviderReleaseResult,
  ProviderStatus,
  PaymentErrorCode,
} from './types';

import { MockPaymentProvider } from './mock-provider';
export { MockPaymentProvider };
import type { PaymentProvider as PaymentProviderType } from './types';
let cachedProvider: PaymentProviderType | null = null;

export function getPaymentProvider(): PaymentProviderType {
  if (!cachedProvider) {
    cachedProvider = new MockPaymentProvider();
  }
  return cachedProvider;
}
