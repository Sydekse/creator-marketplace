/**
 * Wallet copy and limits (KAN-70 PR 3).
 *
 * Kept beside the wallet modules the way `lib/campaigns/constants.ts` sits
 * beside the funding flow: the UI strings live with the feature so the pages
 * and their tests quote one source.
 */

/**
 * 100 ETB, in santim — the user-approved withdrawal floor. Below this,
 * transfer fees and reconciliation noise outweigh the payout.
 */
export const MIN_WITHDRAWAL_SANTIM = 10_000;

export const WALLET_TITLE = 'Wallet';
export const WALLET_AVAILABLE_LABEL = 'Available to withdraw';
export const WALLET_LIFETIME_LABEL = 'Lifetime earnings';
export const WALLET_PENDING_LABEL = 'Withdrawals in flight';

export const WITHDRAW_LABEL = 'Withdraw';
export const WITHDRAW_DIALOG_TITLE = 'Withdraw to your payout method';
export const WITHDRAW_MIN_NOTE = 'Minimum withdrawal is 100.00 ETB.';
export const WITHDRAW_TEST_MODE_HINT =
  'Chapa test mode — the transfer is simulated and no real money moves.';

export const PAYOUT_METHOD_TITLE = 'Payout method';
export const PAYOUT_METHOD_EMPTY =
  'Add a bank or telebirr account to withdraw your earnings.';
export const PAYOUT_METHOD_SAVED = 'Payout method saved.';

export const WITHDRAWALS_TITLE = 'Withdrawal history';
export const WITHDRAWALS_EMPTY = 'No withdrawals yet.';

export const WALLET_UNAVAILABLE_TITLE = 'Withdrawals are not available here';
export const WALLET_UNAVAILABLE_BODY =
  'This environment runs the mock payment provider, so there is no payout rail to withdraw through. Your earnings are tracked and will be withdrawable where Chapa is configured.';
