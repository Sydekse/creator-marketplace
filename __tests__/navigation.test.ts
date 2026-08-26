import { describe, expect, it } from 'vitest';
import { getNavLinks, roleHomePath } from '../lib/navigation';

describe('getNavLinks', () => {
  it('returns brand links for brand role', () => {
    const links = getNavLinks('brand');
    expect(links.map((l) => l.label)).toEqual([
      'Dashboard',
      'Campaigns',
      'Discover',
      'Deals',
      // The cart is a nav element for brands; its href is a placeholder that
      // MainNav/MobileNav resolve to the active draft's cart.
      'Cart',
    ]);
  });

  it('returns creator links for creator role', () => {
    const links = getNavLinks('creator');
    expect(links.map((l) => l.label)).toEqual(['Dashboard', 'Deals']);
  });

  it('returns admin links for admin role', () => {
    const links = getNavLinks('admin');
    expect(links.map((l) => l.label)).toEqual([
      'Overview',
      'Verification',
      'Tiers',
      'Campaigns',
      'Disputes',
      'Audit log',
    ]);
  });

  it('every link has a non-empty href', () => {
    for (const role of ['brand', 'creator', 'admin'] as const) {
      for (const link of getNavLinks(role)) {
        expect(link.href).toBeTruthy();
        expect(link.href.startsWith('/')).toBe(true);
      }
    }
  });

  // Every role signs in to its own landing page, so every role needs a way back
  // to it once it navigates away.
  it('gives every role a link to its own home', () => {
    for (const role of ['brand', 'creator', 'admin'] as const) {
      const hrefs = getNavLinks(role).map((l) => l.href);
      expect(hrefs).toContain(roleHomePath(role));
    }
  });
});
