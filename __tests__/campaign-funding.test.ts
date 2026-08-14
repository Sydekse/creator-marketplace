import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fundCampaign } from '../lib/campaigns/fund-campaign';
import type { FundCampaignDeps } from '../lib/campaigns/fund-campaign';
import type { PaymentFailureContext } from '../lib/payment/log';
import { readCampaignEscrow } from '../lib/campaigns/escrow';
import type { CampaignEscrowDeps } from '../lib/campaigns/escrow';
import { ForbiddenError } from '../lib/authz';
import { LedgerError, isMoneyHeld } from '../lib/payment/ledger';
import type { HoldForCampaignResult } from '../lib/payment/ledger';
import { PaymentError } from '../lib/payment';
import { ErrorCode, ErrorHttpStatus, ErrorMessage } from '../lib/validation';
import { COMMITS_BUDGET } from '../lib/campaigns/budget';
import type { DealStatus } from '../db/schema';
import {
  FUND_CAMPAIGN_FAILED,
  FUND_CAMPAIGN_LABEL,
  FUND_CAMPAIGN_PENDING_LABEL,
  FUND_CAMPAIGN_PROMPT,
  FUND_CAMPAIGN_SUCCESS,
  FUND_NOT_FUNDABLE_MESSAGE,
  FUND_NO_ACCEPTED_DEALS_MESSAGE,
  HELD_IN_ESCROW_LABEL,
  HELD_IN_ESCROW_NOTE,
} from '../lib/campaigns/constants';
import { FUNDS_HELD_LABEL, FUNDS_HELD_MESSAGE } from '../lib/deals/detail';

/**
 * The nine deal statuses, taken from the one exhaustive map in the codebase
 * rather than typed out again. `COMMITS_BUDGET` is
 * `satisfies Record<DealStatus, boolean>`, so a tenth status reaches this list
 * without anyone remembering to widen it.
 */
const DEAL_STATUSES = Object.keys(COMMITS_BUDGET) as DealStatus[];

/**
 * KAN-43 — Brand funds a campaign and the accepted total is held (US-007,
 * AC-019, AC-021).
 *
 * **What this suite does not re-test.** The money path is
 * `EscrowLedgerService.holdForCampaign`, which landed on KAN-42 and is covered to
 * 100% by `escrow-ledger.test.ts` (NFR-009): one transaction, only `accepted`
 * deals, one `hold` per deal with a re-summed `balance_after`, a `deal_event` per
 * transition, and a second call refused. Repeating those assertions against a
 * different fake would test this file's fake, not the ledger. What is tested here
 * is everything KAN-43 adds around it — the ownership gate, the failure mapping,
 * the notification, and both parties' view of the held money.
 */

const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleFundCampaign } =
  await import('../app/api/campaigns/[id]/fund/route');

const BRAND_USER_ID = '00000000-0000-4000-8000-00000000user';
const BRAND_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND_PROFILE_ID = '99999999-9999-4999-8999-999999999999';
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_NAME = 'Ramadan launch';

/** Three accepted deals, so a `rows[0]`-shaped bug cannot read as correct. */
const HELD_TOTAL = 1_250_000;
const DEAL_COUNT = 3;
const PROVIDER_REF = 'mock_hold_0001';

interface Recorded {
  /** Seam names in call order — ordering asserted without reading source. */
  calls: string[];
  held: Array<{ campaignId: string; actorId: string }>;
  notifications: Array<{ userId: string; type: string; payload: unknown }>;
  ownershipReads: Array<{ campaignId: string; brandProfileId: string }>;
  /**
   * The failure-log seam (KAN-44). Recorded rather than ignored so the success
   * path can assert it stays empty — what gets logged on a failure is asserted in
   * `funding-failure.test.ts`, where the rest of AC-020 lives.
   */
  failureLogs: Array<{ error: unknown; context: PaymentFailureContext }>;
}

interface Overrides {
  /** The campaign is not this brand's, or does not exist. */
  campaignMissing?: boolean;
  /** What the ledger throws instead of returning. */
  holdError?: unknown;
  failNotify?: boolean;
}

function makeDeps(overrides: Overrides = {}): {
  deps: FundCampaignDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    calls: [],
    held: [],
    notifications: [],
    ownershipReads: [],
    failureLogs: [],
  };

  const deps: FundCampaignDeps = {
    getCampaign: async (campaignId, brandProfileId) => {
      recorded.calls.push('getCampaign');
      recorded.ownershipReads.push({ campaignId, brandProfileId });
      if (overrides.campaignMissing) return null;
      return { id: campaignId, name: CAMPAIGN_NAME };
    },
    hold: async (campaignId, actorId) => {
      recorded.calls.push('hold');
      if (overrides.holdError) throw overrides.holdError;
      recorded.held.push({ campaignId, actorId });
      return {
        dealCount: DEAL_COUNT,
        totalHeld: HELD_TOTAL,
        providerRef: PROVIDER_REF,
      } satisfies HoldForCampaignResult;
    },
    notify: (async (userId, type, payload) => {
      recorded.calls.push('notify');
      if (overrides.failNotify) throw new Error('resend down');
      recorded.notifications.push({ userId, type, payload });
    }) as FundCampaignDeps['notify'],
    logFailure: (error, context) => {
      recorded.calls.push('logFailure');
      recorded.failureLogs.push({ error, context });
    },
  };

  return { deps, recorded };
}

