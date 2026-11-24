import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  brandProfile,
  campaign,
  creatorProfile,
  deal,
  deadlineRequest,
} from '@/db/schema';
import type { Tx } from '@/lib/authz';
import { withNotifications, type Notify } from '@/lib/notifications/notify';
import { decideDeadlineSchema, proposeDeadlineSchema } from './deadline';
import type { z } from 'zod';

export class DeadlineError extends Error {
  constructor(
    public readonly code:
      'DEADLINE_CONFLICT' | 'DEADLINE_FORBIDDEN' | 'DEADLINE_INVALID',
    message: string
  ) {
    super(message);
  }
}
export type DeadlineActor = { userId: string; role: 'brand' | 'creator' };
type DealRow = typeof deal.$inferSelect;
export type DeadlineRequestRow = typeof deadlineRequest.$inferSelect;
type OwnedDeal = DealRow & {
  brandUserId: string;
  creatorUserId: string;
  campaignTitle: string;
};
export interface DeadlineDeps {
  run: <T>(fn: (tx: Tx, notify: Notify) => Promise<T>) => Promise<T>;
  load: (tx: Tx, id: string, actor: DeadlineActor) => Promise<OwnedDeal | null>;
  requests: (tx: Tx, id: string) => Promise<DeadlineRequestRow[]>;
  insert: (
    tx: Tx,
    row: typeof deadlineRequest.$inferInsert
  ) => Promise<DeadlineRequestRow>;
  decide: (
    tx: Tx,
    id: string,
    values: Partial<typeof deadlineRequest.$inferInsert>
  ) => Promise<void>;
  extend: (tx: Tx, id: string, due: Date, missed: boolean) => Promise<void>;
  now: () => Date;
}

export const defaultDeps: DeadlineDeps = {
  run: withNotifications,
  load: async (tx, id, actor) => {
    const [row] = await tx
      .select({
        deal,
        brandUserId: brandProfile.userId,
        creatorUserId: creatorProfile.userId,
        campaignTitle: campaign.name,
      })
      .from(deal)
      .innerJoin(campaign, eq(deal.campaignId, campaign.id))
      .innerJoin(brandProfile, eq(campaign.brandId, brandProfile.id))
      .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
      .where(
        and(
          eq(deal.id, id),
          eq(
            actor.role === 'brand'
              ? brandProfile.userId
              : creatorProfile.userId,
            actor.userId
          )
        )
      )
      .for('update', { of: deal });
    return row
      ? {
          ...row.deal,
          brandUserId: row.brandUserId,
          creatorUserId: row.creatorUserId,
          campaignTitle: row.campaignTitle,
        }
      : null;
  },
  requests: (tx, id) =>
    tx
      .select()
      .from(deadlineRequest)
      .where(eq(deadlineRequest.dealId, id))
      .for('update'),
  insert: async (tx, row) => {
    const [result] = await tx.insert(deadlineRequest).values(row).returning();
    return result;
  },
  decide: async (tx, id, values) => {
    await tx
      .update(deadlineRequest)
      .set(values)
      .where(eq(deadlineRequest.id, id));
  },
  extend: async (tx, id, due, missed) => {
    await tx
      .update(deal)
      .set({ currentDeliveryDueAt: due, missedDeliveryCommitment: missed })
      .where(eq(deal.id, id));
  },
  now: () => new Date(),
};

function conflict(
  message = 'The delivery agreement changed. Refresh and try again.'
): never {
  throw new DeadlineError('DEADLINE_CONFLICT', message);
}
function active(row: OwnedDeal, expected: string) {
  if (
    row.status !== 'funded' ||
    row.firstDeliveredAt ||
    row.deliveryWindowDays == null ||
    !row.currentDeliveryDueAt
  )
    conflict(
      'Extensions are only available before initial delivery on funded deals with an agreed deadline.'
    );
  if (row.currentDeliveryDueAt.getTime() !== new Date(expected).getTime())
    conflict();
  return row.currentDeliveryDueAt;
}
function later(proposed: Date, current: Date, now: Date) {
  if (proposed <= current || proposed <= now)
    conflict(
      'Choose a deadline later than the current agreement and in the future.'
    );
}

