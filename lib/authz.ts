import { eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  auditLog,
  brandProfile,
  campaign,
  creatorProfile,
  deal,
  deliverable,
} from '@/db/schema';
import type { UserRole } from '@/db/schema';
import { getCurrentUser as getSessionUser } from '@/lib/auth';
import type { CurrentUser } from '@/lib/auth';
import { ErrorCode, ErrorHttpStatus, errorResponse } from '@/lib/validation';
import type { ErrorEnvelope } from '@/lib/validation';

/**
 * Two-layer authorization for every mutation — Tech Spec §6.1, NFR-005.
 *
 * Layer 1 is the role gate (may this role call this action?), layer 2 is the
 * ownership check (does *this* brand own *this* campaign?). `lib/auth.ts`
 * already covers layer 1 for pages, but it does so with `redirect()`, which is
 * right for a navigation and wrong for a mutation. This module is the mutation
 * path: it throws, and the caller renders the standard 403 envelope.
 *
 * Two separate reasons this cannot be skipped by a page-level check:
 *
 *   - A Server Action is reachable as a direct POST whether or not any UI
 *     references it, so the page that renders the form is not a gate at all.
 *   - Hiding the button is cosmetic. The client never decides access.
 *
 * Everything here fails closed. There is no code path that returns "allowed"
 * because it did not recognise the question (AC4, §6.3 deny-by-default).
 */

/** Thrown by every denial. Carries the code so callers never invent their own. */
export class ForbiddenError extends Error {
  readonly code = ErrorCode.FORBIDDEN;

  constructor(reason: string) {
    // The reason is for server logs and tests. It is deliberately not the
    // user-facing string — that comes from ErrorMessage, so a denial can never
    // leak *why* it was denied (which row exists, which role was needed).
    super(reason);
    this.name = 'ForbiddenError';
  }
}

/** Resources that can be owned. Anything not listed here is denied, not allowed. */
export type ResourceKind =
  'campaign' | 'deal' | 'deliverable' | 'creatorProfile' | 'brandProfile';

/**
 * The actor, with both profile ids resolved.
 *
 * Business rows never reference `user.id` — `campaign.brand_id` points at
 * `brand_profile.id` and `deal.creator_id` at `creator_profile.id`. Ownership is
 * therefore always two hops, and comparing a row against `user.id` directly is
 * the bug this type exists to prevent.
 */
export interface AuthzContext {
  user: CurrentUser;
  brandProfileId: string | null;
  creatorProfileId: string | null;
}

/**
 * Who owns a resource, expressed in profile ids so the comparison is direct.
 * Both are populated where a resource has two legitimate owners: a deal is
 * owned by its creator *and* by the brand running its campaign, and §4.4 gates
 * different endpoints on different sides of it.
 */
export interface OwnerRefs {
  brandProfileId: string | null;
  creatorProfileId: string | null;
  /** For profile rows, which are owned by a user directly rather than via a profile. */
  userId: string | null;
}

export interface GuardOptions {
  /**
   * Roles permitted to call this action. Required, and an empty array denies
   * everyone — an endpoint that forgets to declare a role rejects all callers
   * rather than admitting them (AC4).
   */
  roles: readonly UserRole[];
  /** The entity being acted on. Omit for actions that own no specific row. */
  resource?: { kind: ResourceKind; id: string };
  /**
   * Let an admin through the ownership check. Tech Spec §4.5 gates the metrics
   * endpoint on "role creator (own deliverable) **or admin**", so allowed-roles
   * and must-own are independent axes rather than one test.
   *
   * An admin still has to be listed in `roles`; this only exempts them from
   * layer 2.
   */
  allowAdmin?: boolean;
}

/** Seams for testing. The defaults are the real database reads. */
export interface AuthzDeps {
  getCurrentUser: () => Promise<CurrentUser | null>;
  loadProfileIds: (userId: string) => Promise<{
    brandProfileId: string | null;
    creatorProfileId: string | null;
  }>;
  loadOwnerRefs: (kind: ResourceKind, id: string) => Promise<OwnerRefs | null>;
}

// -- Real data access -------------------------------------------------------

