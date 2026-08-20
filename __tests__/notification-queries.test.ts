import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  listNotifications,
  unreadCount,
  markAsRead,
  markAllAsRead,
} from '../lib/notifications/queries';
import type { NotificationQueryDeps } from '../lib/notifications/queries';
import { deepLink } from '../lib/notifications/deep-link';
import { VIEW_DETAILS_LABEL } from '../app/notifications/view-details-link';
import { NOTIFICATION_TYPES } from '../lib/notifications';
import type { UserRole } from '../db/schema';

/**
 * KAN-96 — the notification read path (AC-031, FR-008).
 *
 * These tests exercise the query functions via a fake db that returns
 * pre-seeded rows — the same seam pattern the audit-log tests use.
 *
 * KAN-200 adds the two halves of "the feed is usable": the order rows come back
 * in, and where a row's link goes. Both were wrong in a way no existing test
 * could see, because neither the ordering terms nor the link target was ever
 * asserted.
 */

/** Every clause the fake was handed, so a test can read the real SQL back. */
interface Captured {
  orderBy: unknown[];
}

function fakeDb(
  rows: unknown[],
  returnedRows: unknown[] = rows,
  captured: Captured = { orderBy: [] }
) {
  // Build a chainable query builder that captures the final call and
  // returns `returnedRows`. Every Drizzle query method is a no-op pass-through
  // that returns `this`, except the terminal methods (execute/select).
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: (...terms: unknown[]) => {
      captured.orderBy = terms;
      return chain;
    },
    limit: () => chain,
    offset: () => chain,
    set: () => chain,
    returning: () => Promise.resolve(returnedRows),
    // The terminal that Drizzle calls internally:
    then: (resolve: (value: unknown) => unknown) => resolve(returnedRows),
  };

  return {
    db: {
      select: () => chain,
      update: () => chain,
    } as unknown as NotificationQueryDeps['db'],
  };
}

describe('listNotifications', () => {
  it('returns rows and hasMore=false when result fits in limit', async () => {
    const rows = [
      {
        id: '1',
        type: 'offer_received',
        payload: {},
        readAt: null,
        createdAt: new Date(),
      },
      {
        id: '2',
        type: 'campaign_funded',
        payload: {},
        readAt: new Date(),
        createdAt: new Date(),
      },
    ];
    const deps = fakeDb(rows, rows);

    const result = await listNotifications('user-1', 50, 0, deps);

    expect(result.rows).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.rows[0].id).toBe('1');
  });

  it('sets hasMore=true when rows exceed limit', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: String(i),
      type: 'offer_received',
      payload: {},
      readAt: null,
      createdAt: new Date(),
    }));
    const deps = fakeDb(rows, rows);

    const result = await listNotifications('user-1', 50, 0, deps);

    expect(result.rows).toHaveLength(50);
    expect(result.hasMore).toBe(true);
  });

  it('truncates to limit even when extra row present', async () => {
    const rows = [
      { id: '1', type: 'a', payload: {}, readAt: null, createdAt: new Date() },
      { id: '2', type: 'b', payload: {}, readAt: null, createdAt: new Date() },
    ];
    const deps = fakeDb(rows, rows);

    const result = await listNotifications('user-1', 1, 0, deps);

    expect(result.rows).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it('returns empty when no rows exist', async () => {
    const deps = fakeDb([], []);

    const result = await listNotifications('user-1', 50, 0, deps);

    expect(result.rows).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });
});

describe('unreadCount', () => {
  it('returns 0 when no unread notifications', async () => {
    const deps = fakeDb([], []);

    const count = await unreadCount('user-1', deps);

    expect(count).toBe(0);
  });

  it('returns the count of unread notifications', async () => {
    const rows = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const deps = fakeDb(rows, rows);

    const count = await unreadCount('user-1', deps);

    expect(count).toBe(3);
  });
});

describe('markAsRead', () => {
  it('returns true when a row was updated', async () => {
    const deps = fakeDb([], [{ id: 'n1' }]);

    const result = await markAsRead('n1', 'user-1', deps);

    expect(result).toBe(true);
  });

  it('returns false when no row matched (wrong user or already read)', async () => {
    const deps = fakeDb([], []);

    const result = await markAsRead('n1', 'user-1', deps);

    expect(result).toBe(false);
  });
});

describe('markAllAsRead', () => {
  it('returns the count of updated rows', async () => {
    const deps = fakeDb([], [{ id: '1' }, { id: '2' }]);

    const count = await markAllAsRead('user-1', deps);

    expect(count).toBe(2);
  });

  it('returns 0 when nothing to mark', async () => {
    const deps = fakeDb([], []);

    const count = await markAllAsRead('user-1', deps);

    expect(count).toBe(0);
  });
});

// -- KAN-200: newest first, and only that ------------------------------------

/**
 * The order is asserted on the **rendered SQL of the terms the builder was
 * handed**, not on "orderBy was called". A mock that only records the call
 * passes identically when the direction is ascending or the column is the wrong
 * one, which are exactly the two ways this went wrong.
 */
