import {
  ChapaClient,
  type ChapaBank,
  type VerifiedTransaction,
  type VerifiedTransfer,
} from '@/lib/chapa/client';

/**
 * The external money gateway (KAN-70).
 *
 * Chapa has no hold/escrow primitive, so it does not replace the
 * `PaymentProvider` interface — escrow accounting stays internal
 * (`EscrowLedgerService` + `PgHoldStore`). Chapa touches money at exactly
 * three edges, and this seam is those edges:
 *
 *   money in    → `createFundingCheckout` + `verifyFunding`  (brand deposits)
 *   money out   → `sendTransfer` + `verifyTransfer`          (creator withdraws)
 *   money back  → `refund`                                   (dispute refunds)
 *
 * Selection follows the email-provider convention
 * (`lib/notifications/providers.ts`): configured → real gateway, unconfigured
 * → null, and every caller treats null as "the mock flow you have today".
 * That keeps CI, e2e, and offline dev byte-for-byte on the current behaviour
 * with zero extra env.
 */

export type PaymentGatewayMode = 'chapa-test' | 'chapa-live';

export interface FundingCheckout {
  checkoutUrl: string;
}

export interface PaymentGateway {
  /** Which rails, for UI hints ("test mode — no real money") and logging. */
  readonly mode: PaymentGatewayMode;

  /** Open a hosted checkout for a campaign's total. */
  createFundingCheckout(options: {
    txRef: string;
    amountSantim: number;
    email: string;
    firstName: string;
    lastName?: string;
    returnUrl: string;
    callbackUrl?: string;
    campaignName: string;
  }): Promise<FundingCheckout>;

  /** The truth about a charge — status, exact amount, currency, mode. */
  verifyFunding(txRef: string): Promise<VerifiedTransaction>;

  /** Payout destinations for the wallet's method picker. */
  listBanks(): Promise<ChapaBank[]>;

  /** Queue a transfer to a creator's bank/telebirr account. */
  sendTransfer(options: {
    txRef: string;
    amountSantim: number;
    accountName: string;
    accountNumber: string;
    bankCode: string;
  }): Promise<{ providerRef: string | null }>;

  /** The truth about a transfer. */
  verifyTransfer(txRef: string): Promise<VerifiedTransfer>;

  /** Refund part of a charge back to the payer's original method. */
  refund(options: {
    txRef: string;
    amountSantim: number;
    reason?: string;
  }): Promise<void>;
}

/**
 * Strip a merchant-supplied string down to the character set Chapa's
 * validators accept — letters, numbers, hyphens, underscores, spaces, and
 * dots — collapsed and capped. ASCII only: Chapa's published rule doesn't say
 * whether "letters" includes an Amharic name, and a stripped value still
 * passes validation where a rejected one loses the whole call.
 */
export function chapaSafeText(value: string, max: number): string {
  return value
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * The checkout-page description, within Chapa's own validation (anything else
 * in a campaign name — a colon, an ampersand, an emoji — would fail the whole
 * initialize call), capped well under the field limit.
 */
export function checkoutDescription(campaignName: string): string {
  return `Fund campaign ${chapaSafeText(campaignName, 100)}`
    .trim()
    .slice(0, 100);
}

export class ChapaGateway implements PaymentGateway {
  constructor(
    private readonly client: ChapaClient,
    public readonly mode: PaymentGatewayMode
  ) {}

  async createFundingCheckout(
    options: Parameters<PaymentGateway['createFundingCheckout']>[0]
  ): Promise<FundingCheckout> {
    return this.client.initializeTransaction({
      txRef: options.txRef,
      amountSantim: options.amountSantim,
      email: options.email,
      // Same defensive stance as the customization fields below: a brand
      // display name is free text ("Big & Bold ✨") and Chapa validates
      // names at initialize — strip rather than risk the whole checkout.
      firstName: chapaSafeText(options.firstName, 50) || 'Brand',
      lastName: options.lastName,
      returnUrl: options.returnUrl,
      callbackUrl: options.callbackUrl,
      // Chapa validates both customization fields at initialize: the title
      // must not exceed 16 characters, and the description may only contain
      // letters, numbers, hyphens, underscores, spaces, and dots — a colon
      // (or an emoji in a campaign name) fails the whole checkout.
      title: 'Fund campaign',
      // Chapa shows this on the checkout page — the brand should recognise
      // what they're paying for.
      description: checkoutDescription(options.campaignName),
    });
  }

  verifyFunding(txRef: string): Promise<VerifiedTransaction> {
    return this.client.verifyTransaction(txRef);
  }

  listBanks(): Promise<ChapaBank[]> {
    return this.client.listBanks();
  }

  sendTransfer(
    options: Parameters<PaymentGateway['sendTransfer']>[0]
  ): Promise<{ providerRef: string | null }> {
    return this.client.createTransfer(options);
  }

  verifyTransfer(txRef: string): Promise<VerifiedTransfer> {
    return this.client.verifyTransfer(txRef);
  }

  refund(options: Parameters<PaymentGateway['refund']>[0]): Promise<void> {
    // The reason is admin free text; Chapa's refund validation is
    // undocumented, so it gets the same strip-don't-risk treatment.
    const reason = options.reason
      ? chapaSafeText(options.reason, 100) || undefined
      : undefined;
    return this.client.refund({ ...options, reason });
  }
}

/** Chapa's own key prefixes make the mode self-evident from the secret. */
export function gatewayModeForKey(secretKey: string): PaymentGatewayMode {
  return secretKey.startsWith('CHASECK_TEST-') ? 'chapa-test' : 'chapa-live';
}

let cachedGateway: PaymentGateway | null | undefined;

/**
 * The process-wide gateway, or null when `CHAPA_SECRET_KEY` is unset —
 * null meaning "mock mode": funding stays the instant in-process call,
 * wallet withdrawal surfaces stay hidden.
 */
export function getPaymentGateway(): PaymentGateway | null {
  if (cachedGateway === undefined) {
    const secretKey = process.env.CHAPA_SECRET_KEY;
    cachedGateway = secretKey
      ? new ChapaGateway(
          new ChapaClient(secretKey),
          gatewayModeForKey(secretKey)
        )
      : null;
  }
  return cachedGateway;
}

/** Test hook: drop the cached gateway so env changes take effect. */
export function resetPaymentGatewayCache(): void {
  cachedGateway = undefined;
}

/**
 * What the UI should say about money. `mock` renders today's instant-fund
 * demo flow; `chapa-test` adds the "test mode — no real money" hint cards;
 * `chapa-live` is the real thing (post-MVP, needs business verification).
 */
export function paymentUxMode(): 'mock' | PaymentGatewayMode {
  return getPaymentGateway()?.mode ?? 'mock';
}
