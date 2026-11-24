import { describe, expect, it } from 'vitest';
import { deliverable, deliverableEvent, videoMetric } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import {
  appendEvidence,
  assertVersions,
  currentVideos,
  interruptReview,
  preserveSuperseded,
  recordDisposition,
  rejectCurrent,
  reviewReady,
  VersionConflict,
} from '@/lib/deliverables/history';
import { defaultDeps as submitDeps } from '@/lib/deals/submit-deliverable';
import { defaultDeps as metricDeps } from '@/lib/deals/record-metrics';
import { toVideoHistoryEvent } from '@/lib/deliverables/read-history';
import {
  expectedVersionsSchema,
  submitDeliverableSchema,
  updateMetricsSchema,
  rejectDeliverableSchema,
  resolveDisputeSchema,
} from '@/lib/validation';
import {
  REVISION_CATEGORIES,
  REVISION_CATEGORY_LABELS,
} from '@/lib/deliverables/evidence';

const DEAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AT = new Date('2026-09-01T12:00:00Z');
const video = (
  over: Partial<typeof deliverable.$inferSelect> = {}
): typeof deliverable.$inferSelect => ({
  id: ID,
  dealId: DEAL,
  videoOrdinal: 1,
  submissionVersion: 1,
  historyCompleteness: 'complete',
  tiktokUrl: 'https://www.tiktok.com/@creator/video/123',
  submittedAt: AT,
  reviewStatus: 'pending',
  reviewedAt: null,
  rejectionReason: null,
  revisionCategory: null,
  thumbnailUrl: null,
  tiktokVideoId: null,
  reviewCycleId: null,
  ...over,
});
const actor = { actorId: ACTOR, actorRole: 'brand' as const };

function runner(results: unknown[][] = []) {
  const inserted: { table: unknown; values: unknown }[] = [];
  const updated: { table: unknown; values: unknown }[] = [];
  const deleted: unknown[] = [];
  const locks: string[] = [];
  let selected = 0;
  let failInsert = false;
  const tx = {
    select: () => {
      const rows = results[selected++] ?? [];
      const query = {
        from: () => query,
        where: () => query,
        orderBy: () => query,
        for: (mode: string) => {
          locks.push(mode);
          return query;
        },
        limit: () => query,
        then: (resolve: (value: unknown[]) => unknown) =>
          Promise.resolve(rows).then(resolve),
      };
      return query;
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (failInsert) throw new Error('evidence unavailable');
        inserted.push({ table, values });
        const query = {
          returning: async () => [
            video({ ...(values as Partial<typeof deliverable.$inferSelect>) }),
          ],
          onConflictDoUpdate: () => query,
          then: (resolve: () => unknown) => Promise.resolve().then(resolve),
        };
        return query;
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          updated.push({ table, values });
          return {
            returning: async () => [
              video({
                ...(values as Partial<typeof deliverable.$inferSelect>),
              }),
            ],
            then: (resolve: () => unknown) => Promise.resolve().then(resolve),
          };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        deleted.push(table);
      },
    }),
  } as unknown as Tx;
  return {
    tx,
    inserted,
    updated,
    deleted,
    locks,
    fail: () => {
      failInsert = true;
    },
  };
}

