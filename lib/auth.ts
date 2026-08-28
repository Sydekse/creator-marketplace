import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import * as authSchema from '@/db/auth-schema';
import type { UserRole } from '@/db/schema';
import {
  RoleNotSelfAssignableError,
  resolveSignupRole,
  isUserRole,
} from '@/lib/auth-policy';
import { roleHomePath } from '@/lib/navigation';
import { normalizeTiktokHandle } from '@/lib/creators/handle';

/**
 * The deployment's own URL on Vercel. `VERCEL_URL` is set automatically on
 * every deploy (production and preview alike) and carries no scheme; previews
 * get a fresh random host each build, which is exactly why it cannot be a
 * static env var. `BETTER_AUTH_URL` still wins where it is set (local dev,
 * e2e), so nothing changes off Vercel.
 */
const deploymentURL =
  process.env.BETTER_AUTH_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

/**
 * `VERCEL_BRANCH_URL` is the stable per-branch alias. A custom domain pinned
 * to a branch (e.g. `dev-creator-marketplace.vercel.app`) is NOT any of the
 * URLs Vercel exposes in env, so it must be trusted explicitly —
 * `BETTER_AUTH_EXTRA_ORIGINS` takes a comma-separated list for that, and the
 * pinned dev domain is baked in so previews work with zero dashboard config.
 * Without these, Better Auth rejects requests arriving through the pinned
 * domain as an invalid origin.
 */
const trustedOrigins = [
  deploymentURL,
  process.env.VERCEL_BRANCH_URL
    ? `https://${process.env.VERCEL_BRANCH_URL}`
    : undefined,
  'https://dev-creator-marketplace.vercel.app',
  ...(process.env.BETTER_AUTH_EXTRA_ORIGINS?.split(',').map((o) => o.trim()) ??
    []),
].filter((origin): origin is string => Boolean(origin));

export const auth = betterAuth({
  ...(deploymentURL ? { baseURL: deploymentURL } : {}),
  ...(trustedOrigins.length > 0 ? { trustedOrigins } : {}),
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
  // TikTok Login Kit. Keys live in env — never commit them. If either is
  // missing the provider is omitted so local/CI without TikTok still boots.
  ...(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET
    ? {
        socialProviders: {
          tiktok: {
            // Better Auth's shared social-provider guard only looks at
            // `clientId`. TikTok's types forbid that field (`clientKey` only),
            // so it is passed at runtime and asserted away for the type checker.
            clientId: process.env.TIKTOK_CLIENT_KEY,
            clientKey: process.env.TIKTOK_CLIENT_KEY,
            clientSecret: process.env.TIKTOK_CLIENT_SECRET,
            // TikTok never sends an email; Better Auth stores the Login Kit
            // `username` in the email column instead. The handle the creator
            // signs up with is the one their profile is built on, so it is
            // captured onto the user here and locked on onboarding.
            mapProfileToUser: (profile) => ({
              tiktokHandle: normalizeTiktokHandle(
                (profile as { data?: { user?: { username?: string } } }).data
                  ?.user?.username ?? ''
              ),
            }),
          } as {
            clientKey: string;
            clientSecret: string;
            mapProfileToUser: (profile: unknown) => Record<string, unknown>;
          },
        },
      }
    : {}),
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
      // The TikTok username from Login Kit (KAN-39 phase 1). Not an input: it
      // arrives from the provider, never from the request body.
      tiktokHandle: {
        type: 'string',
        required: false,
        input: false,
      },
    },
    // The credentials step moves a TikTok user from the synthetic email to a
    // real one. Verification is optional in phase 1 (Resend may be off in
    // sandbox), so the update is allowed while the placeholder is unverified.
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: true,
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Allowlist brand/creator. Anything else — including 'admin' and any
          // string outside the union — is refused (NFR-005).
          try {
            const role = resolveSignupRole((user as { role?: unknown }).role);
            return { data: { ...user, role } };
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
  /** The TikTok username Login Kit wrote at sign-up, when there is one. */
  tiktokHandle?: string | null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { headers } = await import('next/headers');
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) return null;

  const role = (session.user as { role?: unknown }).role;
  const handle = (session.user as { tiktokHandle?: unknown }).tiktokHandle;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    // A row with an unrecognised role is treated as the least-privileged one
    // rather than being trusted into a gate.
    role: isUserRole(role) ? role : 'creator',
    tiktokHandle: typeof handle === 'string' && handle !== '' ? handle : null,
  };
}

/**
 * Whether this session still owes the credentials step (phase 1).
 *
 * A TikTok sign-up has no real email — Better Auth stores the Login Kit
 * `username` in the email column, never `@` — and no password until the
 * creator sets one. Both must exist before onboarding.
 */
export function needsCredentials(user: CurrentUser): boolean {
  return !user.email.includes('@');
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
