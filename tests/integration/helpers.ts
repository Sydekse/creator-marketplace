import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaign, creatorProfile, deal, user } from '@/db/schema';
import { auth } from '@/lib/auth';
import { isUserRole } from '@/lib/auth-policy';
import { createGuard, loadOwnerRefs, loadProfileIds } from '@/lib/authz';
import type { GuardOptions } from '@/lib/authz';
import { providerFromEnv, renderNotification } from '@/lib/notifications';
import type { NotifyDeps } from '@/lib/notifications/notify';
import type { VerifyCreatorDeps } from '@/app/api/admin/creators/[id]/verify/route';

/**
 * KAN-59 helpers — real sessions and real rows, never fakes.
 *
 * The seeded demo accounts are the fixture (KAN-20): they sign in through
 * Better Auth against the same database the assertions read, so the RBAC
 * suite exercises the actual session store, not a stand-in.
 */

/** The seed's demo password — see `DEMO_PASSWORD` in db/seed.ts. */
export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'demo-Passw0rd!';

/**
 * Sign in as a seeded user and return the `better-auth.session_token=…`
 * cookie fragment that `auth.api.getSession` accepts. The sign-in itself is
 * the first thing tested: a session that cannot be minted fails every RBAC
 * test downstream.
 */
export async function signInCookie(email: string): Promise<string> {
  const res = await auth.api.signInEmail({
    body: { email, password: DEMO_PASSWORD },
  });
  if (!res.token) {
    throw new Error(`[integration] sign-in for ${email} produced no session token`);
  }
  return `better-auth.session_token=${res.token}`;
}

/**
 * Resolve a session cookie back to a user row, through the real auth API.
 * The role is normalised the way `getCurrentUser` does — an unrecognised
 * role must read as the least-privileged one, never trusted into a gate.
 */
export async function userFromCookie(cookie: string) {
  const session = await auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  if (!session) return null;
  const role = (session.user as { role?: unknown }).role;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: isUserRole(role) ? role : 'creator',
  };
}

/**
 * The real deps for the verify handler: real guard + real notification
 * service (console provider, so nothing mails) + real admin audit, all keyed
 * off one live session. The unit suite fakes these; here the whole flow runs
 * for real.
 */
export function realVerifyDeps(cookie: string): VerifyCreatorDeps {
  return {
    guard: guardForCookie(cookie),
    notifyDeps: {
      db,
      provider: providerFromEnv({}),
      render: renderNotification,
      log: console,
      sleep: async () => {},
    } as NotifyDeps,
    adminAuditDeps: {
      getCurrentUser: async () => userFromCookie(cookie),
      loadProfileIds,
      loadOwnerRefs,
    },
  };
}

/**
 * A real guard for a real session: `createGuard` with the production DB-backed
 * ownership lookups, and only the session resolution swapped — the one piece
 * that reads Next's request context and cannot run outside a request. This is
 * the seam the route handlers already expose (`deps.guard`), so the 403/200
 * matrix below runs the route's own guard logic against a real session and a
 * real database.
 */
export function guardForCookie(cookie: string) {
  return createGuard({
    getCurrentUser: async () => userFromCookie(cookie),
    loadProfileIds,
    loadOwnerRefs,
  });
}

export type Guard = (opts: GuardOptions) => Promise<unknown>;

/** Look up a seeded deal by campaign name, with the deal's own ids. */
export async function seededDeal(campaignName: string) {
  const [row] = await db
    .select({ dealId: deal.id, campaignId: campaign.id })
    .from(campaign)
    .innerJoin(deal, eq(deal.campaignId, campaign.id))
    .where(eq(campaign.name, campaignName))
    .limit(1);
  if (!row) {
    throw new Error(`[integration] no seeded deal for campaign "${campaignName}"`);
  }
  return row;
}

/** The seeded creator profile id for a demo creator email. */
export async function profileIdForEmail(email: string): Promise<string> {
  const [row] = await db
    .select({ id: creatorProfile.id })
    .from(user)
    .innerJoin(creatorProfile, eq(creatorProfile.userId, user.id))
    .where(eq(user.email, email))
    .limit(1);
  if (!row) {
    throw new Error(`[integration] no creator profile for "${email}"`);
  }
  return row.id;
}
