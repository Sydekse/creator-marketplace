import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MissingRightsTermsError,
  confirmCampaign,
} from '../lib/campaigns/confirm-campaign';
import type {
  ConfirmCampaignDeps,
  ConfirmCampaignItem,
  NewDealRow,
} from '../lib/campaigns/confirm-campaign';
import { recordDealsCreated } from '../lib/deals/state-machine';
import { ForbiddenError } from '../lib/authz';
import type { Tx } from '../lib/authz';
import { ErrorCode, ErrorMessage } from '../lib/validation';
import {
  COMMISSION_RATE,
  OFFER_WINDOW_MS,
  offerExpiresAt,
} from '../lib/config/pricing';
import { computeSplit } from '../lib/payment/ledger';
import {
  CAMPAIGN_NOT_DRAFT_MESSAGE,
  CONFIRM_CAMPAIGN_FAILED,
  CONFIRM_CAMPAIGN_LABEL,
  CONFIRM_CAMPAIGN_PENDING_LABEL,
  CONFIRM_CAMPAIGN_PROMPT,
  CONFIRM_CAMPAIGN_SUCCESS,
  CONFIRM_EMPTY_CART_MESSAGE,
} from '../lib/campaigns/constants';

/**
 * KAN-33 — Confirm a campaign and send a pending offer per selected creator
 * (US-006, AC-016).
 */

const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleConfirmCampaign } =
  await import('../app/api/campaigns/[id]/confirm/route');

const BRAND_USER_ID = '00000000-0000-4000-8000-00000000user';
const BRAND_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';
const RIGHTS_TERMS_ID = '55555555-5555-4555-8555-555555555555';

/**
 * Three creators, and every id distinct from every other.
 *
 * `creatorId` is a `creator_profile.id` while notifications address a
 * `user.id`; a fixture that reused one for both would pass whichever way the
 * code wired it. Three rather than one, because a `rows[0]`-shaped bug — one
 * deal, one event, one notification — reads as correct with a single item.
 */
const CREATORS = [
  {
    creatorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    creatorUserId: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa',
    videoCount: 2,
    unitPrice: 150_000,
    totalPrice: 300_000,
    commissionRate: '15.00',
  },
  {
    creatorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    creatorUserId: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb',
    videoCount: 1,
    unitPrice: 500_000,
    totalPrice: 500_000,
    commissionRate: '15.00',
  },
  {
    creatorId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    creatorUserId: 'cccccccc-3333-4ccc-8ccc-cccccccccccc',
    videoCount: 3,
    unitPrice: 150_000,
    totalPrice: 450_000,
    commissionRate: '15.00',
  },
] satisfies ConfirmCampaignItem[];

const CART_TOTAL = CREATORS.reduce((sum, c) => sum + c.totalPrice, 0);

const FIXED_NOW = new Date('2026-08-10T12:00:00.000Z');

/**
 * The deal id the insert seam hands back for a given creator.
 *
 * Derived from the creator rather than from the row's position, so the
 * assertions can name which deal each creator should have been sent. A module
 * that pairs by position gets a mismatched pair and the notification tests see
 * it.
 */
function dealIdFor(creatorId: string): string {
  return `deal-for-${creatorId}`;
}

/** What `recordDealsCreated` was asked to record, as the seam sees it. */
interface RecordedCreation {
  dealIds: string[];
  actorId: string | null;
}

interface Recorded {
  deals: NewDealRow[];
  events: RecordedCreation[];
  confirmed: string[];
  notifications: Array<{ userId: string; type: string; payload: unknown }>;
  committed: boolean;
  /** Seam names in call order — how ordering is asserted without reading source. */
  calls: string[];
}

interface Overrides {
  status?: string;
  budget?: number;
  items?: ConfirmCampaignItem[];
  rightsTerms?: { id: string } | null;
  campaignMissing?: boolean;
  failInsert?: boolean;
  failNotify?: boolean;
}

/**
 * Fake deps that record writes, and only mark the transaction committed when
 * the body returns without throwing — the same shape the verification decision
 * tests use, and the reason a rollback is observable here at all.
 */
