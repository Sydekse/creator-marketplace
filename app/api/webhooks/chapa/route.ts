import { parseChapaEvent, verifyChapaSignature } from '@/lib/chapa/webhook';
import { settleFundingSession } from '@/lib/campaigns/settle-funding';
import type { SettleFundingResult } from '@/lib/campaigns/settle-funding';
import { settleWithdrawal } from '@/lib/wallet/settle-withdrawal';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `POST /api/webhooks/chapa` — Chapa's delivery of payment events (KAN-70).
 *
 * The contract with Chapa's retry machinery decides every status code here:
 * anything but a 200 is redelivered every 10 minutes for up to 72 hours, so
 *
 *   - a request that fails **signature** verification answers 401 with no
 *     side effects — it is not Chapa's, and if somehow it is, redelivery is
 *     exactly right until the dashboard secret and ours agree;
 *   - a payload we verified but do not **recognise** answers 200 — replaying
 *     an event we will never act on would retry for three days for nothing;
 *   - a recognised event whose settlement is **not final yet** (`pending` —
 *     charge unconfirmed or Chapa's verify endpoint unreachable) answers 503
 *     on purpose, borrowing those retries as our redelivery queue;
 *   - everything final (`consumed`, `already_consumed`, `failed`) answers
 *     200, because redelivering cannot change a terminal state.
 *
 * No value is given from the payload itself — `settleFundingSession`
 * re-verifies via the API before any money is credited, so a forged-but-
 * signed body could at most make us look up our own session. Payout and
 * refund events (PR 3/4) are logged in full for now: their shapes are thinly
 * documented and the capture is how we pin them before wiring those legs.
 */

export interface WebhookRouteDeps {
  settle?: typeof settleFundingSession;
  settlePayout?: typeof settleWithdrawal;
  secret?: () => string | undefined;
  log?: Pick<Console, 'error' | 'info' | 'warn'>;
}

export async function handleChapaWebhook(
  request: Request,
  deps: WebhookRouteDeps = {}
): Promise<Response> {
  const settle = deps.settle ?? settleFundingSession;
  const settlePayout = deps.settlePayout ?? settleWithdrawal;
  const secret = (deps.secret ?? (() => process.env.CHAPA_WEBHOOK_SECRET))();
  const log = deps.log ?? console;

  if (!secret) {
    // Fails closed, like the cron route, and just as loudly: with no secret
    // every event Chapa sends is being turned away.
    log.error(
      '[chapa webhook] CHAPA_WEBHOOK_SECRET is not configured; rejecting all deliveries'
    );
    return new Response(null, { status: 401 });
  }

  // The raw body, exactly as sent — the HMAC is over these bytes, and parsing
  // first would verify our re-serialisation instead of their message.
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

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Correctly signed non-JSON: acknowledged so it is not redelivered, and
    // logged because it should not exist.
    log.warn('[chapa webhook] signed but unparseable payload', { rawBody });
    return new Response(null, { status: 200 });
  }

  const event = parseChapaEvent(payload);

  if (event.kind === 'transaction' && event.txRef?.startsWith('cmfund_')) {
    const result: SettleFundingResult = await settle(event.txRef);
    log.info(
      `[chapa webhook] funding event ${event.name ?? '(no name)'} tx_ref=${event.txRef} -> ${result.outcome}`
    );
    if (result.outcome === 'pending') {
      // Not final: lean on Chapa's redelivery to try again later.
      return new Response(null, { status: 503 });
    }
    return Response.json({ outcome: result.outcome }, { status: 200 });
  }

  // The payout leg (PR 3). Any signed event carrying one of our withdrawal
  // references settles it — the discriminator is the tx_ref rather than the
  // event name, because transfer webhook shapes vary and the settlement
  // re-verifies via the API anyway. Always 200, unlike the funding leg's
  // 503-on-pending: "still queued" is a normal life stage for a transfer,
  // and the hourly sweep is the retry mechanism, not Chapa's redelivery.
  if (event.txRef?.startsWith('cmwd_')) {
    const result = await settlePayout(event.txRef);
    log.info(
      `[chapa webhook] payout event ${event.name ?? '(no name)'} tx_ref=${event.txRef} -> ${result.outcome}`
    );
    return Response.json({ outcome: result.outcome }, { status: 200 });
  }

  // Refund legs arrive in PR 4. Captured verbatim so their real
  // test-mode shapes are pinned before any code depends on them.
  log.info(
    `[chapa webhook] unhandled ${event.kind} event ${event.name ?? '(no name)'}: ${rawBody}`
  );
  return new Response(null, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  return handleChapaWebhook(request);
}
