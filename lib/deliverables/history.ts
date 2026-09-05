import { and, asc, eq } from 'drizzle-orm';
import { deliverable, deliverableEvent, videoMetric } from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { ErrorCode } from '@/lib/validation/errors';
import type {
  EvidenceMetadata,
  ExpectedVersion,
  RevisionCategory,
} from './evidence';

export class VersionConflict extends Error {
  readonly code = ErrorCode.DELIVERABLE_VERSION_STALE;
  constructor() {
    super('This video changed. Reload the page and try again.');
  }
}

type Video = typeof deliverable.$inferSelect;
type Actor = {
  actorId: string | null;
  actorRole: 'brand' | 'creator' | 'admin' | 'system';
};

/** All writers hold the deal lock before calling these helpers. */
export async function appendEvidence(
  tx: Tx,
  video: Video,
  kind: typeof deliverableEvent.$inferInsert.kind,
  actor: Actor,
  at: Date,
  extra: Partial<
    Pick<
      typeof deliverableEvent.$inferInsert,
      'note' | 'revisionCategory' | 'reviewCycleId' | 'requestId' | 'metadata'
    >
  > = {}
) {
  await tx.insert(deliverableEvent).values({
    dealId: video.dealId,
    deliverableId: video.id,
    submissionVersion: video.submissionVersion,
    tiktokUrl: video.tiktokUrl,
    kind,
    ...actor,
    occurredAt: at,
    ...extra,
  });
}

export function assertVersions(videos: Video[], expected: ExpectedVersion[]) {
  if (
    videos.length !== expected.length ||
    new Set(expected.map((v) => v.id)).size !== expected.length ||
    videos.some(
      (video) =>
        !expected.some(
          (v) =>
            v.id === video.id && v.submissionVersion === video.submissionVersion
        )
    )
  ) {
    throw new VersionConflict();
  }
}

export async function currentVideos(tx: Tx, dealId: string) {
  // Deal-first writers also lock videos so media enrichment cannot change a
  // thumbnail pointer between its supersession snapshot and replacement.
  return tx
    .select()
    .from(deliverable)
    .where(eq(deliverable.dealId, dealId))
    .orderBy(asc(deliverable.videoOrdinal))
    .for('update');
}

export async function reviewReady(
  tx: Tx,
  dealId: string,
  actorId: string,
  at: Date
) {
  const cycle = crypto.randomUUID();
  const videos = await currentVideos(tx, dealId);
  for (const video of videos) {
    await appendEvidence(
      tx,
      video,
      'review_ready',
      { actorId, actorRole: 'creator' },
      at,
      { reviewCycleId: cycle }
    );
  }
  await tx
    .update(deliverable)
    .set({ reviewCycleId: cycle })
    .where(eq(deliverable.dealId, dealId));
}

export async function interruptReview(
  tx: Tx,
  videos: Video[],
  actor: Actor,
  at: Date,
  exceptId?: string
) {
  for (const video of videos) {
    if (video.reviewCycleId && video.id !== exceptId) {
      await appendEvidence(tx, video, 'review_interrupted', actor, at, {
        reviewCycleId: video.reviewCycleId,
      });
    }
  }
  if (videos.length)
    await tx
      .update(deliverable)
      .set({ reviewCycleId: null })
      .where(eq(deliverable.dealId, videos[0].dealId));
}

export async function rejectCurrent(
  tx: Tx,
  dealId: string,
  id: string,
  expectedVersion: number,
  category: RevisionCategory,
  note: string,
  actor: Actor,
  at: Date
) {
  const videos = await currentVideos(tx, dealId);
  const target = videos.find((v) => v.id === id);
  if (!target) return null;
  if (target.submissionVersion !== expectedVersion) throw new VersionConflict();
  await appendEvidence(tx, target, 'revision_requested', actor, at, {
    note,
    revisionCategory: category,
    reviewCycleId: target.reviewCycleId,
  });
  await interruptReview(tx, videos, actor, at, id);
  await tx
    .update(deliverable)
    .set({
      reviewStatus: 'rejected',
      reviewedAt: at,
      rejectionReason: note,
      revisionCategory: category,
    })
    .where(and(eq(deliverable.id, id), eq(deliverable.dealId, dealId)));
  return { tiktokUrl: target.tiktokUrl };
}

export async function preserveSuperseded(
  tx: Tx,
  video: Video,
  actorId: string,
  at: Date
) {
  const [metric] = await tx
    .select()
    .from(videoMetric)
    .where(eq(videoMetric.deliverableId, video.id));
  const metadata: EvidenceMetadata = {
    reviewStatus: video.reviewStatus,
    reviewedAt: video.reviewedAt?.toISOString() ?? null,
    recordedSubmittedAt: video.submittedAt.toISOString(),
    metrics: metric
      ? {
          views: metric.views,
          likes: metric.likes,
          shares: metric.shares,
          comments: metric.comments,
          source: metric.source,
          lastUpdatedAt: metric.lastUpdatedAt?.toISOString() ?? null,
          stale: metric.stale,
        }
      : null,
  };
  await appendEvidence(
    tx,
    video,
    'superseded',
    { actorId, actorRole: 'creator' },
    at,
    {
      note: video.rejectionReason,
      revisionCategory: video.revisionCategory,
      metadata,
    }
  );
  await tx.delete(videoMetric).where(eq(videoMetric.deliverableId, video.id));
}

export async function recordDisposition(
  tx: Tx,
  dealId: string,
  kind: 'batch_approved' | 'admin_release' | 'refunded',
  actor: Actor,
  at: Date,
  note?: string
) {
  const videos = await currentVideos(tx, dealId);
  if (kind === 'refunded') await interruptReview(tx, videos, actor, at);
  for (const video of videos) {
    await appendEvidence(tx, video, kind, actor, at, {
      note,
      reviewCycleId: kind === 'refunded' ? null : video.reviewCycleId,
    });
  }
}
