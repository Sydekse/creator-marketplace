import { guard, toErrorResponse } from '@/lib/authz';
import {
  EMAIL_PREF_KEYS,
  readEmailPrefs,
  updateEmailPref,
} from '@/lib/notifications/prefs';
import type { EmailPrefKey } from '@/lib/notifications/prefs';
import { ErrorCode, ErrorHttpStatus, errorResponse } from '@/lib/validation';

export const runtime = 'nodejs';

/**
 * `PATCH /api/settings/notifications` — flip one email category on or off.
 *
 * Body: `{ key: EmailPrefKey, enabled: boolean }`. Scoped to the session's
 * own user id — there is nothing here a caller could aim at anyone else.
 */
export async function PATCH(request: Request): Promise<Response> {
  let ctx;
  try {
    ctx = await guard({ roles: ['creator', 'brand', 'admin'] });
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    let body: { key?: unknown; enabled?: unknown };
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const key = body.key;
    if (
      typeof key !== 'string' ||
      !EMAIL_PREF_KEYS.includes(key as EmailPrefKey) ||
      typeof body.enabled !== 'boolean'
    ) {
      return Response.json(errorResponse(ErrorCode.VALIDATION_ERROR), {
        status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
      });
    }

    await updateEmailPref(ctx.user.id, key as EmailPrefKey, body.enabled);
    return Response.json({ prefs: await readEmailPrefs(ctx.user.id) });
  } catch {
    return Response.json(errorResponse(ErrorCode.INTERNAL_SERVER_ERROR), {
      status: ErrorHttpStatus[ErrorCode.INTERNAL_SERVER_ERROR],
    });
  }
}
