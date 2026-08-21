'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { CurrentUser } from '@/lib/auth';
import { getNavLinks } from '@/lib/navigation';
import {
  Binoculars,
  Briefcase,
  ChartDonut,
  ClipboardText,
  Megaphone,
  SealCheck,
  Stack,
  WarningCircle,
} from '@phosphor-icons/react';
import { motion, useReducedMotion } from 'framer-motion';

interface MainNavProps {
  user: CurrentUser;
}

export function MainNav({ user }: MainNavProps) {
  const pathname = usePathname();
  const links = getNavLinks(user.role);
  const reduceMotion = useReducedMotion();
  const activeHref = links
    .filter(
      (link) => pathname === link.href || pathname.startsWith(`${link.href}/`)
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav
      aria-label="Primary navigation"
      className="ml-1 hidden min-w-0 items-center gap-0.5 md:flex lg:ml-4"
    >
      {links.map((link) => {
        const isActive = link.href === activeHref;
        const Icon = NAV_ICONS[link.icon];
        return (
          <Link
            key={link.href}
            href={link.href}
            prefetch
            data-active={isActive || undefined}
            aria-current={isActive ? 'page' : undefined}
            className="group relative flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-neutral-300 transition-[color] duration-300 ease-out hover:text-neutral-50 active:scale-[0.98] data-[active]:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-50"
          >
            {isActive && (
              <motion.span
                layoutId="signed-in-nav-selector"
                className="absolute inset-0 rounded-full bg-neutral-50"
                initial={false}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : {
                        type: 'spring',
                        stiffness: 520,
                        damping: 42,
                        mass: 0.65,
                      }
                }
                aria-hidden
              />
            )}
            <Icon
              className="relative z-[1]"
              size={16}
              weight={isActive ? 'fill' : 'regular'}
              aria-hidden
            />
            <span className="relative z-[1]">{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

const NAV_ICONS = {
  dashboard: ChartDonut,
  discover: Binoculars,
  campaigns: Megaphone,
  deals: Briefcase,
  verification: SealCheck,
  tiers: Stack,
  worklist: WarningCircle,
  audit: ClipboardText,
} as const;
