import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { notification, user } from '@/db/schema';
import { guard } from '@/lib/authz';
import { PAGE_SIZE } from '@/lib/paging';

/**
 * The read side of the notification system (KAN-96).
 *
 * Every function gates on the caller's session via `guard`. The gate runs
 * before any query, so an unauthenticated caller never reaches the database.
 *
 * Notifications are scoped by `user.id` (not profile id), because a single
 * user can be both a creator and a brand — and both roles should see the same
 * notification feed.
 */

export interface NotificationRow {
  id: string;
  type: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPage {
  rows: NotificationRow[];
  hasMore: boolean;
}

/**
 * Lists notifications for the signed-in user, newest first.
 *
 * The `(user_id, created_at)` index keeps this off the heap regardless of
 * table size — every row sorts by `created_at`, and the filter leads with
 * `user_id`.
 */
export async function listNotifications(
  userId: string,
  limit: number = PAGE_SIZE,
  offset: number = 0
): Promise<NotificationPage> {
  // One row past the page, to answer `hasMore` without a second COUNT.
  const rows = await db
    .select({
      id: notification.id,
      type: notification.type,
      payload: notification.payload,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    })
    .from(notification)
    .where(eq(notification.userId, userId))
    .orderBy(
      // Unread first, then newest — the most useful default order.
      // isNull returns true (1) when read_at is null, so unread rows sort first.
      isNull(notification.readAt),
      notification.createdAt
    )
    .limit(limit + 1)
    .offset(offset);

  return {
    rows: rows.slice(0, limit),
    hasMore: rows.length > limit,
  };
}

/**
 * Returns the unread count for the signed-in user.
 *
 * Used by the header bell — a lightweight count query that the index covers
 * entirely.
 */
export async function unreadCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: notification.id })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));

  return rows.length;
}

/**
 * Mark a single notification as read. Only succeeds if the notification
 * belongs to the caller (the WHERE clause enforces ownership).
 */
export async function markAsRead(
  notificationId: string,
  userId: string
): Promise<boolean> {
  const [updated] = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.id, notificationId),
        eq(notification.userId, userId),
        isNull(notification.readAt)
      )
    )
    .returning({ id: notification.id });

  return !!updated;
}

/**
 * Mark all unread notifications for the user as read in one shot.
 */
export async function markAllAsRead(userId: string): Promise<number> {
  const updated = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)))
    .returning({ id: notification.id });

  return updated.length;
}
