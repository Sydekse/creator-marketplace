/**
 * In-app notification sentences. Email bodies live in `templates.tsx`;
 * this is the one-line next action the notifications list can show
 * without pulling react-email into the page bundle.
 */

export function inAppNotificationDetail(
  type: string,
  payload: Record<string, unknown>
): string | null {
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
