import type { UserRole } from '@/db/schema';

export interface NavLink {
  label: string;
  href: string;
  icon:
    | 'dashboard'
    | 'discover'
    | 'campaigns'
    | 'deals'
    | 'cart'
    | 'verification'
    | 'tiers'
    | 'worklist'
    | 'audit';
}

const NAV_LINKS: Record<UserRole, NavLink[]> = {
  brand: [
    { label: 'Dashboard', href: '/brand', icon: 'dashboard' },
    { label: 'Campaigns', href: '/campaigns', icon: 'campaigns' },
    { label: 'Discover', href: '/discover', icon: 'discover' },
    { label: 'Deals', href: '/deals', icon: 'deals' },
    // Not a fixed route — the cart is per-campaign, so MainNav resolves this
    // entry to the active draft's cart (or /campaigns when there is none) and
    // carries the item count as a badge. The href here is only a fallback.
    { label: 'Cart', href: '/campaigns', icon: 'cart' },
  ],
  creator: [
    // `/creator/deals`, not `/deals`. The route this points at is real as of
    // KAN-39, and it is the one the four email CTAs in
    // `lib/notifications/templates.tsx` already named — a nav item and an email
    // disagreeing about the same screen is how one of them stays broken.
    { label: 'Dashboard', href: '/creator', icon: 'dashboard' },
    { label: 'Deals', href: '/creator/deals', icon: 'deals' },
  ],
  admin: [
    { label: 'Overview', href: '/admin', icon: 'dashboard' },
    {
      label: 'Verification',
      href: '/admin/verification',
      icon: 'verification',
    },
    { label: 'Tiers', href: '/admin/tiers', icon: 'tiers' },
    { label: 'Campaigns', href: '/admin/campaigns', icon: 'campaigns' },
    { label: 'Disputes', href: '/admin/worklist', icon: 'worklist' },
    { label: 'Audit log', href: '/admin/audit-log', icon: 'audit' },
  ],
};

export function getNavLinks(role: UserRole): NavLink[] {
  return NAV_LINKS[role];
}

/**
 * Which top-bar item is current. Cart href is a campaign cart, so a naive
 * `/campaigns` prefix match would light Campaigns (dark text, no pill) at
 * the same time as Cart.
 */
export function isNavLinkActive(
  link: NavLink,
  pathname: string,
  cartHref?: string
): boolean {
  if (link.icon === 'cart') {
    return Boolean(
      cartHref && cartHref !== '/campaigns' && pathname === cartHref
    );
  }
  if (cartHref && cartHref !== '/campaigns' && pathname === cartHref) {
    return false;
  }
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

/**
 * Where each role lands after signing in. One table, so the sign-in page, the
 * sign-up page, the role gates, and `/dashboard` cannot disagree.
 */
const ROLE_HOME: Record<UserRole, string> = {
  brand: '/brand',
  creator: '/creator',
  admin: '/admin',
};

export function roleHomePath(role: UserRole): string {
  return ROLE_HOME[role];
}

/**
 * Sanitises a `?redirect=` value before it is used to navigate.
 *
 * Only same-origin absolute paths are allowed. A protocol-relative value like
 * `//evil.example` is a valid URL that browsers resolve off-origin, so it is
 * rejected alongside anything carrying a scheme or a backslash.
 */
export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  if (value.includes('\\')) return null;
  return value;
}
