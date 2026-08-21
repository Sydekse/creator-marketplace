'use client';

import Link from 'next/link';
import { Bell } from '@phosphor-icons/react';

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
      className="relative grid h-9 w-9 place-items-center rounded-full text-neutral-300 transition-[background-color,color,transform] duration-300 ease-out hover:bg-neutral-800 hover:text-neutral-50 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-50"
      aria-label={
        unreadCount > 0
          ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
          : 'Notifications'
      }
    >
      <Bell size={19} weight="regular" aria-hidden />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
