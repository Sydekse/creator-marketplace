/**
 * Deadline formatting for display.
 *
 * Timestamps are `timestamptz` UTC everywhere in the system (invariant 11), and
 * this module is the only place one becomes a string for a human. That is the
 * same role `lib/money.ts` plays for santim, and it is here for the same
 * forcing reason: `formatDeadline` was written in
 * `lib/notifications/templates.tsx`, which imports `@react-email/components`,
 * so importing it from a page would pull the email renderer into the app
 * bundle. The deal inbox is its second caller (KAN-39), so it moved.
 * `templates.tsx` re-exports it, so nothing that imports from
 * `lib/notifications` changes.
 */

/**
 * A UTC instant rendered for a human — `12 Aug 2026, 09:00`.
 *
 * Explicitly UTC rather than the server's zone: a server-local render would
 * quietly change meaning when the deployment region does, and an offer deadline
 * that shifts by hours is worse than one that names its zone. This is a server
 * component's output, so it is *not* the viewer's local time either — the
 * suffix below says which zone it is in rather than leaving the reader to
 * assume.
 *
 * Takes a `Date` or an ISO string. Drizzle hands back `Date` for a
 * `timestamptz` column and the notification payloads carry ISO strings, and
 * requiring either side to convert first is how a `new Date(...)` ends up
 * duplicated at the call sites this module exists to remove.
 */
export function formatDeadline(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
}

/** `formatDeadline` plus the zone it is in, for screens rather than email. */
export function formatDeadlineUtc(value: Date | string): string {
  return `${formatDeadline(value)} UTC`;
}

export const NO_EXPIRY_LABEL = 'No expiry set';

/**
 * How an offer deadline reads on screen, in the right tense (KAN-39, AC-1).
 *
 * `now` is a parameter rather than a call to `new Date()` inside, so the
 * boundary between "expires" and "expired" is assertable without freezing the
 * clock — the same injection `offerExpiresAt` uses in `lib/config/pricing.ts`.
 *
 * **Why the past tense is reachable at all.** The expiry sweep that moves a
 * lapsed offer out of `pending` is KAN-38, which has not shipped. So a `pending`
 * deal whose deadline has already passed exists in the database right now, and
 * "Expires on 3 Aug 2026" would be a sentence that is simply false. This reads
 * the clock and says so.
 *
 * It changes no status and writes nothing. A creator seeing "Expired on …"
 * still has a `pending` deal, and the accept endpoint is what will refuse it
 * (`OFFER_EXPIRED`, KAN-36) — a display helper is not a place to enforce a
 * lifecycle rule, and one that quietly hid the deal would leave the creator
 * with no way to see what happened to it.
 *
 * Null is not "no deadline, act whenever": every deal KAN-33 creates carries
 * one, so a null is an older row, and the honest answer is that none is
 * recorded.
 */
export function expiryLabel(
  offerExpiresAt: Date | string | null,
  now: Date
): string {
  if (offerExpiresAt === null) return NO_EXPIRY_LABEL;

  const deadline =
    typeof offerExpiresAt === 'string'
      ? new Date(offerExpiresAt)
      : offerExpiresAt;
  const verb = deadline.getTime() <= now.getTime() ? 'Expired' : 'Expires';

  return `${verb} ${formatDeadlineUtc(deadline)}`;
}

/**
 * Relative age label for a timestamp — "just now", "5 minutes ago", "3 days
 * ago", etc. Uses `Intl.RelativeTimeFormat` for proper pluralization and
 * locale-aware formatting.
 *
 * Thresholds: <1min → "just now", <60min → minutes, <24h → hours, <30d →
 * days, else → months. The `now` parameter follows the same injection
 * pattern as `expiryLabel` so tests can pin the clock.
 */
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['month', 30 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

export function ageLabel(date: Date, now: Date = new Date()): string {
  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  // Future timestamps: "in 5 minutes", "in 2 hours", etc.
  if (diffSeconds < 0) {
    const abs = Math.abs(diffSeconds);
    if (abs < 60) return 'just now';

    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    for (const [unit, secondsInUnit] of UNITS) {
      if (abs >= secondsInUnit) {
        return rtf.format(Math.floor(abs / secondsInUnit), unit);
      }
    }
    return 'just now';
  }

  if (diffSeconds < 60) return 'just now';

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  for (const [unit, secondsInUnit] of UNITS) {
    if (diffSeconds >= secondsInUnit) {
      const value = -Math.floor(diffSeconds / secondsInUnit);
      return rtf.format(value, unit);
    }
  }

  return 'just now';
}