describe('listNotifications orders the feed newest first', () => {
  const dialect = new PgDialect();
  const terms = () => {
    const captured: Captured = { orderBy: [] };
    return listNotifications('user-1', 50, 0, fakeDb([], [], captured)).then(
      () => captured.orderBy.map((t) => dialect.sqlToQuery(t as SQL).sql)
    );
  };

  it('sorts by created_at descending', async () => {
    const rendered = await terms();

    expect(rendered.join(' ')).toMatch(/"created_at"\s+desc/i);
    expect(rendered.join(' ')).not.toMatch(/"created_at"\s+asc/i);
  });

  it('sorts by nothing else', async () => {
    // The bug was a *leading* `isNull(read_at)` term, which sorts `false` before
    // `true` in Postgres and therefore put every **read** row above the unread
    // ones — the exact inverse of the docstring's claim. Removing it rather than
    // flipping it is the deliberate choice: unread rows are already a tinted
    // card, a teal chip and a "New" marker, and a feed whose first item is not
    // its most recent event is the harder thing to read.
    const rendered = await terms();

    expect(rendered).toHaveLength(1);
    expect(rendered.join(' ')).not.toMatch(/read_at/i);
    expect(rendered.join(' ')).not.toMatch(/is null/i);
  });
});

// -- KAN-200: where a notification takes the person who received it ----------

/**
 * `deepLink` used to live in `app/notifications/page.tsx` and hard-coded
 * `/creator/...` for all eleven types, four of which only ever reach a brand. A
 * brand clicking "View details" on "Offer accepted" was bounced by the role gate
 * — and with the mark-read now riding on that click, the row would have been
 * marked read on the way to a 403.
 *
 * Exhaustive over `NOTIFICATION_TYPES` × the three roles, because the failure was
 * not one wrong branch but a whole role having no branches at all.
 */
describe('deepLink routes by the recipient role', () => {
  const ROLES: UserRole[] = ['brand', 'creator', 'admin'];
  const DEAL_ID = 'd1';
  const CAMPAIGN_ID = 'ca1';

  /** A payload carrying both ids, so no case can pass for want of one. */
  const full = { dealId: DEAL_ID, campaignId: CAMPAIGN_ID };

  it.each(ROLES)('never sends a %s to another role area', (role) => {
    const foreign: Record<UserRole, RegExp> = {
      // A brand's routes: `/brand`, `/campaigns`, `/deals/{id}` — never the
      // creator's or the admin's.
      brand: /^\/(creator|admin)\b/,
      creator: /^\/(brand|admin|campaigns|deals)\b/,
      admin: /^\/(brand|creator|campaigns|deals)\b/,
    };

    for (const type of NOTIFICATION_TYPES) {
      expect(deepLink(type, full, role), `${type} → ${role}`).not.toMatch(
        foreign[role]
      );
    }
  });

  it.each(ROLES)('always returns an absolute in-app path for a %s', (role) => {
    for (const type of NOTIFICATION_TYPES) {
      const href = deepLink(type, full, role);
      expect(href.startsWith('/'), `${type} → ${role}`).toBe(true);
      // The two shapes a missing id leaks into a URL.
      expect(href).not.toContain('undefined');
      expect(href).not.toMatch(/\/$/);
    }
  });

  it('sends a brand to the brand deal screen KAN-68 built', () => {
    // These four are the ones that were broken: they only ever reach a brand,
    // and they resolved to a creator route.
    for (const type of [
      'deliverable_submitted',
      'offer_accepted',
      'offer_declined',
      'offer_expired',
    ]) {
      expect(deepLink(type, full, 'brand')).toBe(`/deals/${DEAL_ID}`);
    }
  });

  it('sends a creator to their own deal screen', () => {
    for (const type of [
      'offer_received',
      'revision_requested',
      'deliverable_approved',
      'metric_reminder',
    ]) {
      expect(deepLink(type, full, 'creator')).toBe(`/creator/deals/${DEAL_ID}`);
    }
  });

  it('routes the one type both parties receive to each their own screen', () => {
    // `dispute_resolved` reaches both sides of the same deal. Notifications are
    // scoped by `user.id`, not by profile, so the recipient's role is the only
    // thing that can decide the route.
    expect(deepLink('dispute_resolved', full, 'brand')).toBe(
      `/deals/${DEAL_ID}`
    );
    expect(deepLink('dispute_resolved', full, 'creator')).toBe(
      `/creator/deals/${DEAL_ID}`
    );
  });

  it('links the campaign itself for the one type whose subject is a campaign', () => {
    expect(
      deepLink('campaign_funded', { campaignId: CAMPAIGN_ID }, 'brand')
    ).toBe(`/campaigns/${CAMPAIGN_ID}`);
    // A creator has no campaign screen, so they get the deal list — where the
    // now-funded deal shows a deliver control.
    expect(
      deepLink('campaign_funded', { campaignId: CAMPAIGN_ID }, 'creator')
    ).toBe('/creator/deals');
  });

  it('falls back to a list rather than building /deals/undefined', () => {
    // Rows written before the payload carried an id, and rows whose id is not a
    // string. A 404 is worse than a degraded link: the same reasoning the
    // `offer_expired` email fallback already follows.
    for (const payload of [
      {},
      { dealId: null },
      { dealId: 42 },
      { dealId: '' },
    ]) {
      expect(deepLink('revision_requested', payload, 'creator')).toBe(
        '/creator/deals'
      );
      expect(deepLink('revision_requested', payload, 'brand')).toBe(
        '/campaigns'
      );
    }
  });

  it('sends a verification result to the recipient dashboard', () => {
    expect(deepLink('verification_result', {}, 'creator')).toBe('/creator');
  });

  it('sends an admin to /admin, not into a 404ing admin route', () => {
    // Admins are not a party to a deal, and three admin nav links still 404
    // (F26) — a deep link into one of those would be the same broken promise
    // this function exists to stop making.
    for (const type of NOTIFICATION_TYPES) {
      expect(deepLink(type, full, 'admin')).toBe('/admin');
    }
  });

  it('takes the role from the caller, never from the payload', () => {
    // The role comes from `requireUser()`. A payload-derived role would be a
    // value the notifying code chose, which is how a link ends up pointing at a
    // screen its holder cannot open.
    const spoofed = { ...full, role: 'brand' };
    expect(deepLink('offer_received', spoofed, 'creator')).toBe(
      `/creator/deals/${DEAL_ID}`
    );
  });

  it('does not import the database, so it can be read in a client bundle', () => {
    const source = readFileSync(
      join(__dirname, '..', 'lib/notifications/deep-link.ts'),
      'utf8'
    );
    expect(source).toContain('export function deepLink');
    expect(source).not.toMatch(/from '@\/db'/);
    expect(source).not.toMatch(/drizzle-orm/);
  });
});

