import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { handleTransferApproval } from '@/app/api/webhooks/chapa/transfer-approval/route';

/**
 * Transfer-approval endpoint tests (KAN-70 PR 3).
 *
 * This URL replaces the dashboard OTP: a 200 approves the pending transfer.
 * So the only thing that matters is the gate — nothing unsigned may ever
 * reach the approving 200, and a missing secret must fail closed.
 */

const SECRET = 'whsec_test_0123456789';

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

const silentLog = { error: vi.fn(), info: vi.fn() };

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(
    'https://app.example.com/api/webhooks/chapa/transfer-approval',
    { method: 'POST', headers, body }
  );
}

describe('handleTransferApproval', () => {
  const BODY = JSON.stringify({ reference: 'tr-1', amount: '500.00' });

  it('fails closed and loudly when the secret is unconfigured', async () => {
    const log = { error: vi.fn(), info: vi.fn() };
    const response = await handleTransferApproval(
      post(BODY, { 'chapa-signature': sign(BODY) }),
      { secret: () => undefined, log }
    );
    expect(response.status).toBe(401);
    expect(log.error).toHaveBeenCalled();
  });

  it('refuses an unsigned request', async () => {
    const response = await handleTransferApproval(post(BODY), {
      secret: () => SECRET,
      log: silentLog,
    });
    expect(response.status).toBe(401);
  });

  it('refuses a tampered signature', async () => {
    const response = await handleTransferApproval(
      post(BODY, { 'chapa-signature': 'ab'.repeat(32) }),
      { secret: () => SECRET, log: silentLog }
    );
    expect(response.status).toBe(401);
  });

  it('refuses a signature over different bytes', async () => {
    const response = await handleTransferApproval(
      post(BODY, { 'chapa-signature': sign('something else') }),
      { secret: () => SECRET, log: silentLog }
    );
    expect(response.status).toBe(401);
  });

  it('approves a correctly signed request', async () => {
    const log = { error: vi.fn(), info: vi.fn() };
    const response = await handleTransferApproval(
      post(BODY, { 'chapa-signature': sign(BODY) }),
      { secret: () => SECRET, log }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ approved: true });
    expect(log.info).toHaveBeenCalled();
  });

  it('accepts the x-chapa-signature scheme too', async () => {
    const response = await handleTransferApproval(
      post(BODY, { 'x-chapa-signature': sign(SECRET) }),
      { secret: () => SECRET, log: silentLog }
    );
    expect(response.status).toBe(200);
  });
});
