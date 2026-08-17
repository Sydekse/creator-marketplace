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

    // KAN-60 e2e hook (flow 5, AC-020): a dedicated e2e server runs with
    // `PAYMENT_FAIL_METHOD=capturePayout` (or `hold`) so the browser can
    // exercise the payment-failure path through the real UI. The provider is
    // created lazily on first use, so reading the env here arms exactly the
    // first payment attempt of that server. Unset in every normal run, and
    // harmless if set: `setFailNext` fails one call, then clears.
    const failMethod = process.env.PAYMENT_FAIL_METHOD;
    if (
      failMethod &&
      cachedProvider instanceof MockPaymentProvider &&
      (failMethod === 'hold' ||
        failMethod === 'capturePayout' ||
        failMethod === 'release')
    ) {
      cachedProvider.setFailNext(failMethod);
    }
  }
  return cachedProvider;
}
