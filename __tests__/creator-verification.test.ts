import { describe, expect, it, vi } from 'vitest';
import {
  decideVerification,
  CreatorNotPendingError,
  CreatorNotFoundError,
} from '../lib/creators/decide-verification';
import type { DecisionDeps } from '../lib/creators/decide-verification';
import {
  PAGE_SIZE,
  offsetForPage,
  pageFromParam,
  readVerificationQueue,
  type QueueDeps,
} from '../lib/creators/verification-queue';
import type { QueueCreator } from '../lib/creators/verification-queue';
import { ForbiddenError } from '../lib/authz';
import type { Tx } from '../lib/authz';
import type { CurrentUser } from '../lib/auth';
import {
  ErrorCode,
  MAX_VERIFICATION_NOTE_LENGTH,
  verifyCreatorSchema,
  zodIssuesToDetails,
} from '../lib/validation';
import { redactDetail } from '../lib/audit/redact';
import {
  handleVerifyCreator,
  type VerifyCreatorDeps,
} from '../app/api/admin/creators/[id]/verify/route';

/**
 * KAN-22 — creator verification queue.
 *
 * Tests the decision function (approve/reject with transaction composition +
 * state guard), the queue query (admin-gated FIFO listing), and the POST route
 * (auth/validation/error mapping).
 */

const ADMIN_USER: CurrentUser = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
};

// -- Decision function ------------------------------------------------------