/**
 * Source guards read code, not prose about code. A module that documents why it
 * avoids something names that thing in a comment, and an un-stripped guard reads
 * the explanation as the violation.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function read(path: string): string {
  return stripComments(readFileSync(path, 'utf8'));
}

const FUND_MODULE = read('lib/campaigns/fund-campaign.ts');
const FUND_ROUTE = read('app/api/campaigns/[id]/fund/route.ts');
const FUND_BUTTON = read('components/campaign/fund-campaign-button.tsx');
const CAMPAIGN_PAGE = read('app/(brand)/(onboarded)/campaigns/[id]/page.tsx');
const CREATOR_DEAL_PAGE = read('app/(creator)/creator/deals/[id]/page.tsx');
const ESCROW_LEAF = read('lib/payment/escrow.ts');
const CAMPAIGN_ESCROW = read('lib/campaigns/escrow.ts');
const LEDGER_MODULE = read('lib/payment/ledger.ts');
const TEMPLATES = readFileSync('lib/notifications/templates.tsx', 'utf8');
const CONSTANTS = readFileSync('lib/campaigns/constants.ts', 'utf8');

beforeEach(() => {
  guardMock.mockReset();
  guardMock.mockResolvedValue({
    user: {
      id: BRAND_USER_ID,
      email: 'brand@example.com',
      name: 'Brand',
      role: 'brand',
    },
    brandProfileId: BRAND_PROFILE_ID,
    creatorProfileId: null,
  });
});

describe('fundCampaign — AC-019: the accepted total is held', () => {
  it('holds through the ledger and reports what was held', async () => {
    const { deps, recorded } = makeDeps();

    const result = await fundCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result).toEqual({
      ok: true,
      campaignId: CAMPAIGN_ID,
      dealCount: DEAL_COUNT,
      totalHeld: HELD_TOTAL,
    });
    expect(recorded.held).toEqual([
      { campaignId: CAMPAIGN_ID, actorId: BRAND_USER_ID },
    ]);
  });

  it('holds once per call, never twice', async () => {
    const { deps, recorded } = makeDeps();

    await fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.calls.filter((c) => c === 'hold')).toHaveLength(1);
  });

  it('logs nothing when funding succeeds', async () => {
    const { deps, recorded } = makeDeps();

    await fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    // The failure log is for failures. A line on the happy path would make the
    // `payment.failed` event useless for alerting.
    expect(recorded.failureLogs).toHaveLength(0);
  });

  /**
   * The discriminating case for "the amount is not the client's to choose". A
   * fake ledger returning a figure no argument mentioned proves the action reports
   * what the ledger summed rather than anything passed in.
   */
  it('takes no amount from its caller', async () => {
    const { deps } = makeDeps();

    const result = await fundCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result.ok && result.totalHeld).toBe(HELD_TOTAL);
    // The signature is `(campaignId, brandProfileId, actorUserId, deps)` — four
    // parameters, none of them money.
    expect(fundCampaign).toHaveLength(3);
    expect(FUND_ROUTE).not.toContain('request.json()');
  });

  it('does not re-derive the ledger sum or write entries itself', async () => {
    // The action orchestrates; `holdForCampaign` owns every write. An insert here
    // would be a ledger entry outside the transaction that owns the balance.
    expect(FUND_MODULE).not.toContain('ledgerEntry');
    expect(FUND_MODULE).not.toContain('transitionDeal');
    expect(FUND_MODULE).not.toMatch(/db\.transaction/);
  });
});

describe('fundCampaign — ownership (NFR-005, invariant 2)', () => {
  it('scopes the campaign read to the brand and never reaches the ledger otherwise', async () => {
    const { deps, recorded } = makeDeps({ campaignMissing: true });

    const result = await fundCampaign(
      CAMPAIGN_ID,
      OTHER_BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    // The point of the ordering: `holdForCampaign` locks by campaign id alone, so
    // nothing but this read stands between a valid id and someone else's escrow.
    expect(recorded.calls).toEqual(['getCampaign']);
    expect(recorded.held).toHaveLength(0);
  });

  it('passes the guard-resolved brand profile into the query', async () => {
    const { deps, recorded } = makeDeps();

    await fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.ownershipReads).toEqual([
      { campaignId: CAMPAIGN_ID, brandProfileId: BRAND_PROFILE_ID },
    ]);
  });

  it('checks ownership before the ledger, not after', async () => {
    const { deps, recorded } = makeDeps();

    await fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.calls.indexOf('getCampaign')).toBeLessThan(
      recorded.calls.indexOf('hold')
    );
  });

  it('filters the default query on brandId', () => {
    expect(FUND_MODULE).toContain('eq(campaign.brandId, brandProfileId)');
  });
});

