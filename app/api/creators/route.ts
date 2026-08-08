import { createCreatorProfile } from '@/lib/creators/create-profile';
import type { CreateProfileDeps } from '@/lib/creators/create-profile';
import {
  DISCOVERY_PARAM_ALIASES,
  readDiscovery,
} from '@/lib/creators/discovery';
import type { DiscoveryDeps, DiscoveryPage } from '@/lib/creators/discovery';
import { guard, toErrorResponse } from '@/lib/authz';
import { conflictDetails, readParams } from '@/lib/query-params';
import {
  ErrorCode,
  ErrorHttpStatus,
  ErrorMessage,
  createCreatorSchema,
  discoverCreatorsSchema,
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

// -- Discovery --------------------------------------------------------------

/** snake_case out, matching the response style in tech spec §4.2. */
function serializeDiscovery(page: DiscoveryPage) {
  return {
    creators: page.creators.map((row) => ({
      id: row.id,
      tiktok_handle: row.tiktokHandle,
      niche: row.niche,
      follower_count: row.followerCount,
      engagement_rate: row.engagementRate,
      audience: row.audience,
      tier: {
        id: row.tierId,
        name: row.tierName,
        price_per_video: row.pricePerVideo,
      },
    })),
    has_more: page.hasMore,
  };
}

/**
 * `GET /api/creators` — brand-facing discovery (US-004, AC-010, AC-011).
 *
 * Same order of operations the POST above sets out: authorize, then normalise,
 * then parse, then query. The brand check runs twice and both are load-bearing —
 * here before parsing, so a caller with no right to be here cannot use
 * validation responses to map what the endpoint accepts; and again inside
 * `readDiscovery`, which is what makes the *query* safe rather than this one
 * route, since the `/discover` page calls it directly.
 *
 * A creator, an admin and an anonymous caller all get 403 FORBIDDEN. The AC asks
 * for 403 on anonymous where tech spec §4.2 says 401, and the AC wins: it is
 * also what `guard` already does everywhere else, failing closed without
 * distinguishing "no session" from "wrong role", which is what keeps this
 * endpoint from being an existence oracle.
 *
 * Note there is no `verified` or `tier` parameter to be found here. The bookable
 * rule is not a filter a caller can supply or omit — `buildDiscoveryWhere` seeds
 * it before reading anything below (AC-006).
 */
export async function handleDiscoverCreators(
  request: Request,
  deps?: DiscoveryDeps
): Promise<Response> {
  try {
    // Same seam the query uses, so a test that injects one brand injects both.
    await (deps?.requireBrand ?? (() => guard({ roles: ['brand'] })))();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { params, conflicts } = readParams(
    new URL(request.url).searchParams,
    DISCOVERY_PARAM_ALIASES
  );
  if (conflicts.length > 0) {
    return Response.json(validationError(conflictDetails(conflicts)), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  const parsed = discoverCreatorsSchema.safeParse(params);
  if (!parsed.success) {
    return Response.json(fromZodError(parsed.error), {
      status: ErrorHttpStatus[ErrorCode.VALIDATION_ERROR],
    });
  }

  try {
    const page = await readDiscovery(parsed.data, deps);
    return Response.json(serializeDiscovery(page));
  } catch (error) {
    // Re-throws anything that is not a denial, so a database outage is not
    // reported as a permission problem.
    return toErrorResponse(error);
  }
}

/** Second argument omitted for the same reason as POST — see above. */
export async function GET(request: Request): Promise<Response> {
  return handleDiscoverCreators(request);
}
