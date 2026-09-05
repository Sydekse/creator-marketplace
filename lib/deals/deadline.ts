import { z } from 'zod';
import type { DealStatus } from '@/db/schema';

export const deliveryWindowSchema = z.number().int().min(1).max(90);
export const DELIVERY_TERMS_VERSION = 'funding-24h-v1';
export const NO_DELIVERY_DEADLINE = 'No delivery deadline recorded';

export function deliveryTerm(days: number | null | undefined): string {
  return days == null
    ? NO_DELIVERY_DEADLINE
    : `Within ${days} days after funding`;
}

export function fundingDeadline(
  days: number | null | undefined,
  fundedAt: Date
) {
  return days == null ? null : new Date(fundedAt.getTime() + days * 86_400_000);
}

export interface DeadlineEvidence {
  status: DealStatus;
  deliveryWindowDays?: number | null;
  originalDeliveryDueAt?: Date | null;
  currentDeliveryDueAt?: Date | null;
  firstDeliveredAt?: Date | null;
  dueAtFirstDelivery?: Date | null;
  missedDeliveryCommitment?: boolean;
}
export type Punctuality =
  | 'unknown'
  | 'awaiting_funding'
  | 'due'
  | 'overdue'
  | 'on_time'
  | 'late'
  | 'earlier_missed'
  | 'closed';
export const PUNCTUALITY_LABELS: Record<Punctuality, string> = {
  unknown: NO_DELIVERY_DEADLINE,
  awaiting_funding: 'Delivery clock starts at funding',
  due: 'Delivery due',
  overdue: 'Delivery overdue',
  on_time: 'Initial delivery on time',
  late: 'Initial delivery late',
  earlier_missed: 'Within extended deadline; earlier deadline missed',
  closed: 'Closed without initial delivery',
};

export function classifyPunctuality(
  row: DeadlineEvidence,
  now: Date
): Punctuality {
  if (row.deliveryWindowDays == null) return 'unknown';
  if (row.firstDeliveredAt) {
    if (!row.dueAtFirstDelivery || !row.originalDeliveryDueAt) return 'unknown';
    if (row.firstDeliveredAt > row.dueAtFirstDelivery) return 'late';
    return row.missedDeliveryCommitment ? 'earlier_missed' : 'on_time';
  }
  if (['refunded', 'declined', 'expired'].includes(row.status)) return 'closed';
  if (['delivered', 'revision_requested', 'completed'].includes(row.status))
    return 'unknown';
  if (!row.currentDeliveryDueAt)
    return row.status === 'pending' || row.status === 'accepted'
      ? 'awaiting_funding'
      : 'unknown';
  return now > row.currentDeliveryDueAt ? 'overdue' : 'due';
}

export function punctualityAggregate(rows: DeadlineEvidence[], now: Date) {
  const counts: Record<Punctuality, number> = {
    unknown: 0,
    awaiting_funding: 0,
    due: 0,
    overdue: 0,
    on_time: 0,
    late: 0,
    earlier_missed: 0,
    closed: 0,
  };
  for (const row of rows) counts[classifyPunctuality(row, now)]++;
  const eligible = counts.on_time + counts.late + counts.earlier_missed;
  return {
    ...counts,
    eligible,
    total: rows.length,
    onTimeRate: eligible ? counts.on_time / eligible : null,
  };
}

export const proposeDeadlineSchema = z
  .object({
    expectedDueAt: z.iso.datetime({ offset: true }),
    proposedDueAt: z.iso.datetime({ offset: true }),
    note: z.string().trim().min(1).max(2000),
  })
  .strict();
export const decideDeadlineSchema = z
  .object({
    requestId: z.uuid(),
    expectedDueAt: z.iso.datetime({ offset: true }),
    decision: z.enum(['accepted', 'rejected', 'withdrawn']),
  })
  .strict();
