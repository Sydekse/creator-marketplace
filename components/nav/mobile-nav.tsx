'use client';

import { useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { NavActivePill } from '@/components/nav/nav-active-pill';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { CurrentUser } from '@/lib/auth';
import { getNavLinks, isNavLinkActive } from '@/lib/navigation';
import { Mark } from '@/components/brand/mark';
import {
  Binoculars,
  Briefcase,
  ChartDonut,
  ChartBar,
  ClipboardText,
  CurrencyCircleDollar,
  List,
  Megaphone,
  ShoppingCart,
  Stack,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type { CartTarget } from '@/components/nav/main-nav';

interface MobileNavProps {
  user: CurrentUser;
  /** Brands only — resolved server-side, same as MainNav. */
  cart?: CartTarget;
}

export function MobileNav({ user, cart }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const links = getNavLinks(user.role);
  const navRef = useRef<HTMLElement>(null);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/*
        `render` replaces the trigger's own element rather than nesting inside
        it — the pattern SheetClose already uses in `components/ui/sheet.tsx`.
        Passing <Button> as a child instead puts a <button> inside a <button>,
        which browsers reparent, so the server and client trees disagree and
        hydration fails. The responsive visibility rides on the Button too.
      */}
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative -ml-1 text-neutral-50 hover:bg-neutral-800 hover:text-neutral-50 min-[1100px]:hidden"
          />
        }
      >
        <List size={21} weight="regular" aria-hidden />
        {/* The draft cart's count rides the trigger, so the number is visible
            before the sheet is opened — same source as the cart entry's badge
            inside. */}
        {cart && cart.itemCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-tint px-1 text-[10px] leading-none font-semibold text-brand-ink"
          >
            {cart.itemCount > 99 ? '99+' : cart.itemCount}
          </span>
        ) : null}
        <span className="sr-only">
          Toggle navigation menu
          {cart && cart.itemCount > 0
            ? `, ${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'} in cart`
            : ''}
        </span>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(88vw,320px)] gap-0 border-neutral-200 bg-neutral-50 p-0 shadow-[12px_0_40px_-24px_rgba(23,23,23,0.3)]"
      >
        <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
        <div className="border-b border-neutral-200 px-5 py-5">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            aria-label="Creator Marketplace home"
            className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-900"
          >
            <Mark tone="dark" className="h-6 w-6 rounded-lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-900">
                Creator Marketplace
              </p>
              <p className="mt-0.5 text-xs capitalize text-neutral-500">
                {user.role} workspace
              </p>
            </div>
          </Link>
        </div>
        <nav
          ref={navRef}
          aria-label="Primary navigation"
          className="relative flex flex-col gap-1 overflow-hidden p-3"
        >
          <NavActivePill
            containerRef={navRef}
            activeKey={`${pathname}:${cart?.href ?? ''}`}
            orientation="vertical"
            className="rounded-lg bg-neutral-900"
          />
          {links.map((link) => {
            const Icon = NAV_ICONS[link.icon];
            // Same resolution as MainNav: the cart entry points at the active
            // draft's cart and hides entirely when there is no draft cart.
            const isCart = link.icon === 'cart';
            if (isCart && !cart) return null;
            const href = isCart ? (cart?.href ?? link.href) : link.href;
            const isActive = isNavLinkActive(link, pathname, cart?.href, links);
            const badge =
              isCart && cart && cart.itemCount > 0 ? cart.itemCount : 0;
            return (
              <Link
                key={link.href + link.icon}
                href={href}
                onClick={() => setOpen(false)}
                data-active={isActive || undefined}
                aria-current={isActive ? 'page' : undefined}
                className="relative z-[1] flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-neutral-600 transition-colors duration-200 ease-out hover:text-neutral-900 active:scale-[0.98] data-[active]:bg-neutral-900 data-[active]:text-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
              >
                <Icon
                  className="relative z-[1]"
                  size={18}
                  weight={isActive ? 'fill' : 'regular'}
                  aria-hidden
                />
                <span className="relative z-[1]">{link.label}</span>
                {badge > 0 && (
                  <span className="relative z-[1] ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-tint px-1.5 text-[11px] font-semibold text-brand-ink">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

const NAV_ICONS = {
  dashboard: ChartDonut,
  discover: Binoculars,
  campaigns: Megaphone,
  insights: ChartBar,
  deals: Briefcase,
  cart: ShoppingCart,
  tiers: Stack,
  worklist: WarningCircle,
  payments: CurrencyCircleDollar,
  audit: ClipboardText,
} as const;
