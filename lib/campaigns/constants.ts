export const ADD_TO_CAMPAIGN_LABEL = 'Add to campaign';
export const NO_DRAFT_CAMPAIGN_MESSAGE =
  'You need a draft campaign before you can shortlist a creator.';

/** KAN-32 / AC-015 — removing a creator from a draft cart. */
export const REMOVE_FROM_CART_LABEL = 'Remove';
export const REMOVE_FROM_CART_PENDING_LABEL = 'Removing…';
export const REMOVE_FROM_CART_SUCCESS = 'Creator removed from campaign.';

/**
 * The removal failed because the item was already gone — a second click, a
 * stale tab, or another session. Says the cart no longer holds them rather
 * than "not found", which reads as though the creator was deleted.
 */
export const REMOVE_FROM_CART_MISSING =
  'That creator is no longer in this cart.';
export const REMOVE_FROM_CART_FAILED =
  'Failed to remove creator from campaign.';

/**
 * Shared by the add and remove paths — both are refused once the campaign
 * leaves `draft`, and two copies of this sentence would drift.
 */
export const CAMPAIGN_NOT_DRAFT_MESSAGE =
  'This campaign is no longer a draft and cannot be edited.';

/** AC-016 — confirming a draft campaign sends an offer to every creator in it. */
export const CONFIRM_CAMPAIGN_LABEL = 'Send offers';
export const CONFIRM_CAMPAIGN_PENDING_LABEL = 'Sending offers…';

/**
 * The confirmation prompt. Spelled out because confirming is irreversible in
 * both directions the brand cares about: creators are notified immediately, and
 * the brief and cart lock at the same moment.
 */
export const CONFIRM_CAMPAIGN_PROMPT =
  'Send offers to every creator in this campaign? They will be notified straight away, and you will not be able to change the brief or the creator list afterwards.';

export const CONFIRM_CAMPAIGN_SUCCESS = 'Offers sent to your creators.';
export const CONFIRM_CAMPAIGN_FAILED = 'Failed to send offers.';

/**
 * Why the confirm button is disabled, and what to do about it — shown as a
 * sentence beside the control, never a `title=` tooltip, which a touch user
 * never sees.
 */
export const CONFIRM_EMPTY_CART_MESSAGE =
  'Add at least one creator before sending offers.';

/** AC-019 / KAN-43 — funding a confirmed campaign holds the accepted total. */
export const FUND_CAMPAIGN_LABEL = 'Fund campaign';
export const FUND_CAMPAIGN_PENDING_LABEL = 'Holding funds…';

/**
 * The confirmation prompt.
 *
 * Says "held" and not "paid", because that is the whole substance of AC-021: the
 * money leaves the brand's available balance now and reaches no creator until a
 * deliverable is approved. A brand who reads this as payment would think an
 * unposted video had already cost them.
 *
 * No amount interpolated. The figure the button knows is the one the page
 * rendered, and the amount actually held is re-summed from the accepted deals
 * under a row lock — a prompt quoting a stale number would be worse than one
 * quoting none, and the Budget Summary beside it already shows the total.
 */
export const FUND_CAMPAIGN_PROMPT =
  'Hold the total for every accepted offer in escrow? The money leaves your available budget now, and each creator is paid only after you approve their video.';

export const FUND_CAMPAIGN_SUCCESS =
  'Funds held. Your creators can start work.';
export const FUND_CAMPAIGN_FAILED = 'Failed to fund this campaign.';

/**
 * Nobody has accepted yet (`NO_ACCEPTED_DEALS`). Doubles as the disabled-button
 * explanation and the 409 toast, because both answer the same question and the
 * brand's move is the same either way: wait.
 */
export const FUND_NO_ACCEPTED_DEALS_MESSAGE =
  'No creator has accepted an offer yet. You can fund this campaign once at least one has.';

/**
 * `CAMPAIGN_NOT_FUNDABLE` from the client's side — already funded, or not
 * confirmed. Deliberately does not guess which: the button refreshes the page
 * straight after, and the status badge is the honest answer.
 */
export const FUND_NOT_FUNDABLE_MESSAGE =
  'This campaign cannot be funded right now. Reloading to show where it stands.';

/** AC-019 item 6, brand side — the Budget Summary row. */
export const HELD_IN_ESCROW_LABEL = 'Held in escrow';

/**
 * What "held" means, under the figure. AC-021 is a promise to the brand as much
 * as to the creator, so the screen states it rather than leaving the brand to
 * infer it from a label.
 */
export const HELD_IN_ESCROW_NOTE =
  'Released to each creator only after you approve their video.';
