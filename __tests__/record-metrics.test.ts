import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordMetrics } from '../lib/deals/record-metrics';
import type {
  MetricValues,
  RecordMetricsDeps,
  RecordMetricsOk,
} from '../lib/deals/record-metrics';
import { ForbiddenError } from '../lib/authz';
import type { AuditEntry, AuthzContext, Tx } from '../lib/authz';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_TARGET,
  AUDIT_TARGET_TYPES,
} from '../lib/audit/actions';
import { db } from '../db';
import { ErrorCode } from '../lib/validation';
import type { MetricSource } from '../db/schema';

/**
 * KAN-48 — the creator or an admin records engagement metrics for a delivered
 * video (US-009, AC-028, Tech Spec §4.5, §5 Metrics Service).
 *
 * Five claims carry the weight here.
 *
 * **Merge, not replace (AC-6).** Every body field is optional, so a `views`
 * -only update must leave `likes`/`shares`/`comments` untouched rather than
 * nulling them. Only the submitted columns reach the SQL SET clause, and
 * counts stay null when never measured — null is "Metrics pending" (AC-027,
 * KAN-50), never a confident zero. Asserted both by what reaches the seam
 * (the values object carries no undefined keys) and by source guard (the
 * default upsert builds `set` from the submitted keys alone).
 *
 * **One row per deliverable is a database constraint, and the upsert is the
 * path that satisfies it.** `video_metric.deliverable_id` is unique; the
 * default upsert inserts on first write and updates in place on every later
 * one, so it never trips the constraint it exists to backstop.
 *
 * **Admin writes are audited, creator writes are not (AC-031, FR-008).**
 * `metric.edit`/`video_metric` is the vocabulary pair, and `targetId` is a
 * function of the result because the first admin write *creates* the row it
 * must log — the id does not exist until the transaction has run. The
 * upsert runs inside the audit transaction; a creator's plain write is a
 * single upsert with no audit and no transaction.
 *
 * **`stale` is cleared on every manual write.** The flag exists for cached
 * values from a feed that went down (NFR-011, KAN-50); a manual submission
 * is fresh by definition.
 *
 * **The route's 403/404 split is deliberate.** The gate runs before the body
 * is read (a 403 and a 422 cannot be played off each other to probe ids),
 * and a missing deliverable is 403 for a creator — the anti-oracle collapse
 * (§6.3) — but 404 for an admin, whose `allowAdmin` admission means the
 * action's own existence check is the only answer. `source` is the actor's
 * role from the session, never anything the body supplies.
 *
 * The UI assertions are source guards. There is no DOM environment in this
 * repo — see the header of `ui-primitives.test.ts` — so they assert what a
 * file references, never what it paints. Comments are stripped first, so a
 * guard cannot be satisfied by prose about the rule.
 */

const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleRecordMetrics } =
  await import('../app/api/deliverables/[id]/metrics/route');

const CREATOR_USER_ID = '99999999-9999-4999-8999-999999999999';
const ADMIN_USER_ID = '44444444-4444-4444-8444-444444444444';
const DELIVERABLE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const METRIC_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

interface Recorded {
  /** Seam names in call order — ordering asserted without reading source. */
  calls: string[];
  loads: string[];
  upserts: Array<{
    runner: unknown;
    deliverableId: string;
    values: MetricValues;
    source: MetricSource;
    lastUpdatedAt: Date;
  }>;
  /** Entries handed to the audit seam, captured unresolved. */
  audits: Record<string, unknown>[];
}

interface Overrides {
  deliverableMissing?: boolean;
  failUpsert?: Error;
}

