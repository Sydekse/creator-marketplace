import { describe, expect, it, vi } from 'vitest';
import {
  handleCancelFundingSession,
  handleCreateFundingSession,
} from '@/app/api/campaigns/[id]/fund/session/route';
import type { RouteDeps } from '@/app/api/campaigns/[id]/fund/session/route';
import { ForbiddenError } from '@/lib/authz';
import type { AuthzContext } from '@/lib/authz';

/**
 * Session route tests (KAN-70) — the HTTP skin over `fund-session.ts`.
 *
 * What matters here is the gate (brand-only, own campaign, malformed ids
 * denied before any query) and the reason→status mapping, including the 403
 * collapse that keeps the endpoint from being an existence oracle.
 */

const CAMPAIGN_ID = 'c0000000-0000-4000-8000-000000000001';
const ORIGIN = 'https://app.example.com';

const ctx: AuthzContext = {
  user: {
    id: 'u0000000-0000-4000-8000-000000000001',
    email: 'brand@example.com',
    name: 'Bete',
    role: 'brand',
  },
  brandProfileId: 'b0000000-0000-4000-8000-000000000001',
  creatorProfileId: null,
};

function makeDeps(overrides?: Partial<RouteDeps>): RouteDeps {
  return {
    guard: vi.fn().mockResolvedValue(ctx),
    createDeps: {
      getCampaign: vi.fn().mockResolvedValue({
        id: CAMPAIGN_ID,
        name: 'Summer',
        status: 'confirmed',
      }),
      sumAcceptedDeals: vi.fn().mockResolvedValue({ total: 250_000, count: 2 }),
      getOpenSession: vi.fn().mockResolvedValue(null),
      insertSession: vi.fn().mockResolvedValue('inserted'),
      gateway: () =>
        ({
          mode: 'chapa-test',
          createFundingCheckout: vi.fn().mockResolvedValue({
            checkoutUrl: 'https://checkout.chapa.co/x/1',
          }),
        }) as never,
      logFailure: vi.fn(),
    },
    cancelDeps: {
      getCampaign: vi.fn().mockResolvedValue({
        id: CAMPAIGN_ID,
        name: 'Summer',
        status: 'confirmed',
      }),
      expireOpenSession: vi.fn().mockResolvedValue(true),
    },
    ...overrides,
  };
}

describe('POST /api/campaigns/{id}/fund/session', () => {
  it('denies a malformed id before the guard runs', async () => {
    const deps = makeDeps();
    const response = await handleCreateFundingSession(
      'not-a-uuid',
      ORIGIN,
      deps
    );
    expect(response.status).toBe(403);
    expect(deps.guard).not.toHaveBeenCalled();
  });

  it('maps a guard denial to its error response', async () => {
    const deps = makeDeps({
      guard: vi.fn().mockRejectedValue(new ForbiddenError('nope')),
    });
    const response = await handleCreateFundingSession(
      CAMPAIGN_ID,
      ORIGIN,
      deps
    );
    expect(response.status).toBe(403);
  });

  it('answers 201 with the checkout URL for a fresh session', async () => {
    const response = await handleCreateFundingSession(
      CAMPAIGN_ID,
      ORIGIN,
      makeDeps()
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.checkout_url).toBe('https://checkout.chapa.co/x/1');
    expect(body.tx_ref).toMatch(/^cmfund_/);
    expect(body.amount).toBe(250_000);
    expect(body.resumed).toBe(false);
  });

  it('answers 200 when resuming an already-open session', async () => {
    const deps = makeDeps();
    (
      deps.createDeps!.getOpenSession as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      txRef: 'cmfund_open',
      checkoutUrl: 'https://checkout.chapa.co/x/open',
      amount: 100,
    });
    const response = await handleCreateFundingSession(
      CAMPAIGN_ID,
      ORIGIN,
      deps
    );
    expect(response.status).toBe(200);
    expect((await response.json()).resumed).toBe(true);
  });

  it.each([
    [
      'unowned campaign → 403 collapse',
      { getCampaign: null },
      403,
      'FORBIDDEN',
    ],
    ['draft campaign → 409', { status: 'draft' }, 409, 'CAMPAIGN_NOT_FUNDABLE'],
    ['no accepted deals → 409', { accepted: 0 }, 409, 'NO_ACCEPTED_DEALS'],
    ['gateway off → PAYMENT_FAILED', { gateway: null }, 402, 'PAYMENT_FAILED'],
  ] as const)('%s', async (_desc, scenario, _status, code) => {
    const deps = makeDeps();
    const createDeps = deps.createDeps!;
    if ('getCampaign' in scenario) {
      (createDeps.getCampaign as ReturnType<typeof vi.fn>).mockResolvedValue(
        null
      );
    }
    if ('status' in scenario) {
      (createDeps.getCampaign as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: CAMPAIGN_ID,
        name: 'Summer',
        status: scenario.status,
      });
    }
    if ('accepted' in scenario) {
      (
        createDeps.sumAcceptedDeals as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        total: 0,
        count: 0,
      });
    }
    if ('gateway' in scenario) {
      createDeps.gateway = () => null;
    }
    const response = await handleCreateFundingSession(
      CAMPAIGN_ID,
      ORIGIN,
      deps
    );
    expect(response.ok).toBe(false);
    expect((await response.json()).error.code).toBe(code);
  });
});

describe('DELETE /api/campaigns/{id}/fund/session', () => {
  it('denies a malformed id before the guard runs', async () => {
    const deps = makeDeps();
    const response = await handleCancelFundingSession('nope', deps);
    expect(response.status).toBe(403);
    expect(deps.guard).not.toHaveBeenCalled();
  });

  it('cancels the open session', async () => {
    const response = await handleCancelFundingSession(CAMPAIGN_ID, makeDeps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cancelled: true });
  });

  it('is idempotent — nothing open still answers 200', async () => {
    const deps = makeDeps();
    (
      deps.cancelDeps!.expireOpenSession as ReturnType<typeof vi.fn>
    ).mockResolvedValue(false);
    const response = await handleCancelFundingSession(CAMPAIGN_ID, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cancelled: false });
  });
});
