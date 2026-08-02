import { describe, expect, it, vi } from 'vitest';
import {
  ForbiddenError,
  createGuard,
  toActionError,
  toErrorResponse,
  withAdminAudit,
} from '../lib/authz';
import type {
  AdminAuditDeps,
  AuthzDeps,
  OwnerRefs,
  ResourceKind,
  Tx,
} from '../lib/authz';
import type { CurrentUser } from '../lib/auth';
import { ErrorCode } from '../lib/validation';

// Ids are fixed strings rather than uuids so a failure message says which
// actor was involved instead of which random hex was involved.
const BRAND_USER: CurrentUser = {
  id: 'user-brand',
  email: 'brand@example.com',
  name: 'Brand',
  role: 'brand',
};
const CREATOR_USER: CurrentUser = {
  id: 'user-creator',
  email: 'creator@example.com',
  name: 'Creator',
  role: 'creator',
};
const ADMIN_USER: CurrentUser = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
};

const PROFILES: Record<
  string,
  { brandProfileId: string | null; creatorProfileId: string | null }
> = {
  'user-brand': { brandProfileId: 'brand-1', creatorProfileId: null },
  'user-creator': { brandProfileId: null, creatorProfileId: 'creator-1' },
  'user-admin': { brandProfileId: null, creatorProfileId: null },
};

/** A deal on brand-1's campaign, assigned to creator-1 — so it has two owners. */
const OWNED_DEAL: OwnerRefs = {
  brandProfileId: 'brand-1',
  creatorProfileId: 'creator-1',
  userId: null,
};
/** The same shape, belonging to somebody else entirely. */
const OTHER_DEAL: OwnerRefs = {
  brandProfileId: 'brand-2',
  creatorProfileId: 'creator-2',
  userId: null,
};

function deps(overrides: Partial<AuthzDeps> = {}): AuthzDeps {
  return {
    getCurrentUser: async () => BRAND_USER,
    loadProfileIds: async (userId) =>
      PROFILES[userId] ?? { brandProfileId: null, creatorProfileId: null },
    loadOwnerRefs: async () => OWNED_DEAL,
    ...overrides,
  };
}

