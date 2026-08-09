import { updateBrandProfile } from '@/lib/brands/update-profile';
import type { UpdateBrandProfileDeps } from '@/lib/brands/update-profile';
import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import {
  ErrorCode,
  ErrorHttpStatus,
  errorResponse,
  fromZodError,
  updateBrandSchema,
  validationError,
  UUID_REGEX,
} from '@/lib/validation';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * `PATCH /api/brands/{id}` — rename a brand profile (KAN-27 AC-5).
 *
 * Two layers, both of them server-side (invariant 2, NFR-005): the role gate,
 * then the ownership check against `brand_profile.user_id`. Unlike the create
 * endpoint there is a row here to own, so the ownership half is a real query
 * rather than true by construction — `guard()` resolves it through
 * `loadOwnerRefs('brandProfile', id)`.
 *
 * The id is taken as a parameter rather than read from a route context object,
 * so the dependency seam cannot collide with what Next passes to `PATCH`.
 */
export async function handleUpdateBrand(
  request: Request,
  id: string,
  deps?: UpdateBrandProfileDeps
): Promise<Response> {
  let userId: string;
  try {
    // A malformed id denies exactly like a well-formed id belonging to someone
    // else. Distinguishing them would make this endpoint an existence oracle
    // for ids the caller has no right to (Tech Spec §6.3), and the guard
    // already collapses "no such row" into the same 403.
    if (!UUID_REGEX.test(id)) {
      throw new ForbiddenError('malformed id');
    }

    const ctx = await guard({
      roles: ['brand'],
      resource: { kind: 'brandProfile', id },
    });
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

  const parsed = updateBrandSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const result = await updateBrandProfile(id, userId, parsed.data, deps);

  if (!result.ok) {
    // The guard saw the row and this did not, so it was deleted in between.
    // Reported as a denial rather than a 404, so the two paths stay
    // indistinguishable from outside.
    return Response.json(errorResponse(ErrorCode.FORBIDDEN), {
      status: ErrorHttpStatus[ErrorCode.FORBIDDEN],
    });
  }

  return Response.json(
    { id: result.profile.id, company_name: result.profile.companyName },
    { status: 200 }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  return handleUpdateBrand(request, id);
}
