import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { session } from '@/db/auth-schema';
import {
  brandProfile,
  campaign,
  creatorProfile,
  deal,
  pricingTier,
  rightsTerms,
  user,
} from '@/db/schema';
import { auth } from '@/lib/auth';
import { isUserRole } from '@/lib/auth-policy';
import { createGuard, loadOwnerRefs, loadProfileIds } from '@/lib/authz';
import type { GuardOptions } from '@/lib/authz';
import { COMMISSION_RATE } from '@/lib/config/pricing';
import { transitionDeal } from '@/lib/deals/state-machine';
import {
  defaultDeps as defaultResolveDeps,
  type ResolveDisputeDeps,
} from '@/lib/deals/resolve-dispute';
import { getPaymentProvider } from '@/lib/payment';
import { EscrowLedgerService } from '@/lib/payment/ledger';
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
 * Sign in as a seeded user and return the real session token. The sign-in
 * itself is the first thing tested: a session that cannot be minted fails
 * every RBAC test downstream.
 *
 * The returned value is a `better-auth.session_token=…` fragment so the
 * callers read as "this is a session cookie" even though resolution below
 * goes through the session table rather than the cookie header.
 */
export async function signInCookie(email: string): Promise<string> {
  const res = await auth.api.signInEmail({
    body: { email, password: DEMO_PASSWORD },
  });
  if (!res.token) {
    throw new Error(
      `[integration] sign-in for ${email} produced no session token`
    );
  }
  return `better-auth.session_token=${res.token}`;
}

/**
 * Resolve a session back to a user row through the real session store.
 *
 * `auth.api.getSession` reads its cookie via `getSignedCookie`, and better-auth
 * HMAC-signs session cookies at the transport layer — a raw token pasted into
 * a header fails that check. In a server request the signature is the browser's
 * concern; the resolution here skips it and looks the token up in the real
 * `session` table instead, which is exactly what the endpoint does *after*
 * verifying the signature. The token is genuine — minted by `signInEmail` —
 * so the session row, the user row, and the role are all real.
 *
 * The role is normalised the way `getCurrentUser` does — an unrecognised
 * role must read as the least-privileged one, never trusted into a gate.
 */
export async function userFromCookie(cookie: string) {
  const token = cookie.split('=').slice(1).join('=');
  const [sessionRow] = await db
    .select({ userId: session.userId })
    .from(session)
    .where(eq(session.token, token))
    .limit(1);
  if (!sessionRow) return null;

  const [userRow] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    })
    .from(user)
    .where(eq(user.id, sessionRow.userId))
    .limit(1);
  if (!userRow) return null;

  const role = userRow.role;
  return {
    id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    role: isUserRole(role) ? role : 'creator',
  };
}

/** The real user id for a seeded email — used as an event actor in the money walk. */
export async function userIdForEmail(email: string): Promise<string> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (!row) throw new Error(`[integration] no user row for "${email}"`);
  return row.id;
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
 * The real deps for the resolve-dispute action, with only the audit re-check
 * swapped to a real session: the production `defaultDeps` re-checks the admin
 * role through `getSessionUser`, which reads `headers()` — a Next request
 * API that cannot run outside a request. `userFromCookie` resolves the same
 * genuine session token through the real session table instead (see its own
 * comment), so `withAdminAudit` inside the ledger transaction attributes the
 * audit row without needing a request scope.
 */
