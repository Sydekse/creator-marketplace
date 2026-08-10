import type { UserRole } from '@/db/schema';

export interface NavLink {
  label: string;
  href: string;
}

const NAV_LINKS: Record<UserRole, NavLink[]> = {
  brand: [
    { label: 'Discover', href: '/discover' },
    { label: 'Campaigns', href: '/campaigns' },
    { label: 'Dashboard', href: '/brand' },
  ],
  creator: [
    // `/creator/deals`, not `/deals`. The route this points at is real as of
    // KAN-39, and it is the one the four email CTAs in
    // `lib/notifications/templates.tsx` already named — a nav item and an email
    // disagreeing about the same screen is how one of them stays broken.
    { label: 'My Deals', href: '/creator/deals' },
    { label: 'Dashboard', href: '/creator' },
  ],
  admin: [
    { label: 'Console', href: '/admin' },
    { label: 'Verification', href: '/admin/verification' },
    { label: 'Campaigns', href: '/admin/campaigns' },
    { label: 'Deals', href: '/admin/deals' },
    { label: 'Audit Log', href: '/admin/audit-log' },
  ],
};

export function getNavLinks(role: UserRole): NavLink[] {
  return NAV_LINKS[role];
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
