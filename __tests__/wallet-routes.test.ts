import { describe, expect, it, vi } from 'vitest';
import { handleCreateWithdrawal } from '@/app/api/creator/withdrawals/route';
import type { RouteDeps } from '@/app/api/creator/withdrawals/route';
import { handleSavePayoutMethod } from '@/app/api/creator/payout-method/route';
import type { RouteDeps as MethodRouteDeps } from '@/app/api/creator/payout-method/route';
import { ForbiddenError } from '@/lib/authz';
import type { AuthzContext } from '@/lib/authz';
import type { ChapaBank } from '@/lib/chapa/client';
import type { PaymentGateway } from '@/lib/payment/gateway';

/**
 * Wallet route tests (KAN-70 PR 3) — the HTTP skins over `lib/wallet`.
 *
 * The gates matter most: creator-only, own wallet only (no id in the URL to
 * get wrong), and the reason→status mapping the dialog's copy relies on.
 */

const ctx: AuthzContext = {
  user: {
    id: 'u0000000-0000-4000-8000-000000000001',
    email: 'creator@example.com',
    name: 'Alem',
    role: 'creator',
  },
  brandProfileId: null,
  creatorProfileId: 'c0000000-0000-4000-8000-000000000001',
};

function jsonRequest(body: unknown): Request {
  return new Request('https://app.example.com/api/creator/withdrawals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const METHOD = {
  kind: 'bank' as const,
  bankCode: '946',
  bankName: 'Awash Bank',
  accountNumber: '01320811436100',
  accountName: 'Abebe Bikila',
};

function withdrawalDeps(overrides?: Partial<RouteDeps>): RouteDeps {
  return {
    guard: vi.fn().mockResolvedValue(ctx),
    withdrawDeps: {
      gateway: () =>
        ({
          sendTransfer: vi.fn().mockResolvedValue({ providerRef: 'tr-1' }),
        }) as unknown as PaymentGateway,
      getMethod: vi.fn().mockResolvedValue(METHOD),
      reserve: vi.fn().mockResolvedValue({ ok: true, id: 'w-1' }),
      markProcessing: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      logFailure: vi.fn(),
    },
    ...overrides,
  };
}

describe('POST /api/creator/withdrawals', () => {
  it('answers 403 for a caller the guard refuses', async () => {
    const deps = withdrawalDeps({
      guard: vi.fn().mockRejectedValue(new ForbiddenError('nope')),
    });
    const response = await handleCreateWithdrawal(
      jsonRequest({ amount: 50_000 }),
      deps
    );
    expect(response.status).toBe(403);
  });

  it('answers 403 for a session with no creator profile', async () => {
    const deps = withdrawalDeps({
      guard: vi.fn().mockResolvedValue({ ...ctx, creatorProfileId: null }),
    });
    const response = await handleCreateWithdrawal(
      jsonRequest({ amount: 50_000 }),
      deps
    );
    expect(response.status).toBe(403);
  });

  it('answers 422 for a non-JSON body', async () => {
    const request = new Request('https://x.example/api/creator/withdrawals', {
      method: 'POST',
      body: 'not json',
    });
    const response = await handleCreateWithdrawal(request, withdrawalDeps());
    expect(response.status).toBe(422);
  });

  it('answers 422 for a string amount', async () => {
    const response = await handleCreateWithdrawal(
      jsonRequest({ amount: '50000' }),
      withdrawalDeps()
    );
    expect(response.status).toBe(422);
  });

  it.each([
    [5_000, 422, 'WITHDRAWAL_BELOW_MINIMUM'],
    [-5, 422, 'VALIDATION_ERROR'],
  ] as const)('maps amount %s to %s %s', async (amount, status, code) => {
    const response = await handleCreateWithdrawal(
      jsonRequest({ amount }),
      withdrawalDeps()
    );
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error.code).toBe(code);
  });

  it('answers 409 NO_PAYOUT_METHOD with no method on file', async () => {
    const deps = withdrawalDeps();
    deps.withdrawDeps!.getMethod = vi.fn().mockResolvedValue(null);
    const response = await handleCreateWithdrawal(
      jsonRequest({ amount: 50_000 }),
      deps
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('NO_PAYOUT_METHOD');
  });

  it.each(['insufficient_balance', 'conflict'] as const)(
    'maps a %s reserve to 409 INSUFFICIENT_BALANCE',
    async (reason) => {
      const deps = withdrawalDeps();
      deps.withdrawDeps!.reserve = vi
        .fn()
        .mockResolvedValue({ ok: false, reason });
      const response = await handleCreateWithdrawal(
        jsonRequest({ amount: 50_000 }),
        deps
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('INSUFFICIENT_BALANCE');
    }
  );

  it('answers 402 with no gateway configured', async () => {
    const deps = withdrawalDeps();
    deps.withdrawDeps!.gateway = () => null;
    const response = await handleCreateWithdrawal(
      jsonRequest({ amount: 50_000 }),
      deps
    );
    expect(response.status).toBe(402);
  });

  it('answers 201 with the masked receipt on success', async () => {
    const response = await handleCreateWithdrawal(
      jsonRequest({ amount: 50_000 }),
      withdrawalDeps()
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      id: 'w-1',
      tx_ref: expect.stringMatching(/^cmwd_/),
      amount: 50_000,
      status: 'processing',
      bank_name: 'Awash Bank',
      account_number_masked: '••••6100',
    });
    expect(JSON.stringify(body)).not.toContain(METHOD.accountNumber);
  });
});

const BANKS: ChapaBank[] = [
  { code: '946', name: 'Awash Bank', accountLength: 14, isMobileMoney: false },
];

function methodRequest(body: unknown): Request {
  return new Request('https://app.example.com/api/creator/payout-method', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function methodDeps(overrides?: Partial<MethodRouteDeps>): MethodRouteDeps {
  return {
    guard: vi.fn().mockResolvedValue(ctx),
    methodDeps: {
      listBanks: vi.fn().mockResolvedValue(BANKS),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

describe('PUT /api/creator/payout-method', () => {
  it('answers 403 for a caller the guard refuses', async () => {
    const deps = methodDeps({
      guard: vi.fn().mockRejectedValue(new ForbiddenError('nope')),
    });
    const response = await handleSavePayoutMethod(
      methodRequest({
        bankCode: '946',
        accountNumber: '01320811436100',
        accountName: 'Abebe',
      }),
      deps
    );
    expect(response.status).toBe(403);
  });

  it('answers 422 for missing fields', async () => {
    const response = await handleSavePayoutMethod(
      methodRequest({ bankCode: '946' }),
      methodDeps()
    );
    expect(response.status).toBe(422);
  });

  it('answers 422 with field errors for a bad account number', async () => {
    const response = await handleSavePayoutMethod(
      methodRequest({
        bankCode: '946',
        accountNumber: 'abc',
        accountName: 'Abebe',
      }),
      methodDeps()
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.details.accountNumber).toBeDefined();
  });

  it('answers 402 when the banks list is unavailable', async () => {
    const deps = methodDeps();
    deps.methodDeps!.listBanks = vi.fn().mockResolvedValue(null);
    const response = await handleSavePayoutMethod(
      methodRequest({
        bankCode: '946',
        accountNumber: '01320811436100',
        accountName: 'Abebe',
      }),
      deps
    );
    expect(response.status).toBe(402);
  });

  it('answers 200 with the masked method on success', async () => {
    const response = await handleSavePayoutMethod(
      methodRequest({
        bankCode: '946',
        accountNumber: '01320811436100',
        accountName: 'Abebe Bikila',
      }),
      methodDeps()
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      kind: 'bank',
      bank_code: '946',
      bank_name: 'Awash Bank',
      account_number_masked: '••••6100',
      account_name: 'Abebe Bikila',
    });
    expect(JSON.stringify(body)).not.toContain('01320811436100');
  });
});
