import Link from 'next/link';
import { Chip } from '@/components/ui/chip';
import { InitialsAvatar } from '@/components/ui/initials-avatar';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/feedback/empty-state';
import { buttonVariants } from '@/components/ui/button';
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
const NOTIFICATION_LABELS: Record<string, string> = {
  offer_received: 'New offer',
  verification_result: 'Verification update',
  campaign_funded: 'Campaign funded',
  deliverable_submitted: 'Video submitted',
  deliverable_approved: 'Video approved',
  revision_requested: 'Revision requested',
  dispute_resolved: 'Dispute resolved',
  offer_expired: 'Offer expired',
  offer_accepted: 'Offer accepted',
  offer_declined: 'Offer declined',
  metric_reminder: 'Metrics reminder',
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

  // Use a person name from the payload when available, otherwise fall back
  // to the notification label (e.g. "Video approved" → "VA").
  const avatarName =
    (payload.companyName as string) ??
    (payload.creatorHandle as string) ??
    label;

  return (
    <li
      className={`rounded-xl border p-5 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(23,23,23,0.08)] ${
        isUnread
          ? 'border-brand/30 bg-brand-tint/30'
          : 'border-neutral-200 bg-card'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <InitialsAvatar name={avatarName} size="sm" />
        <Chip tone={isUnread ? 'teal' : 'gray'}>{label}</Chip>
        {isUnread && (
          <span className="text-xs font-medium text-brand-ink">New</span>
        )}
        <span className="text-xs text-muted-foreground">
          {formatTimestamp(row.createdAt)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {/* Opening a notification is reading it, so following this link clears
            the unread state on its own (KAN-200). `MarkReadButton` stays for a
            row the user wants to clear without opening it. */}
        <ViewDetailsLink notificationId={row.id} href={href} />
        {isUnread && <MarkReadButton notificationId={row.id} />}
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

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Notifications"
        description={
          unread > 0
            ? `${unread} unread notification${unread === 1 ? '' : 's'}`
            : "You're all caught up."
        }
      />

      {result.rows.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          description="Activity on your deals, campaigns, and account will appear here."
          action={
            <Link
              href="/"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Back to dashboard
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {result.rows.map((row) => (
            <NotificationItem key={row.id} row={row} role={user.role} />
          ))}
        </ul>
      )}

      {result.hasMore && (
        <p className="text-sm text-muted-foreground">
          Older notifications are on subsequent pages — paging coming soon.
        </p>
      )}
    </div>
  );
}
