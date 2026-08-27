'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import type { CurrentUser } from '@/lib/auth';
import { getNavLinks, isNavLinkActive } from '@/lib/navigation';
import { NavActivePill } from '@/components/nav/nav-active-pill';
import {
  Binoculars,
  Briefcase,
  ChartDonut,
  ClipboardText,
  Megaphone,
  SealCheck,
  ShoppingCart,
  Stack,
  WarningCircle,
} from '@phosphor-icons/react';

/**
 * Where the top-bar Cart entry points, resolved on the server — the cart is
 * per-campaign, so there is no static `/cart` to link to.
 */
export interface CartTarget {
  /** The active draft's cart, or `/campaigns` when no draft exists. */
  href: string;
  /** Creators carted in the active draft. Zero hides the badge. */
  itemCount: number;
}

interface MainNavProps {
  user: CurrentUser;
  /** Brands only — the cart entry renders only when this is provided. */
  cart?: CartTarget;
}

export function MainNav({ user, cart }: MainNavProps) {
  const pathname = usePathname();
  const links = getNavLinks(user.role);
  const navRef = useRef<HTMLElement>(null);

  return (
    <nav
      ref={navRef}
      aria-label="Primary navigation"
      className="relative ml-1 hidden min-w-0 items-center gap-0.5 overflow-hidden rounded-full md:flex lg:ml-4"
    >
      <NavActivePill
        containerRef={navRef}
        activeKey={`${pathname}:${cart?.href ?? ''}`}
        className="bg-neutral-50"
      />
      {links.map((link) => {
        const Icon = NAV_ICONS[link.icon];
        // The cart entry's href is a placeholder — it resolves to the active
        // draft's cart, and it is active exactly when the brand is standing in
        // that cart, not whenever any /campaigns page is open.
        const isCart = link.icon === 'cart';
        const href = isCart ? (cart?.href ?? link.href) : link.href;
        const isActive = isNavLinkActive(link, pathname, cart?.href);
        const badge = isCart && cart && cart.itemCount > 0 ? cart.itemCount : 0;
        return (
          <Link
            key={link.href + link.icon}
            href={href}
            prefetch
            data-active={isActive || undefined}
            aria-current={isActive ? 'page' : undefined}
            aria-label={
              isCart && badge > 0
                ? `Cart, ${badge} creator${badge === 1 ? '' : 's'}`
                : undefined
            }
            className="group relative flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-neutral-300 transition-[color] duration-300 ease-out hover:text-neutral-50 active:scale-[0.98] data-[active]:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-50"
          >
            <span className="relative z-[1] inline-flex">
              <Icon
                size={16}
                weight={isActive ? 'fill' : 'regular'}
                aria-hidden
              />
            </span>
            <span className="relative z-[1]">{link.label}</span>
            {badge > 0 && (
              <span className="relative z-[1] flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-tint px-1 text-[10px] font-semibold text-brand-ink">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
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
  cart: ShoppingCart,
  verification: SealCheck,
  tiers: Stack,
  worklist: WarningCircle,
  audit: ClipboardText,
} as const;
