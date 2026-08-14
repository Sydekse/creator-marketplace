/**
 * Structured logging primitives, shared by every path that has to write a
 * diagnosable line about a failure without leaking its contents (NFR-010).
 *
 * Extracted from `lib/scheduler/harness.ts` on KAN-44, at the second caller and
 * not before, matching how `lib/money.ts` and `lib/paging.ts` arrived. The
 * scheduler still re-exports both functions, so no existing call site moved.
 *
 * The alternative was for `lib/payment/` to import from `lib/scheduler/`, which
 * would have been a lie about the dependency — funding a campaign has nothing to
 * do with cron — and would have pulled the harness's watchdog and its
 * `node:crypto` import into the request path. The other alternative was a second
 * copy of the email-scrubbing regex, which is the version that gets fixed once
 * and stays broken in the other place.
 */

/**
 * Serializes a log payload into a single JSON line that cannot throw on the
 * values error handling produces.
 *
 * One JSON object per console call is what Vercel's Log Drain can field-parse
 * (searchable `event`/`job`/`durationMs` instead of prose), and JSON escaping
 * neutralizes CR/LF log injection (CWE-117) by construction.
 *
 * BigInts become strings and cyclic references are replaced with a marker, so
 * a hostile error property (a circular `dealId`, a BigInt `campaignId`)
 * cannot destroy the failure log it lives in — the failure mode where the
 * catch itself becomes the 500.
 *
 * Not a silver bullet: a value with a throwing getter or `toJSON` can still
 * make `JSON.stringify` throw. That is contained two layers out — the
 * harness's defensive per-job catch and the route catch — so the run and the
 * response survive; only the detail line degrades.
 */
export function toLogString(fields: Record<string, unknown>): string {
  // The set is never pruned, so a reference repeated between siblings is
  // marked `[Circular]` as well. Scheduler payloads are flat, so the false
  // positive cannot fire today; a stack-based ancestor set would be the fix
  // if that ever changes.
  const seen = new WeakSet<object>();
  const replacer = (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  };

  return JSON.stringify(fields, replacer);
}

/**
 * The email pattern, exported so a caller layering further scrubbing on top can
 * assert it still runs rather than re-implementing it.
 *
 * Emails with international characters, IDN domains, and single-letter TLDs
 * (user@bücher.de, user@a.b) were invisible to the ASCII-only pattern this
 * replaced.
 */
export const EMAIL_PATTERN =
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;

export interface SafeErrorDetails {
  name: string;
  code: string;
  message: string;
  context: Record<string, unknown>;
}

export function extractSafeErrorDetails(err: unknown): SafeErrorDetails {
  let name = 'Error';
  let code = 'UNKNOWN_ERROR';
  let message = 'An unknown error occurred';
  const context: Record<string, unknown> = {};

  if (err instanceof Error) {
    name = err.name;
    message = err.message;
  } else if (typeof err === 'string') {
    message = err;
  } else if (typeof err === 'object' && err !== null) {
    if ('name' in err && typeof err.name === 'string') name = err.name;
    if ('message' in err && typeof err.message === 'string')
      message = err.message;
  }

  if (typeof err === 'object' && err !== null) {
    if (
      'code' in err &&
      (typeof err.code === 'string' || typeof err.code === 'number')
    ) {
      code = String(err.code);
    }
    if ('dealId' in err) context.dealId = err.dealId;
    if ('campaignId' in err) context.campaignId = err.campaignId;
  }

  // The accepted limit is emails only: scrubbing TikTok handles would also
  // mangle @-prefixed context in legitimately useful error text.
  //
  // Accepted, documented divergence from lib/audit/redact.ts (M7): that module
  // also redacts phone/SSN/birth/address, but it guards audit rows built from
  // request bodies. Scheduler logs never contain row content — jobs report
  // counts and whitelisted ids — so no such field can reach this log today. If
  // a future job ever logs row-derived context, it must reuse that redactor
  // rather than widen this regex.
  //
  // A caller whose message comes from *outside* the system has a different
  // threat model and layers its own rules on top — see `lib/payment/log.ts`,
  // where the text is written by a payment processor.
  const safeMessage = message.replace(EMAIL_PATTERN, '***@***.***');
  return { name, code, message: safeMessage, context };
}
