import type { UserRole } from '@/db/schema';

export interface NavLink {
  label: string;
  href: string;
}

const NAV_LINKS: Record<UserRole, NavLink[]> = {
  brand: [
    { label: 'Discover', href: '/discover' },
    { label: 'Campaigns', href: '/campaigns' },
    { label: 'Dashboard', href: '/dashboard' },
  ],
  creator: [
    { label: 'My Deals', href: '/deals' },
    { label: 'Dashboard', href: '/dashboard' },
  ],
  admin: [
    { label: 'Verification', href: '/admin/verification' },
    { label: 'Campaigns', href: '/admin/campaigns' },
    { label: 'Deals', href: '/admin/deals' },
    { label: 'Audit Log', href: '/admin/audit-log' },
  ],
};

export function getNavLinks(role: UserRole): NavLink[] {
  return NAV_LINKS[role];
}