function makeDeps(overrides: Overrides = {}): {
  deps: ConfirmCampaignDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    deals: [],
    events: [],
    confirmed: [],
    notifications: [],
    committed: false,
    calls: [],
  };

  const items = overrides.items ?? CREATORS;
  const tx = {} as Tx;

  const deps: ConfirmCampaignDeps = {
    getCampaign: async () => {
      recorded.calls.push('getCampaign');
      if (overrides.campaignMissing) return null;
      return {
        id: CAMPAIGN_ID,
        name: 'Ramadan launch',
        budget: overrides.budget ?? CART_TOTAL,
        status: (overrides.status ??
          'draft') as import('../db/schema').CampaignStatus,
        companyName: 'Habesha Coffee',
      };
    },
    listItems: async () => {
      recorded.calls.push('listItems');
      return items;
    },
    getRightsTerms: async () => {
      recorded.calls.push('getRightsTerms');
      return overrides.rightsTerms === undefined
        ? { id: RIGHTS_TERMS_ID }
        : overrides.rightsTerms;
    },
    insertDeals: async (_tx, rows) => {
      recorded.calls.push('insertDeals');
      if (overrides.failInsert) throw new Error('insert exploded');
      recorded.deals.push(...rows);
      // Reversed on purpose, with the creator encoded in the id: `RETURNING`
      // does not promise input order, so a module that pairs deals to creators
      // by position hands the wrong deal id to the wrong creator, and the
      // notification assertions below can see it.
      return rows
        .map((row) => ({
          id: dealIdFor(row.creatorId),
          creatorId: row.creatorId,
        }))
        .reverse();
    },
    recordCreated: async (_tx, dealIds, actorId) => {
      recorded.calls.push('recordCreated');
      recorded.events.push({ dealIds, actorId });
    },
    markConfirmed: async (_tx, campaignId) => {
      recorded.calls.push('markConfirmed');
      recorded.confirmed.push(campaignId);
    },
    now: () => FIXED_NOW,
    run: async (fn) => {
      const notify = (async (userId, type, payload) => {
        recorded.calls.push('notify');
        if (overrides.failNotify) throw new Error('resend down');
        recorded.notifications.push({ userId, type, payload });
      }) as Parameters<ConfirmCampaignDeps['run']>[0] extends (
        tx: Tx,
        notify: infer N
      ) => unknown
        ? N
        : never;

      const result = await fn(tx, notify);
      recorded.committed = true;
      return result;
    },
  };

  return { deps, recorded };
}

/**
 * Source guards read code, not prose about code. A module that documents why it
 * avoids something names that thing in a comment, and an un-stripped guard
 * reads the explanation as the violation.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function read(path: string): string {
  return stripComments(readFileSync(path, 'utf8'));
}

const CONFIRM_MODULE = read('lib/campaigns/confirm-campaign.ts');
const CONFIRM_BUTTON = read('components/campaign/confirm-campaign-button.tsx');
const CAMPAIGN_PAGE = read('app/(brand)/(onboarded)/campaigns/[id]/page.tsx');
const CAMPAIGNS_LIST = read('app/(brand)/(onboarded)/campaigns/page.tsx');
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

describe('confirmCampaign — AC-1: an offer per selected creator', () => {
  it('creates one pending deal per cart item', async () => {
    const { deps, recorded } = makeDeps();

    const result = await confirmCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result.ok).toBe(true);
    expect(recorded.deals).toHaveLength(CREATORS.length);
    expect(recorded.deals.map((d) => d.creatorId).sort()).toEqual(
      CREATORS.map((c) => c.creatorId).sort()
    );
    expect(recorded.deals.every((d) => d.status === 'pending')).toBe(true);
  });

  it('carries the video count, prices and rights terms onto every deal', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    for (const creator of CREATORS) {
      const row = recorded.deals.find((d) => d.creatorId === creator.creatorId);
      expect(row).toBeDefined();
      expect(row!.videoCount).toBe(creator.videoCount);
      expect(row!.totalPrice).toBe(creator.totalPrice);
      expect(row!.rightsTermsId).toBe(RIGHTS_TERMS_ID);
      expect(row!.campaignId).toBe(CAMPAIGN_ID);
    }
  });

  it('returns the ids of every deal it created', async () => {
    const { deps } = makeDeps();

    const result = await confirmCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result.ok && result.dealIds).toHaveLength(CREATORS.length);
    expect(result.ok && result.totalCommitted).toBe(CART_TOTAL);
  });
});

describe('confirmCampaign — AC-2: prices are snapshotted from the cart row', () => {
  /**
   * The discriminating case. A cart row whose `unit_price` no longer matches
   * any tier price can only come from the cart, so a deal carrying it proves
   * the module copied rather than re-read `pricing_tier`.
   */
  it('copies a cart price that no tier would produce', async () => {
    const stalePrice = 123_456;
    const items: ConfirmCampaignItem[] = [
      {
        ...CREATORS[0],
        unitPrice: stalePrice,
        videoCount: 2,
        totalPrice: stalePrice * 2,
        commissionRate: '9.50',
      },
    ];
    const { deps, recorded } = makeDeps({ items, budget: stalePrice * 2 });

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.deals[0].unitPrice).toBe(stalePrice);
    expect(recorded.deals[0].totalPrice).toBe(stalePrice * 2);
    // Snapshotted per deal (invariant 8), not read from config at payout time.
    expect(recorded.deals[0].commissionRate).toBe('9.50');
  });

  it('keeps total_price equal to unit_price × video_count on every row', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    for (const row of recorded.deals) {
      expect(row.totalPrice).toBe(row.unitPrice * row.videoCount);
      expect(Number.isInteger(row.totalPrice)).toBe(true);
    }
  });
});

