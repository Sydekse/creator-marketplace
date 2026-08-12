/**
 * Copy for the one deal surface that has to be a client component.
 *
 * These strings would sit in `lib/deals/detail.ts` beside the query that serves
 * them, which is the convention every other screen follows (`NO_MATCHES_TITLE`,
 * `ADD_TO_CAMPAIGN_LABEL`). They cannot: `detail.ts` imports `@/db` for its
 * query, `components/deals/offer-actions.tsx` is `'use client'` because of the
 * agreement checkbox, and a client component importing anything from that module
 * pulls `pg` into the browser bundle. The build says so in as many words —
 * `Can't resolve 'util/types'`, with an import trace running
 * `offer-actions.tsx → detail.ts → db/index.ts → pg`.
 *
 * So the constraint is the same one that produced `lib/money.ts` on KAN-24 and
 * `lib/dates.ts` on KAN-39: a leaf module with no database import, extracted
 * because a bundle boundary sits between the two callers. `lib/deals/groups.ts`
 * is kept pure for exactly this reason and has a test asserting it; this module
 * has the same guard.
 *
 * `detail.ts` re-exports all of them, so the "copy beside the query" surface is
 * unchanged for every server-side caller and nothing has to know there are two
 * files. Add a string for the accept surface **here**, not there.
 */

export const ACCEPT_DEAL_LABEL = 'Accept offer';
export const DECLINE_DEAL_LABEL = 'Decline offer';

/**
 * What the accept button is waiting for, when it is disabled and there is
 * something to agree to.
 *
 * A sentence beside the control rather than a `title=` tooltip, which tells a
 * touch user nothing — the rule KAN-29 set and KAN-39 followed.
 */
export const ACCEPT_NEEDS_AGREEMENT_MESSAGE =
  'Tick the box above to confirm you agree to the usage-rights terms.';

/** While the request is in flight. Replaces the label, so the button never lies. */
export const ACCEPTING_LABEL = 'Accepting…';

export const ACCEPT_SUCCESS_MESSAGE =
  'Offer accepted. The brand has been notified and will fund the deal.';

/**
 * The browser could not reach the server at all — no response, so no error
 * envelope and no code to branch on.
 *
 * Said separately from any server-sent message because the two call for
 * different things: a 409 means read something, this means try again.
 */
export const ACCEPT_NETWORK_ERROR_MESSAGE =
  'Could not reach the server. Check your connection and try again.';

/**
 * The fallback when a response carries no message of its own.
 *
 * Every code the endpoint returns has a sentence in `ErrorMessage`, and that
 * sentence is what gets shown — it is the acceptance criterion's wording, and
 * paraphrasing it here would create a second copy free to drift. This covers
 * only a response shaped unlike the envelope.
 */
export const ACCEPT_FAILED_MESSAGE =
  'Could not accept this offer. Reload the page and try again.';

/** While the decline request is in flight. */
export const DECLINING_LABEL = 'Declining…';

/**
 * The last stop before an irreversible action.
 *
 * A declined deal cannot be accepted or resurrected — `LEGAL_TRANSITIONS.declined`
 * is empty — and this button sits one tap from the accept button, so the prompt
 * says what cannot be undone rather than just asking "are you sure". `confirm`
 * rather than a dialog because no dialog primitive is installed and adding one
 * for a yes/no would widen the ticket; `remove-from-cart-button.tsx` set that
 * precedent.
 */
export const DECLINE_CONFIRM_MESSAGE =
  'Decline this offer? This cannot be undone — the brand will be told, and you will not be able to accept it later.';

export const DECLINE_SUCCESS_MESSAGE =
  'Offer declined. The brand has been notified and the budget is back with them.';

/**
 * The fallback when a response carries no message of its own — the accept
 * button's `ACCEPT_FAILED_MESSAGE` reasoning, applied to this one. Every code
 * this endpoint returns has its own sentence in `ErrorMessage`, and that is what
 * gets shown; this covers only a response shaped unlike the envelope.
 */
export const DECLINE_FAILED_MESSAGE =
  'Could not decline this offer. Reload the page and try again.';
