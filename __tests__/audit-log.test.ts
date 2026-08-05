import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_TARGET,
  AUDIT_ACTION_VALUES,
  AUDIT_TARGET_TYPES,
  AUDIT_TARGET_TYPE_VALUES,
  isAuditAction,
  isAuditTargetType,
} from '../lib/audit/actions';
import { isSensitiveKey, redactDetail } from '../lib/audit/redact';
import {
  DEFAULT_AUDIT_LIMIT,
  MAX_AUDIT_LIMIT,
  buildAuditWhere,
  readAuditLog,
} from '../lib/audit/queries';
import type { AuditLogRow, AuditQueryDeps } from '../lib/audit/queries';
import { ForbiddenError, withAdminAudit } from '../lib/authz';
import type { AdminAuditDeps, Tx } from '../lib/authz';
import type { CurrentUser } from '../lib/auth';
import { auditLogQuerySchema } from '../lib/validation';
import { handleReadAuditLog } from '../app/api/admin/audit-log/route';

/**
 * KAN-52 — the audit log (AC-031, FR-008, NFR-010).
 *
 * The write path and its transaction guarantee are covered by the
 * `withAdminAudit` suite in `authz.test.ts`, which KAN-17 shipped. This file
 * covers what KAN-52 adds: the vocabulary, redaction, the admin-only read path
 * with its filters, and the insert-only guarantee.
 */

const ADMIN_USER: CurrentUser = {
  id: 'user-admin',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
};

// -- Vocabulary -------------------------------------------------------------

describe('audit vocabulary', () => {
  it('pairs every action with exactly one target type', () => {
    // The mapping is what makes `creator.verify` against a deal id a failure
    // rather than a plausible-looking row. An action missing from it would be
    // undefined at runtime and match nothing.
    for (const action of AUDIT_ACTION_VALUES) {
      expect(AUDIT_ACTION_TARGET[action]).toBeDefined();
      expect(AUDIT_TARGET_TYPE_VALUES).toContain(AUDIT_ACTION_TARGET[action]);
    }
    expect(Object.keys(AUDIT_ACTION_TARGET).sort()).toEqual(
      [...AUDIT_ACTION_VALUES].sort()
    );
  });

  it('names the actions the tech spec names', () => {
    // §3.2 gives these three as the examples of `audit_log.action`.
    expect(AUDIT_ACTION_VALUES).toContain('creator.verify');
    expect(AUDIT_ACTION_VALUES).toContain('deal.resolve_dispute');
    expect(AUDIT_ACTION_VALUES).toContain('metric.edit');
  });

  it('uses table names as target types', () => {
    // So a target_id is resolvable without a translation table.
    expect(AUDIT_TARGET_TYPE_VALUES).toEqual([
      'creator_profile',
      'deal',
      'video_metric',
    ]);
  });

  it('rejects anything outside the union', () => {
    expect(isAuditAction('creator.verify')).toBe(true);
    expect(isAuditAction('creator.verified')).toBe(false);
    expect(isAuditAction('verify_creator')).toBe(false);
    expect(isAuditAction(undefined)).toBe(false);
    expect(isAuditAction(null)).toBe(false);
    expect(isAuditAction(42)).toBe(false);

    expect(isAuditTargetType('deal')).toBe(true);
    expect(isAuditTargetType('deals')).toBe(false);
    expect(isAuditTargetType({})).toBe(false);
  });
});

// -- Redaction (NFR-010) ----------------------------------------------------

