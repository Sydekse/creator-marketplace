import type { ZodError } from 'zod';

export enum ErrorCode {
  TIKTOK_HANDLE_TAKEN = 'TIKTOK_HANDLE_TAKEN',
  /**
   * Extends the error table in CLAUDE.md — flagged in the KAN-21 PR.
   *
   * `creator_profile.user_id` carries its own unique constraint, so a second
   * submit by the same signed-in creator violates a *different* constraint than
   * AC-003's. Reusing TIKTOK_HANDLE_TAKEN there would tell someone their handle
   * belongs to a stranger when in fact it is already theirs, which sends them
   * to support instead of to their own dashboard. The same code covers the
   * brand side, since `brand_profile.user_id` is unique for the same reason.
   */
  PROFILE_EXISTS = 'PROFILE_EXISTS',
  BUDGET_NOT_POSITIVE = 'BUDGET_NOT_POSITIVE',
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
  OFFER_NOT_PENDING = 'OFFER_NOT_PENDING',
  /**
   * A verify/reject decision landed on a creator that is no longer
   * `pending_verification` — flagged as the guard AC-029 implies by scoping the
   * action to "pending_verification creators".
   *
   * Its own code rather than a reused OFFER_NOT_PENDING: the two guard the same
   * *shape* of mistake (a decision on an already-decided row) but name different
   * things, and an admin told "this offer is no longer pending" about a creator
   * has been handed the wrong noun. The tech spec's §4.6 lists only 200/403, but
   * a second decision must not silently re-notify the creator or write a
   * duplicate audit row, so the state is guarded and this is what it returns.
   */
  CREATOR_NOT_PENDING = 'CREATOR_NOT_PENDING',
  /**
   * A tier assignment was retried against a creator who is not `verified`
   * (KAN-23). Tier assignment happens on activation, so re-running it for a
   * pending or rejected creator is a request for something the state machine
   * does not offer.
   *
   * Not CREATOR_NOT_PENDING, which is its near-opposite: that one fires when a
   * creator has *already* been decided, and its message — "This creator has
   * already been reviewed." — would be actively misleading here, where the
   * problem is that they have not been.
   */
  CREATOR_NOT_VERIFIED = 'CREATOR_NOT_VERIFIED',
  /**
   * A creator was targeted for campaign booking but is either not verified or
   * has no active pricing tier (AC-006).
   *
   * Use this when a brand tries to book or cart a creator.
   * Contrast with CREATOR_NOT_VERIFIED, which guards the admin tier-assignment
   * action against creators who have not yet passed verification.
   */
  CREATOR_NOT_BOOKABLE = 'CREATOR_NOT_BOOKABLE',
  /**
   * A creator has already been added to this campaign (KAN-30 AC item 4).
   */
  CREATOR_ALREADY_IN_CART = 'CREATOR_ALREADY_IN_CART',
  /**
   * An edit or item modification was attempted on a campaign that is no longer
   * in `draft` status (KAN-26, KAN-30, Tech Spec §4.3).
   */
  CAMPAIGN_NOT_DRAFT = 'CAMPAIGN_NOT_DRAFT',
  OFFER_EXPIRED = 'OFFER_EXPIRED',
  /**
   * An accept named a usage-rights version that is no longer the current one
   * (KAN-36, AC-017). The terms were republished while the offer sat open, so
   * the creator is looking at text the deal can no longer be governed by.
   *
   * Not OFFER_NOT_PENDING, whose message — "This offer is no longer pending." —
   * would be plainly false here: the offer still is, and refusing it with that
   * sentence would send a creator looking for a status change that never
   * happened. The only correct instruction is to reload and read the version
   * now in effect, so the message says exactly that. Reloading works because
   * the offer screen renders the *current* terms for a pending deal rather than
   * the version stamped at offer time; without that, this error would repeat
   * forever.
   */
  RIGHTS_TERMS_STALE = 'RIGHTS_TERMS_STALE',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  NO_ACCEPTED_DEALS = 'NO_ACCEPTED_DEALS',
  INVALID_TIKTOK_URL = 'INVALID_TIKTOK_URL',
  DEAL_NOT_FUNDED = 'DEAL_NOT_FUNDED',
  DEAL_NOT_DELIVERED = 'DEAL_NOT_DELIVERED',
  FORBIDDEN = 'FORBIDDEN',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /**
   * Not in the §4.7 table, but the spec's endpoint definitions return 404 in
   * several places (§4.3 cart removal, §4.5 metrics) and `ErrorEnvelope`
   * requires every response to carry a member of this enum — an ad-hoc string
   * would bypass the envelope type. Used only where the caller is entitled to
   * know the row does not exist (admin endpoints); owner-scoped routes keep
   * collapsing "no such row" into FORBIDDEN so they are not existence oracles.
   */
  NOT_FOUND = 'NOT_FOUND',
  /**
   * The scheduled run exceeded its time budget and was aborted (KAN-56).
   *
   * Not in the §4.7 table — that table holds business codes for the §4 REST
   * surface, and the cron route is Vercel infrastructure, not part of it — but
   * the envelope rule holds here too: an ad-hoc string would bypass the
   * `ErrorEnvelope` type, so these are members like any other. The status is
   * 504, never 500: an aborted run is a timeout, not an internal failure, and
   * it must not trip the same alarms as a crash.
   */
  CRON_TIMEOUT = 'CRON_TIMEOUT',
  /**
   * The scheduled run completed but one or more jobs failed (KAN-56).
   *
   * The summary — the one thing an operator wants from this response — stays
   * in the server logs and in the 200 body of a healthy run; the envelope here
   * carries no `details` so the shape stays `Record<string, string[]>`.
   */
  CRON_PARTIAL_FAILURE = 'CRON_PARTIAL_FAILURE',
  /**
   * The request did not carry the shared cron secret (KAN-56 AC-002).
   *
   * Deliberately no distinct response for an *unconfigured* secret: a 500
   * would answer an unauthenticated probe with the server's config state.
   * Misconfiguration is loud in the logs instead, and the request still gets
   * this 401.
   */
  UNAUTHORIZED = 'UNAUTHORIZED',
  /**
   * An unexpected infrastructure failure in the cron route (KAN-56).
   */
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
}

