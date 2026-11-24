import {
  classifyPunctuality,
  deliveryTerm,
  PUNCTUALITY_LABELS,
  type DeadlineEvidence,
} from '@/lib/deals/deadline';
import { formatDeadlineUtc } from '@/lib/dates';

export function DeadlineSummary({
  deal,
  now = new Date(),
}: {
  deal: DeadlineEvidence;
  now?: Date;
}) {
  const state = classifyPunctuality(deal, now);
  return (
    <span className="text-xs text-muted-foreground">
      {state === 'awaiting_funding'
        ? `Delivery: ${deliveryTerm(deal.deliveryWindowDays)}`
        : PUNCTUALITY_LABELS[state]}
      {deal.currentDeliveryDueAt &&
        ` · ${formatDeadlineUtc(deal.dueAtFirstDelivery ?? deal.currentDeliveryDueAt)}`}
    </span>
  );
}
