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
  OFFER_EXPIRED = 'OFFER_EXPIRED',
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
}

export const ErrorMessage: Record<ErrorCode, string> = {
  [ErrorCode.TIKTOK_HANDLE_TAKEN]: 'This TikTok account is already registered.',
  [ErrorCode.PROFILE_EXISTS]: 'You already have a profile.',
  [ErrorCode.BUDGET_NOT_POSITIVE]: 'Budget must be greater than zero.',
  [ErrorCode.BUDGET_EXCEEDED]: 'This exceeds your remaining budget.',
  [ErrorCode.OFFER_NOT_PENDING]: 'This offer is no longer pending.',
  [ErrorCode.CREATOR_NOT_PENDING]: 'This creator has already been reviewed.',
  [ErrorCode.CREATOR_NOT_VERIFIED]: 'This creator is not verified yet.',
  [ErrorCode.OFFER_EXPIRED]: 'This offer has expired.',
  [ErrorCode.PAYMENT_FAILED]: 'Payment failed — please try again.',
  [ErrorCode.NO_ACCEPTED_DEALS]: 'No accepted deals to fund.',
  [ErrorCode.INVALID_TIKTOK_URL]: 'Enter a valid public TikTok video link.',
  [ErrorCode.DEAL_NOT_FUNDED]: 'Deal has not been funded yet.',
  [ErrorCode.DEAL_NOT_DELIVERED]: 'Deal has not been delivered yet.',
  [ErrorCode.FORBIDDEN]: 'You do not have permission to perform this action.',
  [ErrorCode.VALIDATION_ERROR]: 'Validation failed.',
  [ErrorCode.NOT_FOUND]: 'The requested resource does not exist.',
};

export const ErrorHttpStatus: Record<ErrorCode, number> = {
  [ErrorCode.TIKTOK_HANDLE_TAKEN]: 409,
  [ErrorCode.PROFILE_EXISTS]: 409,
  [ErrorCode.BUDGET_NOT_POSITIVE]: 422,
  [ErrorCode.BUDGET_EXCEEDED]: 409,
  [ErrorCode.OFFER_NOT_PENDING]: 409,
  [ErrorCode.CREATOR_NOT_PENDING]: 409,
  [ErrorCode.CREATOR_NOT_VERIFIED]: 409,
  [ErrorCode.OFFER_EXPIRED]: 409,
  [ErrorCode.PAYMENT_FAILED]: 402,
  [ErrorCode.NO_ACCEPTED_DEALS]: 409,
  [ErrorCode.INVALID_TIKTOK_URL]: 422,
  [ErrorCode.DEAL_NOT_FUNDED]: 409,
  [ErrorCode.DEAL_NOT_DELIVERED]: 409,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.VALIDATION_ERROR]: 422,
  [ErrorCode.NOT_FOUND]: 404,
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
