import { createBrandProfile } from '@/lib/brands/create-profile';
import type { CreateBrandProfileDeps } from '@/lib/brands/create-profile';
import { guard, toErrorResponse } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  createBrandSchema,
  errorResponse,
  fromZodError,
  validationError,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * `POST /api/brands` — brand onboarding (KAN-27, FR-001, AC-1, AC-2).
 *
 * The mirror of `POST /api/creators`, including the ordering, which is the
 * contract rather than a style preference:
 *
 *   1. Authorize — before parsing, so an unauthorized caller cannot use
 *      validation responses to probe what the endpoint accepts.
 *   2. Parse and validate — trimming the company name happens here, so nothing
 *      downstream sees a padded value.
 *   3. Insert, and let the unique constraint decide the conflict.
 */
export async function handleCreateBrand(
  request: Request,
  deps?: CreateBrandProfileDeps
): Promise<Response> {
  let userId: string;
  try {
    // Role gate only — there is no row to own yet, and the row this creates is
    // owned by the session user by construction. `ctx.user.id` is the sole
    // source of the owner: a `userId` in the body would be an account-takeover
    // vector and is ignored (the schema does not declare the field).
    const ctx = await guard({ roles: ['brand'] });
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

  const parsed = createBrandSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await createBrandProfile(userId, parsed.data, deps);

  if (!result.ok) {
    // AC-2, "exactly one brand profile per user account". The only conflict this
    // table has. No `details` key: the failure is about the account, not about
    // anything the brand typed, so there is no input to attach it to.
    return Response.json(errorResponse(ErrorCode.PROFILE_EXISTS), {
      status: ErrorHttpStatus[ErrorCode.PROFILE_EXISTS],
    });
  }

  // snake_case body, matching the tech spec §4.2 response style.
  return Response.json(
    { id: result.profile.id, company_name: result.profile.companyName },
    { status: 201 }
  );
}

/**
 * The exported handler takes no second argument on purpose.
 *
 * Next passes the *route context* as the second parameter, so a dependency seam
 * in that position would be silently overwritten with a shape that has no
 * `insert` — working in tests and crashing in production. Tests call
 * `handleCreateBrand` directly instead.
 */
export async function POST(request: Request): Promise<Response> {
  return handleCreateBrand(request);
}
