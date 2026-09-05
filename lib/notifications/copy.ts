import { formatDeadlineUtc } from '@/lib/dates';

export const DEADLINE_NOTIFICATION_LABELS = {
  deadline_requested: 'Delivery extension requested',
  deadline_accepted: 'Delivery extension accepted',
  deadline_rejected: 'Delivery extension rejected',
  deadline_withdrawn: 'Delivery extension withdrawn',
} as const;

/**
 * In-app notification sentences. Email bodies live in `templates.tsx`;
 * this is the one-line next action the notifications list can show
 * without pulling react-email into the page bundle.
 */

export function inAppNotificationDetail(
  type: string,
  payload: Record<string, unknown>
): string | null {
  if (type in DEADLINE_NOTIFICATION_LABELS) {
    const label =
      DEADLINE_NOTIFICATION_LABELS[
        type as keyof typeof DEADLINE_NOTIFICATION_LABELS
      ];
    const proposed =
      typeof payload.proposedDueAt === 'string'
        ? formatDeadlineUtc(payload.proposedDueAt)
        : 'the proposed date';
    return `${label}: ${proposed}. ${type === 'deadline_accepted' ? 'The new delivery deadline is agreed. Earlier missed commitments remain recorded.' : 'The current delivery agreement is unchanged. Open the deal to review.'}`;
  }
  if (type === 'offer_accepted') {
    const handle =
      typeof payload.creatorHandle === 'string'
        ? payload.creatorHandle
        : 'A creator';
    const campaign =
      typeof payload.campaignTitle === 'string'
        ? payload.campaignTitle
        : 'the campaign';
    return `${handle} accepted ${campaign}. Fund the campaign to hold the money — they cannot start until you do.`;
  }
  return null;
}
