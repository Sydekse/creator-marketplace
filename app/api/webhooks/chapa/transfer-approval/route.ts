import { verifyChapaSignature } from '@/lib/chapa/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/webhooks/chapa/transfer-approval` (KAN-70 PR 3).
 *
 * Chapa transfers normally wait on a dashboard OTP; configuring this URL in
 * the dashboard replaces the OTP with a server call — Chapa POSTs the pending
 * transfer here and a 200 approves it. Anything else leaves it unapproved.
 *
 * The gate is the same HMAC scheme as the event webhook, but with its own
 * secret: Chapa's dashboard caps the approval secret at 25 characters, so it
 * cannot share the longer webhook secret. Verified over the raw bytes.
 * Approval is the *only* judgement made here: whether the transfer
 * should exist was decided when `requestWithdrawal` reserved the money in a
 * serializable transaction, and by construction we never send a transfer we
 * do not mean — so a correctly signed approval request is approved. Rejecting
 * on payload details would only re-implement half of Chapa's own validation
 * against an undocumented shape.
 */
export interface ApprovalRouteDeps {
  secret?: () => string | undefined;
  log?: Pick<Console, 'error' | 'info'>;
}

export async function handleTransferApproval(
  request: Request,
  deps: ApprovalRouteDeps = {}
): Promise<Response> {
  const secret = (
    deps.secret ?? (() => process.env.CHAPA_TRANSFER_APPROVAL_SECRET)
  )();
  const log = deps.log ?? console;

  if (!secret) {
    // Fails closed and loudly, like the event webhook: with no secret every
    // transfer stalls unapproved, which someone must hear about.
    log.error(
      '[chapa transfer-approval] CHAPA_TRANSFER_APPROVAL_SECRET is not configured; transfers cannot be approved'
    );
    return new Response(null, { status: 401 });
  }

  const rawBody = await request.text();
  const verified = verifyChapaSignature(
    rawBody,
    {
      chapaSignature: request.headers.get('chapa-signature'),
      xChapaSignature: request.headers.get('x-chapa-signature'),
    },
    secret
  );
  if (!verified) {
    return new Response(null, { status: 401 });
  }

  log.info(`[chapa transfer-approval] approved: ${rawBody}`);
  return Response.json({ approved: true }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  return handleTransferApproval(request);
}