describe('confirmCampaign — AC-3: the offer window', () => {
  it('sets offer_expires_at to now + the configured window on every deal', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    const expected = new Date(FIXED_NOW.getTime() + OFFER_WINDOW_MS);
    for (const row of recorded.deals) {
      expect(row.offerExpiresAt).toBeInstanceOf(Date);
      expect(row.offerExpiresAt.getTime()).toBe(expected.getTime());
    }
  });

  it('gives every deal in one confirmation the same expiry instant', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    const instants = new Set(
      recorded.deals.map((row) => row.offerExpiresAt.getTime())
    );
    expect(instants.size).toBe(1);
  });

  it('derives the window from config, not a literal in the module', () => {
    // A hardcoded `7 * 24 * 60 * 60 * 1000` here is exactly what the config
    // constant exists to prevent (invariant 8's reasoning).
    expect(CONFIRM_MODULE).toContain('offerExpiresAt');
    expect(CONFIRM_MODULE).not.toMatch(/24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it('offerExpiresAt is exactly the window past its argument', () => {
    expect(offerExpiresAt(FIXED_NOW).getTime() - FIXED_NOW.getTime()).toBe(
      OFFER_WINDOW_MS
    );
  });
});

describe('confirmCampaign — AC-4: draft → confirmed, once', () => {
  it('moves the campaign to confirmed', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.confirmed).toEqual([CAMPAIGN_ID]);
  });

  it.each(['confirmed', 'funded', 'in_progress', 'completed', 'cancelled'])(
    'refuses a %s campaign and writes nothing',
    async (status) => {
      const { deps, recorded } = makeDeps({ status });

      const result = await confirmCampaign(
        CAMPAIGN_ID,
        BRAND_PROFILE_ID,
        BRAND_USER_ID,
        deps
      );

      expect(result).toEqual({ ok: false, reason: 'not_draft' });
      expect(recorded.deals).toHaveLength(0);
      expect(recorded.events).toHaveLength(0);
      expect(recorded.notifications).toHaveLength(0);
      expect(recorded.confirmed).toHaveLength(0);
    }
  );

  it('returns not_found when the campaign is not this brand’s', async () => {
    const { deps, recorded } = makeDeps({ campaignMissing: true });

    const result = await confirmCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(recorded.deals).toHaveLength(0);
  });

  it('locks the campaign row before reading its status', () => {
    // The lock is what serialises two concurrent confirms; without it both can
    // read `draft` and race to insert.
    expect(CONFIRM_MODULE).toContain(".for('update')");
  });

  it('scopes the campaign lookup to the calling brand', () => {
    // Re-applied inside the module, so a caller that forgot to gate still
    // cannot confirm someone else's campaign.
    expect(CONFIRM_MODULE).toContain('eq(campaign.brandId, brandProfileId)');
  });
});

