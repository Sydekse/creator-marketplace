import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { handleChapaWebhook } from '@/app/api/webhooks/chapa/route';
import type { SettleFundingResult } from '@/lib/campaigns/settle-funding';
import type { SettleWithdrawalOutcome } from '@/lib/wallet/settle-withdrawal';

/**
 * Webhook route tests (KAN-70).
 *
 * The route's whole job is deciding who gets a 200: unsigned requests must
 * bounce with zero side effects, signed funding events must settle, and the
 * status code must match the retry contract (503 borrows Chapa's redelivery
 * for not-yet-final settlements; 200 stops it for everything terminal).
 */

const SECRET = 'whsec_test_0123456789';
const TX_REF = 'cmfund_00000000-0000-4000-8000-000000000001';

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

const silentLog = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://app.example.com/api/webhooks/chapa', {
    method: 'POST',
    headers,
    body,
  });
}

function settleReturning(result: SettleFundingResult) {
  return vi.fn().mockResolvedValue(result);
}

describe('handleChapaWebhook', () => {
  it('rejects everything when the secret is unconfigured', async () => {
    const settle = settleReturning({
      outcome: 'consumed',
      campaignId: 'c',
      dealCount: 1,
      totalHeld: 1,
    });
    const body = JSON.stringify({ event: 'charge.success', tx_ref: TX_REF });
    const response = await handleChapaWebhook(
      post(body, { 'chapa-signature': sign(body) }),
      { settle, secret: () => undefined, log: silentLog }
    );
    expect(response.status).toBe(401);
    expect(settle).not.toHaveBeenCalled();
  });

  it('rejects a bad signature with no side effects', async () => {
    const settle = settleReturning({
      outcome: 'consumed',
      campaignId: 'c',
      dealCount: 1,
      totalHeld: 1,
    });
    const body = JSON.stringify({ event: 'charge.success', tx_ref: TX_REF });
    const response = await handleChapaWebhook(
      post(body, { 'chapa-signature': 'ab'.repeat(32) }),
      { settle, secret: () => SECRET, log: silentLog }
    );
    expect(response.status).toBe(401);
    expect(settle).not.toHaveBeenCalled();
  });

  it('rejects an unsigned request', async () => {
    const settle = settleReturning({
      outcome: 'consumed',
      campaignId: 'c',
      dealCount: 1,
      totalHeld: 1,
    });
    const body = JSON.stringify({ event: 'charge.success', tx_ref: TX_REF });
    const response = await handleChapaWebhook(post(body), {
      settle,
      secret: () => SECRET,
      log: silentLog,
    });
    expect(response.status).toBe(401);
    expect(settle).not.toHaveBeenCalled();
  });

  it('acknowledges signed non-JSON so it is not redelivered for 72 hours', async () => {
    const settle = settleReturning({
      outcome: 'consumed',
      campaignId: 'c',
      dealCount: 1,
      totalHeld: 1,
    });
    const body = 'not json at all';
    const response = await handleChapaWebhook(
      post(body, { 'chapa-signature': sign(body) }),
      { settle, secret: () => SECRET, log: silentLog }
    );
    expect(response.status).toBe(200);
    expect(settle).not.toHaveBeenCalled();
  });

  it('settles a signed funding event and answers 200 when terminal', async () => {
    const settle = settleReturning({
      outcome: 'consumed',
      campaignId: 'c',
      dealCount: 2,
      totalHeld: 250_000,
    });
    const body = JSON.stringify({
      event: 'charge.success',
      status: 'success',
      tx_ref: TX_REF,
    });
    const response = await handleChapaWebhook(
      post(body, { 'chapa-signature': sign(body) }),
      { settle, secret: () => SECRET, log: silentLog }
    );
    expect(response.status).toBe(200);
    expect(settle).toHaveBeenCalledWith(TX_REF);
    expect(await response.json()).toEqual({ outcome: 'consumed' });
  });

  it.each([
    ['already_consumed', { outcome: 'already_consumed', campaignId: 'c' }],
    ['failed', { outcome: 'failed', campaignId: 'c', reason: 'x' }],
    ['not_found', { outcome: 'not_found' }],
  ] as const)('%s is terminal → 200', async (_desc, result) => {
    const settle = settleReturning(result);
    const body = JSON.stringify({ event: 'charge.success', tx_ref: TX_REF });
    const response = await handleChapaWebhook(
      post(body, { 'chapa-signature': sign(body) }),
      { settle, secret: () => SECRET, log: silentLog }
    );
    expect(response.status).toBe(200);
  });

  it('answers 503 for a not-yet-final settlement, borrowing the retries', async () => {
    const settle = settleReturning({ outcome: 'pending', campaignId: 'c' });
    const body = JSON.stringify({ event: 'charge.success', tx_ref: TX_REF });
    const response = await handleChapaWebhook(
      post(body, { 'chapa-signature': sign(body) }),
      { settle, secret: () => SECRET, log: silentLog }
    );
    expect(response.status).toBe(503);
  });

  it('accepts via the x-chapa-signature scheme too', async () => {
    const settle = settleReturning({
      outcome: 'already_consumed',
      campaignId: 'c',
    });
    const body = JSON.stringify({ event: 'charge.success', tx_ref: TX_REF });
    const response = await handleChapaWebhook(
      post(body, { 'x-chapa-signature': sign(SECRET) }),
      { settle, secret: () => SECRET, log: silentLog }
    );
    expect(response.status).toBe(200);
    expect(settle).toHaveBeenCalled();
  });

  it.each([
    ['a payout event', { type: 'transfer', status: 'success', reference: 'R' }],
    ['a refund event', { event: 'refund.processed', tx_ref: TX_REF }],
    [
      'a transaction with a foreign tx_ref',
      { event: 'charge.success', tx_ref: 'someone_elses' },
    ],
    ['an unrecognisable payload', { hello: 'world' }],
  ])('logs and 200s %s without settling', async (_desc, payload) => {
    const settle = settleReturning({ outcome: 'not_found' });
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const body = JSON.stringify(payload);
    const response = await handleChapaWebhook(
      post(body, { 'chapa-signature': sign(body) }),
      { settle, secret: () => SECRET, log }
    );
    expect(response.status).toBe(200);
    expect(settle).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalled();
  });

  describe('payout leg', () => {
    const WD_REF = 'cmwd_00000000-0000-4000-8000-000000000002';

    function payoutDeps(outcome: SettleWithdrawalOutcome['outcome']) {
      const settle = settleReturning({ outcome: 'not_found' });
      const settlePayout = vi
        .fn()
        .mockResolvedValue({ outcome } as SettleWithdrawalOutcome);
      return {
        deps: {
          settle,
          settlePayout,
          secret: () => SECRET,
          log: silentLog,
        },
        settle,
        settlePayout,
      };
    }

    it('routes a cmwd_ reference to withdrawal settlement, not funding', async () => {
      const { deps, settle, settlePayout } = payoutDeps('paid');
      const body = JSON.stringify({
        event: 'payout.success',
        tx_ref: WD_REF,
      });
      const response = await handleChapaWebhook(
        post(body, { 'chapa-signature': sign(body) }),
        deps
      );
      expect(response.status).toBe(200);
      expect(settlePayout).toHaveBeenCalledWith(WD_REF);
      expect(settle).not.toHaveBeenCalled();
      expect(await response.json()).toEqual({ outcome: 'paid' });
    });

    it.each([
      'paid',
      'failed',
      'pending',
      'already_settled',
      'not_found',
    ] as const)(
      'answers 200 even for %s — the sweep is the retry, not Chapa',
      async (outcome) => {
        const { deps } = payoutDeps(outcome);
        const body = JSON.stringify({ event: 'anything', tx_ref: WD_REF });
        const response = await handleChapaWebhook(
          post(body, { 'chapa-signature': sign(body) }),
          deps
        );
        expect(response.status).toBe(200);
      }
    );

    it('still bounces an unsigned payout event', async () => {
      const { deps, settlePayout } = payoutDeps('paid');
      const body = JSON.stringify({ event: 'payout.success', tx_ref: WD_REF });
      const response = await handleChapaWebhook(post(body), deps);
      expect(response.status).toBe(401);
      expect(settlePayout).not.toHaveBeenCalled();
    });
  });
});
