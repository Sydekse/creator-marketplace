import { z } from 'zod';
import { guard, toErrorResponse } from '@/lib/authz';
import type { GuardOptions } from '@/lib/authz';
import type { CurrentUser } from '@/lib/auth';
import { peekEmailOtp } from '@/lib/creators/email-otp';
import type { EmailOtpDeps, VerifyOtpResult } from '@/lib/creators/email-otp';
import {
  ErrorCode,
  ErrorHttpStatus,
  errorResponse,
  validationError,
} from '@/lib/validation';

export const runtime = 'nodejs';

const peekSchema = z.object({
  email: z.email('Enter a valid email address.'),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
});

const OTP_ERROR_MESSAGES = {
  no_code: 'That code is no longer valid. Request a new one.',
  expired: 'That code has expired. Request a new one.',
  invalid_code: 'That code is not correct. Check the email and try again.',
  too_many_attempts: 'Too many incorrect attempts. Request a new code.',
} as const;

export interface PeekOtpRouteDeps {
  guard: (options: GuardOptions) => Promise<{ user: CurrentUser }>;
  peekOtp: (
    userId: string,
    email: string,
    code: string,
    deps?: EmailOtpDeps
  ) => Promise<VerifyOtpResult>;
}

/**
 * `POST /api/creators/credentials/otp/verify` — check the code without
 * consuming it. The credentials write still runs `verifyEmailOtp`.
 */
export async function handlePeekOtp(
  request: Request,
  deps?: Partial<PeekOtpRouteDeps>
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

  const parsed = peekSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(validationError(parsed.error.flatten().fieldErrors), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await (deps?.peekOtp ?? peekEmailOtp)(
    user.id,
    parsed.data.email,
    parsed.data.code
  );

  if (!result.ok) {
    return Response.json(
      errorResponse(ErrorCode.VALIDATION_ERROR, {
        code: [OTP_ERROR_MESSAGES[result.error]],
      }),
      { status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR] }
    );
  }

  return Response.json({ ok: true });
}

export async function POST(request: Request): Promise<Response> {
  return handlePeekOtp(request);
}
