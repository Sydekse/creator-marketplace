import Link from 'next/link';
import type { CurrentUser } from '@/lib/auth';
import { Mark } from '@/components/brand/mark';
import { MainNav } from '@/components/nav/main-nav';
import { MobileNav } from '@/components/nav/mobile-nav';
import { UserMenu } from '@/components/nav/user-menu';
import { NotificationBell } from './notification-bell';
import { unreadCount } from '@/lib/notifications/queries';

interface HeaderProps {
  user: CurrentUser;
}

export async function Header({ user }: HeaderProps) {
  // Notification count is best-effort — a query failure must not break the
  // header for every page. Default to 0 on error.
  let count = 0;
  try {
    count = await unreadCount(user.id);
  } catch {
    // Swallow — the bell simply shows no badge.
  }

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3">
        <div className="pointer-events-auto flex h-14 w-full max-w-6xl items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/95 px-3 shadow-[0_12px_32px_rgba(23,23,23,0.18)] backdrop-blur sm:gap-3">
          <MobileNav user={user} />
          <Link
            href="/"
            aria-label="Creator Marketplace home"
            className="flex shrink-0 items-center gap-2 rounded-full px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-50"
          >
            <Mark
              tone="light"
              className="h-6 w-6 rounded-lg transition-transform duration-300 ease-out hover:rotate-3"
            />
            <span className="text-[13px] font-semibold tracking-tight text-neutral-50 max-[380px]:hidden">
              Creator Marketplace
            </span>
          </Link>
          <MainNav user={user} />
          <div className="ml-auto flex items-center gap-1 border-l border-neutral-50/15 pl-2 sm:gap-2 sm:pl-3">
            <NotificationBell unreadCount={count} />
            <UserMenu user={user} />
          </div>
        </div>
      </header>
      {/* Spacer prevents page content from hiding behind the fixed header. */}
      <div aria-hidden className="h-[calc(3.5rem+0.75rem)]" />
    </>
  );
}
