'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * Notification bell with unread count (KAN-96).
 *
 * Rendered in the header for every role. The count is passed as a prop from
 * the server — no client-side fetch needed. When the count is zero the badge
 * is hidden; when > 0 it shows the number (capped at 99 for display).
 *
 * Clicking navigates to `/notifications` where the full feed lives. On that
 * page the bell wears the same white active pill (and the filled icon) the
 * main nav gives the current section, so the selection is unmistakable.
 */
export function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const active = usePathname() === '/notifications';
  return (
    <Link
      href="/notifications"
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative grid h-9 w-9 place-items-center rounded-full transition-[background-color,color,transform] duration-300 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-50',
        active
          ? 'bg-neutral-50 text-neutral-900'
          : 'text-neutral-300 hover:bg-neutral-800 hover:text-neutral-50'
      )}
      aria-label={
        unreadCount > 0
          ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
          : 'Notifications'
      }
    >
      <Bell size={19} weight={active ? 'fill' : 'regular'} aria-hidden />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
