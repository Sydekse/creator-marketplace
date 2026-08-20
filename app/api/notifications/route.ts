import { guard, toErrorResponse } from '@/lib/authz';
import { listNotifications, unreadCount } from '@/lib/notifications/queries';
import { ErrorCode, ErrorHttpStatus, errorResponse } from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * `GET /api/notifications` — list the signed-in user's notifications (KAN-96).
 *
 * Scoped by `user.id`, not profile id, because a single user can be both a
 * creator and a brand. Newest first; unread first within the same timestamp.
 * Paginated with `?page=` (default 1).
 */
export async function GET(request: Request): Promise<Response> {
  let ctx;
  try {
    ctx = await guard({ roles: ['creator', 'brand', 'admin'] });
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const [notifications, unread] = await Promise.all([
      listNotifications(ctx.user.id, limit, offset),
      unreadCount(ctx.user.id),
    ]);

    return Response.json({
      notifications: notifications.rows,
      hasMore: notifications.hasMore,
      unreadCount: unread,
    });
  } catch {
    return Response.json(errorResponse(ErrorCode.INTERNAL_SERVER_ERROR), {
      status: ErrorHttpStatus[ErrorCode.INTERNAL_SERVER_ERROR],
    });
  }
}
