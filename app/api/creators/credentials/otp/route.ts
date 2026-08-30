import { z } from 'zod';
import { guard, toErrorResponse } from '@/lib/authz';
import type { GuardOptions } from '@/lib/authz';
import type { CurrentUser } from '@/lib/auth';
import { needsCredentials } from '@/lib/auth';
import { requestEmailOtp } from '@/lib/creators/email-otp';
import type { EmailOtpDeps, RequestOtpResult } from '@/lib/creators/email-otp';
import {
  ErrorCode,
  ErrorHttpStatus,
  errorResponse,
  validationError,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

const requestSchema = z.object({
  email: z.email('Enter a valid email address.'),
});

/** Seam for tests. */
export interface OtpRouteDeps {
  guard: (options: GuardOptions) => Promise<{ user: CurrentUser }>;
  requestOtp: (
    userId: string,
    email: string,
    deps?: EmailOtpDeps
  ) => Promise<RequestOtpResult>;
}

/**
 * `POST /api/creators/credentials/otp` — mail a verification code to a
 * *candidate* email (phase 3, PR 2).
 *
 * The first half of verify-before-write: the credentials step no longer
 * stores whatever address was typed; it stores the one that echoed a code
 * back. This endpoint sends that code. Only useful — and only allowed —
 * while the account still carries the TikTok placeholder: once a real email
 * is set, the write this code would authorize is refused anyway
 * (`CredentialsAlreadySetError`), so the mail would be pure noise.
 *
 * A repeat request inside the cooldown is a 429 with `Retry-After`, so the
 * form can count down rather than guess.
 */
export async function handleRequestOtp(
  request: Request,
  deps?: Partial<OtpRouteDeps>
): Promise<Response> {
  let user: CurrentUser;
  try {
    ({ user } = await (deps?.guard ?? guard)({ roles: ['creator'] }));
  } catch (error) {
    return toErrorResponse(error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      validationError({ _root: ['Request body must be valid JSON.'] }),
      { status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR] }
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(validationError(parsed.error.flatten().fieldErrors), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  if (!needsCredentials(user)) {
    return Response.json(
      validationError({
        email: ['An email is already set for this account.'],
      }),
      { status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR] }
    );
  }

  const result = await (deps?.requestOtp ?? requestEmailOtp)(
    user.id,
    parsed.data.email
  );

  if (!result.ok) {
    const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
    return Response.json(errorResponse(ErrorCode.OTP_RATE_LIMITED), {
      status: ErrorHttpStatus[ErrorCode.OTP_RATE_LIMITED],
      headers: { 'Retry-After': String(retryAfterSeconds) },
    });
  }

  return Response.json({ ok: true });
}

export async function POST(request: Request): Promise<Response> {
  return handleRequestOtp(request);
}
