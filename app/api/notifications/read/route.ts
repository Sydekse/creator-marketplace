import { guard, toErrorResponse } from '@/lib/authz';
import { markAsRead, markAllAsRead } from '@/lib/notifications/queries';
import {
  ErrorCode,
  ErrorHttpStatus,
  errorResponse,
  notificationReadSchema,
} from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * `POST /api/notifications/read` — mark notifications as read (KAN-96).
 *
 * Body: `{ notificationId?: string }` — when present, marks that single
 * notification. When absent, marks all unread notifications for the user.
 *
 * The ownership check is inside `markAsRead`/`markAllAsRead` (both filter by
 * `user.id`), so a caller cannot mark another user's notifications.
 */
export async function POST(request: Request): Promise<Response> {
  let ctx;
  try {
    ctx = await guard({ roles: ['creator', 'brand', 'admin'] });
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      // Empty body or malformed JSON → mark all as read.
      body = {};
    }

    const parsed = notificationReadSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(errorResponse(ErrorCode.VALIDATION_ERROR), {
        status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
      });
    }

    const { notificationId } = parsed.data;

    if (notificationId) {
      const updated = await markAsRead(notificationId, ctx.user.id);
      return Response.json({ updated });
    }

    const count = await markAllAsRead(ctx.user.id);
    return Response.json({ updated: count > 0, count });
  } catch (error) {
    return Response.json(errorResponse(ErrorCode.INTERNAL_SERVER_ERROR), {
      status: ErrorHttpStatus[ErrorCode.INTERNAL_SERVER_ERROR],
    });
  }
}
