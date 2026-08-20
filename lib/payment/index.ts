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
import { PgHoldStore } from './pg-hold-store';
import type { PaymentProvider as PaymentProviderType } from './types';
let cachedProvider: PaymentProviderType | null = null;

/**
 * The process-wide provider.
 *
 * `PgHoldStore` rather than the in-memory default (KAN-200). The cache below is
 * still worth having — one object per process — but it is no longer what makes a
 * hold findable: that is now the `provider_hold` table, because a serverless
 * deployment gives no guarantee that the instance which funded a campaign is the
 * instance that approves a deliverable against it. With holds in memory,
 * `capturePayout` answered `INVALID_REFERENCE` and the brand saw
 * "Payment failed — please try again." with nothing they could do about it.
 */
export function getPaymentProvider(): PaymentProviderType {
  if (!cachedProvider) {
    cachedProvider = new MockPaymentProvider(new PgHoldStore());

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