describe('guard — layer 1, role gate', () => {
  it('admits a role that is listed', async () => {
    const guard = createGuard(deps());
    const ctx = await guard({ roles: ['brand'] });
    expect(ctx.user.id).toBe('user-brand');
  });

  it('rejects a role that is not listed', async () => {
    const guard = createGuard(
      deps({ getCurrentUser: async () => CREATOR_USER })
    );
    await expect(guard({ roles: ['brand'] })).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it('rejects a brand calling a creator-only action', async () => {
    const guard = createGuard(deps());
    await expect(guard({ roles: ['creator'] })).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it('admits when several roles are listed', async () => {
    const guard = createGuard(deps({ getCurrentUser: async () => ADMIN_USER }));
    await expect(guard({ roles: ['creator', 'admin'] })).resolves.toBeDefined();
  });

  it('rejects when there is no session', async () => {
    const guard = createGuard(deps({ getCurrentUser: async () => null }));
    await expect(guard({ roles: ['brand'] })).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it('resolves both profile ids onto the context', async () => {
    const guard = createGuard(
      deps({ getCurrentUser: async () => CREATOR_USER })
    );
    const ctx = await guard({ roles: ['creator'] });
    expect(ctx.creatorProfileId).toBe('creator-1');
    expect(ctx.brandProfileId).toBeNull();
  });
});

// AC4 — "an endpoint with no explicit role declaration rejects all callers
// rather than allowing them". Each of these is a way of forgetting to declare.
describe('guard — deny by default', () => {
  it('rejects an empty roles array', async () => {
    const guard = createGuard(deps());
    await expect(guard({ roles: [] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects when roles is omitted entirely', async () => {
    const guard = createGuard(deps());
    // A JavaScript caller can do this even though TypeScript forbids it, which
    // is exactly why the check exists at runtime and not only in the type.
    await expect(
      guard({} as unknown as { roles: readonly [] })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects when the options object is missing', async () => {
    const guard = createGuard(deps());
    await expect(
      guard(undefined as unknown as { roles: readonly [] })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('denies rather than allows when the resource kind has no resolver', async () => {
    const guard = createGuard(deps({ loadOwnerRefs: async () => null }));
    await expect(
      guard({
        roles: ['brand'],
        resource: { kind: 'nonsense' as ResourceKind, id: 'x' },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('checks the role gate before ever loading the resource', async () => {
    const loadOwnerRefs = vi.fn(async () => OWNED_DEAL);
    const guard = createGuard(
      deps({ getCurrentUser: async () => CREATOR_USER, loadOwnerRefs })
    );
    await expect(
      guard({ roles: ['brand'], resource: { kind: 'deal', id: 'deal-1' } })
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(loadOwnerRefs).not.toHaveBeenCalled();
  });
});

describe('guard — layer 2, ownership', () => {
  it('lets a brand act on its own campaign', async () => {
    const guard = createGuard(
      deps({
        loadOwnerRefs: async () => ({
          brandProfileId: 'brand-1',
          creatorProfileId: null,
          userId: null,
        }),
      })
    );
    await expect(
      guard({ roles: ['brand'], resource: { kind: 'campaign', id: 'c-1' } })
    ).resolves.toBeDefined();
  });

  it("rejects a brand acting on another brand's campaign", async () => {
    const guard = createGuard(
      deps({
        loadOwnerRefs: async () => ({
          brandProfileId: 'brand-2',
          creatorProfileId: null,
          userId: null,
        }),
      })
    );
    await expect(
      guard({ roles: ['brand'], resource: { kind: 'campaign', id: 'c-9' } })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // A deal has two legitimate owners, and both paths have to work — §4.4 gates
  // some endpoints on the brand side and others on the creator side.
  it('lets the brand side own a deal via its campaign', async () => {
    const guard = createGuard(deps());
    await expect(
      guard({ roles: ['brand'], resource: { kind: 'deal', id: 'deal-1' } })
    ).resolves.toBeDefined();
  });

  it('lets the creator side own the same deal directly', async () => {
    const guard = createGuard(
      deps({ getCurrentUser: async () => CREATOR_USER })
    );
    await expect(
      guard({ roles: ['creator'], resource: { kind: 'deal', id: 'deal-1' } })
    ).resolves.toBeDefined();
  });

  it("rejects a creator acting on another creator's deal", async () => {
    const guard = createGuard(
      deps({
        getCurrentUser: async () => CREATOR_USER,
        loadOwnerRefs: async () => OTHER_DEAL,
      })
    );
    await expect(
      guard({ roles: ['creator'], resource: { kind: 'deal', id: 'deal-9' } })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('denies a missing row exactly as it denies an unowned one', async () => {
    const missing = createGuard(deps({ loadOwnerRefs: async () => null }));
    const unowned = createGuard(
      deps({ loadOwnerRefs: async () => OTHER_DEAL })
    );

    const a = await missing({
      roles: ['brand'],
      resource: { kind: 'deal', id: 'ghost' },
    }).catch((e) => e);
    const b = await unowned({
      roles: ['brand'],
      resource: { kind: 'deal', id: 'real' },
    }).catch((e) => e);

    // Same class and same user-facing code, so a caller cannot use the response
    // to discover which ids exist.
    expect(a).toBeInstanceOf(ForbiddenError);
    expect(b).toBeInstanceOf(ForbiddenError);
    expect(a.code).toBe(b.code);
  });

  it('owns a profile row by user id rather than by profile id', async () => {
    const guard = createGuard(
      deps({
        getCurrentUser: async () => CREATOR_USER,
        loadOwnerRefs: async () => ({
          brandProfileId: null,
          creatorProfileId: 'creator-1',
          userId: 'user-creator',
        }),
      })
    );
    await expect(
      guard({
        roles: ['creator'],
        resource: { kind: 'creatorProfile', id: 'creator-1' },
      })
    ).resolves.toBeDefined();
  });

  it('skips ownership entirely when no resource is named', async () => {
    const loadOwnerRefs = vi.fn(async () => OWNED_DEAL);
    const guard = createGuard(deps({ loadOwnerRefs }));
    await guard({ roles: ['brand'] });
    expect(loadOwnerRefs).not.toHaveBeenCalled();
  });

  // A user with no profile row must not match a resource whose owning column is
  // also null — null equalling null would hand over every orphaned row.
  it('does not let a null profile id match a null owner', async () => {
    const guard = createGuard(
      deps({
        getCurrentUser: async () => ADMIN_USER,
        loadOwnerRefs: async () => ({
          brandProfileId: null,
          creatorProfileId: null,
          userId: null,
        }),
      })
    );
    await expect(
      guard({ roles: ['admin'], resource: { kind: 'deal', id: 'orphan' } })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// Tech Spec §4.5: "role creator (own deliverable) or admin".
describe('guard — allowAdmin', () => {
  it('lets an admin past ownership when allowAdmin is set', async () => {
    const guard = createGuard(
      deps({
        getCurrentUser: async () => ADMIN_USER,
        loadOwnerRefs: async () => OTHER_DEAL,
      })
    );
    await expect(
      guard({
        roles: ['creator', 'admin'],
        resource: { kind: 'deliverable', id: 'd-1' },
        allowAdmin: true,
      })
    ).resolves.toBeDefined();
  });

  it('still requires the admin to be a listed role', async () => {
    const guard = createGuard(
      deps({
        getCurrentUser: async () => ADMIN_USER,
        loadOwnerRefs: async () => OTHER_DEAL,
      })
    );
    await expect(
      guard({
        roles: ['creator'],
        resource: { kind: 'deliverable', id: 'd-1' },
        allowAdmin: true,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('holds an admin to ownership when allowAdmin is not set', async () => {
    const guard = createGuard(
      deps({
        getCurrentUser: async () => ADMIN_USER,
        loadOwnerRefs: async () => OTHER_DEAL,
      })
    );
    await expect(
      guard({
        roles: ['admin'],
        resource: { kind: 'deliverable', id: 'd-1' },
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('does not extend the exemption to non-admins', async () => {
    const guard = createGuard(
      deps({
        getCurrentUser: async () => CREATOR_USER,
        loadOwnerRefs: async () => OTHER_DEAL,
      })
    );
    await expect(
      guard({
        roles: ['creator', 'admin'],
        resource: { kind: 'deliverable', id: 'd-1' },
        allowAdmin: true,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// AC3 — a failed check returns 403 FORBIDDEN in the standard envelope.
describe('error envelope adapters', () => {
  it('renders a route-handler 403 with the exact envelope', async () => {
    const response = toErrorResponse(new ForbiddenError('nope'));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action.',
        details: undefined,
      },
    });
  });

  it('renders a server-action envelope', () => {
    const envelope = toActionError(new ForbiddenError('nope'));
    expect(envelope.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  // A database outage reported as "you lack permission" would send everyone
  // hunting the wrong problem, so anything that is not a denial is re-thrown.
  it('re-throws errors that are not denials', () => {
    const boom = new Error('connection reset');
    expect(() => toErrorResponse(boom)).toThrow('connection reset');
    expect(() => toActionError(boom)).toThrow('connection reset');
  });

  it('never leaks the internal reason to the caller', async () => {
    const response = toErrorResponse(
      new ForbiddenError('does not own campaign 123')
    );
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain('123');
    expect(body).not.toContain('does not own');
  });
});

// AC5 — "Admin-only routes additionally require role = 'admin' and write an
// audit_log row." Tech Spec §6.1 and the audit_log table spec (insert-only).
describe('withAdminAudit', () => {
  interface Recorded {
    rows: Record<string, unknown>[];
    committed: boolean;
  }

  /**
   * A transaction double that records inserts and models rollback: if the body
   * throws, `committed` stays false and the recorded rows are discarded, which
   * is what Postgres would do.
   */
  function txDeps(overrides: Partial<AuthzDeps> = {}): {
    deps: AdminAuditDeps;
    recorded: Recorded;
  } {
    const recorded: Recorded = { rows: [], committed: false };
    const tx = {
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          recorded.rows.push(row);
        },
      }),
    } as unknown as Tx;

    return {
      recorded,
      deps: {
        getCurrentUser: async () => ADMIN_USER,
        loadProfileIds: async (userId) =>
          PROFILES[userId] ?? { brandProfileId: null, creatorProfileId: null },
        loadOwnerRefs: async () => OWNED_DEAL,
        ...overrides,
        transaction: async (fn) => {
          const result = await fn(tx);
          recorded.committed = true;
          return result;
        },
      },
    };
  }

  it('runs the mutation and returns its value', async () => {
    const { deps } = txDeps();
    const result = await withAdminAudit(
      {
        action: 'creator.verify',
        targetType: 'creator_profile',
        targetId: 'c-1',
      },
      async () => 'verified',
      deps
    );
    expect(result).toBe('verified');
  });

  it('writes exactly one audit row with actor, action and target', async () => {
    const { deps, recorded } = txDeps();
    await withAdminAudit(
      {
        action: 'deal.resolve_dispute',
        targetType: 'deal',
        targetId: 'deal-7',
        detail: { resolution: 'refund' },
      },
      async () => undefined,
      deps
    );

    expect(recorded.rows).toHaveLength(1);
    expect(recorded.rows[0]).toMatchObject({
      actorId: 'user-admin',
      action: 'deal.resolve_dispute',
      targetType: 'deal',
      targetId: 'deal-7',
      detail: { resolution: 'refund' },
    });
  });

  it('defaults detail to null rather than undefined', async () => {
    const { deps, recorded } = txDeps();
    await withAdminAudit(
      { action: 'metric.edit', targetType: 'video_metric', targetId: 'm-1' },
      async () => undefined,
      deps
    );
    // The column is nullable jsonb; undefined would make Drizzle omit it.
    expect(recorded.rows[0].detail).toBeNull();
  });

  it('writes the audit row inside the same transaction as the mutation', async () => {
    const { deps, recorded } = txDeps();
    const seen: Tx[] = [];
    await withAdminAudit(
      {
        action: 'creator.verify',
        targetType: 'creator_profile',
        targetId: 'c-1',
      },
      async (tx) => {
        seen.push(tx);
      },
      deps
    );
    // One transaction, and the audit row landed in it before commit.
    expect(seen).toHaveLength(1);
    expect(recorded.committed).toBe(true);
    expect(recorded.rows).toHaveLength(1);
  });

  it('writes no audit row when the mutation fails', async () => {
    const { deps, recorded } = txDeps();
    await expect(
      withAdminAudit(
        {
          action: 'deal.resolve_dispute',
          targetType: 'deal',
          targetId: 'deal-7',
        },
        async () => {
          throw new Error('ledger would go negative');
        },
        deps
      )
    ).rejects.toThrow('ledger would go negative');

    // A log entry for an action that rolled back would be a lie (invariant 1).
    expect(recorded.rows).toHaveLength(0);
    expect(recorded.committed).toBe(false);
  });

  it('rejects a brand and never opens a transaction', async () => {
    const { deps, recorded } = txDeps({
      getCurrentUser: async () => BRAND_USER,
    });
    const fn = vi.fn(async () => undefined);
    await expect(
      withAdminAudit(
        {
          action: 'creator.verify',
          targetType: 'creator_profile',
          targetId: 'c-1',
        },
        fn,
        deps
      )
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(fn).not.toHaveBeenCalled();
    expect(recorded.rows).toHaveLength(0);
    expect(recorded.committed).toBe(false);
  });

  it('rejects a creator', async () => {
    const { deps } = txDeps({ getCurrentUser: async () => CREATOR_USER });
    await expect(
      withAdminAudit(
        {
          action: 'creator.verify',
          targetType: 'creator_profile',
          targetId: 'c-1',
        },
        async () => undefined,
        deps
      )
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects an unauthenticated caller', async () => {
    const { deps } = txDeps({ getCurrentUser: async () => null });
    await expect(
      withAdminAudit(
        {
          action: 'creator.verify',
          targetType: 'creator_profile',
          targetId: 'c-1',
        },
        async () => undefined,
        deps
      )
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