describe('fundCampaign — AC bullet 2: no accepted deals holds nothing', () => {
  it('maps NO_ACCEPTED_DEALS onto its own reason', async () => {
    const { deps, recorded } = makeDeps({
      holdError: new LedgerError(
        'Campaign has no accepted deals to fund.',
        ErrorCode.NO_ACCEPTED_DEALS
      ),
    });

    const result = await fundCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'no_accepted_deals' });
    // Nothing held, and nobody told a campaign was funded.
    expect(recorded.held).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
  });
});

describe('fundCampaign — AC bullet 7: funding twice is rejected', () => {
  it('maps CAMPAIGN_NOT_FUNDABLE onto not_fundable and holds nothing', async () => {
    const { deps, recorded } = makeDeps({
      holdError: new LedgerError(
        'Campaign has already been funded.',
        ErrorCode.CAMPAIGN_NOT_FUNDABLE
      ),
    });

    const result = await fundCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'not_fundable' });
    expect(recorded.held).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('gives an unconfirmed campaign the same answer', async () => {
    // One code for both causes: the client's move is to re-read the campaign
    // either way, and the ledger keeps the distinction in its server-log message.
    const { deps } = makeDeps({
      holdError: new LedgerError(
        'Campaign 22222222 is draft, expected confirmed.',
        ErrorCode.CAMPAIGN_NOT_FUNDABLE
      ),
    });

    const result = await fundCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'not_fundable' });
  });

  it('branches on the code, never on the message', () => {
    // Rewording a server log line must not change which status a brand sees.
    expect(FUND_MODULE).toContain('error.code');
    expect(FUND_MODULE).not.toMatch(/error\.message/);
    expect(FUND_MODULE).not.toMatch(/already been funded/);
  });
});

describe('fundCampaign — a provider that declines', () => {
  it('reports payment_failed and holds nothing', async () => {
    const { deps, recorded } = makeDeps({
      holdError: new PaymentError('Insufficient funds.', 'INSUFFICIENT_FUNDS'),
    });

    const result = await fundCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'payment_failed' });
    expect(recorded.notifications).toHaveLength(0);
  });

  it('reports a serialization conflict that outlived its retries the same way', async () => {
    const { deps } = makeDeps({
      holdError: new LedgerError(
        'Payment could not be completed due to concurrent activity.',
        ErrorCode.PAYMENT_FAILED
      ),
    });

    const result = await fundCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'payment_failed' });
  });

  /**
   * The one that must not be flattened. An unrecognised failure leaves the state
   * of the money unestablished, and answering "try again" about it would invite a
   * second hold on top of a first that may have committed.
   */
  it('re-throws an error it does not recognise rather than calling it a payment failure', async () => {
    const { deps } = makeDeps({ holdError: new Error('connection reset') });

    await expect(
      fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps)
    ).rejects.toThrow('connection reset');
  });

  it('re-throws a LedgerError carrying a code it does not map', async () => {
    const { deps } = makeDeps({
      holdError: new LedgerError('weird', ErrorCode.INVALID_TIKTOK_URL),
    });

    await expect(
      fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps)
    ).rejects.toThrow(LedgerError);
  });
});

describe('fundCampaign — the brand is told (AC-019 item 6)', () => {
  it('notifies the funding brand with the held total and deal count', async () => {
    const { deps, recorded } = makeDeps();

    await fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.notifications).toEqual([
      {
        // A `user.id`, never a `brand_profile.id` — notifications address users
        // and a profile id here would write rows nobody can read.
        userId: BRAND_USER_ID,
        type: 'campaign_funded',
        payload: {
          campaignId: CAMPAIGN_ID,
          campaignTitle: CAMPAIGN_NAME,
          dealCount: DEAL_COUNT,
          totalHeld: HELD_TOTAL,
        },
      },
    ]);
  });

  it('notifies after the hold, never before it', async () => {
    const { deps, recorded } = makeDeps();

    await fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    // An email about money that has not moved is worse than a late one.
    expect(recorded.calls).toEqual(['getCampaign', 'hold', 'notify']);
  });

  /**
   * The documented asymmetry, asserted so it stays a decision rather than a
   * surprise: this is the one action whose notification is outside the
   * transaction, because `holdForCampaign` owns and retries its own.
   */
  it('does not wrap the ledger in withNotifications', () => {
    expect(FUND_MODULE).not.toContain('withNotifications');
    expect(FUND_MODULE).toContain('notify');
  });

  it('surfaces a failed notification rather than swallowing it', async () => {
    const { deps, recorded } = makeDeps({ failNotify: true });

    await expect(
      fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps)
    ).rejects.toThrow('resend down');

    // The money stayed held: the ledger transaction had already committed, and
    // rolling a captured hold back to save an email is the wrong direction.
    expect(recorded.held).toHaveLength(1);
  });
});

