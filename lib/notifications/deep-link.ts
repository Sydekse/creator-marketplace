import type { UserRole } from '@/db/schema';

/**
 * Where a notification takes the person who received it (KAN-96, fixed KAN-200).
 *
 * A pure leaf, in its own module rather than inside `app/notifications/page.tsx`:
 * it is a decision with eleven inputs and three roles, which is a thing to unit
 * test rather than to source-guard. No `pg` import, so nothing here can pull the
 * database into a client bundle.
 *
 * **The role is the fix.** The original mapping sent every type to
 * `/creator/...`, including the four that only ever reach a brand — a brand who
 * clicked "View details" on "Offer accepted" landed on a creator route and was
 * bounced by the role gate. Marking a notification read on the way to a 403 is
 * worse than not marking it at all, so the link has to know who is holding it.
 *
 * Notifications are scoped by `user.id`, not by profile, so the same type genuinely
 * can arrive for either side — `dispute_resolved` reaches both parties. The
 * recipient's own role is therefore the only thing that can decide the route, and
 * it comes from the session (`requireUser`), never from the payload.
 *
 * Admins are sent to `/admin`. They are not a party to a deal, and three of the
 * admin nav links still 404 (F26) — a deep link into one of those would be the
 * same broken promise this function exists to stop making.
 */

/** Where each role's own dashboard lives, and where an unroutable type lands. */
const DASHBOARD: Record<UserRole, string> = {
  brand: '/brand',
  creator: '/creator',
  admin: '/admin',
};

/** Each role's list of deals: the fallback when the deal id is missing. */
const DEALS_INDEX: Record<UserRole, string> = {
  brand: '/campaigns',
  creator: '/creator/deals',
  admin: '/admin',
};

/**
 * The types whose subject is one deal. Every one of these payloads carries a
 * `dealId` (see `NotificationPayloadMap`), and every one of them has a screen on
 * both sides: `/deals/{id}` for the brand (KAN-68), `/creator/deals/{id}` for the
 * creator.
 */
const DEAL_SCOPED = new Set([
  'deadline_requested',
  'deadline_accepted',
  'deadline_rejected',
  'deadline_withdrawn',
  'deliverable_submitted',
  'deliverable_approved',
  'revision_requested',
  'dispute_resolved',
  'metric_reminder',
  'offer_received',
  'offer_accepted',
  'offer_declined',
  'offer_expired',
]);

function dealHref(role: UserRole, dealId: string): string {
  if (role === 'creator') return `/creator/deals/${dealId}`;
  if (role === 'brand') return `/deals/${dealId}`;
  return DASHBOARD.admin;
}

export function deepLink(
  type: string,
  payload: Record<string, unknown>,
  role: UserRole
): string {
  // `campaign_funded` is the one type whose subject is the campaign rather than a
  // deal — it is the only payload with a `campaignId` and no `dealId`. A creator
  // has no campaign screen, so they get their deal list, where the funded deal now
  // shows a deliver control.
  if (type === 'campaign_funded') {
    const campaignId = payload.campaignId;
    if (role === 'brand' && typeof campaignId === 'string') {
      return `/campaigns/${campaignId}`;
    }
    return DEALS_INDEX[role];
  }

  // The creator's own account, not a deal. A brand never receives this.
  if (type === 'verification_result') return DASHBOARD[role];

  // Wallet events land on the wallet, where the balance and the history row
  // both are. Only creators receive these.
  if (type === 'withdrawal_paid' || type === 'withdrawal_failed') {
    return role === 'creator' ? '/creator/wallet' : DASHBOARD[role];
  }

  if (DEAL_SCOPED.has(type)) {
    const dealId = payload.dealId;
    // A row written before the payload carried an id, or one whose id is not a
    // string, falls back to the list rather than building `/deals/undefined`.
    return typeof dealId === 'string' && dealId.length > 0
      ? dealHref(role, dealId)
      : DEALS_INDEX[role];
  }

  return DASHBOARD[role];
}
