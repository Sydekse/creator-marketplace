import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import * as authSchema from '@/db/auth-schema';
import type { UserRole } from '@/db/schema';
import {
  RoleNotSelfAssignableError,
  assertSelfRegisterableRole,
  isUserRole,
} from '@/lib/auth-policy';
import { roleHomePath } from '@/lib/navigation';

export const auth = betterAuth({
  // Better Auth mints ids in application code, and its default is a random
  // string. The project keeps uuid primary keys throughout (Tech Spec §3), so
  // it is told to mint UUIDs — this is what lets `db/auth-schema.ts` declare
  // `uuid('id')` and business tables keep `uuid` foreign keys to `user.id`.
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: authSchema.user,
      session: authSchema.session,
      account: authSchema.account,
      verification: authSchema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'creator',
        // The sign-up form sends this, so it has to be accepted as input — the
        // database hooks below are what make that safe.
        input: true,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Allowlist brand/creator. Anything else — including 'admin' and any
          // string outside the union — is refused (NFR-005).
          try {
            assertSelfRegisterableRole((user as { role?: unknown }).role);
          } catch (error) {
            if (!(error instanceof RoleNotSelfAssignableError)) throw error;
            // Better Auth turns an APIError into the documented status; a bare
            // Error would surface as a 500 and the caller would see nothing
            // useful. A real role being self-assigned is a refused privilege
            // (FORBIDDEN); anything else is a malformed field.
            throw new APIError(
              isUserRole(error.received) ? 'FORBIDDEN' : 'BAD_REQUEST',
              {
                code: isUserRole(error.received)
                  ? 'FORBIDDEN'
                  : 'VALIDATION_ERROR',
                message: error.message,
              }
            );
          }
          return { data: user };
        },
      },
      update: {
        before: async (user) => {
          // `input: true` means Better Auth's update-user endpoint would
          // otherwise pass `role` straight through, letting any signed-in user
          // PATCH themselves to admin. Role changes never travel over this
          // endpoint; an admin promoting someone writes the column directly.
          if ('role' in (user as Record<string, unknown>)) {
            throw new APIError('FORBIDDEN', {
              message: 'Your role cannot be changed from here.',
            });
          }
          return { data: user };
        },
      },
    },
  },
  // E2E only: the Playwright suite signs in serially, faster than the
  // production default (3 sign-ins per 10s per IP) allows, so the webServers
  // set E2E_DISABLE_RATE_LIMIT=1 to turn throttling off. Production keeps the
  // default-on protection untouched.
  ...(process.env.E2E_DISABLE_RATE_LIMIT === '1'
    ? { rateLimit: { enabled: false } }
    : {}),
});

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { headers } = await import('next/headers');
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) return null;

  const role = (session.user as { role?: unknown }).role;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    // A row with an unrecognised role is treated as the least-privileged one
    // rather than being trusted into a gate.
    role: isUserRole(role) ? role : 'creator',
  };
}

/** Requires a session. Redirects to sign-in when there isn't one. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in');
  return user;
}

/**
 * The role gate (NFR-005, invariant 2). Server-side and mandatory on every
 * role-scoped layout — hiding a nav link is cosmetic, this is the control.
 *
 * A signed-in user with the wrong role goes to their own home rather than to
 * sign-in; they are authenticated, just not entitled to this section.
 */
export async function requireRole(
  ...allowed: readonly UserRole[]
): Promise<CurrentUser> {
  const user = await requireUser();
  if (!allowed.includes(user.role)) redirect(roleHomePath(user.role));
  return user;
}
