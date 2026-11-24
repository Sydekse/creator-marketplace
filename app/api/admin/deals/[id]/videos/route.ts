import { guard, toErrorResponse } from '@/lib/authz';
import { readVideoEvidence } from '@/lib/deliverables/read-history';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await guard({ roles: ['admin'] });
    const { id } = await params;
    return Response.json(await readVideoEvidence(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