export function realResolveDeps(cookie: string): ResolveDisputeDeps {
  return {
    ...defaultResolveDeps,
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
    throw new Error(
      `[integration] no seeded deal for campaign "${campaignName}"`
    );
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

/**
 * KAN-59 money fixtures — a fresh campaign + deal, money built IN-PROCESS.
 *
 * The mock provider keeps its holds in memory, so a hold placed by the seed
 * process is invisible to the test process: every `capturePayout` or
 * `releaseHold` against a seeded ref throws "Hold not found". Each money test
 * therefore creates its own campaign and walks it through the real ledger here,
 * so the provider refs it uses were placed by this process — and the only
 * failures that can occur are the ones the test induces.
 *
 * A unique name per call (`crypto.randomUUID` suffix) keeps the suite
 * repeatable against a persistent database: no two runs share a campaign, so
 * nothing a later run does can trip an earlier run's fixtures, and `deal` is
 * unique on `(campaign_id, creator_id)` — one run can never collide with the
 * next.
 */
export async function createMoneyFixture(opts: {
  /** How far the real walk goes: `accepted` (pre-money), `funded`, `delivered`. */
  kind: 'accepted' | 'funded' | 'delivered';
  /** KAN-69 (F40): raise the attention flag, as the dispute flow needs. */
  flagged?: boolean;
  /** Human tag embedded in the campaign name, for greppable fixtures. */
  label: string;
}): Promise<{ dealId: string; campaignId: string }> {
  const { kind, flagged = false, label } = opts;

  const [brand] = await db
    .select({ id: brandProfile.id })
    .from(brandProfile)
    .innerJoin(user, eq(brandProfile.userId, user.id))
    .where(eq(user.email, 'brand@demo.com'))
    .limit(1);
  if (!brand) {
    throw new Error('[integration] no seeded brand row for brand@demo.com');
  }

  const creatorId = await profileIdForEmail('creator@demo.com');
  const [creator] = await db
    .select({ pricePerVideo: pricingTier.pricePerVideo })
    .from(creatorProfile)
    .innerJoin(pricingTier, eq(creatorProfile.tierId, pricingTier.id))
    .where(eq(creatorProfile.id, creatorId))
    .limit(1);
  if (!creator) {
    throw new Error('[integration] seeded creator has no tier to price from');
  }

  const [terms] = await db
    .select({ id: rightsTerms.id })
    .from(rightsTerms)
    .limit(1);
  if (!terms) {
    throw new Error('[integration] no rights terms seeded');
  }

  const videoCount = 2;
  const totalPrice = creator.pricePerVideo * videoCount;
  const tag = crypto.randomUUID().slice(0, 8);

  const [campaignRow] = await db
    .insert(campaign)
    .values({
      brandId: brand.id,
      name: `${label} ${tag}`,
      goal: `KAN-59 fixture: ${label}`,
      budget: totalPrice,
      desiredVideos: videoCount,
      status: 'confirmed',
    })
    .returning({ id: campaign.id });

  const [dealRow] = await db
    .insert(deal)
    .values({
      campaignId: campaignRow.id,
      creatorId,
      videoCount,
      unitPrice: creator.pricePerVideo,
      totalPrice,
      commissionRate: COMMISSION_RATE,
      // Created at `accepted` with its rights timestamp in the same row: the
      // CHECK constraint refuses an accepted deal with null rights columns,
      // and the real accept flow (KAN-33) writes both in one transaction.
      status: 'accepted',
      rightsAcceptedAt: new Date(),
      rightsTermsId: terms.id,
      offerExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ...(flagged ? { flagged: true } : {}),
    })
    .returning({ id: deal.id });

  const ids = { dealId: dealRow.id, campaignId: campaignRow.id };

  if (kind === 'accepted') return ids;

  // `holdForCampaign` is the real money walk: it places the hold on THIS
  // process's provider (so the ref is live here), writes the ledger rows, and
  // transitions the deal to `funded`.
  const ledger = new EscrowLedgerService(db, getPaymentProvider());
  await ledger.holdForCampaign(campaignRow.id);

  if (kind === 'funded') return ids;

  // `delivered` — through the real guarded transition, so the `deal_event`
  // trail is real too (invariant 6).
  await db.transaction(async (tx) => {
    await transitionDeal(
      tx,
      dealRow.id,
      'delivered',
      await userIdForEmail('creator@demo.com'),
      {
        reason: 'Creator submitted the live TikTok post URL',
      }
    );
  });

  return ids;
}