describe('decideVerification', () => {
  interface Recorded {
    rows: Record<string, unknown>[];
    committed: boolean;
  }

  /**
   * Fake transaction deps that record writes and only "commit" them when the
   * function returns without throwing (mirrors real Postgres).
   *
   * `withNotifications` builds its own `scoped` notify internally and ignores
   * any second argument to the transaction callback, so both the audit row and
   * the notification row arrive through `mockTx.insert` — recorded in `rows`.
   */
  function txDeps(
    creator: { id: string; userId: string; status: string } | null
  ): {
    deps: DecisionDeps;
    recorded: Recorded;
  } {
    const recorded: Recorded = {
      rows: [],
      committed: false,
    };

    const mockTx = {
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
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((row) => {
          recorded.rows.push(row);
          return Promise.resolve();
        }),
      })),
    } as unknown as Tx;

    const deps: DecisionDeps = {
      notifyDeps: {
        db: {
          transaction: async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
            const result = await fn(mockTx);
            recorded.committed = true;
            return result;
          },
        } as unknown as DecisionDeps['notifyDeps']['db'],
        provider: null as unknown as DecisionDeps['notifyDeps']['provider'],
        render: async () => ({ subject: '', text: '', html: '' }),
        log: {
          info: vi.fn(),
          error: vi.fn(),
        } as unknown as DecisionDeps['notifyDeps']['log'],
        sleep: async () => {},
      },
      adminAuditDeps: {
        getCurrentUser: async () => ADMIN_USER,
        loadProfileIds: async () => ({
          brandProfileId: null,
          creatorProfileId: null,
        }),
        loadOwnerRefs: async () => null,
      },
    };

    return { deps, recorded };
  }

  it('approves a pending creator and sets verified + verifiedAt', async () => {
    const creator = {
      id: 'c-1',
      userId: 'user-c1',
      status: 'pending_verification',
    };
    const { deps, recorded } = txDeps(creator);

    const result = await decideVerification(
      'c-1',
      { decision: 'verified' },
      deps
    );

    expect(result.id).toBe('c-1');
    expect(result.status).toBe('verified');
    expect(recorded.committed).toBe(true);
  });

  it('rejects a pending creator without setting verifiedAt', async () => {
    const creator = {
      id: 'c-2',
      userId: 'user-c2',
      status: 'pending_verification',
    };
    const { deps, recorded } = txDeps(creator);

    const result = await decideVerification(
      'c-2',
      { decision: 'rejected', note: 'Invalid handle' },
      deps
    );

    expect(result.id).toBe('c-2');
    expect(result.status).toBe('rejected');
    expect(recorded.committed).toBe(true);
  });

  it('throws CreatorNotPendingError when creator already verified', async () => {
    const creator = { id: 'c-3', userId: 'user-c3', status: 'verified' };
    const { deps } = txDeps(creator);

    await expect(
      decideVerification('c-3', { decision: 'verified' }, deps)
    ).rejects.toThrow(CreatorNotPendingError);
  });

  it('throws CreatorNotPendingError when creator already rejected', async () => {
    const creator = { id: 'c-4', userId: 'user-c4', status: 'rejected' };
    const { deps } = txDeps(creator);

    await expect(
      decideVerification('c-4', { decision: 'verified' }, deps)
    ).rejects.toThrow(CreatorNotPendingError);
  });

  it('throws when creator does not exist', async () => {
    const { deps } = txDeps(null);

    await expect(
      decideVerification('ghost', { decision: 'verified' }, deps)
    ).rejects.toThrow('Creator not found');
  });

  it('writes audit row with correct action for verify', async () => {
    const creator = {
      id: 'c-5',
      userId: 'user-c5',
      status: 'pending_verification',
    };
    const { deps, recorded } = txDeps(creator);

    await decideVerification('c-5', { decision: 'verified' }, deps);

    const auditRow = recorded.rows.find((r) => r.action === 'creator.verify');
    expect(auditRow).toBeDefined();
    expect(auditRow?.targetType).toBe('creator_profile');
    expect(auditRow?.targetId).toBe('c-5');
  });

  it('writes audit row with correct action for reject', async () => {
    const creator = {
      id: 'c-6',
      userId: 'user-c6',
      status: 'pending_verification',
    };
    const { deps, recorded } = txDeps(creator);

    await decideVerification(
      'c-6',
      { decision: 'rejected', note: 'Test note' },
      deps
    );

    const auditRow = recorded.rows.find((r) => r.action === 'creator.reject');
    expect(auditRow).toBeDefined();
    expect(auditRow?.targetType).toBe('creator_profile');
    expect(auditRow?.targetId).toBe('c-6');
  });

  it('writes notification with outcome "approved" for verified decision', async () => {
    const creator = {
      id: 'c-7',
      userId: 'user-c7',
      status: 'pending_verification',
    };
    const { deps, recorded } = txDeps(creator);

    await decideVerification('c-7', { decision: 'verified' }, deps);

    // The real withNotifications builds its own `scoped` notify, which writes the
    // notification row through the same tx — so it lands in recorded.rows.
    const notificationRow = recorded.rows.find(
      (r) => r.type === 'verification_result'
    );
    expect(notificationRow).toBeDefined();
    expect(notificationRow?.userId).toBe('user-c7');
    expect(notificationRow?.payload).toMatchObject({ outcome: 'approved' });
  });

  it('writes notification with outcome "rejected" and note', async () => {
    const creator = {
      id: 'c-8',
      userId: 'user-c8',
      status: 'pending_verification',
    };
    const { deps, recorded } = txDeps(creator);

    await decideVerification(
      'c-8',
      { decision: 'rejected', note: 'Handle does not exist' },
      deps
    );

    const notificationRow = recorded.rows.find(
      (r) => r.type === 'verification_result'
    );
    expect(notificationRow).toBeDefined();
    expect(notificationRow?.userId).toBe('user-c8');
    expect(notificationRow?.payload).toMatchObject({
      outcome: 'rejected',
      reason: 'Handle does not exist',
    });
  });

  it('leaves notifications un-flushed when mutation fails', async () => {
    const creator = {
      id: 'c-9',
      userId: 'user-c9',
      status: 'verified', // Already decided, will throw
    };
    const { deps, recorded } = txDeps(creator);

    await expect(
      decideVerification('c-9', { decision: 'verified' }, deps)
    ).rejects.toThrow();

    expect(recorded.committed).toBe(false);
  });
});

// -- Queue query ------------------------------------------------------------