describe('confirmCampaign — AC-5: one transaction', () => {
  it('opens no transaction of its own', () => {
    // `withNotifications` owns it. A second `db.transaction` here would nest
    // two transactions on two pool connections.
    expect(CONFIRM_MODULE).not.toContain('db.transaction');
    expect(CONFIRM_MODULE).toContain('withNotifications');
  });

  it('rolls everything back when a deal insert fails', async () => {
    const { deps, recorded } = makeDeps({ failInsert: true });

    await expect(
      confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps)
    ).rejects.toThrow('insert exploded');

    expect(recorded.committed).toBe(false);
    expect(recorded.events).toHaveLength(0);
    expect(recorded.confirmed).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('rolls everything back when a notification fails', async () => {
    const { deps, recorded } = makeDeps({ failNotify: true });

    await expect(
      confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps)
    ).rejects.toThrow('resend down');

    // The deals were handed to the insert seam, but the transaction never
    // committed — so no offer is observable, which is AC-5's "every offer
    // exists or none does".
    expect(recorded.committed).toBe(false);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('inserts all deals in one call rather than one per creator', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.calls.filter((c) => c === 'insertDeals')).toHaveLength(1);
    expect(recorded.calls.filter((c) => c === 'recordCreated')).toHaveLength(1);
  });
});

describe('confirmCampaign — AC-6: an initial deal_event per deal', () => {
  it('records exactly one creation event per deal', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    const dealIds = recorded.events.flatMap((e) => e.dealIds);
    expect(dealIds).toHaveLength(recorded.deals.length);
    expect(new Set(dealIds).size).toBe(CREATORS.length);
  });

  it('points every event at a deal that was actually inserted', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    // Built from the returned rows, not from the input: an event whose
    // `deal_id` came from anywhere else would reference a deal that does not
    // exist, and the history of a real one would be missing.
    const expected = new Set(CREATORS.map((c) => dealIdFor(c.creatorId)));
    expect(new Set(recorded.events.flatMap((e) => e.dealIds))).toEqual(
      expected
    );
  });

  it('actors the events to the brand user who confirmed', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    for (const event of recorded.events) {
      expect(event.actorId).toBe(BRAND_USER_ID);
    }
  });

  it('does not route creation through transitionDeal', () => {
    // `LEGAL_TRANSITIONS` has no inbound edge to `pending` — a deal is created
    // there, never transitioned there.
    expect(CONFIRM_MODULE).not.toContain('transitionDeal');
  });

  it('writes no deal_event of its own', () => {
    // Every write to that table belongs to the state machine's module, which
    // is what keeps an audit row from being written next to unrelated logic
    // with no status change behind it.
    expect(CONFIRM_MODULE).not.toContain('insert(dealEvent)');
    expect(CONFIRM_MODULE).toContain('recordDealsCreated');
  });
});

describe('recordDealsCreated — the opening event (AC-6, invariant 6)', () => {
  function eventTx() {
    const rows: Array<{
      dealId: string;
      fromStatus: null;
      toStatus: string;
      actorId: string | null;
    }> = [];
    const insert = vi.fn(() => ({
      values: vi.fn((v) => {
        rows.push(...(Array.isArray(v) ? v : [v]));
        return Promise.resolve();
      }),
    }));
    return { tx: { insert } as unknown as Tx, rows, insert };
  }

  it('writes from_status null → to_status pending for every deal', async () => {
    const { tx, rows } = eventTx();

    await recordDealsCreated(tx, ['d-1', 'd-2', 'd-3'], BRAND_USER_ID);

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // Null because the deal did not come from another status — it began
      // here. A `pending → pending` row would claim a transition that never
      // happened.
      expect(row.fromStatus).toBeNull();
      expect(row.toStatus).toBe('pending');
      expect(row.actorId).toBe(BRAND_USER_ID);
    }
    expect(rows.map((r) => r.dealId)).toEqual(['d-1', 'd-2', 'd-3']);
  });

  it('records a system action as a null actor', async () => {
    const { tx, rows } = eventTx();

    await recordDealsCreated(tx, ['d-1'], null);

    expect(rows[0].actorId).toBeNull();
  });

  it('writes one multi-row insert, not one per deal', async () => {
    const { tx, insert } = eventTx();

    await recordDealsCreated(tx, ['d-1', 'd-2', 'd-3'], BRAND_USER_ID);

    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when there are no deals', async () => {
    const { tx, insert } = eventTx();

    await recordDealsCreated(tx, [], BRAND_USER_ID);

    expect(insert).not.toHaveBeenCalled();
  });
});

