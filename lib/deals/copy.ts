/**
 * Copy for the one deal surface that has to be a client component.
 *
 * These three strings would sit in `lib/deals/detail.ts` beside the query that
 * serves them, which is the convention every other screen follows
 * (`NO_MATCHES_TITLE`, `ADD_TO_CAMPAIGN_LABEL`). They cannot: `detail.ts`
 * imports `@/db` for its query, `components/deals/offer-actions.tsx` is
 * `'use client'` because of the agreement checkbox, and a client component
 * importing anything from that module pulls `pg` into the browser bundle. The
 * build says so in as many words — `Can't resolve 'util/types'`, with an import
 * trace running `offer-actions.tsx → detail.ts → db/index.ts → pg`.
 *
 * So the constraint is the same one that produced `lib/money.ts` on KAN-24 and
 * `lib/dates.ts` on KAN-39: a leaf module with no database import, extracted
 * because a bundle boundary sits between the two callers. `lib/deals/groups.ts`
 * is kept pure for exactly this reason and has a test asserting it; this module
 * has the same guard.
 *
 * `detail.ts` re-exports all three, so the "copy beside the query" surface is
 * unchanged for every server-side caller and nothing has to know there are two
 * files. Add a fourth string to the accept surface **here**, not there.
 */

export const ACCEPT_DEAL_LABEL = 'Accept offer';
export const DECLINE_DEAL_LABEL = 'Decline offer';
export const OFFER_ACTIONS_UNAVAILABLE_MESSAGE =
  'Accepting and declining offers is not available yet. Nothing is expected from you in the meantime.';