export async function proposeDeadline(
  id: string,
  actor: DeadlineActor,
  input: z.infer<typeof proposeDeadlineSchema>,
  deps: DeadlineDeps = defaultDeps
) {
  const parsed = proposeDeadlineSchema.safeParse(input);
  if (!parsed.success)
    throw new DeadlineError(
      'DEADLINE_INVALID',
      'Enter a valid UTC deadline and a note.'
    );
  return deps.run(async (tx, notify) => {
    const row = await deps.load(tx, id, actor);
    if (!row)
      throw new DeadlineError('DEADLINE_FORBIDDEN', 'Deal not available.');
    const current = active(row, input.expectedDueAt);
    const now = deps.now();
    const proposed = new Date(input.proposedDueAt);
    later(proposed, current, now);
    if ((await deps.requests(tx, id)).some((r) => r.status === 'pending'))
      conflict('An extension is already pending. Refresh to review it.');
    const request = await deps.insert(tx, {
      dealId: id,
      proposedBy: actor.userId,
      proposerRole: actor.role,
      previousDueAt: current,
      proposedDueAt: proposed,
      note: parsed.data.note,
      proposedAt: now,
      status: 'pending',
    });
    await notify(
      actor.role === 'brand' ? row.creatorUserId : row.brandUserId,
      'deadline_requested',
      {
        dealId: id,
        requestId: request.id,
        campaignTitle: row.campaignTitle,
        recipientRole: actor.role === 'brand' ? 'creator' : 'brand',
        previousDueAt: current.toISOString(),
        proposedDueAt: proposed.toISOString(),
      }
    );
    return request;
  });
}

export async function decideDeadline(
  id: string,
  actor: DeadlineActor,
  input: z.infer<typeof decideDeadlineSchema>,
  deps: DeadlineDeps = defaultDeps
) {
  if (!decideDeadlineSchema.safeParse(input).success)
    throw new DeadlineError('DEADLINE_INVALID', 'Invalid extension decision.');
  return deps.run(async (tx, notify) => {
    const row = await deps.load(tx, id, actor);
    if (!row)
      throw new DeadlineError('DEADLINE_FORBIDDEN', 'Deal not available.');
    const request = (await deps.requests(tx, id)).find(
      (r) => r.id === input.requestId
    );
    if (!request) conflict();
    const isProposer =
      request.proposedBy === actor.userId &&
      request.proposerRole === actor.role;
    if (
      input.decision === 'withdrawn'
        ? !isProposer
        : isProposer || request.proposerRole === actor.role
    )
      throw new DeadlineError(
        'DEADLINE_FORBIDDEN',
        'Only the counterparty may accept or reject; only the proposer may withdraw.'
      );
    if (
      request.previousDueAt.getTime() !==
      new Date(input.expectedDueAt).getTime()
    )
      conflict();
    if (request.status !== 'pending') {
      if (
        request.status === input.decision &&
        request.decidedBy === actor.userId
      )
        return request;
      conflict();
    }
    const current = active(row, input.expectedDueAt);
    const now = deps.now();
    if (now < request.proposedAt)
      conflict('The request clock changed. Refresh and try again.');
    if (input.decision === 'accepted') {
      later(request.proposedDueAt, current, now);
      await deps.extend(
        tx,
        id,
        request.proposedDueAt,
        row.missedDeliveryCommitment || now > current
      );
    }
    await deps.decide(tx, request.id, {
      status: input.decision,
      decidedBy: actor.userId,
      decidedAt: now,
    });
    await notify(
      actor.role === 'brand' ? row.creatorUserId : row.brandUserId,
      `deadline_${input.decision}`,
      {
        dealId: id,
        requestId: request.id,
        campaignTitle: row.campaignTitle,
        recipientRole: actor.role === 'brand' ? 'creator' : 'brand',
        previousDueAt: current.toISOString(),
        proposedDueAt: request.proposedDueAt.toISOString(),
      }
    );
    return {
      ...request,
      status: input.decision,
      decidedBy: actor.userId,
      decidedAt: now,
    };
  });
}

/** Caller holds the deal lock; terminal transitions share the same lock order. */
export async function closeDeadlineRequests(
  tx: Tx,
  id: string,
  reason: 'first_delivery' | 'refunded',
  now: Date
) {
  await tx
    .update(deadlineRequest)
    .set({ status: 'closed', decidedAt: now, closureReason: reason })
    .where(
      and(eq(deadlineRequest.dealId, id), eq(deadlineRequest.status, 'pending'))
    );
}

/** Only called after the owning page's guard; recheck the owner on the read. */
export async function getDeadlineDetail(
  id: string,
  actor: DeadlineActor | { userId: string; role: 'admin' }
) {
  return db.transaction(
    async (tx) => {
      const [row] = await tx
        .select({ deal })
        .from(deal)
        .innerJoin(campaign, eq(deal.campaignId, campaign.id))
        .innerJoin(brandProfile, eq(campaign.brandId, brandProfile.id))
        .innerJoin(creatorProfile, eq(deal.creatorId, creatorProfile.id))
        .where(
          and(
            eq(deal.id, id),
            actor.role === 'admin'
              ? undefined
              : eq(
                  actor.role === 'brand'
                    ? brandProfile.userId
                    : creatorProfile.userId,
                  actor.userId
                )
          )
        );
      if (!row) return null;
      const requests = await tx
        .select()
        .from(deadlineRequest)
        .where(eq(deadlineRequest.dealId, id))
        .orderBy(desc(deadlineRequest.proposedAt), desc(deadlineRequest.id));
      return { ...row.deal, requests };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  );
}