describe('POST /api/campaigns/[id]/fund', () => {
  function fundRoute(deps?: Parameters<typeof handleFundCampaign>[1]) {
    return handleFundCampaign(CAMPAIGN_ID, deps);
  }

  it('returns 200 with what was held', async () => {
    const { deps } = makeDeps();

    const response = await fundRoute({ fundCampaignDeps: deps });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      campaign_id: CAMPAIGN_ID,
      deals_funded: DEAL_COUNT,
      total_held: HELD_TOTAL,
    });
  });

  it('returns 409 NO_ACCEPTED_DEALS when nobody has accepted', async () => {
    const { deps } = makeDeps({
      holdError: new LedgerError('none', ErrorCode.NO_ACCEPTED_DEALS),
    });

    const response = await fundRoute({ fundCampaignDeps: deps });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.NO_ACCEPTED_DEALS);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.NO_ACCEPTED_DEALS]);
  });

  it('returns 409 CAMPAIGN_NOT_FUNDABLE on a second fund', async () => {
    const { deps, recorded } = makeDeps({
      holdError: new LedgerError('twice', ErrorCode.CAMPAIGN_NOT_FUNDABLE),
    });

    const response = await fundRoute({ fundCampaignDeps: deps });
    const body = await response.json();

    // Not 200 with the first call's figures: AC bullet 7 asks that a second fund
    // be rejected, and a 200 would report a capture that did not happen.
    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.CAMPAIGN_NOT_FUNDABLE);
    expect(body.error.message).toBe(
      ErrorMessage[ErrorCode.CAMPAIGN_NOT_FUNDABLE]
    );
    expect(recorded.notifications).toHaveLength(0);
  });

  it('returns 402 PAYMENT_FAILED when the provider declines', async () => {
    const { deps } = makeDeps({
      holdError: new PaymentError('down', 'PROVIDER_UNAVAILABLE'),
    });

    const response = await fundRoute({ fundCampaignDeps: deps });
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error.code).toBe(ErrorCode.PAYMENT_FAILED);
    // The PRD's exact string, not a paraphrase.
    expect(body.error.message).toBe('Payment failed — please try again.');
  });

  it('collapses a campaign owned by another brand into 403', async () => {
    const { deps } = makeDeps({ campaignMissing: true });

    const response = await fundRoute({ fundCampaignDeps: deps });
    const body = await response.json();

    // Not 404: a distinct code would make this an existence oracle for other
    // brands' campaign ids.
    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('rejects a malformed id without touching the database', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleFundCampaign('not-a-uuid', {
      fundCampaignDeps: deps,
    });

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
    expect(guardMock).not.toHaveBeenCalled();
  });

  it.each(['creator', 'admin'])(
    'refuses a %s and never enters fundCampaign',
    async (role) => {
      const { deps, recorded } = makeDeps();
      guardMock.mockRejectedValueOnce(new ForbiddenError(`role ${role}`));

      const response = await fundRoute({ fundCampaignDeps: deps });

      expect(response.status).toBe(403);
      expect(recorded.calls).toHaveLength(0);
    }
  );

  it('refuses an anonymous caller', async () => {
    const { deps, recorded } = makeDeps();
    guardMock.mockRejectedValueOnce(new ForbiddenError('no session'));

    const response = await fundRoute({ fundCampaignDeps: deps });

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
  });

  it('refuses a brand with no profile', async () => {
    const { deps, recorded } = makeDeps();
    guardMock.mockResolvedValueOnce({
      user: {
        id: BRAND_USER_ID,
        email: 'brand@example.com',
        name: 'Brand',
        role: 'brand',
      },
      brandProfileId: null,
      creatorProfileId: null,
    });

    const response = await fundRoute({ fundCampaignDeps: deps });

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
  });

  it('gates on the brand role and the campaign resource', async () => {
    const { deps } = makeDeps();

    await fundRoute({ fundCampaignDeps: deps });

    expect(guardMock).toHaveBeenCalledWith({
      roles: ['brand'],
      resource: { kind: 'campaign', id: CAMPAIGN_ID },
    });
  });

  it('runs on the node runtime, because pg needs Node APIs', () => {
    expect(FUND_ROUTE).toContain("export const runtime = 'nodejs'");
  });
});