// -- KAN-200: opening a notification is reading it ---------------------------

describe('View details marks the notification read', () => {
  const src = (path: string) =>
    readFileSync(join(__dirname, '..', path), 'utf8')
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  const LINK = src('app/notifications/view-details-link.tsx');
  const PAGE = src('app/notifications/page.tsx');

  it('read the files it asserts on', () => {
    expect(LINK).toContain('export function ViewDetailsLink');
    expect(PAGE).toContain('export default async function NotificationsPage');
  });

  it('is the link the page renders, not a second copy of it', () => {
    expect(PAGE).toContain(
      '<ViewDetailsLink notificationId={row.id} href={href} />'
    );
    expect(PAGE).toContain("from './view-details-link'");
    // The plain `<Link>` it replaced said the label inline. One label, one place.
    expect(PAGE).not.toContain(VIEW_DETAILS_LABEL);
  });

  it('posts to the existing read endpoint on click', () => {
    expect(LINK).toContain("fetch('/api/notifications/read'");
    expect(LINK).toContain("method: 'POST'");
    expect(LINK).toContain('onClick={markRead}');
  });

  it('is still a real link', () => {
    // Middle-click, ⌘-click and "open in new tab" have to keep working, and a
    // `<button>` calling `router.push` breaks all three. `onClick` fires
    // alongside the navigation, not instead of it.
    expect(LINK).toContain('<Link');
    expect(LINK).toContain('href={href}');
    expect(LINK).not.toMatch(/preventDefault|router\.push/);
  });

  it('keeps the request alive across the navigation', () => {
    // The load-bearing line. A normal `fetch` from a page that is unloading is
    // cancelled, so the row would stay unread *intermittently* — the worst
    // version of this bug, because it looks fixed.
    expect(LINK).toContain('keepalive: true');
  });

  it('does not block or interrupt the navigation it rides on', () => {
    // The mark-read is a side effect of reading, not the user's request. A toast
    // about it would interrupt a navigation already committed to, and an `await`
    // would delay it.
    expect(LINK).not.toMatch(/await fetch|toast/);
    expect(LINK).toMatch(/\.catch\(/);
  });

  it('keeps Mark read for a row the user clears without opening', () => {
    expect(PAGE).toContain('<MarkReadButton notificationId={row.id} />');
    expect(PAGE).toContain('{isUnread && <MarkReadButton');
  });

  it('builds every link from the session role', () => {
    // Not from the payload, and not defaulted: the page threads `user.role` from
    // `requireUser()` into each row.
    expect(PAGE).toContain('deepLink(row.type, payload, role)');
    expect(PAGE).toContain('role={user.role}');
    expect(PAGE).toContain("from '@/lib/notifications/deep-link'");
    // No local copy left behind to drift from the shared one.
    expect(PAGE).not.toMatch(/function deepLink/);
  });

  it('shows no ticket number to a user', () => {
    expect(VIEW_DETAILS_LABEL).not.toMatch(/KAN-\d+/);
  });
});