describe('per-video evidence under an existing transaction', () => {
  it('labels captured review evidence without looking up a mutable current actor role', () => {
    const baseline = {
      id: ID,
      seq: 1,
      dealId: DEAL,
      deliverableId: ID,
      submissionVersion: 0,
      kind: 'legacy_baseline' as const,
      actorId: null,
      actorRole: 'unknown' as const,
      occurredAt: AT,
      tiktokUrl: video().tiktokUrl,
      revisionCategory: null,
      note: null,
      reviewCycleId: null,
      requestId: null,
      metadata: { reviewStatus: 'rejected' as const },
    };
    expect(toVideoHistoryEvent(baseline)).toMatchObject({
      actorRole: 'unknown',
      occurredAt: AT.toISOString(),
      categoryLabel: null,
      label: 'Legacy record adopted — earlier history unavailable',
      reviewLabel: 'Changes requested',
    });
    expect(
      toVideoHistoryEvent({
        ...baseline,
        revisionCategory: 'other',
        metadata: {},
      })
    ).toMatchObject({ categoryLabel: 'Other', reviewLabel: null });
  });
  it('preserves actor-role, URL, version and operation timestamp without opening another transaction', async () => {
    const f = runner();
    await appendEvidence(f.tx, video(), 'batch_approved', actor, AT);
    expect(f.inserted).toEqual([
      {
        table: deliverableEvent,
        values: {
          dealId: DEAL,
          deliverableId: ID,
          submissionVersion: 1,
          tiktokUrl: video().tiktokUrl,
          kind: 'batch_approved',
          ...actor,
          occurredAt: AT,
        },
      },
    ]);
  });

  it('compares the complete distinct set of expected current versions', () => {
    expect(() =>
      assertVersions([video()], [{ id: ID, submissionVersion: 1 }])
    ).not.toThrow();
    for (const expected of [
      [],
      [{ id: ID, submissionVersion: 0 }],
      [{ id: ACTOR, submissionVersion: 1 }],
      [
        { id: ID, submissionVersion: 1 },
        { id: ID, submissionVersion: 1 },
      ],
    ]) {
      expect(() => assertVersions([video()], expected)).toThrow(
        VersionConflict
      );
    }
  });

  it('opens a shared cycle for all current videos', async () => {
    const videos = [video(), video({ id: ACTOR, videoOrdinal: 2 })];
    const f = runner([videos]);
    await reviewReady(f.tx, DEAL, ACTOR, AT);
    const events = f.inserted.map(
      (row) => row.values
    ) as (typeof deliverableEvent.$inferInsert)[];
    expect(events).toHaveLength(2);
    expect(
      events.every(
        (event) =>
          event.kind === 'review_ready' &&
          event.occurredAt === AT &&
          event.reviewCycleId === events[0].reviewCycleId
      )
    ).toBe(true);
    expect(f.updated[0].values).toEqual({
      reviewCycleId: events[0].reviewCycleId,
    });
  });

  it('rejects only the expected target and interrupts the other review intervals', async () => {
    const cycle = crypto.randomUUID();
    const f = runner([
      [
        video({ reviewCycleId: cycle }),
        video({ id: ACTOR, videoOrdinal: 2, reviewCycleId: cycle }),
      ],
    ]);
    await rejectCurrent(
      f.tx,
      DEAL,
      ID,
      1,
      'message_accuracy',
      'Correct the claim',
      actor,
      AT
    );
    expect(
      f.inserted.map((row) => (row.values as { kind: string }).kind)
    ).toEqual(['revision_requested', 'review_interrupted']);
    expect(f.updated.at(-1)?.values).toEqual({
      reviewStatus: 'rejected',
      reviewedAt: AT,
      rejectionReason: 'Correct the claim',
      revisionCategory: 'message_accuracy',
    });
  });

  it('rejects stale targets without events or updates; foreign targets are not found', async () => {
    const f = runner([[video()], [video()]]);
    await expect(
      rejectCurrent(f.tx, DEAL, ID, 0, 'other', 'note', actor, AT)
    ).rejects.toThrow(VersionConflict);
    expect(
      await rejectCurrent(f.tx, DEAL, ACTOR, 1, 'other', 'note', actor, AT)
    ).toBeNull();
    expect(f.inserted).toEqual([]);
    expect(f.updated).toEqual([]);
  });

  it('archives the prior latest metrics and review evidence before deleting current metrics', async () => {
    const metric = {
      views: 0,
      likes: null,
      comments: 12,
      shares: 3,
      source: 'admin',
      lastUpdatedAt: AT,
      stale: false,
    };
    const f = runner([[metric]]);
    await preserveSuperseded(
      f.tx,
      video({
        reviewStatus: 'rejected',
        reviewedAt: AT,
        rejectionReason: 'Redo',
        revisionCategory: 'other',
      }),
      ACTOR,
      AT
    );
    expect(f.inserted[0].values).toMatchObject({
      kind: 'superseded',
      note: 'Redo',
      metadata: {
        reviewStatus: 'rejected',
        reviewedAt: AT.toISOString(),
        metrics: { ...metric, lastUpdatedAt: AT.toISOString() },
      },
    });
    expect(f.deleted).toEqual([videoMetric]);
  });

  it('records missing metrics honestly and never deletes them if history fails', async () => {
    const f = runner([[]]);
    await preserveSuperseded(f.tx, video(), ACTOR, AT);
    expect(f.inserted[0].values).toMatchObject({
      metadata: { metrics: null, reviewedAt: null },
    });
    const broken = runner([[]]);
    broken.fail();
    await expect(
      preserveSuperseded(broken.tx, video(), ACTOR, AT)
    ).rejects.toThrow('evidence unavailable');
    expect(broken.deleted).toEqual([]);
  });

  it('distinguishes admin release and refunds from brand batch approval', async () => {
    for (const kind of [
      'batch_approved',
      'admin_release',
      'refunded',
    ] as const) {
      const f = runner([[video({ reviewCycleId: ACTOR })]]);
      await recordDisposition(
        f.tx,
        DEAL,
        kind,
        { ...actor, actorRole: 'admin' },
        AT,
        'Resolution'
      );
      const events = f.inserted.map(
        (row) => row.values
      ) as (typeof deliverableEvent.$inferInsert)[];
      expect(events.at(-1)).toMatchObject({
        kind,
        actorRole: 'admin',
        note: 'Resolution',
      });
      expect(events.map((e) => e.kind)).toEqual(
        kind === 'refunded' ? ['review_interrupted', 'refunded'] : [kind]
      );
    }
    const f = runner();
    await interruptReview(f.tx, [], actor, AT);
    expect(f.updated).toEqual([]);
    expect(await currentVideos(runner([[]]).tx, DEAL)).toEqual([]);
  });
});