describe('AC-019 item 6 — the brand can see money is held', () => {
  function makeEscrowDeps(escrowed = HELD_TOTAL): {
    deps: CampaignEscrowDeps;
    calls: string[];
  } {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        requireOwnership: async (campaignId) => {
          calls.push(`guard:${campaignId}`);
        },
        sumEscrowed: async (campaignId) => {
          calls.push(`sum:${campaignId}`);
          return escrowed;
        },
      },
    };
  }

  it('reads the escrowed total for a campaign', async () => {
    const { deps } = makeEscrowDeps();

    await expect(readCampaignEscrow(CAMPAIGN_ID, deps)).resolves.toBe(
      HELD_TOTAL
    );
  });

  it('gates inside the module, before the sum runs', async () => {
    const { deps, calls } = makeEscrowDeps();
    deps.requireOwnership = async () => {
      calls.push('guard');
      throw new ForbiddenError('not yours');
    };

    await expect(readCampaignEscrow(CAMPAIGN_ID, deps)).rejects.toThrow(
      ForbiddenError
    );
    // A read protected only by its callers is protected as well as its least
    // careful caller. The seam is what proves the query never ran.
    expect(calls).toEqual(['guard']);
  });

  it('refuses a malformed id without querying, because 22P02 is a 500', async () => {
    const { deps, calls } = makeEscrowDeps();

    await expect(readCampaignEscrow('not-a-uuid', deps)).rejects.toThrow(
      ForbiddenError
    );
    expect(calls).toEqual([]);
  });

  it('asks the guard for the brand role and this campaign', () => {
    expect(CAMPAIGN_ESCROW).toContain("roles: ['brand']");
    expect(CAMPAIGN_ESCROW).toContain("kind: 'campaign'");
  });

  it('has no creator branch — a campaign total would leak other creators’ pay', () => {
    expect(CAMPAIGN_ESCROW).not.toContain("'creator'");
  });

  it('renders the held row and what held means on the campaign page', () => {
    expect(CAMPAIGN_PAGE).toContain('HELD_IN_ESCROW_LABEL');
    expect(CAMPAIGN_PAGE).toContain('HELD_IN_ESCROW_NOTE');
    expect(CAMPAIGN_PAGE).toContain('readCampaignEscrow');
  });

  it('shows the row only when something is actually held', () => {
    // A "0.00 ETB held" row reads as a fact about the escrow, not its absence.
    expect(CAMPAIGN_PAGE).toContain('escrowed > 0');
  });

  it('formats the figure rather than doing arithmetic on santim', () => {
    expect(CAMPAIGN_PAGE).toContain('formatEtb(escrowed)');
  });
});

describe('AC-019 item 6 — the creator can see money is held', () => {
  it('gates the held line on the ledger’s own answer', () => {
    expect(CREATOR_DEAL_PAGE).toContain('isMoneyHeld(deal.status)');
    expect(CREATOR_DEAL_PAGE).toContain('FUNDS_HELD_LABEL');
    expect(CREATOR_DEAL_PAGE).toContain('FUNDS_HELD_MESSAGE');
  });

  it('does not restate the statuses money is held in', () => {
    // A second list would be free to disagree with `REFUNDABLE_FROM`.
    expect(CREATOR_DEAL_PAGE).not.toMatch(/status === 'funded'/);
    expect(CREATOR_DEAL_PAGE).not.toContain('REFUNDABLE_FROM');
  });

  it('shows the deal total, which is what a hold entry carries', () => {
    // One `hold` per deal, `amount = total_price`. The payout figure would
    // understate the escrow by the commission.
    expect(CREATOR_DEAL_PAGE).toContain('formatEtb(deal.totalPrice)');
  });
});

describe('isMoneyHeld — derived from REFUNDABLE_FROM, not restated', () => {
  it('is true exactly where a refund is legal', () => {
    const held = DEAL_STATUSES.filter((status) => isMoneyHeld(status));
    expect(held).toEqual(['funded', 'delivered', 'revision_requested']);
  });

  it.each([
    'pending',
    'accepted',
    'declined',
    'expired',
  ] satisfies DealStatus[])(
    'is false for %s, where no hold exists yet or ever will',
    (status) => {
      expect(isMoneyHeld(status)).toBe(false);
    }
  );

  it('is false for completed, because that money is spent rather than held', () => {
    // `COMMITS_BUDGET.completed` is true and this is false — the same money seen
    // as `spent` rather than `escrowed` (spike §6).
    expect(isMoneyHeld('completed')).toBe(false);
  });

  it('is false for refunded, because the hold was released', () => {
    expect(isMoneyHeld('refunded')).toBe(false);
  });

  it('covers every deal status, so a tenth cannot default to held', () => {
    for (const status of DEAL_STATUSES) {
      expect(typeof isMoneyHeld(status)).toBe('boolean');
    }
  });
});