export const ErrorMessage: Record<ErrorCode, string> = {
  [ErrorCode.TIKTOK_HANDLE_TAKEN]: 'This TikTok account is already registered.',
  [ErrorCode.PROFILE_EXISTS]: 'You already have a profile.',
  [ErrorCode.BUDGET_NOT_POSITIVE]: 'Budget must be greater than zero.',
  [ErrorCode.BUDGET_EXCEEDED]: 'This exceeds your remaining budget.',
  [ErrorCode.OFFER_NOT_PENDING]: 'This offer is no longer pending.',
  [ErrorCode.CREATOR_NOT_PENDING]: 'This creator has already been reviewed.',
  [ErrorCode.CREATOR_NOT_VERIFIED]: 'This creator is not verified yet.',
  [ErrorCode.CREATOR_NOT_BOOKABLE]:
    'This creator is not available for booking.',
  [ErrorCode.CREATOR_ALREADY_IN_CART]:
    'This creator is already in this campaign.',
  [ErrorCode.CAMPAIGN_NOT_DRAFT]: 'This campaign can no longer be edited.',
  [ErrorCode.OFFER_EXPIRED]: 'This offer has expired.',
  [ErrorCode.RIGHTS_TERMS_STALE]:
    'The usage-rights terms were updated. Reload the page and read the current terms before accepting.',
  [ErrorCode.PAYMENT_FAILED]: 'Payment failed — please try again.',
  [ErrorCode.NO_ACCEPTED_DEALS]: 'No accepted deals to fund.',
  [ErrorCode.INVALID_TIKTOK_URL]: 'Enter a valid public TikTok video link.',
  [ErrorCode.DEAL_NOT_FUNDED]: 'Deal has not been funded yet.',
  [ErrorCode.DEAL_NOT_DELIVERED]: 'Deal has not been delivered yet.',
  [ErrorCode.FORBIDDEN]: 'You do not have permission to perform this action.',
  [ErrorCode.VALIDATION_ERROR]: 'Validation failed.',
  [ErrorCode.NOT_FOUND]: 'The requested resource does not exist.',
  [ErrorCode.CRON_TIMEOUT]: 'The scheduled run exceeded its time limit.',
  [ErrorCode.CRON_PARTIAL_FAILURE]: 'One or more jobs failed during this run.',
  [ErrorCode.UNAUTHORIZED]:
    'Invalid or missing cron secret authorization header.',
  [ErrorCode.INTERNAL_SERVER_ERROR]: 'Unhandled infrastructure failure.',
};

export const ErrorHttpStatus: Record<ErrorCode, number> = {
  [ErrorCode.TIKTOK_HANDLE_TAKEN]: 409,
  [ErrorCode.PROFILE_EXISTS]: 409,
  [ErrorCode.BUDGET_NOT_POSITIVE]: 422,
  [ErrorCode.BUDGET_EXCEEDED]: 409,
  [ErrorCode.OFFER_NOT_PENDING]: 409,
  [ErrorCode.CREATOR_NOT_PENDING]: 409,
  [ErrorCode.CREATOR_NOT_VERIFIED]: 409,
  [ErrorCode.CREATOR_NOT_BOOKABLE]: 422,
  [ErrorCode.CREATOR_ALREADY_IN_CART]: 409,
  [ErrorCode.CAMPAIGN_NOT_DRAFT]: 409,
  [ErrorCode.OFFER_EXPIRED]: 409,
  [ErrorCode.RIGHTS_TERMS_STALE]: 409,
  [ErrorCode.PAYMENT_FAILED]: 402,
  [ErrorCode.NO_ACCEPTED_DEALS]: 409,
  [ErrorCode.INVALID_TIKTOK_URL]: 422,
  [ErrorCode.DEAL_NOT_FUNDED]: 409,
  [ErrorCode.DEAL_NOT_DELIVERED]: 409,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CRON_TIMEOUT]: 504,
  [ErrorCode.CRON_PARTIAL_FAILURE]: 500,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.INTERNAL_SERVER_ERROR]: 500,
};

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, string[]>;
  };
}

export function errorResponse(
  code: ErrorCode,
  details?: Record<string, string[]>
): ErrorEnvelope {
  return {
    error: {
      code,
      message: ErrorMessage[code],
      details,
    },
  };
}

export function validationError(
  details: Record<string, string[]>
): ErrorEnvelope {
  return {
    error: {
      code: ErrorCode.VALIDATION_ERROR,
      message: ErrorMessage[ErrorCode.VALIDATION_ERROR],
      details,
    },
  };
}

/**
 * Flattens zod issues into the `details` map, keyed by dotted field path.
 *
 * Exported so a form validating the same schema in the browser produces the
 * *same keys* as the server does — the two error paths merge into one rendering
 * path instead of each side inventing its own naming. An issue with no path
 * (a whole-object refinement) lands under `_root`.
 */
export function zodIssuesToDetails(
  zodError: ZodError
): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of zodError.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_root';
    if (!details[path]) {
      details[path] = [];
    }
    details[path].push(issue.message);
  }
  return details;
}

export function fromZodError(zodError: ZodError): ErrorEnvelope {
  return validationError(zodIssuesToDetails(zodError));
}
