import { ForbiddenError, guard, toErrorResponse } from '@/lib/authz';
import {
  decideDeadline,
  DeadlineError,
  proposeDeadline,
} from '@/lib/deals/deadline-requests';
import {
  decideDeadlineSchema,
  proposeDeadlineSchema,
} from '@/lib/deals/deadline';
import { UUID_REGEX, fromZodError, validationError } from '@/lib/validation';

export const runtime = 'nodejs';

async function handle(request: Request, id: string, decision: boolean) {
  let actor;
  try {
    if (!UUID_REGEX.test(id)) throw new ForbiddenError('Invalid deal');
    const ctx = await guard({
      roles: ['brand', 'creator'],
      resource: { kind: 'deal', id },
    });
    if (ctx.user.role !== 'brand' && ctx.user.role !== 'creator')
      throw new ForbiddenError('Not a party');
    actor = { userId: ctx.user.id, role: ctx.user.role };
  } catch (error) {
    return toErrorResponse(error);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      validationError({ _root: ['Request body must be valid JSON.'] }),
      { status: 422 }
    );
  }
  try {
    if (decision) {
      const parsed = decideDeadlineSchema.safeParse(body);
      if (!parsed.success)
        return Response.json(fromZodError(parsed.error), { status: 422 });
      return Response.json(await decideDeadline(id, actor, parsed.data));
    }
    const parsed = proposeDeadlineSchema.safeParse(body);
    if (!parsed.success)
      return Response.json(fromZodError(parsed.error), { status: 422 });
    return Response.json(await proposeDeadline(id, actor, parsed.data), {
      status: 201,
    });
  } catch (error) {
    if (error instanceof DeadlineError)
      return Response.json(
        { error: { code: error.code, message: error.message } },
        {
          status:
            error.code === 'DEADLINE_FORBIDDEN'
              ? 403
              : error.code === 'DEADLINE_INVALID'
                ? 422
                : 409,
        }
      );
    throw error;
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(request, (await params).id, false);
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(request, (await params).id, true);
}
