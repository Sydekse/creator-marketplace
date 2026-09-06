import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Header } from '@/components/layout/header';
import AwaitingTierPage from '@/app/(admin)/admin/tiers/page';
import SettingsPage from '@/app/settings/page';
import type { CurrentUser } from '@/lib/auth';
import type { AwaitingTierPage as AwaitingPage } from '@/lib/creators/awaiting-tier';
import type { FlaggedReviewPage } from '@/lib/creators/flagged-review';
import { PAGE_SIZE } from '@/lib/paging';

const mocks = vi.hoisted(() => ({
  unread: vi.fn(),
  brand: vi.fn(),
  cart: vi.fn(),
  awaiting: vi.fn(),
  flagged: vi.fn(),
  tiers: vi.fn(),
  suggest: vi.fn(),
  user: vi.fn(),
  live: vi.fn(),
  headers: vi.fn(),
  prefs: vi.fn(),
  select: vi.fn(),
  nav: vi.fn(() => null),
  bell: vi.fn(() => null),
  revokeSession: vi.fn(() => null),
}));
vi.mock('@/lib/notifications/queries', () => ({ unreadCount: mocks.unread }));
vi.mock('@/lib/brands/queries', () => ({
  getBrandProfileByUserId: mocks.brand,
}));
vi.mock('@/lib/campaigns/queries', () => ({ getActiveDraftCart: mocks.cart }));
vi.mock('@/lib/creators/awaiting-tier', () => ({
  readAwaitingTier: mocks.awaiting,
}));
vi.mock('@/lib/creators/flagged-review', () => ({
  readFlaggedForReview: mocks.flagged,
}));
vi.mock('@/lib/creators/tier-assignment', () => ({
  listTierCandidates: mocks.tiers,
  selectTier: mocks.suggest,
}));
vi.mock('@/lib/auth', () => ({
  requireUser: mocks.user,
  auth: { api: { getSession: mocks.live } },
}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@/lib/notifications/prefs', () => ({ readEmailPrefs: mocks.prefs }));
vi.mock('@/db', () => ({ db: { select: mocks.select } }));
vi.mock('@/lib/fonts', () => ({
  bdSans: { variable: '' },
  bdMono: { variable: '' },
}));
vi.mock('@/components/nav/main-nav', () => ({ MainNav: mocks.nav }));
vi.mock('@/components/nav/mobile-nav', () => ({ MobileNav: () => null }));
vi.mock('@/components/nav/user-menu', () => ({ UserMenu: () => null }));
vi.mock('@/components/layout/notification-bell', () => ({
  NotificationBell: mocks.bell,
}));
vi.mock('@/components/notifications/notification-toaster', () => ({
  NotificationToaster: () => null,
}));
vi.mock('@/components/admin/awaiting-tier-list', () => ({
  AwaitingTierList: () => null,
}));
vi.mock('@/components/admin/flagged-review-list', () => ({
  FlaggedReviewList: () => null,
}));
vi.mock('@/app/settings/name-form', () => ({ NameForm: () => null }));
vi.mock('@/app/settings/password-form', () => ({ PasswordForm: () => null }));
vi.mock('@/app/settings/pref-toggles', () => ({ PrefToggles: () => null }));
vi.mock('@/app/settings/session-actions', () => ({
  RevokeOthersButton: () => null,
  RevokeSessionButton: mocks.revokeSession,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const user: CurrentUser = {
  id: 'user-1',
  email: 'brand@example.test',
  name: 'Brand',
  role: 'brand',
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('header independent best-effort reads', () => {
  it('loads the brand cart while notifications are still pending', async () => {
    const count = deferred<number>();
    mocks.unread.mockReturnValue(count.promise);
    mocks.brand.mockResolvedValue({ id: 'brand-1' });
    mocks.cart.mockResolvedValue({ campaignId: 'campaign-1', itemCount: 3 });
    const pending = Header({ user });
    await vi.waitFor(() => expect(mocks.cart).toHaveBeenCalledWith('brand-1'));
    count.resolve(7);
    renderToStaticMarkup(await pending);
    expect(mocks.nav).toHaveBeenCalledWith(
      expect.objectContaining({
        cart: { href: '/campaigns/campaign-1', itemCount: 3 },
      }),
      undefined
    );
    expect(mocks.bell).toHaveBeenCalledWith({ unreadCount: 7 }, undefined);
  });

  it.each(['creator', 'admin'] as const)(
    'skips cart queries for %s',
    async (role) => {
      mocks.unread.mockResolvedValue(2);
      renderToStaticMarkup(await Header({ user: { ...user, role } }));
      expect(mocks.brand).not.toHaveBeenCalled();
      expect(mocks.cart).not.toHaveBeenCalled();
      expect(mocks.bell).toHaveBeenCalledWith({ unreadCount: 2 }, undefined);
    }
  );

  it('keeps cart success when notification counting fails', async () => {
    mocks.unread.mockRejectedValue(new Error('count failed'));
    mocks.brand.mockResolvedValue({ id: 'brand-1' });
    mocks.cart.mockResolvedValue({ campaignId: 'campaign-1', itemCount: 1 });
    renderToStaticMarkup(await Header({ user }));
    expect(mocks.bell).toHaveBeenCalledWith({ unreadCount: 0 }, undefined);
    expect(mocks.nav).toHaveBeenCalledWith(
      expect.objectContaining({
        cart: { href: '/campaigns/campaign-1', itemCount: 1 },
      }),
      undefined
    );
  });

  it('keeps notification success when cart loading fails', async () => {
    mocks.unread.mockResolvedValue(9);
    mocks.brand.mockResolvedValue({ id: 'brand-1' });
    mocks.cart.mockRejectedValue(new Error('cart failed'));
    renderToStaticMarkup(await Header({ user }));
    expect(mocks.bell).toHaveBeenCalledWith({ unreadCount: 9 }, undefined);
    expect(mocks.nav).toHaveBeenCalledWith(
      expect.objectContaining({ cart: undefined }),
      undefined
    );
  });

  it('does not request a cart without a brand profile', async () => {
    mocks.unread.mockResolvedValue(0);
    mocks.brand.mockResolvedValue(null);
    await Header({ user });
    expect(mocks.cart).not.toHaveBeenCalled();
  });
});

describe('tier queue dependency branches', () => {
  it('starts flagged suggestions before the awaiting queue completes', async () => {
    const awaiting = deferred<AwaitingPage>();
    const flagged = deferred<FlaggedReviewPage>();
    mocks.awaiting.mockReturnValue(awaiting.promise);
    mocks.flagged.mockReturnValue(flagged.promise);
    mocks.tiers.mockResolvedValue([]);
    const pending = AwaitingTierPage({
      searchParams: Promise.resolve({ page: '2' }),
    });
    await vi.waitFor(() => expect(mocks.flagged).toHaveBeenCalledOnce());
    expect(mocks.awaiting).toHaveBeenCalledWith({
      limit: PAGE_SIZE,
      offset: PAGE_SIZE,
    });
    expect(mocks.tiers).not.toHaveBeenCalled();
    flagged.resolve({
      creators: [
        {
          id: 'creator-1',
          tiktokHandle: 'creator',
          niche: 'Beauty',
          followerCount: 1000,
          engagementRate: '0.05',
          tierReviewAt: null,
          currentTier: null,
        },
      ],
      hasMore: false,
    });
    await vi.waitFor(() => expect(mocks.tiers).toHaveBeenCalledOnce());
    awaiting.resolve({ creators: [], hasMore: false });
    const html = renderToStaticMarkup(await pending);
    expect(html).toContain('Nothing on page 2');
    expect(html).toContain('Previous');
    expect(mocks.suggest).toHaveBeenCalledOnce();
  });

  it('skips tier candidates for an empty flagged queue', async () => {
    mocks.awaiting.mockResolvedValue({ creators: [], hasMore: false });
    mocks.flagged.mockResolvedValue({ creators: [], hasMore: false });
    await AwaitingTierPage({ searchParams: Promise.resolve({}) });
    expect(mocks.tiers).not.toHaveBeenCalled();
  });
});

describe('settings reads stay behind authorization', () => {
  it('uses the resolved raw token to protect the current device', async () => {
    mocks.user.mockResolvedValue(user);
    mocks.headers.mockResolvedValue(new Headers());
    mocks.live.mockResolvedValue({
      session: { token: 'current' },
      user: { emailVerified: true, createdAt: new Date('2025-01-01') },
    });
    mocks.prefs.mockResolvedValue({});
    mocks.select.mockImplementation((fields: Record<string, unknown>) => {
      const rows =
        'token' in fields
          ? ['current', 'other', 'expired'].map((token) => ({
              token,
              ipAddress: null,
              userAgent: null,
              updatedAt: new Date('2026-01-01'),
              expiresAt: new Date(
                token === 'expired' ? '2020-01-01' : '2100-01-01'
              ),
            }))
          : [];
      const query = {
        from: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        then: (
          resolve: (rows: object[]) => unknown,
          reject: (e: unknown) => unknown
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return query;
    });
    const html = renderToStaticMarkup(await SettingsPage());
    expect(html).toContain('This device');
    expect(html).toContain('Verified');
    expect(mocks.revokeSession).toHaveBeenCalledExactlyOnceWith(
      { token: 'other' },
      undefined
    );
  });

  it.each(['brand', 'creator', 'admin'] as const)(
    'starts independent %s data while raw session is pending',
    async (role) => {
      const authorized = deferred<CurrentUser>();
      const live = deferred<null>();
      const started: string[] = [];
      mocks.user.mockReturnValue(authorized.promise);
      mocks.headers.mockResolvedValue(new Headers());
      mocks.live.mockReturnValue(live.promise);
      mocks.prefs.mockResolvedValue({});
      mocks.select.mockImplementation((fields: Record<string, unknown>) => {
        const key = Object.keys(fields)[0];
        const query = {
          from: () => query,
          where: () => query,
          orderBy: () => query,
          limit: () => query,
          then: (
            resolve: (rows: object[]) => unknown,
            reject: (error: unknown) => unknown
          ) => {
            started.push(key);
            return Promise.resolve([]).then(resolve, reject);
          },
        };
        return query;
      });
      const pending = SettingsPage();
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.live).not.toHaveBeenCalled();
      expect(mocks.headers).not.toHaveBeenCalled();
      authorized.resolve({ ...user, role });
      await vi.waitFor(() => {
        expect(mocks.live).toHaveBeenCalledOnce();
        expect(started).toContain('token');
        expect(started).toContain('providerId');
      });
      expect(mocks.prefs).toHaveBeenCalledWith(user.id);
      expect(started).toHaveLength(role === 'admin' ? 2 : 3);
      if (role === 'brand') expect(started).toContain('companyName');
      if (role === 'creator') expect(started).toContain('tiktokHandle');
      live.resolve(null);
      expect(renderToStaticMarkup(await pending)).toContain('Settings');
    }
  );

  it('does not read data for an unauthorized request', async () => {
    mocks.user.mockRejectedValue(new Error('Unauthorized'));
    await expect(SettingsPage()).rejects.toThrow('Unauthorized');
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.live).not.toHaveBeenCalled();
    expect(mocks.prefs).not.toHaveBeenCalled();
  });
});
