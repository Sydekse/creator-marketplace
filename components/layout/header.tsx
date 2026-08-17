import Link from 'next/link';
import type { CurrentUser } from '@/lib/auth';
import { Mark } from '@/components/brand/mark';
import { MainNav } from '@/components/nav/main-nav';
import { MobileNav } from '@/components/nav/mobile-nav';
import { UserMenu } from '@/components/nav/user-menu';

interface HeaderProps {
  user: CurrentUser;
}

export function Header({ user }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-neutral-200 bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <MobileNav user={user} />
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500"
        >
          <Mark tone="dark" className="h-5 w-5 rounded-md" />
          <span className="text-[13px] font-semibold tracking-tight text-neutral-900">
            Creator Marketplace
          </span>
        </Link>
        <MainNav user={user} />
        <div className="ml-auto flex items-center gap-2">
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
