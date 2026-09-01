import { z } from 'zod';

/**
 * Chapa API client (KAN-70).
 *
 * A thin, typed wrapper over the endpoints this app uses — nothing more.
 * Verified against developer.chapa.co and the official chapa-nodejs SDK's
 * URL table (fireayehu/chapa-nodejs, src/enums/chapa-urls.enum.ts):
 *
 *   POST /v1/transaction/initialize        → hosted checkout URL
 *   GET  /v1/transaction/verify/{tx_ref}   → charge truth (status/amount/mode)
 *   GET  /v1/banks                         → payout destinations
 *   POST /v1/transfers                     → send money out (withdrawals)
 *   GET  /v1/transfers/verify/{tx_ref}     → transfer truth
 *   POST /v1/refund/{tx_ref}               → refund a charge (form-encoded)
 *
 * Two hard rules live here and nowhere else:
 *
 *   1. **Santim↔ETB conversion happens only at this boundary.** The whole app
 *      speaks integer santim; Chapa speaks decimal ETB strings. Every request
 *      converts on the way out and every response converts (exactly — a value
 *      that doesn't land on a whole santim is malformed) on the way in.
 *   2. **Responses are zod-parsed, never trusted.** A shape we don't recognise
 *      is a `ChapaError('MALFORMED')`, not an `any` allowed to wander into
 *      the money path.
 *
 * Transport failures and Chapa-side rejections both surface as `ChapaError`s
 * with a machine-readable code; callers at the three money edges decide what
 * each means for them. The client never retries — its callers own retry
 * policy because a retried charge and a retried transfer have very different
 * blast radii.
 */

const BASE_URL = 'https://api.chapa.co/v1';

export type ChapaErrorCode =
  /** Network failure, 5xx, or a response body that isn't JSON. */
  | 'UNAVAILABLE'
  /** Chapa answered and said no (4xx or an envelope with status ≠ success). */
  | 'REJECTED'
  /** Chapa answered "success" but the payload doesn't match its documented shape. */
  | 'MALFORMED';

export class ChapaError extends Error {
  constructor(
    message: string,
    public readonly code: ChapaErrorCode,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'ChapaError';
  }
}

// -- Money conversion ---------------------------------------------------------

/** Integer santim → the decimal ETB string Chapa's `amount` fields expect. */
export function santimToEtb(santim: number): string {
  if (!Number.isInteger(santim) || santim <= 0) {
    throw new ChapaError(
      `not a positive integer santim amount: ${santim}`,
      'MALFORMED'
    );
  }
  return `${Math.floor(santim / 100)}.${String(santim % 100).padStart(2, '0')}`;
}

/**
 * Chapa's decimal ETB (string or number) → integer santim, or null when the
 * value is not exactly representable. Null is a *verification failure* for
 * callers, never something to round past: money that doesn't land on a whole
 * santim is money we didn't ask for.
 */
export function etbToSantim(amount: string | number): number | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(amount));
  if (!match) return null;
  const fraction = match[2] ?? '';
  // "100.005" is not a santim amount; "100.50" and "100.5" both are.
  if (fraction.length > 2 && !/^0*$/.test(fraction.slice(2))) return null;
  const santim =
    Number(match[1]) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
  return Number.isSafeInteger(santim) ? santim : null;
}

// -- Response shapes ----------------------------------------------------------

/**
 * Every Chapa response wears the same envelope — except `/banks`, observed
 * live (2026-09-01) answering `{message, data}` with no `status` at all.
 * So: `status` is optional, and an *absent* status on a 2xx is success;
 * a *present* status must say so.
 */
const envelopeSchema = z.object({
  message: z.unknown().optional(),
  status: z.string().optional(),
  data: z.unknown().optional(),
});

const initializeDataSchema = z.object({
  checkout_url: z.string().url(),
});

const verifyDataSchema = z.object({
  status: z.string(),
  amount: z.union([z.string(), z.number()]),
  currency: z.string(),
  tx_ref: z.string(),
  reference: z.string().nullish(),
  /** 'test' | 'live' — checked by every caller before value is given. */
  mode: z.string().nullish(),
});

const bankSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string(),
  acct_length: z.number().nullish(),
  is_mobilemoney: z
    .union([z.boolean(), z.number()])
    .nullish()
    .transform((v) => (v == null ? null : Boolean(v))),
});

const transferVerifyDataSchema = z.object({
  status: z.string(),
  tx_ref: z.string().nullish(),
  reference: z.string().nullish(),
  amount: z.union([z.string(), z.number()]).nullish(),
});

export interface VerifiedTransaction {
  /** Chapa's charge status, lowercased: 'success' | 'pending' | 'failed' | … */
  status: string;
  /** Exact santim, or null when Chapa's decimal doesn't land on one. */
  amountSantim: number | null;
  currency: string;
  txRef: string;
  /** Chapa's own reference for the charge. */
  providerRef: string | null;
  /** 'test' | 'live' | null when absent. */
  mode: string | null;
}

export interface ChapaBank {
  code: string;
  name: string;
  accountLength: number | null;
  isMobileMoney: boolean | null;
}

export interface VerifiedTransfer {
  status: string;
  txRef: string | null;
  providerRef: string | null;
  amountSantim: number | null;
}

// -- Client ---------------------------------------------------------------------

/** Seam for tests: the only I/O this module performs. */
export interface ChapaClientDeps {
  fetchImpl: typeof fetch;
}

