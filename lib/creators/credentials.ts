import { eq } from 'drizzle-orm';
import { APIError } from 'better-auth/api';
import { db } from '@/db';
import { account, user as userTable } from '@/db/auth-schema';
import { auth, needsCredentials } from '@/lib/auth';
import type { CurrentUser } from '@/lib/auth';

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
 * Sets the real email, then the password, in that order. An email that fails
 * (taken, malformed) leaves the password untouched, so a retried call never
 * hits `PASSWORD_ALREADY_SET` with the old email still in place.
 *
 * Both calls go through Better Auth rather than through `db` directly, so the
 * password hash and the session cookie stay the library's problem. The email
 * uniqueness check is the framework's (`updateUserByEmail`), and the
 * caller-visible conflict comes out of `mapCredentialsError`.
 */
export async function setCreatorCredentials(
  request: Request,
  email: string,
  password: string
): Promise<void> {
  await auth.api.changeEmail({
    body: { newEmail: email },
    headers: request.headers,
  });
  await (auth.api.setPassword as PasswordApi)({
    body: { newPassword: password },
    headers: request.headers,
  });
}

/** Better Auth's APIError names → the envelope code the route answers with. */
export function mapCredentialsError(error: unknown): 'EMAIL_TAKEN' | 'RETRY' {
  const message = error instanceof APIError ? error.body?.code : undefined;
  if (message === 'EMAIL_IS_THE_SAME' || message === 'PASSWORD_ALREADY_SET') {
    return 'RETRY';
  }
  return 'EMAIL_TAKEN';
}

/**
 * The handle Login Kit wrote at sign-up, for this session's user.
 *
 * Read at insert time, never from the request body: `mapProfileToUser` is the
 * only writer, so onboarding cannot be pointed at a different TikTok account
 * than the one the OAuth consent screen named.
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
