/**
 * Formatting for the two optional numbers on a creator profile (AC-012).
 *
 * Both `follower_count` and `engagement_rate` are nullable, and both are read on
 * two screens now: the creator's own dashboard (`app/(creator)/creator/page.tsx`)
 * and the brand-facing card and detail view this module was extracted for. A
 * second caller is what promoted these out of the page, the same trigger that
 * produced `lib/paging.ts`, `lib/money.ts` and `lib/query-params.ts`.
 *
 * The rule worth having in one place is what null renders as. AC-027 says absent
 * metrics show "Metrics pending" rather than zeros, and the reason generalises
 * past metrics: a creator who left an optional field blank has not claimed to
 * have no followers, and a brand shown "0" on a card would read it as a fact
 * about the creator rather than a gap in the data. Two definitions of that rule
 * is one edit away from a card that says a creator has no audience.
 */

/** What both formatters render for an absent value — never `'0'` or `'0%'`. */
export const NOT_PROVIDED = 'Not provided';

/**
 * Follower count for display — `25000` → `'25,000'`.
 *
 * Thousands separators because the number is compared across cards at a glance,
 * and `25000` beside `250000` is a digit-counting exercise.
 */
export function formatFollowerCount(count: number | null): string {
  if (count === null) return NOT_PROVIDED;
  return count.toLocaleString('en-US');
}

/**
 * Engagement rate for display — `'3.50'` → `'3.50%'`.
 *
 * The value stays a string from the column to the screen. `engagement_rate` is
 * `numeric(5,2)` and reaches drizzle as a string precisely so it survives the
 * trip intact; passing it through `Number` here would render `'3.50'` as `3.5`
 * and `'10.00'` as `10`, so two creators measured to the same precision would
 * display differently for no reason a brand can see. Same argument
 * `formatCommissionRate` makes in reverse — there, the trailing zeros *are* an
 * artefact of the column and get dropped, because a rate is a business figure
 * rather than a measurement.
 */
export function formatEngagementRate(rate: string | null): string {
  if (rate === null) return NOT_PROVIDED;
  return `${rate}%`;
}
