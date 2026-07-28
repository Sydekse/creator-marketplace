import Link from 'next/link';
import type { CurrentUser } from '@/lib/auth';
import { MainNav } from '@/components/nav/main-nav';
import { MobileNav } from '@/components/nav/mobile-nav';
import { UserMenu } from '@/components/nav/user-menu';

interface HeaderProps {
  user: CurrentUser;
}

export function Header({ user }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <MobileNav user={user} />
        <Link href="/" className="text-base font-semibold tracking-tight">
          Creator Marketplace
        </Link>
        <MainNav user={user} />
        <div className="ml-auto flex items-center gap-2">
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
