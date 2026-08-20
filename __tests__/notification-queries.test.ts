import { describe, expect, it } from 'vitest';
import {
  listNotifications,
  unreadCount,
  markAsRead,
  markAllAsRead,
} from '../lib/notifications/queries';
import type { NotificationQueryDeps } from '../lib/notifications/queries';

/**
 * KAN-96 — the notification read path (AC-031, FR-008).
 *
 * These tests exercise the query functions via a fake db that returns
 * pre-seeded rows — the same seam pattern the audit-log tests use.
 */

function fakeDb(rows: unknown[], returnedRows: unknown[] = rows) {
  // Build a chainable query builder that captures the final call and
  // returns `returnedRows`. Every Drizzle query method is a no-op pass-through
  // that returns `this`, except the terminal methods (execute/select).
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
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
