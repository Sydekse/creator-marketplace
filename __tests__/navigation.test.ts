import { describe, expect, it } from 'vitest';
import { getNavLinks } from '../lib/navigation';

describe('getNavLinks', () => {
  it('returns brand links for brand role', () => {
    const links = getNavLinks('brand');
    expect(links.map((l) => l.label)).toEqual([
      'Discover',
      'Campaigns',
      'Dashboard',
    ]);
  });

  it('returns creator links for creator role', () => {
    const links = getNavLinks('creator');
    expect(links.map((l) => l.label)).toEqual(['My Deals', 'Dashboard']);
  });

  it('returns admin links for admin role', () => {
    const links = getNavLinks('admin');
    expect(links.map((l) => l.label)).toEqual([
      'Verification',
      'Campaigns',
      'Deals',
      'Audit Log',
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
});
