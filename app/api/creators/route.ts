import { createCreatorProfile } from '@/lib/creators/create-profile';
import type { CreateProfileDeps } from '@/lib/creators/create-profile';
import { guard, toErrorResponse } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  ErrorMessage,
  createCreatorSchema,
  errorResponse,
  fromZodError,
  validationError,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * `POST /api/creators` — creator onboarding (US-001, AC-001, AC-003).
 *
 * A thin adapter over `createCreatorProfile`. The order of the steps is the
 * contract, not a style preference:
 *
 *   1. Authorize — before parsing, so an unauthorized caller cannot use
 *      validation responses to probe what the endpoint accepts.
 *   2. Parse and validate — the transform inside `createCreatorSchema` is what
 *      canonicalises the handle, so nothing downstream sees a raw value.
 *   3. Insert, and let the unique constraints decide the conflicts.
 *
 * Every failure returns the standard envelope from `lib/validation/errors.ts`
 * so the form can map `details` to inline field errors without parsing prose.
 */
export async function handleCreateCreator(
  request: Request,
  deps?: CreateProfileDeps
): Promise<Response> {
  let userId: string;
  try {
    // Role gate only — there is no row to own yet, and the row this creates is
    // owned by the session user by construction. `ctx.user.id` is the sole
    // source of the owner: a `userId` in the body would be an account-takeover
    // vector and is ignored (the schema does not even declare the field).
    const ctx = await guard({ roles: ['creator'] });
    userId = ctx.user.id;
  } catch (error) {
    return toErrorResponse(error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      validationError({ _root: ['Request body must be valid JSON.'] }),
      { status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR] }
    );
  }

  const parsed = createCreatorSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await createCreatorProfile(userId, parsed.data, deps);

  if (!result.ok) {
    // AC-003's exact user-facing string comes from `ErrorMessage`, so it cannot
    // drift from the acceptance criterion by being retyped here.
    const code =
      result.conflict === 'handle'
        ? ErrorCode.TIKTOK_HANDLE_TAKEN
        : ErrorCode.PROFILE_EXISTS;

    // Keyed by field so the form can attach the message to the handle input
    // rather than only showing a page-level banner. The profile conflict has no
    // field to attach to — it is about the account, not about what was typed.
    const details =
      result.conflict === 'handle'
        ? { tiktokHandle: [ErrorMessage[code]] }
        : undefined;

    return Response.json(errorResponse(code, details), {
      status: ErrorHttpStatus[code],
    });
  }

  // snake_case body, matching the tech spec §4.2 example response. The status
  // is echoed rather than hardcoded so the client shows what the database
  // actually stored.
  return Response.json(
    {
      id: result.profile.id,
      status: result.profile.status,
      tiktok_handle: result.profile.tiktokHandle,
    },
    { status: 201 }
  );
}

/**
 * The exported handler takes no second argument on purpose.
 *
 * Next passes the *route context* (`{ params }`) as the second parameter, so a
 * dependency seam in that position would be silently overwritten with a shape
 * that has no `insert` — working in tests and crashing in production. Tests
 * call `handleCreateCreator` directly instead.
 */
export async function POST(request: Request): Promise<Response> {
  return handleCreateCreator(request);
}