describe('confirmCampaign — AC-7: every creator is notified', () => {
  it('sends one offer_received notification per creator', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.notifications).toHaveLength(CREATORS.length);
    expect(
      recorded.notifications.every((n) => n.type === 'offer_received')
    ).toBe(true);
  });

  it('addresses the creator’s user id, not their profile id', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    const addressed = recorded.notifications.map((n) => n.userId).sort();
    expect(addressed).toEqual(CREATORS.map((c) => c.creatorUserId).sort());

    // The two-hop trap: a profile id here writes rows nobody can read.
    for (const creator of CREATORS) {
      expect(addressed).not.toContain(creator.creatorId);
    }
  });

  it('pairs each notification with that creator’s own deal and figures', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    for (const creator of CREATORS) {
      const sent = recorded.notifications.find(
        (n) => n.userId === creator.creatorUserId
      );
      expect(sent).toBeDefined();
      const payload = sent!.payload as {
        dealId: string;
        totalPrice: number;
        videoCount: number;
        companyName: string;
        campaignTitle: string;
        offerExpiresAt: string;
      };

      // The insert seam returns its rows reversed, so a module pairing by
      // position sends this creator someone else's deal id.
      expect(payload.dealId).toBe(dealIdFor(creator.creatorId));
      expect(payload.totalPrice).toBe(creator.totalPrice);
      expect(payload.videoCount).toBe(creator.videoCount);
      expect(payload.companyName).toBe('Habesha Coffee');
      expect(payload.campaignTitle).toBe('Ramadan launch');
      expect(payload.offerExpiresAt).toBe(
        new Date(FIXED_NOW.getTime() + OFFER_WINDOW_MS).toISOString()
      );
    }
  });

  it('gives every creator a distinct deal id', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    const dealIds = recorded.notifications.map(
      (n) => (n.payload as { dealId: string }).dealId
    );
    expect(new Set(dealIds).size).toBe(CREATORS.length);
  });

  /**
   * KAN-55 AC-3: the offer email must state the payout net of commission.
   *
   * The net is computed here, at the producer, not in the template. A template
   * that subtracted its own commission would be a second source for a split
   * `computeSplit` already owns, and the two could disagree on a rounding —
   * these are the figures a creator decides on, and the payout will use the
   * ledger's.
   */
  it('tells each creator what they would take home, per their own deal', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    for (const creator of CREATORS) {
      const sent = recorded.notifications.find(
        (n) => n.userId === creator.creatorUserId
      );
      const payload = sent!.payload as {
        totalPrice: number;
        commission: number;
        payout: number;
      };
      const expected = computeSplit(creator.totalPrice, creator.commissionRate);

      expect(payload.commission).toBe(expected.commission);
      expect(payload.payout).toBe(expected.payout);
      // The three reconcile exactly, so the email cannot show a breakdown that
      // does not add up.
      expect(payload.payout + payload.commission).toBe(payload.totalPrice);
    }
  });

  it('uses the rate snapshotted on the cart row, not the config default', async () => {
    // The discriminating case, same shape as the price snapshot test above: a
    // rate no config value would produce. At 9.5% of 246,912 the commission is
    // 23,457 and the net 223,455 — figures the provisional 15% cannot yield, so
    // a module reading `COMMISSION_RATE` instead of the row fails here.
    const items: ConfirmCampaignItem[] = [
      {
        ...CREATORS[0],
        unitPrice: 123_456,
        videoCount: 2,
        totalPrice: 246_912,
        commissionRate: '9.50',
      },
    ];
    const { deps, recorded } = makeDeps({ items, budget: 246_912 });

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.notifications[0].payload).toMatchObject({
      totalPrice: 246_912,
      commission: 23_457,
      payout: 223_455,
    });
    // What the same total would have paid at the config rate. Asserting the
    // figures differ is what makes the test above discriminating rather than
    // merely arithmetically true.
    expect(computeSplit(246_912, COMMISSION_RATE).commission).not.toBe(23_457);
  });
});

