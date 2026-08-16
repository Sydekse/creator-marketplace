import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { deliverable, videoMetric } from '@/db/schema';
import type { MetricSource } from '@/db/schema';
import { withAdminAudit } from '@/lib/authz';
import type { AuditEntry, AuthzContext, Tx } from '@/lib/authz';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@/lib/audit/actions';

/**
 * Creator or admin records engagement metrics for a delivered video (KAN-48,
 * US-009, AC-028, Tech Spec §4.5, §5 Metrics Service).
 *
 * **Everything before the write is someone else's job, and only the write is
 * this module's.** `updateMetricsSchema` has already refused negatives,
 * non-integers, out-of-range counts and unknown keys; the route's guard has
 * already refused everyone but the deliverable's own creator or an admin
 * (§4.5). This module stores what survived: a merge-style upsert on the one
 * `video_metric` row per deliverable, with the `deliverable_id` unique
 * constraint as the backstop.
 *
 * **Merge, not replace (AC-6).** Every body field is optional, so an update
 * that submits only `views` must leave `likes`/`shares`/`comments` untouched
 * rather than nulling them. Only the submitted columns reach the SQL SET
 * clause — undefined values never do — and counts stay null when never
 * measured, which is what the dashboard renders as "Metrics pending" rather
 * than a confident zero (AC-027, KAN-50).
 *
 * **Admin writes are audited, creator writes are not.** `metric.edit` is a
 * member of the closed audit vocabulary (`lib/audit/actions.ts`), and the
 * vocabulary's own rule is that an admin capability nobody thought to log is
 * exactly the gap FR-008 exists to close. So the admin path runs the upsert
 * inside `withAdminAudit`, sharing one transaction: the audit row and the
 * change commit or roll back together (invariant 9). The creator path is a
 * plain single-row upsert — no audit and no transaction, since there is
 * nothing else to keep atomic with it. The role came from the route's guard,
 * never from the body.
 *
 * **`stale` is cleared on every manual write.** The column exists to flag
 * cached values from a future feed that went down (NFR-011, KAN-50). A manual
 * submission is fresh by definition — keeping the old flag would mark these
 * new numbers stale.
 */

/** The four engagement counts, all optional — absence means "leave untouched". */
export interface MetricValues {
  views?: number;
  likes?: number;
  shares?: number;
  comments?: number;
}

/** The merged row, as the response echoes it. */
export interface StoredMetrics {
  id: string;
  views: number | null;
  likes: number | null;
  shares: number | null;
  comments: number | null;
}

export interface RecordMetricsOk {
  ok: true;
  metricId: string;
  views: number | null;
  likes: number | null;
  shares: number | null;
  comments: number | null;
  source: MetricSource;
  lastUpdatedAt: Date;
}

export type RecordMetricsResult =
  RecordMetricsOk | { ok: false; reason: 'not_found' };

export interface RecordMetricsDeps {
  /**
   * Existence check, layer two for the admin path. The route's guard proved
   * ownership for creators, but `allowAdmin` skips layer 2 by design — so the
   * only thing stopping an admin from writing metrics against a deliverable
   * that does not exist is this load (and the FK on `video_metric` it
   * protects).
   */
  loadDeliverable: (id: string) => Promise<{ id: string } | null>;
  /**
   * Insert on first write, update in place on every later one. Only the
   * submitted columns change; the row keeps its untouched counts (AC-6).
   *
   * The runner is `db` for the creator path and the audit transaction's `tx`
   * for the admin path — `PgTransaction` (a `Tx`) and `db` both expose the
   * drizzle query builder, so the union serves both, and the seam is what
   * keeps tests off Postgres.
   */
  upsertMetrics: (
    runner: Tx | typeof db,
    input: {
      deliverableId: string;
      values: MetricValues;
      source: MetricSource;
      lastUpdatedAt: Date;
    }
  ) => Promise<StoredMetrics>;
  /**
   * Admin path: runs the upsert together with its `metric.edit` audit row in
   * one transaction. Defaults to `withAdminAudit`; a test injects a fake to
   * capture the entry without touching the database or the session.
   */
  runAdminAudit: <T>(
    entry: AuditEntry<T>,
    fn: (tx: Tx, ctx: AuthzContext) => Promise<T>
  ) => Promise<T>;
}

