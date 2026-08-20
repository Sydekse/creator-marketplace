'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';

/**
 * Notification bell with unread count (KAN-96).
 *
 * Rendered in the header for every role. The count is passed as a prop from
 * the server — no client-side fetch needed. When the count is zero the badge
 * is hidden; when > 0 it shows the number (capped at 99 for display).
 *
 * Clicking navigates to `/notifications` where the full feed lives.
 */
export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  return (
    <Link
      href="/notifications"
      className="relative rounded-lg p-2 text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
      aria-label={
        unreadCount > 0
          ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
          : 'Notifications'
      }
    >
      <Bell className="h-5 w-5" strokeWidth={1.5} />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
