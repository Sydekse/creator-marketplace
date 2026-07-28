'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { CurrentUser } from '@/lib/auth';
import { getNavLinks } from '@/lib/navigation';

interface MobileNavProps {
  user: CurrentUser;
}

export function MobileNav({ user }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const links = getNavLinks(user.role);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="md:hidden">
        <Button variant="ghost" size="icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          <span className="sr-only">Toggle navigation menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64">
        <nav className="flex flex-col gap-4 pt-8">
          {links.map((link) => {
            const isActive = pathname.startsWith(link.href);
            return (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                data-active={isActive || undefined}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[active]:text-foreground"
              >
                {link.label}
              </a>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
