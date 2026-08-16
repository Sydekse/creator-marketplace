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

/**
 * The deliverable surface (KAN-46, AC-022, AC-025).
 *
 * These strings belong here for the same forcing reason the accept strings do:
 * `components/deals/deliverable-form.tsx` is `'use client'`, and importing copy
 * from `lib/deals/detail.ts` — which imports `@/db` for its query — pulls `pg`
 * toward the browser and fails the build. `detail.ts` re-exports them, so the
 * server-side surface is unchanged.
 *
 * `SUBMIT_DELIVERABLE_LABEL` moved here on KAN-46: it was defined directly in
 * `detail.ts` when the button was a server-rendered disabled control, and the
 * working form is client-side.
 */

/** The button on the funded deal's submission form. */
export const SUBMIT_DELIVERABLE_LABEL = 'Submit your video';

/** The field the creator pastes the public link into. */
export const SUBMIT_DELIVERABLE_URL_LABEL = 'Live TikTok post URL';

/**
 * The sentence under the field. Says "public" in the platform's own words, the
 * same phrase AC-025 uses for the rejection message — a private link would be
 * rejected server-side, and the sentence is what keeps a creator from learning
 * that the hard way.
 */
export const SUBMIT_DELIVERABLE_URL_HINT =
  'Paste the link to the public TikTok video you posted. The link is stored so the brand can review it — it is never fetched by the platform.';

export const SUBMIT_DELIVERABLE_URL_PLACEHOLDER =
  'https://www.tiktok.com/@you/video/…';

/** While the request is in flight. Replaces the label, so the button never lies. */
export const SUBMITTING_DELIVERABLE_LABEL = 'Submitting…';

export const SUBMIT_DELIVERABLE_SUCCESS_MESSAGE =
  'Video submitted. The brand has been notified and will review it.';

/**
 * The browser could not reach the server at all — no response, so no error
 * envelope and no code to branch on. The `ACCEPT_NETWORK_ERROR_MESSAGE`
 * reasoning, applied to this control.
 */
export const SUBMIT_DELIVERABLE_NETWORK_ERROR_MESSAGE =
  'Could not reach the server. Check your connection and try again.';

/**
 * The fallback when a response carries no message of its own. Every code this
 * endpoint returns has a sentence in `ErrorMessage` — including AC-025's
 * "Enter a valid public TikTok video link." — and that sentence is what gets
 * shown; this covers only a response shaped unlike the envelope.
 */
export const SUBMIT_DELIVERABLE_FAILED_MESSAGE =
  'Could not submit your video. Reload the page and try again.';

/**
 * The brand's review surface (KAN-68, AC-023, AC-024).
 *
 * Here for the same forcing reason as everything above:
 * `components/deals/review-actions.tsx` is `'use client'`, and
 * `lib/deals/brand-detail.ts` imports `@/db` for its query, so importing copy
 * from there pulls `pg` toward the browser and fails the build.
 * `brand-detail.ts` re-exports these, so the server-side surface is unchanged.
 */

/** The two controls on a delivered deal. */
export const APPROVE_DELIVERABLE_LABEL = 'Approve and pay';
export const REJECT_DELIVERABLE_LABEL = 'Request changes';

/**
 * Approve says "and pay" because that is what it does, in one irreversible
 * transaction: the hold is released to the creator net of commission and the deal
 * is `completed` (AC-023). A button labelled only "Approve" would understate an
 * action that moves money and cannot be undone — `LEGAL_TRANSITIONS.completed` is
 * empty.
 *
 * Reject says "request changes" rather than "reject" because the deal goes back
 * to the creator to re-deliver (AC-024), not to a dead end, and the funds stay
 * held throughout.
 */
export const APPROVE_CONFIRM_MESSAGE =
  'Approve this video and pay the creator? This cannot be undone — the money leaves escrow immediately, minus the platform commission.';

/** While a request is in flight. Replaces the label, so the button never lies. */
export const APPROVING_LABEL = 'Approving…';
export const REJECTING_LABEL = 'Sending back…';

export const APPROVE_SUCCESS_MESSAGE =
  'Video approved. The creator has been paid and notified.';
export const REJECT_SUCCESS_MESSAGE =
  'Sent back to the creator with your notes. The funds stay held.';

/** The field the brand types its reason into (AC-024, AC-3). */
export const REJECT_REASON_LABEL = 'What needs to change?';
export const REJECT_REASON_PLACEHOLDER =
  'Tell the creator what to change before they resubmit…';

/**
 * The sentence under the field. Says the reason reaches the creator, because it
 * does — it is stored on the deliverable *and* travels in their notification, so
 * it is the instruction they act on rather than an internal note.
 */
export const REJECT_REASON_HINT =
  'The creator sees this, so say what to change. The funds stay held while they work on it.';

/**
 * The browser could not reach the server at all — no response, so no error
 * envelope and no code to branch on. The `ACCEPT_NETWORK_ERROR_MESSAGE`
 * reasoning, applied to these controls.
 */
export const REVIEW_NETWORK_ERROR_MESSAGE =
  'Could not reach the server. Check your connection and try again.';

/**
 * The fallbacks when a response carries no message of its own. Every code these
 * endpoints return has a sentence in `ErrorMessage` — including
 * `REASON_REQUIRED`'s and `DEAL_NOT_DELIVERED`'s — and that sentence is what gets
 * shown; these cover only a response shaped unlike the envelope.
 */
export const APPROVE_FAILED_MESSAGE =
  'Could not approve this video. Reload the page and try again.';
export const REJECT_FAILED_MESSAGE =
  'Could not send this video back. Reload the page and try again.';