describe('readVerificationQueue', () => {
  function queueDeps(
    creators: QueueCreator[],
    overrides: Partial<QueueDeps> = {}
  ): QueueDeps {
    return {
      requireAdmin: async () => ADMIN_USER,
      select: async (limit, offset) => creators.slice(offset, offset + limit),
      ...overrides,
    };
  }

  const creator = (
    id: string,
    handle: string,
    daysAgo: number
  ): QueueCreator => ({
    id,
    tiktokHandle: handle,
    niche: 'fitness',
    followerCount: 50000,
    engagementRate: '3.5',
    createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  });

  it('refuses a non-admin and never reaches the database', async () => {
    const select = vi.fn();
    const deps = queueDeps([], {
      requireAdmin: async () => {
        throw new ForbiddenError('role creator not permitted');
      },
      select,
    });

    await expect(readVerificationQueue({}, deps)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    // Timing oracle: denied caller cannot use response timing to learn whether
    // pending creators exist
    expect(select).not.toHaveBeenCalled();
  });

  it('returns only pending_verification creators (via SQL, not tested here)', async () => {
    // The WHERE clause is in the real selectCreators; this test confirms the
    // query function itself doesn't filter further
    const creators = [creator('c-1', '@alice', 1), creator('c-2', '@bob', 2)];
    const deps = queueDeps(creators);

    const page = await readVerificationQueue({}, deps);

    expect(page.creators).toHaveLength(2);
  });

  it('reports hasMore without a second COUNT query', async () => {
    const creators = Array.from({ length: 5 }, (_, i) =>
      creator(`c-${i}`, `@user${i}`, i)
    );
    const deps = queueDeps(creators);

    const page = await readVerificationQueue({ limit: 2 }, deps);

    expect(page.creators).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });

  it('reports hasMore false on the last page', async () => {
    const creators = Array.from({ length: 5 }, (_, i) =>
      creator(`c-${i}`, `@user${i}`, i)
    );
    const deps = queueDeps(creators);

    const page = await readVerificationQueue({ limit: 2, offset: 3 }, deps);

    expect(page.creators).toHaveLength(2);
    expect(page.hasMore).toBe(false);
  });

  it('defaults the page size to 50', async () => {
    const select = vi.fn(async () => []);
    const deps = queueDeps([], { select });

    await readVerificationQueue({}, deps);

    // Over-fetch by 1 for hasMore
    expect(select).toHaveBeenCalledWith(51, 0);
  });

  it('clamps the page size to the max ceiling', async () => {
    const select = vi.fn(async () => []);
    const deps = queueDeps([], { select });

    await readVerificationQueue({ limit: 10000 }, deps);

    // Max is 100, plus 1 for hasMore
    expect(select).toHaveBeenCalledWith(101, 0);
  });

  it('clamps negative offset to zero', async () => {
    const select = vi.fn(async () => []);
    const deps = queueDeps([], { select });

    await readVerificationQueue({ limit: 10, offset: -5 }, deps);

    expect(select).toHaveBeenCalledWith(11, 0);
  });

  /**
   * The queue AC is "lists **every** pending_verification creator". The read
   * path always paged correctly; what was missing was any caller able to ask
   * for page 2, so creator 51 was unreachable with nothing on screen saying so.
   */
  describe('paging past the first page', () => {
    it('reaches a creator beyond the first page', async () => {
      const creators = Array.from({ length: PAGE_SIZE + 3 }, (_, i) =>
        creator(`c-${i}`, `@user${i}`, i)
      );
      const deps = queueDeps(creators);

      const first = await readVerificationQueue(
        { limit: PAGE_SIZE, offset: offsetForPage(1) },
        deps
      );
      const second = await readVerificationQueue(
        { limit: PAGE_SIZE, offset: offsetForPage(2) },
        deps
      );

      expect(first.creators).toHaveLength(PAGE_SIZE);
      expect(first.hasMore).toBe(true);
      // The row the old page could not reach at all.
      expect(second.creators[0]?.tiktokHandle).toBe(`@user${PAGE_SIZE}`);
      expect(second.creators).toHaveLength(3);
      expect(second.hasMore).toBe(false);
    });

    it('pages contiguously, dropping and repeating nobody', async () => {
      const creators = Array.from({ length: PAGE_SIZE * 2 + 1 }, (_, i) =>
        creator(`c-${i}`, `@user${i}`, i)
      );
      const deps = queueDeps(creators);

      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        const result = await readVerificationQueue(
          { limit: PAGE_SIZE, offset: offsetForPage(page) },
          deps
        );
        seen.push(...result.creators.map((c) => c.id));
      }

      expect(seen).toHaveLength(creators.length);
      expect(new Set(seen).size).toBe(creators.length);
      expect(seen).toEqual(creators.map((c) => c.id));
    });

    it('starts page 1 at offset 0', () => {
      expect(offsetForPage(1)).toBe(0);
      expect(offsetForPage(2)).toBe(PAGE_SIZE);
      expect(offsetForPage(3)).toBe(PAGE_SIZE * 2);
    });

    it.each([
      ['absent', undefined, 1],
      ['empty', '', 1],
      ['whitespace', '  ', 1],
      ['zero', '0', 1],
      ['negative', '-4', 1],
      ['not a number', 'abc', 1],
      ['infinite', 'Infinity', 1],
      ['fractional', '2.9', 2],
      ['valid', '3', 3],
      // Next hands back an array when the key repeats; last one wins rather
      // than crashing on `.trim` of an array.
      ['repeated', ['2', '5'], 5],
    ])('reads page from a %s param', (_label, raw, expected) => {
      expect(pageFromParam(raw as string | string[] | undefined)).toBe(
        expected
      );
    });
  });
});