const defaultDeps: RecordMetricsDeps = {
  loadDeliverable: async (id) => {
    const [row] = await db
      .select({ id: deliverable.id })
      .from(deliverable)
      .where(eq(deliverable.id, id))
      .limit(1);
    return row ?? null;
  },
  upsertMetrics: async (
    runner,
    { deliverableId, values, source, lastUpdatedAt }
  ) => {
    // Only the submitted columns reach the SET clause; `views`-only updates
    // leave the other counts alone (AC-6). The meta columns always change.
    const set: Partial<typeof videoMetric.$inferInsert> = {
      source,
      lastUpdatedAt,
      stale: false,
    };
    for (const key of ['views', 'likes', 'shares', 'comments'] as const) {
      if (values[key] !== undefined) set[key] = values[key];
    }

    const [row] = await runner
      .insert(videoMetric)
      .values({ deliverableId, ...set })
      .onConflictDoUpdate({
        target: videoMetric.deliverableId,
        set,
      })
      .returning({
        id: videoMetric.id,
        views: videoMetric.views,
        likes: videoMetric.likes,
        shares: videoMetric.shares,
        comments: videoMetric.comments,
      });
    return row;
  },
  runAdminAudit: (entry, fn) => withAdminAudit(entry, fn),
};

/**
 * Records or merges engagement metrics for one deliverable (AC-028).
 *
 * `source` is the actor's role, resolved by the route's guard — a creator
 * writing their own metrics records `creator`, an admin records `admin`. The
 * response carries the merged counts and the new `last_updated_at`, so the
 * client never re-reads to learn them.
 */
export async function recordMetrics(
  deliverableId: string,
  input: { values: MetricValues; source: MetricSource },
  deps: RecordMetricsDeps = defaultDeps
): Promise<RecordMetricsResult> {
  const existing = await deps.loadDeliverable(deliverableId);
  if (!existing) {
    return { ok: false, reason: 'not_found' };
  }

  const lastUpdatedAt = new Date();

  const write = async (runner: Tx | typeof db): Promise<RecordMetricsOk> => {
    const row = await deps.upsertMetrics(runner, {
      deliverableId,
      values: input.values,
      source: input.source,
      lastUpdatedAt,
    });
    return {
      ok: true,
      metricId: row.id,
      views: row.views,
      likes: row.likes,
      shares: row.shares,
      comments: row.comments,
      source: input.source,
      lastUpdatedAt,
    };
  };

  if (input.source === 'admin') {
    // AC-031/FR-008. `targetId` is a function of the result because the
    // `video_metric` row may be brand-new — its id does not exist when this
    // entry is constructed, and the audit row must name the very row the
    // transaction just made. `detail` carries what changed, so the log
    // answers "what did the admin edit" without opening the row.
    // The type argument is pinned because both arguments share `T`: the
    // entry's arrows are contextually typed by it, and this branch can only
    // produce a success — existence was already checked above, so the union's
    // `not_found` member cannot occur here.
    return deps.runAdminAudit<RecordMetricsOk>(
      {
        action: AUDIT_ACTIONS.METRIC_EDIT,
        targetType: AUDIT_TARGET_TYPES.VIDEO_METRIC,
        targetId: (result) => result.metricId,
        detail: (result) => ({
          deliverable_id: deliverableId,
          source: result.source,
          last_updated_at: result.lastUpdatedAt.toISOString(),
          views: result.views,
          likes: result.likes,
          shares: result.shares,
          comments: result.comments,
        }),
      },
      (tx) => write(tx)
    );
  }

  return write(db);
}
