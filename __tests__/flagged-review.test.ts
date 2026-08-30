import { describe, expect, it, vi } from 'vitest';
import {
  readFlaggedForReview,
  type FlaggedReviewCreator,
  type FlaggedReviewDeps,
} from '../lib/creators/flagged-review';
import {
  handleDismissReview,
  type DismissReviewRouteDeps,
} from '../app/api/admin/creators/[id]/dismiss-review/route';
import type { AdminAuditDeps, Tx } from '../lib/authz';
import { ForbiddenError } from '../lib/authz';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_TARGET,
  AUDIT_TARGET_TYPES,
} from '../lib/audit/actions';

/**
 * Phase 3, admin half: the flagged-for-review list and the Dismiss decision.
 *
 * A refresh that suggests a downgrade stamps `tier_review_at` and stops; these
 * are the read that surfaces the stamp and the route that clears it without
 * touching the tier. The other resolution — applying the downgrade — is the
 * existing assign-tier route, covered in tier-assignment.test.ts.
 */

const ADMIN_USER = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin' as const,
};

// -- readFlaggedForReview -----------------------------------------------------

function flaggedCreator(id: string): FlaggedReviewCreator {
  return {
    id,
    tiktokHandle: `handle-${id}`,
    niche: 'fitness',
    followerCount: 40_000,
    engagementRate: '2.10',
    tierReviewAt: new Date('2026-02-01T00:00:00Z'),
    currentTier: { name: 'Mid', pricePerVideo: 400_000 },
  };
}

function readDeps(
  creators: FlaggedReviewCreator[],
  overrides: Partial<FlaggedReviewDeps> = {}
): { deps: FlaggedReviewDeps; select: ReturnType<typeof vi.fn> } {
  const select = vi.fn(
    async (limit: number, offset: number) =>
      creators.slice(offset, offset + limit) // over-fetch semantics live in the caller
  );
  return {
    deps: {
      requireAdmin: async () => ADMIN_USER,
      select,
      ...overrides,
    },
    select,
  };
}

describe('readFlaggedForReview', () => {
  it('refuses every non-admin before touching the query', async () => {
    const { deps, select } = readDeps([], {
      requireAdmin: async () => {
        throw new ForbiddenError('admin role required');
      },
    });

    await expect(readFlaggedForReview({}, deps)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    expect(select).not.toHaveBeenCalled();
  });

  it('returns the page and reports no further pages when it drained the set', async () => {
    const { deps } = readDeps([flaggedCreator('a'), flaggedCreator('b')]);

    const page = await readFlaggedForReview({ limit: 5 }, deps);

    expect(page.creators.map((c) => c.id)).toEqual(['a', 'b']);
    expect(page.hasMore).toBe(false);
  });

  it('over-fetches by one to detect a further page, without leaking the extra row', async () => {
    const { deps, select } = readDeps([
      flaggedCreator('a'),
      flaggedCreator('b'),
      flaggedCreator('c'),
    ]);

    const page = await readFlaggedForReview({ limit: 2 }, deps);

    // limit + 1 requested, limit returned.
    expect(select).toHaveBeenCalledWith(3, 0);
    expect(page.creators.map((c) => c.id)).toEqual(['a', 'b']);
    expect(page.hasMore).toBe(true);
  });
});

// -- POST /api/admin/creators/:id/dismiss-review ------------------------------

describe('POST /api/admin/creators/:id/dismiss-review', () => {
  const VALID_ID = '33333333-3333-4333-8333-333333333333';

  function routeDeps(
    creator: { id: string; tierReviewAt: Date | null } | null,
    overrides: Partial<DismissReviewRouteDeps> = {}
  ): {
    deps: DismissReviewRouteDeps;
    updates: Record<string, unknown>[];
    auditRows: Record<string, unknown>[];
  } {
    const updates: Record<string, unknown>[] = [];
    const auditRows: Record<string, unknown>[] = [];

    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(creator ? [creator] : [])),
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          updates.push(values);
          return { where: vi.fn(() => Promise.resolve()) };
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((row: Record<string, unknown>) => {
          auditRows.push(row);
          return Promise.resolve();
        }),
      })),
    } as unknown as Tx;

    const adminAuditDeps: Partial<AdminAuditDeps> = {
      getCurrentUser: async () => ADMIN_USER,
      loadProfileIds: async () => ({
        brandProfileId: null,
        creatorProfileId: null,
      }),
      loadOwnerRefs: async () => null,
      transaction: <T>(fn: (t: Tx) => Promise<T>) => fn(tx),
    };

    return {
      deps: {
        guard: async () => ADMIN_USER,
        adminAuditDeps,
        ...overrides,
      },
      updates,
      auditRows,
    };
  }

  const flagged = {
    id: VALID_ID,
    tierReviewAt: new Date('2026-02-01T00:00:00Z'),
  };

  it('clears the flag and confirms, leaving the tier untouched', async () => {
    const { deps, updates } = routeDeps(flagged);

    const response = await handleDismissReview(VALID_ID, deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: VALID_ID, dismissed: true });
    // The one write is the flag reset — no tierId in it means the price stood.
    expect(updates).toEqual([{ tierReviewAt: null }]);
  });

  it('writes an audit row recording what was dismissed', async () => {
    const { deps, auditRows } = routeDeps(flagged);

    await handleDismissReview(VALID_ID, deps);

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: AUDIT_ACTIONS.CREATOR_DISMISS_REVIEW,
      targetId: VALID_ID,
    });
  });

  it('404s when the creator does not exist', async () => {
    const { deps, updates } = routeDeps(null);

    const response = await handleDismissReview(VALID_ID, deps);

    expect(response.status).toBe(404);
    expect(updates).toEqual([]);
  });

  it('404s when nothing is flagged — the decision was already made', async () => {
    const { deps, updates } = routeDeps({ id: VALID_ID, tierReviewAt: null });

    const response = await handleDismissReview(VALID_ID, deps);

    expect(response.status).toBe(404);
    expect(updates).toEqual([]);
  });

  it('404s a malformed id before touching the database', async () => {
    const { deps } = routeDeps(flagged);

    const response = await handleDismissReview('not-a-uuid', deps);

    expect(response.status).toBe(404);
  });

  it('refuses non-admins before any work', async () => {
    const { deps, updates } = routeDeps(flagged, {
      guard: async () => {
        throw new ForbiddenError('admin role required');
      },
    });

    const response = await handleDismissReview(VALID_ID, deps);

    expect(response.status).toBe(403);
    expect(updates).toEqual([]);
  });

  it('pairs the audit action with the creator_profile target', () => {
    expect(AUDIT_ACTION_TARGET[AUDIT_ACTIONS.CREATOR_DISMISS_REVIEW]).toBe(
      AUDIT_TARGET_TYPES.CREATOR_PROFILE
    );
  });
});
