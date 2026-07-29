import type { ZodError } from 'zod';

export enum ErrorCode {
  TIKTOK_HANDLE_TAKEN = 'TIKTOK_HANDLE_TAKEN',
  BUDGET_NOT_POSITIVE = 'BUDGET_NOT_POSITIVE',
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
  OFFER_NOT_PENDING = 'OFFER_NOT_PENDING',
  OFFER_EXPIRED = 'OFFER_EXPIRED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  NO_ACCEPTED_DEALS = 'NO_ACCEPTED_DEALS',
  INVALID_TIKTOK_URL = 'INVALID_TIKTOK_URL',
  DEAL_NOT_FUNDED = 'DEAL_NOT_FUNDED',
  DEAL_NOT_DELIVERED = 'DEAL_NOT_DELIVERED',
  FORBIDDEN = 'FORBIDDEN',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

export const ErrorMessage: Record<ErrorCode, string> = {
  [ErrorCode.TIKTOK_HANDLE_TAKEN]: 'This TikTok account is already registered.',
  [ErrorCode.BUDGET_NOT_POSITIVE]: 'Budget must be greater than zero.',
  [ErrorCode.BUDGET_EXCEEDED]: 'This exceeds your remaining budget.',
  [ErrorCode.OFFER_NOT_PENDING]: 'This offer is no longer pending.',
  [ErrorCode.OFFER_EXPIRED]: 'This offer has expired.',
  [ErrorCode.PAYMENT_FAILED]: 'Payment failed — please try again.',
  [ErrorCode.NO_ACCEPTED_DEALS]: 'No accepted deals to fund.',
  [ErrorCode.INVALID_TIKTOK_URL]: 'Enter a valid public TikTok video link.',
  [ErrorCode.DEAL_NOT_FUNDED]: 'Deal has not been funded yet.',
  [ErrorCode.DEAL_NOT_DELIVERED]: 'Deal has not been delivered yet.',
  [ErrorCode.FORBIDDEN]: 'You do not have permission to perform this action.',
  [ErrorCode.VALIDATION_ERROR]: 'Validation failed.',
};

export const ErrorHttpStatus: Record<ErrorCode, number> = {
  [ErrorCode.TIKTOK_HANDLE_TAKEN]: 409,
  [ErrorCode.BUDGET_NOT_POSITIVE]: 422,
  [ErrorCode.BUDGET_EXCEEDED]: 409,
  [ErrorCode.OFFER_NOT_PENDING]: 409,
  [ErrorCode.OFFER_EXPIRED]: 409,
  [ErrorCode.PAYMENT_FAILED]: 402,
  [ErrorCode.NO_ACCEPTED_DEALS]: 409,
  [ErrorCode.INVALID_TIKTOK_URL]: 422,
  [ErrorCode.DEAL_NOT_FUNDED]: 409,
  [ErrorCode.DEAL_NOT_DELIVERED]: 409,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.VALIDATION_ERROR]: 422,
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

export function fromZodError(zodError: ZodError): ErrorEnvelope {
  const details: Record<string, string[]> = {};
  for (const issue of zodError.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_root';
    if (!details[path]) {
      details[path] = [];
    }
    details[path].push(issue.message);
  }
  return validationError(details);
}
