/**
 * The failure log for the money path (KAN-44, AC-020 bullet 7, NFR-010).
 *
 * AC-020 asks for two things that pull against each other: a brand sees one
 * fixed sentence and nothing else, and somebody debugging afterwards can find
 * out what actually happened. That only works if the detail goes somewhere the
 * brand cannot see, which is the server log, and it only stays safe if the thing
 * written there is scrubbed on the way out rather than at each call site.
 *
 * **Why this is not just `extractSafeErrorDetails`.** That function assumes the
 * message was written by us. Here it is written by a payment processor — the one
 * string in this system composed by a third party, quoting fields the brand
 * typed. A PSP that echoes the funding instrument into a decline reason
 * ("card 4111111111111111 declined") would otherwise put a PAN in our logs, and
 * PCI-DSS treats a log as storage. So the shared scrub runs first (emails,
 * CWE-117 via JSON encoding) and this module layers on the rules that only make
 * sense for text from outside.
 *
 * Everything here is best-effort by nature: pattern matching cannot catch a
 * secret a processor buried in prose. What it does catch is the shapes that
 * actually leak — the long digit run and the address — and, more importantly, it
 * makes the safe path the default one, so the next money ticket logs through
 * this rather than reaching for `console.error` and a template string.
 */

import { extractSafeErrorDetails, toLogString } from '@/lib/logging';
import { PaymentError } from './types';

/**
 * A run of 12+ digits, allowing the spaces and dashes people paste them with.
 *
 * 12 is the floor because the shortest PAN in circulation is 12 digits (Maestro)
 * and the longest is 19. Ethiopian phone numbers are 9–12 digits with a country
 * code, so they fall inside this too — which is the correct bias for a log
 * nobody can edit afterwards.
 *
 * A santim amount is not caught and does not need to be: six or seven digits at
 * marketplace scale, and it is not a secret anyway.
 */
const DIGIT_RUN_PATTERN = /\d(?:[ -]?\d){11,}/g;

/**
 * Our own ids, protected from the rule above.
 *
 * Tolerating separators inside a digit run is what makes the PAN rule work on
 * `4111-1111-1111-1111`, and it is also what makes it eat a uuid: hex groups that
 * happen to be all digits, joined by hyphens, are one long run. A campaign id is
 * the single most useful field in a failure line — it is how anyone finds the
 * campaign afterwards — so uuids are lifted out before the digit scrub and put
 * back after.
 *
 * Unanchored, unlike `UUID_REGEX` in `lib/validation`, which exists to validate a
 * whole string and would match nothing inside a sentence.
 */
const UUID_IN_TEXT_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * The stand-in a uuid wears while the digit scrub runs.
 *
 * Written as an escape, never as a literal control character: a literal one is
 * invisible in an editor, and git classifies the whole file as binary the moment
 * one appears — which drops the `.gitattributes` LF normalisation and makes every
 * future diff of this module unreadable. That is how this line was first written.
 *
 * NUL is the delimiter because `stripControlChars` removes it from the input
 * before masking, so nothing a processor sends can forge a slot and shift the
 * restored ids out of position. It also carries no digits, so
 * `DIGIT_RUN_PATTERN` cannot match the placeholder itself.
 */
const UUID_PLACEHOLDER = '\u0000uuid\u0000';

/**
 * Flattens every C0 control in processor text to a space.
 *
 * Two jobs in one pass. It takes the delimiter out of the input before the
 * function below uses it as one, and it keeps CR/LF out of the scrubbed string,
 * so a caller that writes the message somewhere other than `toLogString` cannot
 * be made to forge a second log line with it (CWE-117 — the JSON encoding closes
 * that for our own logger, but the scrubbed string is exported).
 *
 * A space rather than nothing, so removing a control cannot fuse two words into
 * one that reads as a value nobody sent.
 */
function stripControlChars(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ');
}

/** Bounds one line. A processor returning a stack trace should not fill the drain. */
const MAX_MESSAGE_LENGTH = 512;

