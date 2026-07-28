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
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[active]:text-foreground"
          >
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