describe('confirmCampaign — AC-8: the budget ceiling is re-checked', () => {
  it('refuses when the cart total exceeds a budget lowered after carting', async () => {
    const { deps, recorded } = makeDeps({ budget: CART_TOTAL - 1 });

    const result = await confirmCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result).toEqual({
      ok: false,
      reason: 'budget_exceeded',
      excess: 1,
    });
    expect(recorded.deals).toHaveLength(0);
    expect(recorded.confirmed).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('allows a cart that exactly meets the budget', async () => {
    const { deps, recorded } = makeDeps({ budget: CART_TOTAL });

    const result = await confirmCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result.ok).toBe(true);
    expect(recorded.deals).toHaveLength(CREATORS.length);
  });

  it('reports the shortfall in santim', async () => {
    const { deps } = makeDeps({ budget: CART_TOTAL - 75_000 });

    const result = await confirmCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason === 'budget_exceeded').toBe(
      true
    );
    if (result.ok === false && result.reason === 'budget_exceeded') {
      expect(result.excess).toBe(75_000);
      expect(Number.isInteger(result.excess)).toBe(true);
    }
  });

  it('checks the budget before any write', async () => {
    const { deps, recorded } = makeDeps({ budget: CART_TOTAL - 1 });

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    // Asserted by call order on the seam, not by reading the source: nothing
    // that writes ran at all.
    expect(recorded.calls).not.toContain('insertDeals');
    expect(recorded.calls).not.toContain('recordCreated');
    expect(recorded.calls).not.toContain('markConfirmed');
    expect(recorded.calls).not.toContain('notify');
  });

  it('resolves rights terms only after the budget passes', async () => {
    const { deps, recorded } = makeDeps({ budget: CART_TOTAL - 1 });

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(recorded.calls).not.toContain('getRightsTerms');
  });
});

describe('confirmCampaign — the empty cart', () => {
  it('refuses to confirm a campaign with nothing in it', async () => {
    const { deps, recorded } = makeDeps({ items: [] });

    const result = await confirmCampaign(
      CAMPAIGN_ID,
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      deps
    );

    expect(result).toEqual({ ok: false, reason: 'empty_cart' });
    // Confirming zero creators would leave the campaign confirmed with no
    // deals: unfundable (funding needs an accepted deal) and un-editable (the
    // brief locks outside draft).
    expect(recorded.confirmed).toHaveLength(0);
    expect(recorded.deals).toHaveLength(0);
  });
});

