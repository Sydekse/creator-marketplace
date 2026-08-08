import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { dealEvent, user } from '@/db/schema';

/**
 * Retrieves the full audit history of a deal, sorted chronologically.
 * Resolves the actor's name if the transition was initiated by a person (FR-007, AC-009).
 */
export async function getDealHistory(dealId: string) {
  const events = await db
    .select({
      id: dealEvent.id,
      fromStatus: dealEvent.fromStatus,
      toStatus: dealEvent.toStatus,
      reason: dealEvent.reason,
      createdAt: dealEvent.createdAt,
      actor: {
        id: user.id,
        name: user.name,
      },
    })
    .from(dealEvent)
    .leftJoin(user, eq(dealEvent.actorId, user.id))
    .where(eq(dealEvent.dealId, dealId))
    .orderBy(desc(dealEvent.createdAt));

  return events;
}

export type DealHistoryRow = Awaited<ReturnType<typeof getDealHistory>>[number];