const DIGITS_REDACTED = '[redacted-digits]';
const TRUNCATED = '…[truncated]';

/**
 * Scrubs text written by a payment processor.
 *
 * Exported for its own test: this is the function that decides whether a PAN
 * reaches the log, so it is worth covering directly rather than through three
 * layers of a funding call.
 */
export function scrubProviderText(text: string): string {
  // Lift the uuids out, scrub, put them back. Done in three steps rather than
  // with one clever regex because the clever version is the one that silently
  // stops protecting either the ids or the PANs after an edit.
  //
  // Delimiters go first, so the placeholder below is a shape the input cannot
  // contain and the split/join is exact rather than approximate.
  const uuids: string[] = [];
  const masked = stripControlChars(text).replace(
    UUID_IN_TEXT_PATTERN,
    (match) => {
      uuids.push(match);
      return UUID_PLACEHOLDER;
    }
  );

  const digitsRemoved = masked.replace(DIGIT_RUN_PATTERN, DIGITS_REDACTED);

  // `split` on the placeholder yields exactly `uuids.length + 1` segments, and
  // the digit rule cannot have consumed one (the placeholder holds no digits),
  // so this puts each id back where it came from.
  const segments = digitsRemoved.split(UUID_PLACEHOLDER);
  const restored = segments.reduce(
    (acc, segment, i) => (i === 0 ? segment : acc + uuids[i - 1] + segment),
    ''
  );

  // Truncation is last, so the cap applies to what will actually be written.
  return restored.length > MAX_MESSAGE_LENGTH
    ? restored.slice(0, MAX_MESSAGE_LENGTH) + TRUNCATED
    : restored;
}

export interface PaymentFailureContext {
  /** What was being attempted — `fund_campaign`, later `payout`, `refund`. */
  operation: string;
  campaignId?: string;
  dealId?: string;
  /**
   * The acting `user.id`. An opaque uuid, and the join key that makes a report
   * of "my payment failed" findable. Never an email — that is the PII half of
   * NFR-010 and `extractSafeErrorDetails` scrubs it from the message too.
   */
  actorId?: string;
}

/**
 * Writes one field-parseable line about a failed payment attempt.
 *
 * Never throws and returns nothing: this runs in a catch block on the way to
 * telling a brand their payment failed, and a logger that threw there would turn
 * a clean 402 into a 500 — the failure mode where the diagnostics destroy the
 * thing they were meant to explain.
 *
 * No amount is logged. It is derivable from the campaign id by anyone entitled
 * to see it, and a figure in a log line is the field most likely to be quoted
 * into a support ticket, a screenshot, or a third-party monitoring tool.
 */
export function logPaymentFailure(
  error: unknown,
  context: PaymentFailureContext,
  logger: Pick<Console, 'error'> = console
): void {
  try {
    const safe = extractSafeErrorDetails(error);

    // `PaymentError.code` is one of six members of a union we declare, so it is
    // safe by construction and is the field worth alerting on. The generic
    // extractor would find it too; naming it makes the intent explicit and
    // distinguishes "the provider declined" from "something else threw".
    const providerCode = error instanceof PaymentError ? error.code : safe.code;

    logger.error(
      toLogString({
        level: 'error',
        event: 'payment.failed',
        message: `[Payment] ${context.operation} failed: [${safe.name}] ${providerCode} - ${scrubProviderText(safe.message)}`,
        operation: context.operation,
        name: safe.name,
        code: providerCode,
        isProviderError: error instanceof PaymentError,
        campaignId: context.campaignId,
        dealId: context.dealId,
        actorId: context.actorId,
      })
    );
  } catch {
    // Reached only if `toLogString`'s documented escape hatch fires (a throwing
    // getter or `toJSON` on the error). One flat line, no interpolation of
    // anything from the error, so this cannot fail for the same reason.
    logger.error(
      '{"level":"error","event":"payment.failed","message":"[Payment] failure detail could not be serialized"}'
    );
  }
}
