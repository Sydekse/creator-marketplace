import { eq } from 'drizzle-orm';
import { APIError } from 'better-auth/api';
import { db } from '@/db';
import { account, user as userTable } from '@/db/auth-schema';
import { auth, needsCredentials } from '@/lib/auth';
import type { CurrentUser } from '@/lib/auth';
import { normalizeTiktokHandle } from '@/lib/creators/handle';

/**
 * Hash a new credential account onto an already-signed-in user.
 *
 * `auth.api.setPassword` is the same code the sign-in form ends at, and it is
 * server-only: it refuses to run without the session middleware. The route
 * hands the request through, so Better Auth reads the cookie itself rather
 * than trusting a body userId (which would let anyone set a password for a
 * stranger).
 */
type PasswordApi = (args: {
  body: { newPassword: string };
  headers: Headers;
}) => Promise<unknown>;

/**
 * The phase-1 credentials step after Login Kit (KAN-39).
 *
 * Better Auth puts the Login Kit `username` in the email column because TikTok
 * does not send one. That value is not an address, so anything that would mail
 * it is refused, and `/creator` plus onboarding hold the creator here until a
 * real email and a password both exist.
 */

/** What the client needs to decide whether this form matters at all. */
export interface CredentialsStatus {
  needsEmail: boolean;
  hasPassword: boolean;
  tiktokHandle: string | null;
}

export async function readCredentialsStatus(
  user: CurrentUser
): Promise<CredentialsStatus> {
  const rows = await db
    .select({ password: account.password })
    .from(account)
    .where(eq(account.userId, user.id));
  return {
    needsEmail: needsCredentials(user),
    hasPassword: rows.some((row) => row.password !== null),
    tiktokHandle: user.tiktokHandle ?? null,
  };
}

/**
 * Writes the missing credentials for this session's user: the real email, then
 * the password, in that order. Either part may be absent — the form only sends
 * what the status said was missing — and an email that fails (taken) leaves
 * the password untouched, so a retry never half-applies.
 *
 * The email is written directly rather than through `auth.api.changeEmail`:
 * that flow defers the change behind a confirmation link mailed to the
 * *current* address — which here is the TikTok placeholder that the
 * notification providers deliberately refuse to mail. The change would never
 * confirm and the creator would loop on this screen forever. The direct write
 * is safe precisely because it is only allowed while the stored email is that
 * placeholder (`needsCredentials`); a real address can never be overwritten
 * through this path. Uniqueness stays the column's UNIQUE constraint, surfaced
 * as EMAIL_TAKEN by `mapCredentialsError`.
 *
 * The password still goes through Better Auth (`setPassword` reads the session
 * from the request's own headers), so the hash and cookie remain the
 * library's problem.
 */
export async function setCreatorCredentials(
  request: Request,
  user: CurrentUser,
  email: string | undefined,
  password: string | undefined
): Promise<void> {
  if (email !== undefined) {
    if (!needsCredentials(user)) {
      throw new CredentialsAlreadySetError('email');
    }
    // Login Kit parked the username in `user.email`. Overwriting that column
    // without copying it first is how a TikTok sign-up loses its handle before
    // onboarding can prefill.
    const fromPlaceholder = user.email.includes('@')
      ? ''
      : normalizeTiktokHandle(user.email);
    await db
      .update(userTable)
      .set({
        email,
        emailVerified: false,
        updatedAt: new Date(),
        ...(user.tiktokHandle || fromPlaceholder === ''
          ? {}
          : { tiktokHandle: fromPlaceholder }),
      })
      .where(eq(userTable.id, user.id));
  }
  if (password !== undefined) {
    await (auth.api.setPassword as PasswordApi)({
      body: { newPassword: password },
      headers: request.headers,
    });
  }
}

/** Thrown when a credential this endpoint may only set once already exists. */
export class CredentialsAlreadySetError extends Error {
  constructor(which: 'email' | 'password') {
    super(`${which} already set`);
    this.name = 'CredentialsAlreadySetError';
  }
}

/** Postgres unique-violation, as pg surfaces it (SQLSTATE 23505). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}

/** Better Auth's APIError names → the envelope code the route answers with. */
export function mapCredentialsError(error: unknown): 'EMAIL_TAKEN' | 'RETRY' {
  if (error instanceof CredentialsAlreadySetError) return 'RETRY';
  if (isUniqueViolation(error)) return 'EMAIL_TAKEN';
  const message = error instanceof APIError ? error.body?.code : undefined;
  if (message === 'EMAIL_IS_THE_SAME' || message === 'PASSWORD_ALREADY_SET') {
    return 'RETRY';
  }
  return 'EMAIL_TAKEN';
}

/**
 * The handle Login Kit wrote at sign-up, for this session's user.
 *
 * Read at insert time, never from the request body: the `user.create.before`
 * database hook in `lib/auth.ts` is the only writer, so onboarding cannot be
 * pointed at a different TikTok account than the one the OAuth consent screen
 * named.
 */
export async function sessionTiktokHandle(
  userId: string
): Promise<string | null> {
  const rows = await db
    .select({ handle: userTable.tiktokHandle })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  const handle = rows[0]?.handle;
  return typeof handle === 'string' && handle !== '' ? handle : null;
}