describe('the escrow sum has one definition', () => {
  it('is the leaf both the ledger and the brand view read', () => {
    expect(LEDGER_MODULE).toContain('sumEscrowedByCampaign');
    expect(CAMPAIGN_ESCROW).toContain('sumEscrowedByCampaign');
    // The figure invariant 7 guards and the figure a brand is shown are one sum;
    // two copies of the query could disagree after any edit to either.
    expect(LEDGER_MODULE).not.toMatch(/sum\(\$\{?schema\.ledgerEntry\.amount/);
  });

  it('keeps runtime authz out of the ledger’s import chain', () => {
    // `db/seed.ts` imports the ledger, which imports this leaf. A value import
    // of `guard` here would make a plain seed script evaluate `lib/auth.ts`,
    // which calls `betterAuth({...})` at module top level.
    //
    // `import type { Tx }` is fine and is what the leaf actually does: a
    // type-only import is erased, so it reaches no runtime module graph. The
    // rule is about values, so the guard has to be too — a blanket ban on the
    // string would fail on an import that costs nothing.
    const authzImports = ESCROW_LEAF.match(/^import[^;]*'@\/lib\/authz';/gm);
    expect(authzImports).not.toBeNull();
    for (const line of authzImports ?? []) {
      expect(line.startsWith('import type')).toBe(true);
    }
    expect(ESCROW_LEAF).not.toMatch(/\bguard\(/);
  });

  it('keeps the ledger out of lib/campaigns/budget.ts', () => {
    // The two halves of `budget = available + escrowed + spent` come from
    // different sources and stay in different modules.
    const budget = read('lib/campaigns/budget.ts');
    expect(budget).not.toContain('ledgerEntry');
    expect(budget).not.toContain('sumEscrowedByCampaign');
  });

  it('does not import the ledger into the escrow leaf, which would be a cycle', () => {
    // `const` exports are not hoisted: a cycle would leave `REFUNDABLE_FROM`
    // undefined at point of use, and `isMoneyHeld` would silently answer false
    // for everything.
    expect(ESCROW_LEAF).not.toContain("from './ledger'");
    expect(ESCROW_LEAF).not.toContain('REFUNDABLE_FROM');
  });
});

describe('fund button', () => {
  it('renders inside the confirmed-only branch', () => {
    expect(CAMPAIGN_PAGE).toContain('FundCampaignButton');
    const confirmedBranch = CAMPAIGN_PAGE.indexOf(
      "campaign.status === 'confirmed'"
    );
    const button = CAMPAIGN_PAGE.indexOf('<FundCampaignButton');
    expect(confirmedBranch).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(confirmedBranch);
  });

  it('disables itself with nothing accepted, and says why in a sentence', () => {
    expect(CAMPAIGN_PAGE).toContain('acceptedCount={acceptedCount}');
    expect(FUND_BUTTON).toContain('acceptedCount === 0');
    expect(FUND_BUTTON).toContain('disabled={funding || nothingAccepted}');
    expect(FUND_BUTTON).toContain('FUND_NO_ACCEPTED_DEALS_MESSAGE');
    // A `title=` tells a touch user nothing.
    expect(FUND_BUTTON).not.toMatch(/\stitle=/);
  });

  it('uses buttonVariants on a plain button, not Base UI’s Button', () => {
    expect(FUND_BUTTON).toContain('buttonVariants(');
    expect(FUND_BUTTON).not.toMatch(/<Button[\s/>]/);
    expect(FUND_BUTTON).not.toContain('nativeButton');
  });

  it('confirms before moving money', () => {
    expect(FUND_BUTTON).toContain('window.confirm(FUND_CAMPAIGN_PROMPT)');
  });

  it('refreshes from the server rather than patching state locally', () => {
    expect(FUND_BUTTON).toContain('router.refresh()');
  });

  it('branches on the error code, not on a message it matched', () => {
    expect(FUND_BUTTON).toContain("code === 'CAMPAIGN_NOT_FUNDABLE'");
    expect(FUND_BUTTON).toContain("code === 'NO_ACCEPTED_DEALS'");
  });
});

describe('user-facing copy', () => {
  const COPY = [
    FUND_CAMPAIGN_LABEL,
    FUND_CAMPAIGN_PENDING_LABEL,
    FUND_CAMPAIGN_PROMPT,
    FUND_CAMPAIGN_SUCCESS,
    FUND_CAMPAIGN_FAILED,
    FUND_NO_ACCEPTED_DEALS_MESSAGE,
    FUND_NOT_FUNDABLE_MESSAGE,
    HELD_IN_ESCROW_LABEL,
    HELD_IN_ESCROW_NOTE,
    FUNDS_HELD_LABEL,
    FUNDS_HELD_MESSAGE,
  ];

  it('names no ticket in anything a user reads', () => {
    for (const copy of COPY) {
      expect(copy).not.toMatch(/KAN-\d+/);
      expect(copy).not.toMatch(/AC-\d+/);
    }
  });

  it('defines each string once, so no screen can paraphrase it apart', () => {
    for (const literal of [
      FUND_CAMPAIGN_LABEL,
      FUND_CAMPAIGN_SUCCESS,
      FUND_NO_ACCEPTED_DEALS_MESSAGE,
    ]) {
      expect(FUND_BUTTON).not.toContain(`'${literal}'`);
      expect(FUND_BUTTON).not.toContain(`>${literal}<`);
    }
    for (const literal of [HELD_IN_ESCROW_LABEL, HELD_IN_ESCROW_NOTE]) {
      expect(CAMPAIGN_PAGE).not.toContain(`>${literal}<`);
    }
    for (const literal of [FUNDS_HELD_LABEL, FUNDS_HELD_MESSAGE]) {
      expect(CREATOR_DEAL_PAGE).not.toContain(`>${literal}<`);
    }
  });

  /**
   * AC-021 in the copy. Funding holds money; it does not pay anybody. A brand who
   * read the prompt as payment would think an unposted video had already cost
   * them, and a creator who read the held line as payment would expect money that
   * is not coming until approval.
   */
  it('describes funding as a hold, not as paying anybody', () => {
    // Each of these stands alone somewhere — a prompt, a toast, a section a
    // creator reads on its own — so each has to name the hold itself.
    for (const copy of [
      FUND_CAMPAIGN_PROMPT,
      FUND_CAMPAIGN_SUCCESS,
      FUNDS_HELD_MESSAGE,
    ]) {
      expect(copy).toMatch(/escrow|held|funded/i);
    }
    // The escrow note is the exception, and only because it is never read
    // alone: it renders directly under `HELD_IN_ESCROW_LABEL`, which supplies
    // the word. Restating it there would read as a stutter.
    expect(HELD_IN_ESCROW_LABEL).toMatch(/held/i);
    expect(CAMPAIGN_PAGE).toMatch(
      /HELD_IN_ESCROW_LABEL[\s\S]{0,400}HELD_IN_ESCROW_NOTE/
    );
  });

  /**
   * The assertion that actually protects AC-021. "Paid" is allowed — three of
   * these strings need the word — but never on its own: every mention has to
   * carry the condition, or the sentence claims a payout that funding did not
   * make.
   */
  it('conditions every mention of payment on approval', () => {
    for (const copy of [
      FUND_CAMPAIGN_PROMPT,
      FUND_CAMPAIGN_SUCCESS,
      FUNDS_HELD_MESSAGE,
      HELD_IN_ESCROW_NOTE,
    ]) {
      if (/\bpaid\b|\bpay\b|\breleased?\b/.test(copy)) {
        expect(copy).toMatch(/approve/);
        // "only after" / "once" — the qualifier, not just the word `approve`
        // somewhere in the same paragraph.
        expect(copy).toMatch(/only after|once/);
      }
    }
  });

  it('tells each party who does the approving', () => {
    // Second person differs by audience: the brand approves, the creator waits
    // for them to. Same fact, and it would be wrong on one screen if shared.
    expect(HELD_IN_ESCROW_NOTE).toContain('you approve');
    expect(FUNDS_HELD_MESSAGE).toContain('they approve');
  });

  it('quotes no amount in the prompt, which would be a stale figure', () => {
    // The held total is re-summed under a row lock; a prompt naming a number the
    // page happened to render could disagree with what is actually held.
    expect(FUND_CAMPAIGN_PROMPT).not.toMatch(/\d/);
  });

  it('says what funding does before it is irreversible', () => {
    expect(FUND_CAMPAIGN_PROMPT.length).toBeGreaterThan(40);
  });
});

/**
 * The contained defect (KAN-43): five email CTAs pointed at `/brand/campaigns`,
 * which has never existed — a route group's folder name is not part of the URL,
 * and the brand campaign routes are at `/campaigns`. Three of the five were
 * already live and sending brands to a 404.
 *
 * This guard resolves every literal path in the templates against `app/`, so the
 * class of bug cannot come back rather than just this instance of it.
 */
describe('email CTAs resolve to real routes', () => {
  /** Every `appUrl('...')` and `appUrl(`...`)` literal, minus interpolations. */
  function ctaPaths(source: string): string[] {
    const paths: string[] = [];
    const pattern = /appUrl\(\s*[`'"]([^`'"]*)/g;
    for (const match of source.matchAll(pattern)) {
      // Skip the function's own definition, which has no literal.
      if (match[1].startsWith('/')) paths.push(match[1]);
    }
    return paths;
  }

  /**
   * Walks `app/` for the `page.tsx` serving a URL path, ignoring route groups.
   *
   * A `(group)` folder does not appear in the URL — which is exactly what the
   * five broken CTAs got wrong — and a `[param]` segment matches any literal.
   */
  function routeExists(urlPath: string): boolean {
    const segments = urlPath.split('/').filter(Boolean);

    function walk(dir: string, remaining: string[]): boolean {
      if (remaining.length === 0) {
        return existsSync(join(dir, 'page.tsx'));
      }

      const [head, ...tail] = remaining;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;

        // Route groups and private folders are not URL segments — descend
        // without consuming one.
        if (name.startsWith('(') || name.startsWith('_')) {
          if (walk(join(dir, name), remaining)) return true;
          continue;
        }
        // A dynamic segment matches whatever the interpolation produced.
        if (name === head || /^\[.+\]$/.test(name)) {
          if (walk(join(dir, name), tail)) return true;
        }
      }
      return false;
    }

    return walk('app', segments);
  }

  const PATHS = ctaPaths(TEMPLATES);

  it('finds every CTA path in the templates', () => {
    // Non-vacuity: an empty list would make every assertion below pass.
    expect(PATHS.length).toBeGreaterThanOrEqual(9);
  });

  it.each([...new Set(PATHS)])('%s is a real route', (path) => {
    expect(routeExists(path)).toBe(true);
  });

  it('would catch the bug it was written for', () => {
    // The exact path that was live in production, and the route-group form of it.
    expect(routeExists('/brand/campaigns')).toBe(false);
    expect(routeExists('/(brand)/campaigns')).toBe(false);
  });

  it('resolves a path through a route group and a dynamic segment', () => {
    // `app/(brand)/(onboarded)/campaigns/[id]/page.tsx` — two groups deep.
    expect(routeExists('/campaigns')).toBe(true);
    expect(routeExists('/campaigns/22222222-2222-4222-8222-222222222222')).toBe(
      true
    );
  });

  it('deep-links the notifications that carry a campaignId', () => {
    // `campaign_funded`, `offer_accepted` and `offer_declined` all name one
    // campaign, and the brand's next move is on that campaign's page.
    const deepLinks = TEMPLATES.match(
      /appUrl\(`\/campaigns\/\$\{payload\.campaignId\}`\)/g
    );
    expect(deepLinks).toHaveLength(3);
  });

  it('no longer points anywhere at /brand/campaigns', () => {
    for (const path of PATHS) {
      expect(path).not.toBe('/brand/campaigns');
    }
  });
});

/**
 * Non-vacuity. Every guard above passes on a file it should fail on, unless it
 * actually discriminates — these prove the reads are wired and the patterns match
 * something real.
 */
describe('the source guards can fail', () => {
  it('reads non-empty sources', () => {
    for (const source of [
      FUND_MODULE,
      FUND_ROUTE,
      FUND_BUTTON,
      CAMPAIGN_PAGE,
      CREATOR_DEAL_PAGE,
      ESCROW_LEAF,
      CAMPAIGN_ESCROW,
      LEDGER_MODULE,
      TEMPLATES,
      CONSTANTS,
    ]) {
      expect(source.length).toBeGreaterThan(200);
    }
  });

  it('strips comments before matching', () => {
    const stripped = stripComments(
      '// withNotifications is avoided here\n/* error.message */\nconst x = 1;'
    );
    expect(stripped).not.toContain('withNotifications');
    expect(stripped).not.toContain('error.message');
    expect(stripped).toContain('const x = 1;');
  });

  it('would catch a Base UI Button import', () => {
    expect('<Button variant="default">Fund</Button>').toMatch(/<Button[\s/>]/);
  });

  it('would catch a title tooltip', () => {
    expect('<button title="nope">x</button>').toMatch(/\stitle=/);
  });

  it('would catch a hardcoded funded-status check', () => {
    expect("if (deal.status === 'funded') {").toMatch(/status === 'funded'/);
  });

  it('extracts both quote styles of CTA path', () => {
    const paths = [
      ...`appUrl('/a')`.matchAll(/appUrl\(\s*[`'"]([^`'"]*)/g),
    ].map((m) => m[1]);
    expect(paths).toEqual(['/a']);
  });

  it('ErrorHttpStatus agrees with the statuses asserted above', () => {
    expect(ErrorHttpStatus[ErrorCode.CAMPAIGN_NOT_FUNDABLE]).toBe(409);
    expect(ErrorHttpStatus[ErrorCode.NO_ACCEPTED_DEALS]).toBe(409);
    expect(ErrorHttpStatus[ErrorCode.PAYMENT_FAILED]).toBe(402);
  });
});

/**
 * NFR-002 — funding answers within a second under normal load.
 *
 * Asserted structurally rather than on the clock: a wall-clock assertion against
 * a fake database measures the fake, and one against a real Neon instance
 * measures the network. What actually decides whether this is a sub-second
 * endpoint is the query shape, so that is what is checked — one provider call and
 * one balance sum per fund, with no per-deal fan-out.
 */
describe('NFR-002 — the work is bounded', () => {
  it('places one hold with the provider, whatever the deal count', async () => {
    const { deps, recorded } = makeDeps();

    await fundCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.calls.filter((c) => c === 'hold')).toHaveLength(1);
    expect(recorded.calls).toHaveLength(3);
  });

  it('loads the accepted deals in one query and sums the balance once', () => {
    // Both in `holdForCampaign`: a `select(...).where(status = accepted)` and a
    // single `sumBalance`, with the running total carried in memory across the
    // insert loop rather than re-summed per deal.
    const holdBody = LEDGER_MODULE.slice(
      LEDGER_MODULE.indexOf('async holdForCampaign'),
      LEDGER_MODULE.indexOf('async payoutForDeal')
    );
    expect(holdBody).toContain('this.sumBalance(tx, campaignId)');
    expect(holdBody.match(/this\.sumBalance/g)).toHaveLength(1);
    expect(holdBody.match(/this\.provider\./g)).toHaveLength(1);
  });

  it('asks for the escrow total and the accepted count only once a campaign settles', () => {
    // The cart page is the one a brand reloads while shopping; a draft has no
    // deals and no ledger rows, so both answers are known without asking.
    expect(CAMPAIGN_PAGE).toContain("campaign.status !== 'draft'");
    expect(CAMPAIGN_PAGE).toContain('settled ? readCampaignEscrow');
  });
});