function makeDeps(overrides: Overrides = {}): {
  deps: RecordMetricsDeps;
  recorded: Recorded;
  fakeTx: Tx;
} {
  const recorded: Recorded = {
    calls: [],
    loads: [],
    upserts: [],
    audits: [],
  };

  // The audit transaction double: the admin path's upsert must see this exact
  // object as its runner, proving the write happened inside the audit
  // transaction and not beside it.
  const fakeTx = {} as Tx;

  const ctx: AuthzContext = {
    user: {
      id: ADMIN_USER_ID,
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
    },
    brandProfileId: null,
    creatorProfileId: null,
  };

  const deps: RecordMetricsDeps = {
    loadDeliverable: async (id) => {
      recorded.calls.push('loadDeliverable');
      recorded.loads.push(id);
      if (overrides.deliverableMissing) return null;
      return { id };
    },
    upsertMetrics: async (runner, input) => {
      recorded.calls.push('upsertMetrics');
      if (overrides.failUpsert) throw overrides.failUpsert;
      recorded.upserts.push({
        runner,
        deliverableId: input.deliverableId,
        values: input.values,
        source: input.source,
        lastUpdatedAt: input.lastUpdatedAt,
      });
      // What the seam returns is the merged row — submitted counts as stored,
      // untouched counts still null. The response must echo this, not the
      // request.
      return {
        id: METRIC_ID,
        views: input.values.views ?? null,
        likes: input.values.likes ?? null,
        shares: input.values.shares ?? null,
        comments: input.values.comments ?? null,
      };
    },
    runAdminAudit: (async <T>(
      entry: AuditEntry<T>,
      fn: (tx: Tx, ctx: AuthzContext) => Promise<T>
    ) => {
      recorded.calls.push('runAdminAudit');
      recorded.audits.push(entry as unknown as Record<string, unknown>);
      // The same hand-off the real withAdminAudit makes: the mutation runs on
      // the transaction that will carry the audit row.
      return fn(fakeTx, ctx);
    }) as RecordMetricsDeps['runAdminAudit'],
  };

  return { deps, recorded, fakeTx };
}

