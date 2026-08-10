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
