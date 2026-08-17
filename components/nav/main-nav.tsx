'use client';

import { usePathname } from 'next/navigation';
import type { CurrentUser } from '@/lib/auth';
import { getNavLinks } from '@/lib/navigation';

interface MainNavProps {
  user: CurrentUser;
}

export function MainNav({ user }: MainNavProps) {
  const pathname = usePathname();
  const links = getNavLinks(user.role);

  return (
    <nav className="hidden items-center gap-6 md:flex">
      {links.map((link) => {
        const isActive = pathname.startsWith(link.href);
        return (
          <a
            key={link.href}
            href={link.href}
            data-active={isActive || undefined}
            className="nav-underline text-sm font-medium text-muted-foreground transition-colors duration-300 ease-out hover:text-neutral-900 data-[active]:text-brand"
          >
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