function record(
  deps: RecordMetricsDeps,
  over: {
    deliverableId?: string;
    values?: MetricValues;
    source?: MetricSource;
  } = {}
) {
  return recordMetrics(
    over.deliverableId ?? DELIVERABLE_ID,
    {
      values: over.values ?? { views: 1000 },
      source: over.source ?? 'creator',
    },
    deps
  );
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function read(path: string): string {
  return stripComments(readFileSync(path, 'utf8'));
}

const METRICS_MODULE = read('lib/deals/record-metrics.ts');
const METRICS_ROUTE = read('app/api/deliverables/[id]/metrics/route.ts');
const SCHEMA = read('db/schema.ts');

// -- AC-028: the write -------------------------------------------------------

describe('AC-028 — recording metrics writes (or merges) one row', () => {
  it('loads the deliverable before writing', async () => {
    const { deps, recorded } = makeDeps();

    await record(deps);

    expect(recorded.calls).toEqual(['loadDeliverable', 'upsertMetrics']);
    expect(recorded.loads).toEqual([DELIVERABLE_ID]);
    expect(recorded.upserts).toHaveLength(1);
    expect(recorded.upserts[0].deliverableId).toBe(DELIVERABLE_ID);
  });

  it('merges only the submitted columns (AC-6)', async () => {
    const { deps, recorded } = makeDeps();

    const result = await record(deps, {
      values: { views: 1000, likes: 500 },
    });

    // `values` carries exactly the submitted keys — no undefined entries for
    // the fields the caller left out.
    expect(recorded.upserts[0].values).toEqual({ views: 1000, likes: 500 });
    expect(Object.keys(recorded.upserts[0].values).sort()).toEqual([
      'likes',
      'views',
    ]);
    expect(result).toEqual({
      ok: true,
      metricId: METRIC_ID,
      views: 1000,
      likes: 500,
      shares: null,
      comments: null,
      source: 'creator',
      lastUpdatedAt: recorded.upserts[0].lastUpdatedAt,
    });
  });

  it('never sends an untouched count, and never sends a confident zero', () => {
    // The default upsert builds the SET clause from the submitted keys alone;
    // `undefined` never reaches the SQL. Counts stay null when never measured
    // — null is what the dashboard renders as "Metrics pending" (AC-027),
    // which a zero would lie about.
    const upsert = METRICS_MODULE.slice(
      METRICS_MODULE.indexOf('upsertMetrics:')
    );
    expect(upsert).toContain(
      'if (values[key] !== undefined) set[key] = values[key]'
    );
    expect(upsert).toMatch(
      /for \(const key of \['views', 'likes', 'shares', 'comments'\]/
    );
  });

  it('clears the stale flag on every manual write', () => {
    // The flag marks cached values from a feed that went down (NFR-011,
    // KAN-50). A manual submission is fresh by definition — keeping the flag
    // would brand these new numbers stale.
    expect(METRICS_MODULE).toContain('stale: false');
  });

  it('is one row per deliverable, enforced by a unique constraint', () => {
    // The unique on `deliverable_id` is the backstop; the upsert is the path
    // that satisfies it without ever tripping it.
    expect(SCHEMA).toMatch(
      /deliverableId: uuid\('deliverable_id'\)[\s\S]{0,80}\.unique\(\)/
    );
  });

  it('updates in place through the unique column', () => {
    const upsert = METRICS_MODULE.slice(
      METRICS_MODULE.indexOf('upsertMetrics:')
    );
    expect(upsert).toContain('.insert(videoMetric)');
    expect(upsert).toContain('.onConflictDoUpdate({');
    expect(upsert).toContain('target: videoMetric.deliverableId');
  });

  it('echoes the row the write stored, and the clock it used', async () => {
    // The response reports what was recorded — the seam's own merged counts —
    // and the `last_updated_at` stamped into the write, never a re-read.
    const { deps, recorded } = makeDeps();

    const result = await record(deps, { values: { comments: 7 } });

    expect(result).toMatchObject({
      metricId: METRIC_ID,
      comments: 7,
      views: null,
    });
    expect(result.ok && result.lastUpdatedAt).toBe(
      recorded.upserts[0].lastUpdatedAt
    );
  });
});

// -- Existence ---------------------------------------------------------------

describe('the existence check', () => {
  it('refuses a deliverable that does not exist, before any write', async () => {
    const { deps, recorded } = makeDeps({ deliverableMissing: true });

    const result = await record(deps);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(recorded.calls).toEqual(['loadDeliverable']);
    expect(recorded.upserts).toHaveLength(0);
    expect(recorded.audits).toHaveLength(0);
  });
});

// -- The audit split ---------------------------------------------------------

describe('admin writes are audited, creator writes are not (AC-031)', () => {
  it('pairs metric.edit with video_metric in the vocabulary', () => {
    // An action outside the pair would be rejected at runtime; the pair is
    // what the audit log's target_type must name.
    expect(AUDIT_ACTION_TARGET[AUDIT_ACTIONS.METRIC_EDIT]).toBe(
      AUDIT_TARGET_TYPES.VIDEO_METRIC
    );
  });

  it('writes one metric.edit entry for an admin', async () => {
    const { deps, recorded } = makeDeps();

    await record(deps, { source: 'admin' });

    expect(recorded.audits).toHaveLength(1);
    expect(recorded.audits[0]).toMatchObject({
      action: 'metric.edit',
      targetType: 'video_metric',
    });
  });

  it('names the row the transaction just made, via a function targetId', async () => {
    // The first admin write *creates* the video_metric row, so its id does
    // not exist when the entry is constructed. `targetId` defers resolution
    // to the result, exactly like `detail` — the id is the one the upsert
    // returned.
    const { deps, recorded } = makeDeps();

    await record(deps, { source: 'admin' });

    const targetId = recorded.audits[0].targetId as (
      result: RecordMetricsOk
    ) => string;
    expect(typeof targetId).toBe('function');
    expect(targetId({ ok: true, metricId: METRIC_ID } as RecordMetricsOk)).toBe(
      METRIC_ID
    );
    expect(METRICS_MODULE).toContain('targetId: (result) => result.metricId');
  });

  it('logs what changed in the detail, so the row need not be opened', async () => {
    const { deps, recorded } = makeDeps();

    const result = (await record(deps, {
      values: { views: 12, likes: 3 },
      source: 'admin',
    })) as RecordMetricsOk;

    const detail = recorded.audits[0].detail as (
      result: RecordMetricsOk
    ) => Record<string, unknown>;
    expect(detail(result)).toEqual({
      deliverable_id: DELIVERABLE_ID,
      source: 'admin',
      last_updated_at: result.lastUpdatedAt.toISOString(),
      views: 12,
      likes: 3,
      shares: null,
      comments: null,
    });
  });

  it('runs the upsert inside the audit transaction', async () => {
    const { deps, recorded, fakeTx } = makeDeps();

    await record(deps, { source: 'admin' });

    // The upsert saw the audit transaction as its runner — one transaction
    // carries both the change and its log, so they commit or roll back
    // together (invariant 9).
    expect(recorded.calls).toContain('runAdminAudit');
    expect(recorded.upserts[0].runner).toBe(fakeTx);
  });

  it('records the creator path as a plain write with no audit', async () => {
    const { deps, recorded } = makeDeps();

    await record(deps, { source: 'creator' });

    expect(recorded.audits).toHaveLength(0);
    expect(recorded.calls).not.toContain('runAdminAudit');
    // The plain path runs on the db runner, with nothing else to keep atomic
    // with it — no audit row, no transaction.
    expect(recorded.upserts[0].runner).toBe(db);
    expect(METRICS_MODULE).toContain('return write(db);');
  });

  it('takes the source from the caller, never from the values', async () => {
    // The role came from the route's guard; the values carry only counts.
    const { deps, recorded } = makeDeps();

    await record(deps, { values: { views: 5 }, source: 'admin' });

    expect(recorded.upserts[0].source).toBe('admin');
    expect(Object.keys(recorded.upserts[0].values)).toEqual(['views']);
  });

  it('touches no state machine and no notifications', () => {
    // This endpoint does not move the deal (it is already delivered) and
    // tells no one — nothing to keep atomic with the write.
    expect(METRICS_MODULE).not.toContain('state-machine');
    expect(METRICS_MODULE).not.toMatch(
      /transitionDeal|dealEvent|insert\(dealEvent\)/
    );
    expect(METRICS_MODULE).not.toMatch(/withNotifications|\bnotify\b/);
  });
});

// -- The endpoint ------------------------------------------------------------

describe('PUT /api/deliverables/[id]/metrics', () => {
  beforeEach(() => {
    guardMock.mockReset();
    guardMock.mockResolvedValue({
      user: {
        id: CREATOR_USER_ID,
        email: 'creator@example.com',
        name: 'Selam',
        role: 'creator',
      },
      brandProfileId: null,
      creatorProfileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
  });

  function put(body: unknown, id = DELIVERABLE_ID): Request {
    return new Request(`http://localhost/api/deliverables/${id}/metrics`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  it('returns 200 with the merged metrics', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleRecordMetrics(
      put({ views: 1000, likes: 500 }),
      DELIVERABLE_ID,
      { recordMetricsDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      deliverable_id: DELIVERABLE_ID,
      metric_id: METRIC_ID,
      views: 1000,
      likes: 500,
      shares: null,
      comments: null,
      source: 'creator',
      last_updated_at: recorded.upserts[0].lastUpdatedAt.toISOString(),
    });
  });

  it('gates on creator or admin, with allowAdmin', async () => {
    const { deps } = makeDeps();

    await handleRecordMetrics(put({ views: 1 }), DELIVERABLE_ID, {
      recordMetricsDeps: deps,
    });

    expect(guardMock).toHaveBeenCalledWith({
      roles: ['creator', 'admin'],
      resource: { kind: 'deliverable', id: DELIVERABLE_ID },
      allowAdmin: true,
    });
  });

  it('runs the guard before the body is parsed', async () => {
    // A caller who does not own this deliverable never gets as far as having
    // their JSON read, so a 403 and a 422 cannot be played off each other to
    // learn whether a deliverable id exists.
    const { deps, recorded } = makeDeps();
    guardMock.mockRejectedValueOnce(new ForbiddenError('not the owner'));

    const response = await handleRecordMetrics(
      put({ views: 1000 }),
      DELIVERABLE_ID,
      { recordMetricsDeps: deps }
    );

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
    expect(METRICS_ROUTE.indexOf('guardFn')).toBeLessThan(
      METRICS_ROUTE.indexOf('request.json()')
    );
  });

  it('refuses a malformed id before it reaches a uuid column', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleRecordMetrics(
      put({ views: 1 }, 'not-a-uuid'),
      'not-a-uuid',
      { recordMetricsDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
    expect(guardMock).not.toHaveBeenCalled();
    expect(recorded.calls).toHaveLength(0);
  });

  it('collapses a missing deliverable into 403 for a creator', async () => {
    // The anti-oracle rule (§6.3): the guard already refused anyone who does
    // not own this deliverable, so a distinct 404 would only tell a caller
    // which ids exist.
    const { deps } = makeDeps({ deliverableMissing: true });

    const response = await handleRecordMetrics(
      put({ views: 1 }),
      DELIVERABLE_ID,
      { recordMetricsDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('answers a missing deliverable with 404 for an admin', async () => {
    // allowAdmin admits the admin before ownership exists, so the action's own
    // existence check is what answers — and a missing row is an admin route's
    // 404.
    guardMock.mockResolvedValueOnce({
      user: {
        id: ADMIN_USER_ID,
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
      },
      brandProfileId: null,
      creatorProfileId: null,
    });
    const { deps } = makeDeps({ deliverableMissing: true });

    const response = await handleRecordMetrics(
      put({ views: 1 }),
      DELIVERABLE_ID,
      { recordMetricsDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it('refuses an empty body — a no-op PUT would re-stamp last_updated_at', async () => {
    // Every field is optional, but a body with none would update nothing while
    // claiming fresh data: four nulls and a new timestamp.
    const { deps, recorded } = makeDeps();

    const response = await handleRecordMetrics(put({}), DELIVERABLE_ID, {
      recordMetricsDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(recorded.calls).toHaveLength(0);
  });

  it('refuses negatives and out-of-range counts with the same 422', async () => {
    // The schema bounds counts to the Postgres integer range, so a number that
    // fits JavaScript but not the column becomes a fixable 422, never a 500
    // from the driver.
    for (const body of [
      { views: -1 },
      { views: 2_147_483_648 },
      { likes: 100.5 },
    ]) {
      const { deps, recorded } = makeDeps();
      const response = await handleRecordMetrics(put(body), DELIVERABLE_ID, {
        recordMetricsDeps: deps,
      });
      const parsed = await response.json();

      expect(response.status).toBe(422);
      expect(parsed.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(recorded.calls).toHaveLength(0);
    }
  });

  it('refuses an unknown key instead of stripping it', async () => {
    // A typo'd `veiws` must fail loudly, not silently drop the number the
    // creator thought they submitted.
    const { deps, recorded } = makeDeps();

    const response = await handleRecordMetrics(
      put({ views: 100, veiws: 200 }),
      DELIVERABLE_ID,
      { recordMetricsDeps: deps }
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(recorded.calls).toHaveLength(0);
  });

  it('refuses a body that is not JSON at all', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleRecordMetrics(
      put('not json'),
      DELIVERABLE_ID,
      {
        recordMetricsDeps: deps,
      }
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(recorded.calls).toHaveLength(0);
  });

  it('takes the source from the role, never from the body', async () => {
    guardMock.mockResolvedValueOnce({
      user: {
        id: ADMIN_USER_ID,
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
      },
      brandProfileId: null,
      creatorProfileId: null,
    });
    const { deps } = makeDeps();

    const response = await handleRecordMetrics(
      put({ views: 1 }),
      DELIVERABLE_ID,
      { recordMetricsDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe('admin');
    expect(METRICS_ROUTE).toContain('source: role');
    expect(METRICS_ROUTE).not.toMatch(/source:\s*(body|parsed)/);
  });

  it('runs on the Node runtime, because pg cannot run on the edge', () => {
    expect(METRICS_ROUTE).toContain("export const runtime = 'nodejs'");
  });
});

// -- The schema is shared with the client ------------------------------------

describe('updateMetricsSchema', () => {
  it('is the one bound a body must satisfy before this module sees it', () => {
    // The route parses with the shared schema and hands the result straight to
    // the action — no second interpretation of the counts anywhere.
    expect(METRICS_ROUTE).toContain('updateMetricsSchema.safeParse(body)');
    expect(METRICS_ROUTE).toContain('values: parsed.data');
    expect(METRICS_ROUTE).not.toContain('Math.min');
    expect(METRICS_ROUTE).not.toContain('Math.max');
  });
});