export class ChapaClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly secretKey: string,
    deps?: Partial<ChapaClientDeps>
  ) {
    this.fetchImpl = deps?.fetchImpl ?? fetch;
  }

  /** Open a hosted checkout; returns the URL to redirect the payer to. */
  async initializeTransaction(options: {
    txRef: string;
    amountSantim: number;
    email: string;
    firstName: string;
    lastName?: string;
    returnUrl: string;
    callbackUrl?: string;
    title?: string;
    description?: string;
  }): Promise<{ checkoutUrl: string }> {
    const data = await this.request(
      'POST',
      '/transaction/initialize',
      {
        amount: santimToEtb(options.amountSantim),
        currency: 'ETB',
        email: options.email,
        first_name: options.firstName,
        ...(options.lastName ? { last_name: options.lastName } : {}),
        tx_ref: options.txRef,
        return_url: options.returnUrl,
        ...(options.callbackUrl ? { callback_url: options.callbackUrl } : {}),
        ...(options.title || options.description
          ? {
              customization: {
                ...(options.title ? { title: options.title } : {}),
                ...(options.description
                  ? { description: options.description }
                  : {}),
              },
            }
          : {}),
      },
      initializeDataSchema
    );
    return { checkoutUrl: data.checkout_url };
  }

  /**
   * The truth about a charge. Callers must check `status === 'success'`,
   * the exact `amountSantim`, `currency === 'ETB'`, and `mode` before giving
   * value — Chapa's docs are explicit that the webhook alone is not enough.
   */
  async verifyTransaction(txRef: string): Promise<VerifiedTransaction> {
    const data = await this.request(
      'GET',
      `/transaction/verify/${encodeURIComponent(txRef)}`,
      null,
      verifyDataSchema
    );
    return {
      status: data.status.toLowerCase(),
      amountSantim: etbToSantim(data.amount),
      currency: data.currency,
      txRef: data.tx_ref,
      providerRef: data.reference ?? null,
      mode: data.mode ?? null,
    };
  }

  /** Payout destinations (banks and mobile-money entries alike). */
  async listBanks(): Promise<ChapaBank[]> {
    const data = await this.request('GET', '/banks', null, z.array(bankSchema));
    return data.map((bank) => ({
      code: String(bank.id),
      name: bank.name,
      accountLength: bank.acct_length ?? null,
      isMobileMoney: bank.is_mobilemoney ?? null,
    }));
  }

  /**
   * Send money from the merchant balance to a bank/telebirr account.
   * Returns Chapa's reference for the queued transfer. Acceptance is not
   * arrival — `verifyTransfer` (or the payout webhook) says when it lands.
   */
  async createTransfer(options: {
    txRef: string;
    amountSantim: number;
    accountName: string;
    accountNumber: string;
    bankCode: string;
  }): Promise<{ providerRef: string | null }> {
    const data = await this.request(
      'POST',
      '/transfers',
      {
        account_name: options.accountName,
        account_number: options.accountNumber,
        amount: santimToEtb(options.amountSantim),
        currency: 'ETB',
        bank_code: options.bankCode,
        reference: options.txRef,
      },
      // The SDK types this data leg as a bare string reference; be tolerant
      // of an object-shaped future without letting it break acceptance.
      z.union([z.string(), z.object({}).passthrough()]).nullish()
    );
    return { providerRef: typeof data === 'string' ? data : null };
  }

  async verifyTransfer(txRef: string): Promise<VerifiedTransfer> {
    const data = await this.request(
      'GET',
      `/transfers/verify/${encodeURIComponent(txRef)}`,
      null,
      transferVerifyDataSchema
    );
    return {
      status: data.status.toLowerCase(),
      txRef: data.tx_ref ?? null,
      providerRef: data.reference ?? null,
      amountSantim: data.amount == null ? null : etbToSantim(data.amount),
    };
  }

  /**
   * Refund a charge, in part or in full. Chapa takes this one form-encoded
   * (matching the official SDK), unlike every JSON endpoint above.
   */
  async refund(options: {
    txRef: string;
    amountSantim?: number;
    reason?: string;
  }): Promise<void> {
    const form = new URLSearchParams();
    if (options.amountSantim !== undefined) {
      form.set('amount', santimToEtb(options.amountSantim));
    }
    if (options.reason) form.set('reason', options.reason);
    await this.request(
      'POST',
      `/refund/${encodeURIComponent(options.txRef)}`,
      form,
      z.unknown()
    );
  }

  /**
   * One code path for every call: send, insist on JSON, insist on the
   * envelope saying success, then insist the data leg has the shape the
   * endpoint documents.
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown> | URLSearchParams | null,
    dataSchema: z.ZodType<T>
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          ...(body instanceof URLSearchParams
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : body
              ? { 'Content-Type': 'application/json' }
              : {}),
        },
        body:
          body instanceof URLSearchParams
            ? body.toString()
            : body
              ? JSON.stringify(body)
              : undefined,
      });
    } catch (cause) {
      throw new ChapaError(
        `chapa unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
        'UNAVAILABLE'
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ChapaError(
        `chapa returned non-JSON (http ${response.status})`,
        response.status >= 500 ? 'UNAVAILABLE' : 'MALFORMED',
        response.status
      );
    }

    if (response.status >= 500) {
      throw new ChapaError(
        `chapa unavailable (http ${response.status})`,
        'UNAVAILABLE',
        response.status
      );
    }

    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success) {
      throw new ChapaError('chapa response missing envelope', 'MALFORMED');
    }
    if (
      !response.ok ||
      (envelope.data.status !== undefined && envelope.data.status !== 'success')
    ) {
      throw new ChapaError(
        `chapa rejected ${path}: ${JSON.stringify(envelope.data.message ?? envelope.data.status)}`,
        'REJECTED',
        response.status
      );
    }

    const data = dataSchema.safeParse(envelope.data.data);
    if (!data.success) {
      throw new ChapaError(
        `chapa ${path} data shape unrecognised: ${data.error.issues[0]?.message ?? 'parse error'}`,
        'MALFORMED'
      );
    }
    return data.data;
  }
}