describe('confirmCampaign — rights terms', () => {
  it('throws when no terms version is in effect, and writes nothing', async () => {
    const { deps, recorded } = makeDeps({ rightsTerms: null });

    await expect(
      confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps)
    ).rejects.toThrow(MissingRightsTermsError);

    expect(recorded.committed).toBe(false);
    expect(recorded.deals).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('stamps the same terms version on every deal', async () => {
    const { deps, recorded } = makeDeps();

    await confirmCampaign(CAMPAIGN_ID, BRAND_PROFILE_ID, BRAND_USER_ID, deps);

    expect(new Set(recorded.deals.map((d) => d.rightsTermsId))).toEqual(
      new Set([RIGHTS_TERMS_ID])
    );
  });

  it('reads terms through the transaction, never the global db', () => {
    // The pool is max: 5 and the campaign row is locked — a query on `db` here
    // can wait on a connection only this transaction could release.
    expect(CONFIRM_MODULE).toContain('getCurrentRightsTerms(tx)');
    expect(CONFIRM_MODULE).not.toMatch(/getCurrentRightsTerms\(\s*db\s*\)/);
    expect(CONFIRM_MODULE).not.toMatch(/from\s+'@\/db'/);
  });
});

describe('POST /api/campaigns/[id]/confirm', () => {
  function confirmRoute(deps?: Parameters<typeof handleConfirmCampaign>[1]) {
    return handleConfirmCampaign(CAMPAIGN_ID, deps);
  }

  it('returns 200 with the offers it sent', async () => {
    const { deps } = makeDeps();

    const response = await confirmRoute({ confirmCampaignDeps: deps });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.offers_sent).toBe(CREATORS.length);
    expect(body.deal_ids).toHaveLength(CREATORS.length);
    expect(body.total_committed).toBe(CART_TOTAL);
    expect(body.campaign_id).toBe(CAMPAIGN_ID);
    expect(typeof body.offer_expires_at).toBe('string');
  });

  it('returns 409 CAMPAIGN_NOT_DRAFT on a second confirm', async () => {
    const { deps, recorded } = makeDeps({ status: 'confirmed' });

    const response = await confirmRoute({ confirmCampaignDeps: deps });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.CAMPAIGN_NOT_DRAFT);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.CAMPAIGN_NOT_DRAFT]);
    expect(recorded.deals).toHaveLength(0);
  });

  it('returns 409 BUDGET_EXCEEDED with the shortfall in birr', async () => {
    const { deps } = makeDeps({ budget: CART_TOTAL - 1 });

    const response = await confirmRoute({ confirmCampaignDeps: deps });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.BUDGET_EXCEEDED);
    // `formatEtb` already ends in ' ETB' — a second one here is the KAN-32 bug.
    expect(body.error.details.excess[0]).toBe(
      'This exceeds your remaining budget by 0.01 ETB.'
    );
    expect(body.error.details.excess[0]).not.toContain('ETB ETB');
  });

  it('returns 422 VALIDATION_ERROR for an empty cart', async () => {
    const { deps } = makeDeps({ items: [] });

    const response = await confirmRoute({ confirmCampaignDeps: deps });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.error.details._root[0]).toBe(CONFIRM_EMPTY_CART_MESSAGE);
  });

  it('collapses a campaign owned by another brand into 403', async () => {
    const { deps } = makeDeps({ campaignMissing: true });

    const response = await confirmRoute({ confirmCampaignDeps: deps });
    const body = await response.json();

    // Not 404: a distinct code would make this an existence oracle for other
    // brands' campaign ids.
    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('rejects a malformed id without touching the database', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleConfirmCampaign('not-a-uuid', {
      confirmCampaignDeps: deps,
    });

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
  });

  it.each(['creator', 'admin'])(
    'refuses a %s and never enters confirmCampaign',
    async (role) => {
      const { deps, recorded } = makeDeps();
      guardMock.mockRejectedValueOnce(new ForbiddenError(`role ${role}`));

      const response = await confirmRoute({ confirmCampaignDeps: deps });

      expect(response.status).toBe(403);
      expect(recorded.calls).toHaveLength(0);
    }
  );

  it('refuses an anonymous caller', async () => {
    const { deps, recorded } = makeDeps();
    guardMock.mockRejectedValueOnce(new ForbiddenError('no session'));

    const response = await confirmRoute({ confirmCampaignDeps: deps });

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

    const response = await confirmRoute({ confirmCampaignDeps: deps });

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
  });

  it('gates on the brand role and the campaign resource', async () => {
    const { deps } = makeDeps();

    await confirmRoute({ confirmCampaignDeps: deps });

    expect(guardMock).toHaveBeenCalledWith({
      roles: ['brand'],
      resource: { kind: 'campaign', id: CAMPAIGN_ID },
    });
  });

  it('takes no request body', () => {
    const source = read('app/api/campaigns/[id]/confirm/route.ts');
    // Accepting one would invite a client to send a different creator set or
    // different prices than the brand reviewed.
    expect(source).not.toContain('request.json()');
  });
});