async function loadProfileIds(userId: string) {
  const [brand] = await db
    .select({ id: brandProfile.id })
    .from(brandProfile)
    .where(eq(brandProfile.userId, userId))
    .limit(1);
  const [creator] = await db
    .select({ id: creatorProfile.id })
    .from(creatorProfile)
    .where(eq(creatorProfile.userId, userId))
    .limit(1);

  return {
    brandProfileId: brand?.id ?? null,
    creatorProfileId: creator?.id ?? null,
  };
}

/**
 * Resolves the owning profile(s) of a row.
 *
 * Each branch walks the foreign keys from `db/schema.ts` rather than trusting
 * anything the caller passed in. Returning `null` means "no such row", which
 * the guard treats identically to "not yours" — see `assertOwnership`.
 */
async function loadOwnerRefs(
  kind: ResourceKind,
  id: string
): Promise<OwnerRefs | null> {
  switch (kind) {
    case 'campaign': {
      const [row] = await db
        .select({ brandProfileId: campaign.brandId })
        .from(campaign)
        .where(eq(campaign.id, id))
        .limit(1);
      return row
        ? {
            brandProfileId: row.brandProfileId,
            creatorProfileId: null,
            userId: null,
          }
        : null;
    }
    case 'deal': {
      const [row] = await db
        .select({
          brandProfileId: campaign.brandId,
          creatorProfileId: deal.creatorId,
        })
        .from(deal)
        .innerJoin(campaign, eq(deal.campaignId, campaign.id))
        .where(eq(deal.id, id))
        .limit(1);
      return row ? { ...row, userId: null } : null;
    }
    case 'deliverable': {
      const [row] = await db
        .select({
          brandProfileId: campaign.brandId,
          creatorProfileId: deal.creatorId,
        })
        .from(deliverable)
        .innerJoin(deal, eq(deliverable.dealId, deal.id))
        .innerJoin(campaign, eq(deal.campaignId, campaign.id))
        .where(eq(deliverable.id, id))
        .limit(1);
      return row ? { ...row, userId: null } : null;
    }
    case 'creatorProfile': {
      const [row] = await db
        .select({ userId: creatorProfile.userId, id: creatorProfile.id })
        .from(creatorProfile)
        .where(eq(creatorProfile.id, id))
        .limit(1);
      return row
        ? { brandProfileId: null, creatorProfileId: row.id, userId: row.userId }
        : null;
    }
    case 'brandProfile': {
      const [row] = await db
        .select({ userId: brandProfile.userId, id: brandProfile.id })
        .from(brandProfile)
        .where(eq(brandProfile.id, id))
        .limit(1);
      return row
        ? { brandProfileId: row.id, creatorProfileId: null, userId: row.userId }
        : null;
    }
    default:
      // Unreachable through the type, but an unrecognised kind must deny rather
      // than fall through to an allow. Returning null does exactly that.
      return null;
  }
}

const defaultDeps: AuthzDeps = {
  getCurrentUser: getSessionUser,
  loadProfileIds,
  loadOwnerRefs,
};

// -- The guard --------------------------------------------------------------

/**
 * True when the actor owns the row. Pure, so every ownership path is unit
 * testable without a database.
 */
function ownsResource(ctx: AuthzContext, owner: OwnerRefs): boolean {
  // A profile row is owned by the user it belongs to.
  if (owner.userId !== null && owner.userId === ctx.user.id) return true;

  // Otherwise ownership is by profile id. Both sides are checked because a deal
  // legitimately has two owners; the role gate already decided which of them is
  // entitled to call this particular action.
  if (
    owner.brandProfileId !== null &&
    ctx.brandProfileId !== null &&
    owner.brandProfileId === ctx.brandProfileId
  ) {
    return true;
  }
  if (
    owner.creatorProfileId !== null &&
    ctx.creatorProfileId !== null &&
    owner.creatorProfileId === ctx.creatorProfileId
  ) {
    return true;
  }
  return false;
}

