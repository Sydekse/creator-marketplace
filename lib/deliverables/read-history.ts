import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { deal, deliverable, deliverableEvent } from '@/db/schema';
import { ForbiddenError } from '@/lib/authz';
import { requireDealAccess } from '@/lib/deals/queries';
import { labelForReviewStatus } from '@/lib/deals/groups';
import { UUID_REGEX } from '@/lib/validation';
import { EVENT_LABELS, REVISION_CATEGORY_LABELS } from './evidence';

export function toVideoHistoryEvent(
  event: typeof deliverableEvent.$inferSelect
) {
  return {
    ...event,
    occurredAt: event.occurredAt.toISOString(),
    label: EVENT_LABELS[event.kind],
    categoryLabel: event.revisionCategory
      ? REVISION_CATEGORY_LABELS[event.revisionCategory]
      : null,
    reviewLabel: event.metadata.reviewStatus
      ? labelForReviewStatus(event.metadata.reviewStatus)
      : null,
  };
}

export async function selectVideoHistory(dealId: string) {
  const events = await db
    .select()
    .from(deliverableEvent)
    .where(eq(deliverableEvent.dealId, dealId))
    .orderBy(asc(deliverableEvent.seq));
  return events.map(toVideoHistoryEvent);
}
export type VideoHistoryEvent = Awaited<
  ReturnType<typeof selectVideoHistory>
>[number];

export async function readVideoEvidence(dealId: string) {
  if (!UUID_REGEX.test(dealId)) throw new ForbiddenError('malformed deal id');
  await requireDealAccess(dealId);
  return db.transaction(
    async (tx) => {
      const [row] = await tx.select().from(deal).where(eq(deal.id, dealId));
      if (!row) throw new ForbiddenError('missing deal');
      const videos = await tx
        .select()
        .from(deliverable)
        .where(eq(deliverable.dealId, dealId))
        .orderBy(asc(deliverable.videoOrdinal));
      const events = await tx
        .select()
        .from(deliverableEvent)
        .where(eq(deliverableEvent.dealId, dealId))
        .orderBy(asc(deliverableEvent.seq));
      return {
        status: row.status,
        videos,
        events: events.map(toVideoHistoryEvent),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  );
}
