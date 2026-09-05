import Link from 'next/link';
import { BdShell, BdPageHead } from '@/components/brand/v4-shell';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { cn } from '@/lib/utils';
import { inAppNotificationDetail } from '@/lib/notifications/copy';
import { deepLink } from '@/lib/notifications/deep-link';
import { listNotifications, unreadCount } from '@/lib/notifications/queries';
import { requireUser } from '@/lib/auth';
import type { UserRole } from '@/db/schema';
import { MarkReadButton } from './mark-read-button';
import { ViewDetailsLink } from './view-details-link';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Human-readable labels for the notification type vocabulary (KAN-96).
 *
 * One label per entry in `NOTIFICATION_TYPES`, in the same order, so the admin
 * who greps the codebase sees the same list the page renders.
 */
import { DEADLINE_NOTIFICATION_LABELS } from '@/lib/notifications/copy';

const NOTIFICATION_LABELS: Record<string, string> = {
  ...DEADLINE_NOTIFICATION_LABELS,
  offer_received: 'New offer',
  verification_result: 'Verification update',
  campaign_funded: 'Campaign funded',
  deliverable_submitted: 'Video submitted',
  deliverable_approved: 'Video approved',
  revision_requested: 'Revision requested',
  dispute_resolved: 'Dispute resolved',
  offer_expired: 'Offer expired',
  offer_accepted: 'Ready to fund',
  offer_declined: 'Offer declined',
  metric_reminder: 'Metrics reminder',
  tier_upgraded: 'Tier upgraded',
  tier_assigned: 'Tier updated',
};

/**
 * Notification type → v4 chip tone, the campaigns pages' status vocabulary:
 * green for settled good news, amber for something waiting on the reader,
 * red for a closed door, teal for neutral movement.
 */
const TYPE_TONE: Record<string, string> = {
  offer_received: 'bd-capstatus--wait',
  verification_result: 'bd-capstatus--live',
  campaign_funded: 'bd-capstatus--live',
  deliverable_submitted: 'bd-capstatus--wait',
  deliverable_approved: 'bd-capstatus--done',
  revision_requested: 'bd-capstatus--wait',
  dispute_resolved: 'bd-capstatus--done',
  offer_expired: 'bd-capstatus--dead',
  offer_accepted: 'bd-capstatus--done',
  offer_declined: 'bd-capstatus--dead',
  metric_reminder: 'bd-capstatus--wait',
  tier_upgraded: 'bd-capstatus--done',
  tier_assigned: 'bd-capstatus--live',
};

function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function NotificationItem({
  row,
  role,
}: {
  row: {
    id: string;
    type: string;
    payload: unknown;
    readAt: Date | null;
    createdAt: Date;
  };
  /**
   * The recipient's role, from the session (KAN-200). Every link on this page is
   * built from it, because the same notification type reaches both sides of a
   * deal and the routes are not the same.
   */
  role: UserRole;
}) {
  const label = NOTIFICATION_LABELS[row.type] ?? row.type;
  const payload = (
    typeof row.payload === 'object' && row.payload !== null ? row.payload : {}
  ) as Record<string, unknown>;
  const href = deepLink(row.type, payload, role);
  const isUnread = row.readAt === null;
  const detail = inAppNotificationDetail(row.type, payload);

  // Use a person name from the payload when available, otherwise fall back
  // to the notification label (e.g. "Video approved" → "VA").
  const avatarName =
    (payload.companyName as string) ??
    (payload.creatorHandle as string) ??
    label;

  return (
    <li className={cn('bd-ntrow', isUnread && 'bd-ntrow--new')}>
      <InitialsAvatar name={avatarName} size="sm" />
      <div className="bd-ntbody">
        <div className="bd-nthead">
          <span
            className={cn(
              'bd-capstatus',
              TYPE_TONE[row.type] ?? 'bd-capstatus--live'
            )}
          >
            {label}
          </span>
          {isUnread ? <span className="bd-ntnew">New</span> : null}
          <time className="bd-nttime bd-mono">
            {formatTimestamp(row.createdAt)}
          </time>
        </div>
        {detail ? <p className="bd-ntdetail">{detail}</p> : null}
        <div className="bd-ntacts">
          {/* Opening a notification is reading it, so following this link clears
              the unread state on its own (KAN-200). `MarkReadButton` stays for a
              row the user wants to clear without opening it. */}
          <ViewDetailsLink notificationId={row.id} href={href} />
          {isUnread && <MarkReadButton notificationId={row.id} />}
        </div>
      </div>
    </li>
  );
}

export default async function NotificationsPage() {
  const user = await requireUser();
  const [result, unread] = await Promise.all([
    listNotifications(user.id),
    unreadCount(user.id),
  ]);

  // Two chapters: what still needs the reader's eye, then everything they
  // have already seen — the same ruler grammar every workspace page speaks.
  const fresh = result.rows.filter((row) => row.readAt === null);
  const earlier = result.rows.filter((row) => row.readAt !== null);

  return (
    <BdShell>
      <BdPageHead
        eyebrow="Activity"
        title="Notifications"
        facts={
          unread > 0 ? (
            <>
              <b className="bd-mono">{unread}</b> unread{' '}
              {unread === 1 ? 'notification' : 'notifications'}
            </>
          ) : (
            "You're all caught up."
          )
        }
        ruled
      />

      {result.rows.length === 0 ? (
        <div className="bd-rise" style={{ '--i': 1 } as React.CSSProperties}>
          <div className="bd-emptyfeed bd-emptyfeed--center">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10Z" />
              <path d="M10.3 19a2 2 0 0 0 3.4 0" />
            </svg>
            <h3>No notifications yet</h3>
            <p>
              Activity on your deals, campaigns, and account will appear here.
            </p>
            <Link href="/dashboard" className="bd-btn bd-btn--primary">
              Go to dashboard
            </Link>
          </div>
        </div>
      ) : (
        <div
          className="bd-ntwrap bd-rise"
          style={{ '--i': 1 } as React.CSSProperties}
        >
          {fresh.length > 0 ? (
            <section className="bd-ntsection bd-ntsection--new">
              <div className="bd-capruler">
                <span className="bd-ntdot" aria-hidden="true" />
                <span className="bd-caprulertitle">New</span>
                <span className="bd-caprulerline" aria-hidden="true" />
                <span className="bd-caprulercount bd-mono">
                  {fresh.length} {fresh.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>
              <ul className="bd-ntlist">
                {fresh.map((row) => (
                  <NotificationItem key={row.id} row={row} role={user.role} />
                ))}
              </ul>
            </section>
          ) : null}

          {earlier.length > 0 ? (
            <section className="bd-ntsection bd-ntsection--earlier">
              <div className="bd-capruler">
                <span className="bd-caprulertitle">Earlier</span>
                <span className="bd-caprulerline" aria-hidden="true" />
                <span className="bd-caprulercount bd-mono">
                  {earlier.length} {earlier.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>
              <ul className="bd-ntlist">
                {earlier.map((row) => (
                  <NotificationItem key={row.id} row={row} role={user.role} />
                ))}
              </ul>
            </section>
          ) : null}

          {result.hasMore && (
            <p className="bd-ntmore">
              Older notifications are on subsequent pages. Paging is coming
              soon.
            </p>
          )}
        </div>
      )}
    </BdShell>
  );
}