export function createGuard(deps: AuthzDeps = defaultDeps) {
  return async function guard(opts: GuardOptions): Promise<AuthzContext> {
    // Deny-by-default, checked before anything else. `roles` is required by the
    // type, but a JavaScript caller can still omit it and this is the security
    // control — so it is re-checked rather than trusted (AC4).
    if (!opts || !Array.isArray(opts.roles) || opts.roles.length === 0) {
      throw new ForbiddenError('no role declared');
    }

    const user = await deps.getCurrentUser();
    if (!user) {
      // Not a redirect: this path serves mutations, and a Server Action called
      // by fetch needs an envelope, not a 307 to the sign-in page.
      throw new ForbiddenError('no session');
    }

    // Layer 1 — role gate.
    if (!opts.roles.includes(user.role)) {
      throw new ForbiddenError(`role ${user.role} not permitted`);
    }

    const { brandProfileId, creatorProfileId } = await deps.loadProfileIds(
      user.id
    );
    const ctx: AuthzContext = { user, brandProfileId, creatorProfileId };

    // Layer 2 — ownership. Skipped only when the action targets no single row.
    if (opts.resource) {
      if (opts.allowAdmin && user.role === 'admin') return ctx;

      const owner = await deps.loadOwnerRefs(
        opts.resource.kind,
        opts.resource.id
      );
      // A missing row and an unowned row deny identically. Distinguishing them
      // would turn this endpoint into an existence oracle for ids the caller
      // has no right to (§6.3, Broken Access Control).
      if (!owner || !ownsResource(ctx, owner)) {
        throw new ForbiddenError(
          `does not own ${opts.resource.kind} ${opts.resource.id}`
        );
      }
    }

    return ctx;
  };
}

/**
 * The guard every mutating Server Action and Route Handler calls (AC1, AC2).
 *
 * Await it before any write. It throws on denial, so the mutation below it is
 * simply never reached and no state changes (AC3).
 */
export const guard = createGuard();

// -- Error envelope adapters (AC3) ------------------------------------------

/**
 * For Route Handlers. Any non-Forbidden error is re-thrown rather than
 * flattened into a 403 — swallowing it would report a database outage as a
 * permission problem.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ForbiddenError) {
    return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
      status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
    });
  }
  throw error;
}

/** For Server Actions, which return a value rather than a Response. */
export function toActionError(error: unknown): ErrorEnvelope {
  if (error instanceof ForbiddenError) {
    return errorResponse(ErrorCode.FORBIDDEN);
  }
  throw error;
}

// -- Admin actions (AC5) ----------------------------------------------------

export interface AuditEntry {
  /** Dotted entity.verb, per the audit_log spec: creator.verify, deal.resolve_dispute. */
  action: string;
  targetType: string;
  targetId: string;
  /** Before/after or context. */
  detail?: Record<string, unknown>;
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The transaction runner is a seam for the same reason the loaders are: without
 * it, nothing about AC5 could be asserted without a live Postgres.
 */
export interface AdminAuditDeps extends AuthzDeps {
  transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}

const defaultAdminAuditDeps: AdminAuditDeps = {
  ...defaultDeps,
  transaction: (fn) => db.transaction(fn),
};

/**
 * Runs an admin mutation together with its audit row (AC5, AC-031, invariant 9).
 *
 * The audit row is inserted **inside the caller's transaction**, which is the
 * whole point of the wrapper. Writing it before the mutation would leave a
 * permanent record of something that then rolled back; writing it after the
 * commit would lose it if the process died in between. Sharing the transaction
 * means the log and the change share a fate (invariant 1), and `audit_log`
 * stays insert-only (invariant 5).
 *
 * The role gate runs *before* the transaction opens, so a non-admin never
 * causes a connection to be taken from the pool.
 */
export async function withAdminAudit<T>(
  entry: AuditEntry,
  fn: (tx: Tx, ctx: AuthzContext) => Promise<T>,
  deps: AdminAuditDeps = defaultAdminAuditDeps
): Promise<T> {
  const ctx = await createGuard(deps)({ roles: ['admin'] });

  return deps.transaction(async (tx) => {
    // The caller's mutation runs first so that `detail` can carry a before and
    // after, and so a failed mutation throws before any audit row is built.
    const result = await fn(tx, ctx);
    await tx.insert(auditLog).values({
      actorId: ctx.user.id,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      detail: entry.detail ?? null,
    });
    return result;
  });
}