describe('confirm button and campaign pages', () => {
  it('renders the confirm button inside the draft-only branch', () => {
    expect(CAMPAIGN_PAGE).toContain('ConfirmCampaignButton');
    const draftBranch = CAMPAIGN_PAGE.indexOf("campaign.status === 'draft'");
    const button = CAMPAIGN_PAGE.indexOf('<ConfirmCampaignButton');
    expect(draftBranch).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(draftBranch);
  });

  it('passes the cart size so an empty cart disables the button', () => {
    expect(CAMPAIGN_PAGE).toContain('itemCount={items.length}');
    expect(CONFIRM_BUTTON).toContain('itemCount === 0');
    expect(CONFIRM_BUTTON).toContain('disabled={sending || empty}');
  });

  it('explains the disabled state in a sentence, not a tooltip', () => {
    expect(CONFIRM_BUTTON).toContain('CONFIRM_EMPTY_CART_MESSAGE');
    // A `title=` tells a touch user nothing.
    expect(CONFIRM_BUTTON).not.toMatch(/\stitle=/);
  });

  it('uses buttonVariants on a plain button, not Base UI’s Button', () => {
    expect(CONFIRM_BUTTON).toContain('buttonVariants(');
    expect(CONFIRM_BUTTON).not.toMatch(/<Button[\s/>]/);
    expect(CONFIRM_BUTTON).not.toContain('nativeButton');
  });

  it('confirms before sending, because offers cannot be recalled', () => {
    expect(CONFIRM_BUTTON).toContain('window.confirm(CONFIRM_CAMPAIGN_PROMPT)');
  });

  it('refreshes from the server rather than patching state locally', () => {
    expect(CONFIRM_BUTTON).toContain('router.refresh()');
  });

  it('lists campaigns of every status, not drafts only', () => {
    // A draft-only list would drop a campaign the instant it was confirmed.
    expect(CAMPAIGNS_LIST).toContain('listCampaignsByBrand');
    expect(CAMPAIGNS_LIST).not.toContain('listDraftCampaignsByBrand');
  });

  it('sends a confirmed campaign to its detail page, not the locked edit form', () => {
    expect(CAMPAIGNS_LIST).toContain("camp.status === 'draft'");
    expect(CAMPAIGNS_LIST).toContain('View campaign');
  });
});

describe('user-facing copy', () => {
  it('names no ticket in anything a user reads', () => {
    for (const copy of [
      CONFIRM_CAMPAIGN_LABEL,
      CONFIRM_CAMPAIGN_PENDING_LABEL,
      CONFIRM_CAMPAIGN_PROMPT,
      CONFIRM_CAMPAIGN_SUCCESS,
      CONFIRM_CAMPAIGN_FAILED,
      CONFIRM_EMPTY_CART_MESSAGE,
      CAMPAIGN_NOT_DRAFT_MESSAGE,
    ]) {
      expect(copy).not.toMatch(/KAN-\d+/);
      expect(copy).not.toMatch(/AC-\d+/);
    }
  });

  it('defines each string once, so no screen can paraphrase it apart', () => {
    // The button renders the constants; it does not retype them.
    for (const literal of [
      CONFIRM_CAMPAIGN_LABEL,
      CONFIRM_CAMPAIGN_SUCCESS,
      CONFIRM_EMPTY_CART_MESSAGE,
    ]) {
      expect(CONFIRM_BUTTON).not.toContain(`'${literal}'`);
      expect(CONFIRM_BUTTON).not.toContain(`>${literal}<`);
    }
  });

  it('says what confirming does before it is irreversible', () => {
    expect(CONFIRM_CAMPAIGN_PROMPT).toContain('notified');
    expect(CONFIRM_CAMPAIGN_PROMPT.length).toBeGreaterThan(40);
  });
});

/**
 * Non-vacuity. Every guard above passes on a file it should fail on, unless it
 * actually discriminates — these prove the reads are wired and the patterns
 * match something real.
 */
describe('the source guards can fail', () => {
  it('reads non-empty sources', () => {
    for (const source of [
      CONFIRM_MODULE,
      CONFIRM_BUTTON,
      CAMPAIGN_PAGE,
      CAMPAIGNS_LIST,
      CONSTANTS,
    ]) {
      expect(source.length).toBeGreaterThan(200);
    }
  });

  it('strips comments before matching', () => {
    const stripped = stripComments(
      '// db.transaction is avoided here\n/* transitionDeal */\nconst x = 1;'
    );
    expect(stripped).not.toContain('db.transaction');
    expect(stripped).not.toContain('transitionDeal');
    expect(stripped).toContain('const x = 1;');
  });

  it('would catch a Base UI Button import', () => {
    expect('<Button variant="default">Send</Button>').toMatch(/<Button[\s/>]/);
  });

  it('would catch a hardcoded offer window', () => {
    expect('const w = 7 * 24 * 60 * 60 * 1000;').toMatch(
      /24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/
    );
  });

  it('would catch a title tooltip', () => {
    expect('<button title="Add a creator first">').toMatch(/\stitle=/);
  });

  it('would catch a global db import', () => {
    expect("import { db } from '@/db';").toMatch(/from\s+'@\/db'/);
  });
});
