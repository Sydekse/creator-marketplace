import { z } from 'zod';
import { guard, toErrorResponse } from '@/lib/authz';
import {
  mapCredentialsError,
  readCredentialsStatus,
  setCreatorCredentials,
} from '@/lib/creators/credentials';
import { verifyEmailOtp } from '@/lib/creators/email-otp';
import {
  ErrorCode,
  ErrorHttpStatus,
  errorResponse,
  validationError,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

const credentialsSchema = z
  .object({
    email: z.email('Enter a valid email address.').optional(),
    /** The OTP mailed by `POST /api/creators/credentials/otp` (phase 3). */
    code: z
      .string()
      .regex(/^\d{6}$/, 'Enter the 6-digit code from the email.')
      .optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      .optional(),
  })
  .refine((data) => data.email !== undefined || data.password !== undefined, {
    message: 'Nothing to save.',
    path: ['_root'],
  })
  // Verify-before-write: an email without its proof is not a savable request.
  .refine((data) => data.email === undefined || data.code !== undefined, {
    message: 'Enter the 6-digit code from the email.',
    path: ['code'],
  });

/** What the wrong-code family of outcomes says to the person at the form. */
const OTP_ERROR_MESSAGES = {
  no_code: 'That code is no longer valid. Request a new one.',
  expired: 'That code has expired. Request a new one.',
  invalid_code: 'That code is not correct. Check the email and try again.',
  too_many_attempts: 'Too many incorrect attempts. Request a new code.',
} as const;

/** What the form reads before it renders anything. */
export async function GET(): Promise<Response> {
  try {
    const ctx = await guard({ roles: ['creator'] });
    return Response.json(await readCredentialsStatus(ctx.user));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Phase 1's post-OAuth step: a real email and a password, on the user who just
 * signed in with TikTok. Partial by design — the form only sends what the
 * status said was missing, so each field is optional and validated alone.
 *
 * The password mutation goes through Better Auth with the request's own
 * headers, so the session the framework is acting on is the caller's — never
 * a `userId` field, which is the account-takeover version of this endpoint.
 * The email write is guarded by the session user's placeholder state inside
 * `setCreatorCredentials`.
 */
export async function POST(request: Request): Promise<Response> {
  let user;
  try {
    ({ user } = await guard({ roles: ['creator'] }));
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

  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(validationError(parsed.error.flatten().fieldErrors), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  // The proof precedes the write (phase 3, PR 2): only a correct code mailed
  // to this exact candidate address lets the email be stored — which is also
  // why `setCreatorCredentials` may stamp `emailVerified: true`. Password-only
  // requests skip this entirely; nothing about them involves the inbox.
  if (parsed.data.email !== undefined) {
    const verified = await verifyEmailOtp(
      user.id,
      parsed.data.email,
      // The schema refine guarantees `code` whenever `email` is present.
      parsed.data.code!
    );
    if (!verified.ok) {
      return Response.json(
        errorResponse(ErrorCode.VALIDATION_ERROR, {
          code: [OTP_ERROR_MESSAGES[verified.error]],
        }),
        { status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR] }
      );
    }
  }

  try {
    await setCreatorCredentials(
      request,
      user,
      parsed.data.email,
      parsed.data.password
    );
  } catch (error) {
    const code = mapCredentialsError(error);
    return Response.json(
      errorResponse(ErrorCode.VALIDATION_ERROR, {
        email: [
          code === 'EMAIL_TAKEN'
            ? 'That email is already in use. Sign in with it, or use a different one.'
            : 'Credentials were already set. Refresh and continue.',
        ],
      }),
      { status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR] }
    );
  }

  return Response.json({ ok: true });
}