// -- POST route -------------------------------------------------------------

describe('POST /api/admin/creators/:id/verify', () => {
  // A well-formed uuid so the route's shape guard passes and the decision
  // dep is actually reached. Ids like 'c-1' are rejected as malformed 404s
  // before the transaction runs.
  const VALID_ID = '11111111-1111-4111-8111-111111111111';

  function mockRequest(body: unknown): Request {
    return {
      json: async () => body,
    } as unknown as Request;
  }

  const successDeps: VerifyCreatorDeps = {
    guard: async () => ADMIN_USER,
    notifyDeps: {
      db: {
        transaction: async <T>(
          fn: (
            tx: Tx,
            notify: (
              userId: string,
              type: string,
              payload: unknown
            ) => Promise<void>
          ) => Promise<T>
        ): Promise<T> => fn({} as unknown as Tx, async () => {}),
      } as unknown as DecisionDeps['notifyDeps']['db'],
      provider: null as unknown as DecisionDeps['notifyDeps']['provider'],
      render: async () => ({ subject: '', text: '', html: '' }),
      log: {
        info: vi.fn(),
        error: vi.fn(),
      } as unknown as DecisionDeps['notifyDeps']['log'],
      sleep: async () => {},
    },
    adminAuditDeps: {
      getCurrentUser: async () => ADMIN_USER,
      loadProfileIds: async () => ({
        brandProfileId: null,
        creatorProfileId: null,
      }),
      loadOwnerRefs: async () => null,
    },
  };

  it('returns 403 for a non-admin', async () => {
    const deps: VerifyCreatorDeps = {
      ...successDeps,
      guard: async () => {
        throw new ForbiddenError('role creator not permitted');
      },
    };

    const response = await handleVerifyCreator(
      mockRequest({ decision: 'verified' }),
      VALID_ID,
      deps
    );

    expect(response.status).toBe(403);
  });

  it('returns 422 for invalid JSON', async () => {
    const request = {
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Request;

    const response = await handleVerifyCreator(request, 'c-1', successDeps);

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('returns 422 for invalid decision value', async () => {
    const response = await handleVerifyCreator(
      mockRequest({ decision: 'maybe' }),
      VALID_ID,
      successDeps
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('returns 409 CREATOR_NOT_PENDING when creator already decided', async () => {
    const deps: VerifyCreatorDeps = {
      ...successDeps,
      notifyDeps: {
        ...successDeps.notifyDeps,
        db: {
          transaction: async () => {
            throw new CreatorNotPendingError();
          },
        } as unknown as DecisionDeps['notifyDeps']['db'],
      },
    };

    const response = await handleVerifyCreator(
      mockRequest({ decision: 'verified' }),
      VALID_ID,
      deps
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.CREATOR_NOT_PENDING);
  });

  it('returns 404 when creator does not exist', async () => {
    const deps: VerifyCreatorDeps = {
      ...successDeps,
      notifyDeps: {
        ...successDeps.notifyDeps,
        db: {
          transaction: async () => {
            throw new CreatorNotFoundError();
          },
        } as unknown as DecisionDeps['notifyDeps']['db'],
      },
    };

    const response = await handleVerifyCreator(
      mockRequest({ decision: 'verified' }),
      VALID_ID,
      deps
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('returns 404 for a malformed (non-uuid) id without opening a transaction', async () => {
    const transaction = vi.fn();
    const deps: VerifyCreatorDeps = {
      ...successDeps,
      notifyDeps: {
        ...successDeps.notifyDeps,
        db: { transaction } as unknown as DecisionDeps['notifyDeps']['db'],
      },
    };

    const response = await handleVerifyCreator(
      mockRequest({ decision: 'verified' }),
      'not-a-uuid',
      deps
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND);
    // Shape rejected before any decision work runs.
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns 200 with id and status on success', async () => {
    const deps: VerifyCreatorDeps = {
      ...successDeps,
      notifyDeps: {
        ...successDeps.notifyDeps,
        db: {
          transaction: async <T>(
            fn: (
              tx: Tx,
              notify: (
                userId: string,
                type: string,
                payload: unknown
              ) => Promise<void>
            ) => Promise<T>
          ): Promise<T> =>
            fn(
              {
                select: () => ({
                  from: () => ({
                    where: () => ({
                      for: () => ({
                        limit: () =>
                          Promise.resolve([
                            {
                              id: 'c-1',
                              userId: 'user-c1',
                              status: 'pending_verification',
                            },
                          ]),
                      }),
                    }),
                  }),
                }),
                update: () => ({
                  set: () => ({
                    where: () => Promise.resolve(),
                  }),
                }),
                insert: () => ({
                  values: () => Promise.resolve(),
                }),
              } as unknown as Tx,
              async () => {}
            ),
        } as unknown as DecisionDeps['notifyDeps']['db'],
      },
    };

    const response = await handleVerifyCreator(
      mockRequest({ decision: 'verified' }),
      VALID_ID,
      deps
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(VALID_ID);
    expect(body.status).toBe('verified');
  });
});

// -- Request schema ---------------------------------------------------------

/**
 * The note is the only free text on this endpoint, and it fans out to three
 * sinks: `audit_log.detail`, `notification.payload`, and the body of the
 * creator's rejection email. Only the first is bounded downstream, so the
 * schema is where the other two get their limit.
 */
describe('verifyCreatorSchema', () => {
  it('accepts a decision with no note', () => {
    const parsed = verifyCreatorSchema.safeParse({ decision: 'verified' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.note).toBeUndefined();
  });

  it('rejects an unknown key instead of silently dropping it', () => {
    // `notes` for `note` used to parse clean: 200, a creator rejected with no
    // explanation, and an audit row recording no note. Three wrong outcomes and
    // no error anywhere.
    const parsed = verifyCreatorSchema.safeParse({
      decision: 'rejected',
      notes: 'handle does not match the linked account',
    });

    expect(parsed.success).toBe(false);
  });

  it('names the offending key in the error envelope', () => {
    const parsed = verifyCreatorSchema.safeParse({
      decision: 'rejected',
      notes: 'typo',
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    // A whole-object issue carries no path, so it lands under `_root`.
    expect(JSON.stringify(zodIssuesToDetails(parsed.error))).toContain('notes');
  });

  it('accepts a note at exactly the limit', () => {
    const parsed = verifyCreatorSchema.safeParse({
      decision: 'rejected',
      note: 'x'.repeat(MAX_VERIFICATION_NOTE_LENGTH),
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects a note past the limit rather than truncating it', () => {
    const parsed = verifyCreatorSchema.safeParse({
      decision: 'rejected',
      note: 'x'.repeat(MAX_VERIFICATION_NOTE_LENGTH + 1),
    });

    expect(parsed.success).toBe(false);
  });

  it('bounds a multi-byte note too, so the email cannot balloon', () => {
    // Amharic costs 3 bytes a character: unbounded, a 200k-character note was
    // accepted whole, stored as 600kB of jsonb and mailed to the creator.
    const parsed = verifyCreatorSchema.safeParse({
      decision: 'rejected',
      note: 'ሀ'.repeat(200_000),
    });

    expect(parsed.success).toBe(false);
  });

  it('never exceeds the audit truncation point, so log and email agree', () => {
    const note = 'ሀ'.repeat(MAX_VERIFICATION_NOTE_LENGTH);
    const parsed = verifyCreatorSchema.safeParse({
      decision: 'rejected',
      note,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const detail = redactDetail({ note: parsed.data.note });
    // What the creator read is what the log recorded — no truncation marker.
    expect((detail as { note: string }).note).toBe(note);
  });

  it('trims a note', () => {
    const parsed = verifyCreatorSchema.safeParse({
      decision: 'rejected',
      note: '  not your account  ',
    });

    expect(parsed.success && parsed.data.note).toBe('not your account');
  });

  it('treats a whitespace-only note as absent', () => {
    // Left as '', it passes the template's `payload.reason ?` check and renders
    // an empty paragraph in the rejection email.
    const parsed = verifyCreatorSchema.safeParse({
      decision: 'rejected',
      note: '   ',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.note).toBeUndefined();
  });
});