describe('submission and metrics version guards', () => {
  const input = {
    creatorProfileId: ACTOR,
    actorUserId: ACTOR,
    tiktokUrl: video().tiktokUrl,
    requestId: crypto.randomUUID(),
    deliverableId: null,
    expectedVersion: 0,
    expectedSubmitted: 0,
  };

  it('allocates the next ordinal, records partial submissions and refuses stale counts', async () => {
    const f = runner([[]]);
    const result = await submitDeps.recordSubmission(
      f.tx,
      DEAL,
      3,
      input.tiktokUrl,
      AT,
      input
    );
    expect(result).toMatchObject({
      videoOrdinal: 1,
      submissionVersion: 1,
      submitted: 1,
      remaining: 2,
    });
    expect(f.inserted.at(-1)?.values).toMatchObject({
      kind: 'submitted',
      requestId: input.requestId,
      metadata: { status: 'funded', submitted: 1 },
    });
    await expect(
      submitDeps.recordSubmission(
        runner([[video()]]).tx,
        DEAL,
        3,
        input.tiktokUrl,
        AT,
        input
      )
    ).rejects.toThrow(VersionConflict);
  });

  it('keeps the ordinal through same-URL replacement and clears media/metrics', async () => {
    const f = runner([
      [
        video({
          videoOrdinal: 2,
          reviewStatus: 'rejected',
          thumbnailUrl: 'old-cover',
        }),
      ],
      [],
    ]);
    const result = await submitDeps.recordSubmission(
      f.tx,
      DEAL,
      1,
      input.tiktokUrl,
      AT,
      { ...input, deliverableId: ID, expectedVersion: 1, expectedSubmitted: 1 }
    );
    expect(f.updated[0].values).toMatchObject({
      submissionVersion: 2,
      thumbnailUrl: null,
      tiktokVideoId: null,
      revisionCategory: null,
    });
    expect(f.updated[0].values).not.toHaveProperty('videoOrdinal');
    expect(result).toMatchObject({
      id: ID,
      submissionVersion: 2,
      previousThumbnailUrl: 'old-cover',
    });
    expect(f.locks).toEqual(['update']);
    expect(
      f.inserted.map((row) => (row.values as { kind: string }).kind)
    ).toEqual(['superseded', 'submitted']);
    expect(f.deleted).toEqual([videoMetric]);
  });

  it('replays a scoped request and refuses changed payload or missing request identity', async () => {
    const event = {
      deliverableId: ID,
      submissionVersion: 1,
      occurredAt: AT,
      actorId: ACTOR,
      tiktokUrl: input.tiktokUrl,
      metadata: {
        requestExpectedVersion: 0,
        requestExpectedSubmitted: 0,
        videoOrdinal: 1,
        requestTargetId: null,
        submitted: 1,
        status: 'funded',
      },
    };
    expect(
      await submitDeps.replay!(runner([[event]]).tx, DEAL, input, 3)
    ).toMatchObject({ ok: true, deliverableId: ID, submissionVersion: 1 });
    expect(
      await submitDeps.replay!(runner([[]]).tx, DEAL, input, 3)
    ).toBeNull();
    await expect(
      submitDeps.replay!(
        runner([[event]]).tx,
        DEAL,
        { ...input, tiktokUrl: 'different' },
        3
      )
    ).rejects.toThrow(VersionConflict);
    await expect(
      submitDeps.replay!(
        runner().tx,
        DEAL,
        { ...input, requestId: undefined },
        3
      )
    ).rejects.toThrow(VersionConflict);
  });

  it('checks metrics under the deal lock and supports untouched legacy version zero', async () => {
    const f = runner([[{ dealId: DEAL }], [{ id: DEAL }], [{ version: 0 }]]);
    await metricDeps.upsertMetrics(f.tx, {
      deliverableId: ID,
      values: { views: 0 },
      source: 'creator',
      lastUpdatedAt: AT,
      expectedVersion: 0,
    });
    expect(f.inserted[0].values).toMatchObject({
      submissionVersion: 0,
      views: 0,
      stale: false,
    });
    const stale = runner([
      [{ dealId: DEAL }],
      [{ id: DEAL }],
      [{ version: 2 }],
    ]);
    await expect(
      metricDeps.upsertMetrics(stale.tx, {
        deliverableId: ID,
        values: { views: 10 },
        source: 'admin',
        lastUpdatedAt: AT,
        expectedVersion: 1,
      })
    ).rejects.toThrow(VersionConflict);
    expect(stale.inserted).toEqual([]);
  });
});

describe('mounted payload requirements', () => {
  it('rejects pre-version clients and incomplete revision requests', () => {
    expect(
      submitDeliverableSchema.safeParse({ tiktokUrl: video().tiktokUrl })
        .success
    ).toBe(false);
    expect(updateMetricsSchema.safeParse({ views: 5 }).success).toBe(false);
    expect(updateMetricsSchema.safeParse({ expectedVersion: 1 }).success).toBe(
      false
    );
    expect(
      rejectDeliverableSchema.safeParse({ deliverableId: ID, reason: 'Fix' })
        .success
    ).toBe(false);
    expect(
      resolveDisputeSchema.safeParse({ resolution: 'revision', note: 'Fix' })
        .success
    ).toBe(false);
    expect(
      expectedVersionsSchema.safeParse([{ id: ID, submissionVersion: -1 }])
        .success
    ).toBe(false);
    expect(
      REVISION_CATEGORIES.every(
        (category) => !!REVISION_CATEGORY_LABELS[category]
      )
    ).toBe(true);
  });
});
