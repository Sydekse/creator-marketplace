import type { EmailMessage, EmailProvider } from './types';
import { EmailDeliveryError } from './types';
import { redactEmail } from './redact';

/**
 * Bounded retry around a single send (KAN-54 AC-3, AC-7).
 *
 * "Retried but never rolls back the domain transaction" and "bounded — a
 * permanently failing send is logged and abandoned, not retried forever" are
 * the same requirement seen from both ends: this function must always resolve,
 * and it must always stop.
 */

/**
 * Backoff between attempts, in milliseconds. Length = number of retries after
 * the first try, so four attempts total.
 *
 * Short on purpose. The flush is awaited inside the request that triggered it,
 * so every millisecond here is latency a user waits through; the numbers are
 * sized to ride out a blip or a rate limit, not an outage. Surviving an outage
 * is a durable-queue problem, and this service does not pretend to be one —
 * see the module note in `notify.ts`.
 */
export const RETRY_BACKOFF_MS = [250, 1_000, 3_000] as const;

export interface DispatchDeps {
  provider: EmailProvider;
  sleep: (ms: number) => Promise<void>;
  log: DispatchLog;
}

export interface DispatchLog {
  info: (message: string) => void;
  error: (message: string) => void;
}

export type DispatchOutcome =
  | { ok: true; attempts: number; id: string | null }
  | { ok: false; attempts: number; reason: 'permanent' | 'exhausted' };

/**
 * Attempt delivery, retrying transient failures within the bounded budget.
 *
 * Never throws. A caller in the money path must not be able to fail because an
 * email did — that is the entire point of the service being fire-and-forget
 * (Tech Spec §5).
 */
export async function dispatchWithRetry(
  to: string,
  message: EmailMessage,
  deps: DispatchDeps
): Promise<DispatchOutcome> {
  const recipient = redactEmail(to);
  const maxAttempts = RETRY_BACKOFF_MS.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await deps.provider.send(to, message);
      deps.log.info(
        `[email] sent to=${recipient} via=${deps.provider.name} attempt=${attempt}`
      );
      return { ok: true, attempts: attempt, id: result.id };
    } catch (error) {
      // A permanent failure is abandoned immediately rather than after the full
      // budget: retrying a malformed address only delays the same answer.
      if (error instanceof EmailDeliveryError && error.permanent) {
        deps.log.error(
          `[email] permanently failed to=${recipient} via=${deps.provider.name} attempt=${attempt} reason=${error.message}`
        );
        return { ok: false, attempts: attempt, reason: 'permanent' };
      }

      const last = attempt === maxAttempts;
      if (last) {
        // Logged and abandoned (AC-7). Loudly, because from here the user is
        // never getting this email and only the in-app row will show it.
        deps.log.error(
          `[email] giving up to=${recipient} via=${deps.provider.name} attempts=${attempt} reason=${describe(error)}`
        );
        return { ok: false, attempts: attempt, reason: 'exhausted' };
      }

      deps.log.info(
        `[email] retrying to=${recipient} via=${deps.provider.name} attempt=${attempt} reason=${describe(error)}`
      );
      await deps.sleep(RETRY_BACKOFF_MS[attempt - 1]);
    }
  }

  // Unreachable: the loop returns on every path. Present so the function has a
  // total return type without a non-null assertion.
  return { ok: false, attempts: maxAttempts, reason: 'exhausted' };
}

/**
 * A log-safe description of a failure.
 *
 * Only the message, never the error object: a provider error can carry the
 * request body, and the request body is the email (NFR-010).
 */
function describe(error: unknown): string {
  if (error instanceof Error) return JSON.stringify(error.message);
  return '"unknown"';
}