describe('isSensitiveKey', () => {
  it('catches secrets however they are cased or separated', () => {
    for (const key of [
      'password',
      'Password',
      'user_password',
      'passwordHash',
      'passwd',
      'apiKey',
      'api_key',
      'API-KEY',
      'accessToken',
      'refresh_token',
      'sessionToken',
      'secret',
      'clientSecret',
      'authorization',
      'Cookie',
      'credentials',
      'signature',
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it('catches PII the log does not need', () => {
    // actor_id and target_id already resolve to the person; carrying their
    // contact details in every row is the "unnecessary" NFR-010 rules out.
    for (const key of [
      'email',
      'emailAddress',
      'phone',
      'phoneNumber',
      'ssn',
      'dob',
      'dateOfBirth',
      'birthDate',
      'address',
      'ip',
      'ipAddress',
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it('leaves the fields the log exists to record', () => {
    // Each of these is a substring trap: `author` contains `auth`, `keyword`
    // and `monkey` contain `key`, `description` and `recipient` contain `ip`,
    // and `pinned` contains `pin`. Redacting them would gut the log to protect
    // nothing.
    for (const key of [
      'author',
      'authorId',
      'actorId',
      'keyword',
      'monkey',
      'description',
      'recipient',
      'pinned',
      'tiktokHandle',
      'companyName',
      'status',
      'fromStatus',
      'toStatus',
      'reason',
      'note',
      'decision',
      'resolution',
      'views',
    ]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});

describe('redactDetail', () => {
  it('replaces sensitive values and keeps the key', () => {
    // Knowing a password field was present is worth recording; its value is not.
    expect(
      redactDetail({ tiktokHandle: '@hana', password: 'hunter2' })
    ).toEqual({
      tiktokHandle: '@hana',
      password: '[redacted]',
    });
  });

  it('redacts a sensitive key whose value is an object, without walking it', () => {
    const out = redactDetail({
      credentials: { username: 'a', token: 'b' },
    });
    expect(out).toEqual({ credentials: '[redacted]' });
  });

  it('walks nested objects and arrays', () => {
    expect(
      redactDetail({
        before: { status: 'pending_verification', email: 'a@b.com' },
        after: { status: 'verified' },
        notes: [{ text: 'ok', apiKey: 'sk-1' }],
      })
    ).toEqual({
      before: { status: 'pending_verification', email: '[redacted]' },
      after: { status: 'verified' },
      notes: [{ text: 'ok', apiKey: '[redacted]' }],
    });
  });

  it('returns null for nothing to store', () => {
    // Matches the nullable column. `undefined` would make Drizzle omit the
    // field rather than write null.
    expect(redactDetail(undefined)).toBeNull();
    expect(redactDetail(null)).toBeNull();
    expect(redactDetail({})).toBeNull();
  });

  it('ignores a non-object detail', () => {
    // The type forbids these, but a JavaScript caller can still pass them and
    // an array in a jsonb column would break every reader of the log.
    expect(
      redactDetail([1, 2] as unknown as Record<string, unknown>)
    ).toBeNull();
    expect(
      redactDetail('nope' as unknown as Record<string, unknown>)
    ).toBeNull();
  });

  it('truncates long strings', () => {
    const out = redactDetail({ note: 'x'.repeat(600) }) as { note: string };
    expect(out.note).toHaveLength(512 + '…[truncated]'.length);
    expect(out.note.endsWith('…[truncated]')).toBe(true);
  });

  it('truncates past the depth limit', () => {
    expect(redactDetail({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({
      a: { b: { c: { d: '…[truncated]' } } },
    });
  });

  it('caps array length and object width', () => {
    const arr = redactDetail({
      xs: Array.from({ length: 40 }, (_, i) => i),
    }) as {
      xs: unknown[];
    };
    expect(arr.xs).toHaveLength(21);
    expect(arr.xs[20]).toBe('…[truncated]');

    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 80; i++) wide[`k${i}`] = i;
    const out = redactDetail(wide) as Record<string, unknown>;
    expect(Object.keys(out)).toHaveLength(51); // 50 kept plus the marker
    expect(out._truncated).toBe(true);
  });

  it('keeps top-level scalars when the payload is oversize', () => {
    // The readable half (a status, an id) survives; the bulk — nested objects
    // and arrays — is what gets dropped.
    const detail: Record<string, unknown> = {
      status: 'verified',
      dealId: 'd-1',
      big: Array.from({ length: 20 }, () => 'x'.repeat(500)),
    };
    const out = redactDetail(detail) as Record<string, unknown>;
    expect(out._truncated).toBe(true);
    expect(typeof out._bytes).toBe('number');
    expect(out.status).toBe('verified');
    expect(out.dealId).toBe('d-1');
    expect(out.big).toBeUndefined();
  });

  it('measures the byte cap in bytes, not UTF-16 code units', () => {
    // Each 'መ' is 3 UTF-8 bytes but one code unit. Twenty fields of 300 chars
    // each is 6000 code units — comfortably under the 8192 the old `.length`
    // check compared against — but 18000 bytes, over the real cap.
    const detail: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) detail[`f${i}`] = 'መ'.repeat(300);
    const serializedLength = JSON.stringify(detail).length;
    expect(serializedLength).toBeLessThan(8_192); // would have passed on .length

    const out = redactDetail(detail) as Record<string, unknown>;
    expect(out._truncated).toBe(true);
    expect(out._bytes as number).toBeGreaterThan(8_192);
  });

  it('survives a cycle instead of throwing', () => {
    // Throwing here would roll back an admin action that was otherwise fine.
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    expect(redactDetail(cyclic)).toEqual({
      name: 'root',
      self: { name: 'root', self: '[circular]' },
    });
  });

  it('does not mistake a repeated sibling for a cycle', () => {
    const shared = { status: 'verified' };
    expect(redactDetail({ before: shared, after: shared })).toEqual({
      before: { status: 'verified' },
      after: { status: 'verified' },
    });
  });

  it('normalises values json cannot hold', () => {
    const out = redactDetail({
      when: new Date('2026-08-04T10:00:00.000Z'),
      bad: new Date('nonsense'),
      big: BigInt(10),
      nan: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
      fn: () => 1,
      missing: undefined,
    }) as Record<string, unknown>;

    expect(out.when).toBe('2026-08-04T10:00:00.000Z');
    expect(out.bad).toBe('[invalid date]');
    expect(out.big).toBe('10');
    // JSON.stringify turns these into `null`, which reads as "absent" rather
    // than "the caller passed a broken number".
    expect(out.nan).toBe('NaN');
    expect(out.inf).toBe('Infinity');
    expect(out.fn).toBe('[unserializable]');
    expect(out.missing).toBeNull();
  });

  it('produces something JSON.stringify accepts', () => {
    const cyclic: Record<string, unknown> = { big: BigInt(1) };
    cyclic.self = cyclic;
    expect(() => JSON.stringify(redactDetail(cyclic))).not.toThrow();
  });
});

// -- Write path: what KAN-52 adds to withAdminAudit -------------------------

describe('withAdminAudit — vocabulary and redaction', () => {
  function txDeps(): { deps: AdminAuditDeps; rows: Record<string, unknown>[] } {
    const rows: Record<string, unknown>[] = [];
    const tx = {
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          rows.push(row);
        },
      }),
    } as unknown as Tx;

    return {
      rows,
      deps: {
        getCurrentUser: async () => ADMIN_USER,
        loadProfileIds: async () => ({
          brandProfileId: null,
          creatorProfileId: null,
        }),
        loadOwnerRefs: async () => null,
        transaction: async (fn) => fn(tx),
      },
    };
  }

  it('redacts detail on the way in, so no call site has to remember', () => {
    const { deps, rows } = txDeps();
    return withAdminAudit(
      {
        action: AUDIT_ACTIONS.CREATOR_VERIFY,
        targetType: AUDIT_TARGET_TYPES.CREATOR_PROFILE,
        targetId: 'c-1',
        // The realistic accident: spreading a whole row into `detail`.
        detail: { tiktokHandle: '@hana', email: 'hana@example.com' },
      },
      async () => undefined,
      deps
    ).then(() => {
      expect(rows[0].detail).toEqual({
        tiktokHandle: '@hana',
        email: '[redacted]',
      });
    });
  });

  it('builds detail from the mutation result when given a function', async () => {
    const { deps, rows } = txDeps();
    await withAdminAudit<{ status: string }>(
      {
        action: AUDIT_ACTIONS.DEAL_RESOLVE_DISPUTE,
        targetType: AUDIT_TARGET_TYPES.DEAL,
        targetId: 'deal-1',
        // The "after" half of before/after does not exist until `fn` has run.
        detail: (result) => ({ before: 'delivered', after: result.status }),
      },
      async () => ({ status: 'refunded' }),
      deps
    );

    expect(rows[0].detail).toEqual({ before: 'delivered', after: 'refunded' });
  });

  it('refuses an action logged against the wrong target type', async () => {
    const { deps, rows } = txDeps();
    await expect(
      withAdminAudit(
        {
          action: AUDIT_ACTIONS.CREATOR_VERIFY,
          // Type-level this is caught too; the runtime check is what stops a
          // JavaScript caller and what makes the failure legible.
          targetType: AUDIT_TARGET_TYPES.DEAL,
          targetId: 'deal-1',
        },
        async () => undefined,
        deps
      )
    ).rejects.toThrow(/targets creator_profile, got deal/);

    // And it fails before the transaction opens.
    expect(rows).toHaveLength(0);
  });

  it('still writes null for an absent detail', async () => {
    const { deps, rows } = txDeps();
    await withAdminAudit(
      {
        action: AUDIT_ACTIONS.METRIC_EDIT,
        targetType: AUDIT_TARGET_TYPES.VIDEO_METRIC,
        targetId: 'm-1',
      },
      async () => undefined,
      deps
    );
    expect(rows[0].detail).toBeNull();
  });
});

// -- Read path: filters -----------------------------------------------------

describe('buildAuditWhere', () => {
  const dialect = new PgDialect();
  const toSql = (filters: Parameters<typeof buildAuditWhere>[0]) => {
    const where = buildAuditWhere(filters);
    return where ? dialect.sqlToQuery(where).sql : undefined;
  };

  it('filters nothing when nothing is asked for', () => {
    // undefined, not an empty conjunction — Drizzle reads it as "no WHERE".
    expect(buildAuditWhere({})).toBeUndefined();
    // Paging is not filtering.
    expect(buildAuditWhere({ limit: 10, offset: 5 })).toBeUndefined();
  });

  it('filters by actor, action, target and date range', () => {
    expect(toSql({ actorId: 'u-1' })).toContain('"actor_id" =');
    expect(toSql({ action: AUDIT_ACTIONS.CREATOR_VERIFY })).toContain(
      '"action" ='
    );
    expect(toSql({ targetType: AUDIT_TARGET_TYPES.DEAL })).toContain(
      '"target_type" ='
    );
    expect(toSql({ targetId: 't-1' })).toContain('"target_id" =');

    const range = toSql({ from: new Date(0), to: new Date(1) });
    expect(range).toContain('"created_at" >=');
    expect(range).toContain('"created_at" <=');
  });

  it('combines filters with AND', () => {
    const sql = toSql({
      actorId: 'u-1',
      action: AUDIT_ACTIONS.CREATOR_REJECT,
      from: new Date(0),
    });
    expect(sql).toContain('and');
    expect(sql).toContain('"actor_id" =');
    expect(sql).toContain('"action" =');
    expect(sql).toContain('"created_at" >=');
  });
});

describe('readAuditLog', () => {
  function deps(
    rows: AuditLogRow[] = [],
    overrides: Partial<AuditQueryDeps> = {}
  ): {
    deps: AuditQueryDeps;
    calls: { limit: number; offset: number }[];
  } {
    const calls: { limit: number; offset: number }[] = [];
    return {
      calls,
      deps: {
        requireAdmin: async () => ADMIN_USER,
        select: async (_where, limit, offset) => {
          calls.push({ limit, offset });
          return rows.slice(offset, offset + limit);
        },
        ...overrides,
      },
    };
  }

  const row = (id: string): AuditLogRow => ({
    id,
    actorId: 'user-admin',
    actorName: 'Admin',
    actorEmail: 'admin@example.com',
    action: 'creator.verify',
    targetType: 'creator_profile',
    targetId: 'c-1',
    detail: null,
    createdAt: new Date('2026-08-04T10:00:00.000Z'),
  });

  it('refuses a non-admin and never reaches the database', async () => {
    const select = vi.fn();
    const { deps: d } = deps([], {
      requireAdmin: async () => {
        throw new ForbiddenError('role brand not permitted');
      },
      select,
    });

    await expect(readAuditLog({}, d)).rejects.toBeInstanceOf(ForbiddenError);
    // Checked before the query is built, so a denied caller cannot use response
    // timing to learn whether rows matching their filter exist.
    expect(select).not.toHaveBeenCalled();
  });

  it('defaults the page size and over-fetches by one', async () => {
    const { deps: d, calls } = deps([]);
    await readAuditLog({}, d);
    expect(calls[0]).toEqual({
      limit: DEFAULT_AUDIT_LIMIT + 1,
      offset: 0,
    });
  });

  it('reports hasMore without a second query', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`a-${i}`));

    const first = deps(rows);
    const page = await readAuditLog({ limit: 2 }, first.deps);
    expect(page.rows).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(first.calls).toHaveLength(1);

    const last = deps(rows);
    const end = await readAuditLog({ limit: 2, offset: 3 }, last.deps);
    expect(end.rows).toHaveLength(2);
    expect(end.hasMore).toBe(false);
  });

  it('clamps the page size to the ceiling', async () => {
    const { deps: d, calls } = deps([]);
    await readAuditLog({ limit: 10_000 }, d);
    expect(calls[0].limit).toBe(MAX_AUDIT_LIMIT + 1);
  });

  it('clamps nonsense paging rather than passing it through', async () => {
    // A negative LIMIT is a Postgres error, and a fractional one is a silent
    // surprise. Neither should depend on the route having validated first.
    const cases: [
      { limit?: number; offset?: number },
      { limit: number; offset: number },
    ] = [
      { limit: 0, offset: -5 },
      { limit: 2, offset: 0 },
    ];
    const { deps: d, calls } = deps([]);
    await readAuditLog(cases[0], d);
    expect(calls[0]).toEqual(cases[1]);

    const frac = deps([]);
    await readAuditLog({ limit: 7.9, offset: 2.9 }, frac.deps);
    expect(frac.calls[0]).toEqual({ limit: 8, offset: 2 });

    const nan = deps([]);
    await readAuditLog({ limit: Number.NaN, offset: Number.NaN }, nan.deps);
    expect(nan.calls[0]).toEqual({
      limit: DEFAULT_AUDIT_LIMIT + 1,
      offset: 0,
    });
  });
});

// -- Read path: the request schema ------------------------------------------

describe('auditLogQuerySchema', () => {
  it('coerces the string values a query string delivers', () => {
    const parsed = auditLogQuerySchema.parse({
      limit: '25',
      offset: '10',
      from: '2026-08-01T00:00:00.000Z',
    });
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(10);
    expect(parsed.from).toBeInstanceOf(Date);
  });

  it('rejects an action outside the vocabulary', () => {
    // Returning zero rows for a typo would read as "this never happened".
    expect(
      auditLogQuerySchema.safeParse({ action: 'creator.verified' }).success
    ).toBe(false);
    expect(auditLogQuerySchema.safeParse({ targetType: 'deals' }).success).toBe(
      false
    );
  });

  it('rejects an inverted date range', () => {
    const result = auditLogQuerySchema.safeParse({
      from: '2026-08-04T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a limit past the ceiling', () => {
    expect(auditLogQuerySchema.safeParse({ limit: '10000' }).success).toBe(
      false
    );
    expect(auditLogQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('rejects an unknown key rather than stripping it', () => {
    // Without `.strict()` zod drops unknown keys, so a misspelled filter would
    // contribute no condition and the request would read the whole table.
    const result = auditLogQuerySchema.safeParse({ actor_id: 'x' });
    expect(result.success).toBe(false);
  });
});

// -- Read path: the route ---------------------------------------------------

describe('GET /api/admin/audit-log', () => {
  const url = (qs = '') => `http://localhost/api/admin/audit-log${qs}`;

  const okDeps = (rows: AuditLogRow[] = []): AuditQueryDeps => ({
    requireAdmin: async () => ADMIN_USER,
    select: async (_w, limit, offset) => rows.slice(offset, offset + limit),
  });

  it('refuses a non-admin with the standard envelope, before parsing', async () => {
    const select = vi.fn();
    const response = await handleReadAuditLog(
      // An invalid filter as well, to prove the denial wins: a stranger must not
      // be able to map what this endpoint accepts.
      new Request(url('?action=nonsense')),
      {
        requireAdmin: async () => {
          throw new ForbiddenError('role creator not permitted');
        },
        select,
      }
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('FORBIDDEN');
    expect(select).not.toHaveBeenCalled();
  });

  it('returns 422 for a filter it cannot parse', async () => {
    const response = await handleReadAuditLog(
      new Request(url('?action=creator.verified')),
      okDeps()
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('treats an empty filter as an omitted one', async () => {
    // A form that renders every filter sends `?action=&target_id=` untouched.
    const response = await handleReadAuditLog(
      new Request(url('?action=&target_id=&limit=')),
      okDeps()
    );
    expect(response.status).toBe(200);
  });

  it('serialises rows in snake_case with has_more', async () => {
    const response = await handleReadAuditLog(
      new Request(url('?limit=1')),
      okDeps([
        {
          id: 'a-1',
          actorId: 'user-admin',
          actorName: 'Admin',
          actorEmail: 'admin@example.com',
          action: 'creator.verify',
          targetType: 'creator_profile',
          targetId: 'c-1',
          detail: { before: 'pending_verification', after: 'verified' },
          createdAt: new Date('2026-08-04T10:00:00.000Z'),
        },
        {
          id: 'a-2',
          actorId: 'user-admin',
          actorName: 'Admin',
          actorEmail: 'admin@example.com',
          action: 'creator.reject',
          targetType: 'creator_profile',
          targetId: 'c-2',
          detail: null,
          createdAt: new Date('2026-08-04T09:00:00.000Z'),
        },
      ])
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.has_more).toBe(true);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toEqual({
      id: 'a-1',
      actor_id: 'user-admin',
      actor_name: 'Admin',
      actor_email: 'admin@example.com',
      action: 'creator.verify',
      target_type: 'creator_profile',
      target_id: 'c-1',
      detail: { before: 'pending_verification', after: 'verified' },
      created_at: '2026-08-04T10:00:00.000Z',
    });
  });

  it('accepts snake_case filters, matching the response style', async () => {
    // The bug the review caught: `?actor_id=` was dropped and the whole log came
    // back. The filter must reach the query as `actorId`.
    let seen: SQL | undefined;
    const actorId = '11111111-1111-4111-8111-111111111111';
    const response = await handleReadAuditLog(
      new Request(url(`?actor_id=${actorId}&target_type=creator_profile`)),
      {
        requireAdmin: async () => ADMIN_USER,
        select: async (where) => {
          seen = where;
          return [];
        },
      }
    );

    expect(response.status).toBe(200);
    // A real WHERE, not `undefined` — the filter was applied rather than dropped.
    expect(seen).toBeDefined();
    const { sql } = new PgDialect().sqlToQuery(seen as SQL);
    expect(sql).toContain('actor_id');
    expect(sql).toContain('target_type');
  });

  it('rejects an unknown filter instead of ignoring it', async () => {
    // `.strict()` turns the next misspelled param into a loud 422 rather than a
    // silent full-table read.
    const select = vi.fn();
    const response = await handleReadAuditLog(
      new Request(url('?actorId=not-a-real-key-typo')),
      { requireAdmin: async () => ADMIN_USER, select }
    );

    // Unknown key is caught by the schema, not by the uuid check — either way a
    // 422, but the point is the request never reaches the database.
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a filter spelled two ways with different values', async () => {
    const select = vi.fn();
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    const response = await handleReadAuditLog(
      new Request(url(`?actor_id=${a}&actorId=${b}`)),
      { requireAdmin: async () => ADMIN_USER, select }
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.details.actorId).toBeDefined();
    expect(select).not.toHaveBeenCalled();
  });
});

// -- Insert-only ------------------------------------------------------------

/**
 * "The table is insert-only; no application code path updates or deletes a
 * row." That is a claim about the whole codebase rather than about one module,
 * so it is checked by reading the codebase — a unit test of any single file
 * could not observe the ticket that breaks it.
 */
describe('audit_log is insert-only', () => {
  const root = join(__dirname, '..');

  function sourceFiles(dir: string): string[] {
    return readdirSync(join(root, dir), { recursive: true })
      .map(String)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => join(root, dir, f));
  }

  const files = [
    ...sourceFiles('lib'),
    ...sourceFiles('app'),
    ...sourceFiles('db'),
  ];

  it('has no drizzle update or delete against the table', () => {
    const offenders = files.filter((file) =>
      /\.\s*(update|delete)\s*\(\s*(schema\.)?auditLog\s*\)/.test(
        readFileSync(file, 'utf8')
      )
    );
    expect(offenders).toEqual([]);
  });

  it('has no raw SQL update or delete against the table', () => {
    const offenders = files.filter((file) =>
      /(update|delete\s+from)\s+"?audit_log"?/i.test(readFileSync(file, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });

  it('is enforced by a trigger in the migrations, not only by convention', () => {
    // The code check above passes today and can be broken by any future ticket
    // without anyone noticing at review time. This is the half that cannot.
    const sql = readdirSync(join(root, 'drizzle'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(root, 'drizzle', f), 'utf8'))
      .join('\n');

    expect(sql).toMatch(/CREATE\s+TRIGGER\s+audit_log_no_update_delete/i);
    expect(sql).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+"?audit_log"?/i);
    // TRUNCATE bypasses row-level triggers, so it needs its own.
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+audit_log_no_truncate/i);
    expect(sql).toMatch(/BEFORE\s+TRUNCATE\s+ON\s+"?audit_log"?/i);
  });

  it('keeps every dollar-quoted body inside one migration statement', () => {
    // drizzle's migrator splits a migration file on the literal string
    // `--> statement-breakpoint` and runs each piece as one query — see
    // `drizzle-orm/migrator.js`. It does not understand SQL, so a breakpoint
    // written inside a `$$ ... $$` function body would cut the body in half and
    // hand Postgres two fragments. Both halves are syntax errors, the migration
    // fails, and every preview deploy fails with it.
    //
    // An odd number of `$$` in one chunk is exactly that mistake. This is the
    // hand-written SQL's equivalent of a typecheck: it cannot prove the trigger
    // behaves, but it catches the one way the file is easy to break.
    const files = readdirSync(join(root, 'drizzle')).filter((f) =>
      f.endsWith('.sql')
    );

    for (const file of files) {
      const chunks = readFileSync(join(root, 'drizzle', file), 'utf8').split(
        '--> statement-breakpoint'
      );
      chunks.forEach((chunk, i) => {
        const dollars = chunk.match(/\$\$/g)?.length ?? 0;
        expect(dollars % 2, `${file} chunk ${i} splits a $$ body`).toBe(0);
      });
    }
  });
});
