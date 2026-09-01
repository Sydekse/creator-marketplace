import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Chapa webhook verification and event parsing (KAN-70).
 *
 * Chapa POSTs the raw JSON payload with two signature headers, and its docs
 * say verifying **either** one is sufficient:
 *
 *   `Chapa-Signature`   — HMAC-SHA256 of the request body, keyed by the
 *                         dashboard-configured webhook secret.
 *   `x-chapa-signature` — HMAC-SHA256 of the secret itself, keyed by the
 *                         secret (a constant per secret; weaker, but theirs).
 *
 * Verification runs against the *raw body string*, before any JSON parsing —
 * re-serialising parsed JSON can reorder keys and break the HMAC.
 *
 * Parsing is deliberately tolerant. Chapa's payout/refund payload shapes are
 * thinly documented, so `parseChapaEvent` classifies just enough to route the
 * event (transaction vs payout vs refund, via the documented `type`/`event`
 * discriminators) and hands the caller loosely-typed fields plus the raw
 * payload. The handlers give no value based on any of it — the funding leg
 * re-verifies via the API and the payout leg matches on our own single-use
 * `tx_ref` — so an unrecognised shape degrades to a logged no-op, never a
 * wrong credit.
 */

function hmacHex(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual demands equal lengths; unequal lengths are just a miss.
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * True when at least one of the two Chapa signature headers checks out.
 * A request with neither header, or with only wrong ones, is not Chapa's.
 */
export function verifyChapaSignature(
  rawBody: string,
  headers: { chapaSignature?: string | null; xChapaSignature?: string | null },
  secret: string
): boolean {
  if (secret.length === 0) return false;
  const bodySigned = hmacHex(rawBody, secret);
  const secretSigned = hmacHex(secret, secret);
  if (
    headers.chapaSignature &&
    safeEqualHex(bodySigned, headers.chapaSignature)
  ) {
    return true;
  }
  if (
    headers.xChapaSignature &&
    (safeEqualHex(secretSigned, headers.xChapaSignature) ||
      // Some Chapa integrations sign the body into this header instead;
      // accepting our own body-HMAC here costs nothing in security.
      safeEqualHex(bodySigned, headers.xChapaSignature))
  ) {
    return true;
  }
  return false;
}

// -- Event classification -------------------------------------------------------

const eventShape = z
  .object({
    /** 'API' transactions carry event names like 'charge.success'. */
    event: z.string().nullish(),
    /** Transfer/payout webhooks carry a `type` discriminator instead. */
    type: z.string().nullish(),
    status: z.string().nullish(),
    tx_ref: z.string().nullish(),
    reference: z.string().nullish(),
    amount: z.union([z.string(), z.number()]).nullish(),
    currency: z.string().nullish(),
    mode: z.string().nullish(),
  })
  .passthrough();

export type ChapaEventKind = 'transaction' | 'payout' | 'refund' | 'unknown';

export interface ChapaEvent {
  kind: ChapaEventKind;
  /** The raw discriminator ('charge.success', 'transfer', …), lowercased. */
  name: string | null;
  /** Chapa's status word for the event, lowercased ('success', 'failed', …). */
  status: string | null;
  /** Our merchant reference, when present — the join back to our rows. */
  txRef: string | null;
  /** Chapa's own reference. */
  providerRef: string | null;
  raw: unknown;
}

/**
 * Classify a (signature-verified) webhook payload. Never throws: a payload
 * that doesn't parse is an `unknown` event for the caller to log and 200.
 */
export function parseChapaEvent(payload: unknown): ChapaEvent {
  const parsed = eventShape.safeParse(payload);
  if (!parsed.success) {
    return {
      kind: 'unknown',
      name: null,
      status: null,
      txRef: null,
      providerRef: null,
      raw: payload,
    };
  }
  const data = parsed.data;
  const name = (data.event ?? data.type ?? '').toLowerCase() || null;

  let kind: ChapaEventKind = 'unknown';
  if (name) {
    if (name.includes('transfer') || name.includes('payout')) {
      kind = 'payout';
    } else if (name.includes('refund')) {
      kind = 'refund';
    } else if (name.includes('charge') || name.includes('transaction')) {
      kind = 'transaction';
    }
  } else if (data.tx_ref) {
    // No discriminator at all but a merchant reference — treat as a
    // transaction event; the handler's API re-verification decides the rest.
    kind = 'transaction';
  }

  return {
    kind,
    name,
    status: data.status?.toLowerCase() ?? null,
    txRef: data.tx_ref ?? null,
    providerRef: data.reference ?? null,
    raw: payload,
  };
}
