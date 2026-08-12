import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DECLINE_EVENT_REASON,
  buildDeclineOfferWhere,
  declineOffer,
} from '../lib/deals/decline-offer';
import type {
  DeclineOfferDeps,
  DeclineOfferRow,
} from '../lib/deals/decline-offer';
import {
  LEGAL_TRANSITIONS,
  TransitionError,
  getErrorCodeForInvalidTransition,
} from '../lib/deals/state-machine';
import { COMMITS_BUDGET } from '../lib/campaigns/budget';
import { ForbiddenError } from '../lib/authz';
import type { Tx } from '../lib/authz';
import { db } from '../db';
import { deal } from '../db/schema';
import { ErrorCode, ErrorMessage } from '../lib/validation';
import type { DealStatus } from '../db/schema';

/**
 * KAN-37 — the creator declines an offer and the budget returns to the brand
 * (US-006, AC-018, FR-007, Tech Spec §4.4).
 *
 * Four claims carry the weight here, and the first two are the ones worth
 * reading before changing anything.
 *
 * **The released amount is `total_price` because it is the same column the sum
 * stops counting.** AC-018 asks that the released amount equal the deal's
 * `total_price` exactly. That is not arithmetic this module performs — available
 * budget is derived (`lib/campaigns/budget.ts`) and `declined` is `false` in
 * `COMMITS_BUDGET`, so the row simply drops out of the sum. The tests assert the
 * two facts that make it true: the reported amount is read from the locked row,
 * and `declined` is excluded from the derivation.
 *
 * **"One transaction" holds because there is only one write.** The AC asks that
 * the release and the status change apply together or not at all. They cannot
 * come apart: there is no budget column to update, so a partially-applied
 * decline is not a state this schema can represent. The suite asserts the
 * absence — no ledger call, no `campaign` update — rather than asserting that
 * two writes were ordered correctly, because the strongest version of this AC is
 * that the second write does not exist.
 *
 * **A refusal leaves no history behind.** `deal_event` is append-only, so a row
 * written before a rejection cannot be taken back — every refusal path asserts
 * the transition seam was not reached, or that it threw before recording.
 *
 * **Declining goes through the state machine** (FR-007, invariant 6). Asserted
 * as a source guard as well as through the seam: the module must not hand-write a
 * status or a `deal_event` of its own.
 *
 * The UI assertions are source guards. There is no DOM environment in this repo
 * — see the header of `ui-primitives.test.ts` — so they assert what a file
 * references, never what it paints. Comments are stripped first, so a guard
 * cannot be satisfied by prose about the rule.
 */

const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleDeclineDeal } =
  await import('../app/api/deals/[id]/decline/route');

const CREATOR_USER_ID = '99999999-9999-4999-8999-999999999999';
const CREATOR_PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CREATOR_PROFILE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEAL_ID = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN_ID = '44444444-4444-4444-8444-444444444444';
const BRAND_USER_ID = '55555555-5555-4555-8555-555555555555';
const BRAND_PROFILE_ID = '66666666-6666-4666-8666-666666666666';

const TOTAL_PRICE = 450_000;
const CREATOR_HANDLE = '@selam';
const CAMPAIGN_NAME = 'Ramadan Beauty Push';

interface Recorded {
  /** Seam names in call order — ordering asserted without reading source. */
  calls: string[];
  transitions: Array<{ dealId: string; actorId: string; reason: string }>;
  notifications: Array<{ userId: string; type: string; payload: unknown }>;
  loads: Array<{ dealId: string; creatorProfileId: string }>;
  committed: boolean;
}

interface Overrides {
  status?: DealStatus;
  dealMissing?: boolean;
  failNotify?: boolean;
  transitionError?: Error;
}

function makeDeps(overrides: Overrides = {}): {
  deps: DeclineOfferDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    calls: [],
    transitions: [],
    notifications: [],
    loads: [],
    committed: false,
  };

  const status = overrides.status ?? 'pending';
  const tx = {} as Tx;

  const deps: DeclineOfferDeps = {
    loadDeal: async (_tx, dealId, creatorProfileId) => {
      recorded.calls.push('loadDeal');
      recorded.loads.push({ dealId, creatorProfileId });
      // The ownership scope is in the `where`, so a deal belonging to another
      // creator does not come back at all. The fake honours that rather than
      // returning the row and trusting a later check.
      if (overrides.dealMissing) return null;
      if (creatorProfileId !== CREATOR_PROFILE_ID) return null;

      return {
        id: dealId,
        status,
        totalPrice: TOTAL_PRICE,
        campaignId: CAMPAIGN_ID,
        campaignName: CAMPAIGN_NAME,
        brandUserId: BRAND_USER_ID,
        creatorHandle: CREATOR_HANDLE,
      } satisfies DeclineOfferRow;
    },
    transition: async (_tx, dealId, actorId, reason) => {
      recorded.calls.push('transition');
      if (overrides.transitionError) throw overrides.transitionError;
      const legal = status === 'pending';
      if (!legal) {
        throw new TransitionError(
          `cannot decline from ${status}`,
          getErrorCodeForInvalidTransition(status, 'declined')
        );
      }
      recorded.transitions.push({ dealId, actorId, reason });
    },
    run: async (fn) => {
      const notify = (async (
        userId: string,
        type: string,
        payload: unknown
      ) => {
        recorded.calls.push('notify');
        if (overrides.failNotify) throw new Error('resend down');
        recorded.notifications.push({ userId, type, payload });
      }) as Parameters<DeclineOfferDeps['run']>[0] extends (
        tx: Tx,
        notify: infer N
      ) => unknown
        ? N
        : never;

      const result = await fn(tx, notify);
      // Only set when the body returns without throwing, which is what makes a
      // rollback observable here at all.
      recorded.committed = true;
      return result;
    },
  };

  return { deps, recorded };
}

function decline(
  deps: DeclineOfferDeps,
  over: { dealId?: string; creatorProfileId?: string } = {}
) {
  return declineOffer(
    over.dealId ?? DEAL_ID,
    {
      creatorProfileId: over.creatorProfileId ?? CREATOR_PROFILE_ID,
      actorUserId: CREATOR_USER_ID,
    },
    deps
  );
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function read(path: string): string {
  return stripComments(readFileSync(path, 'utf8'));
}

const DECLINE_MODULE = read('lib/deals/decline-offer.ts');
const DECLINE_ROUTE = read('app/api/deals/[id]/decline/route.ts');
const BUDGET_MODULE = read('lib/campaigns/budget.ts');
const ACTIONS_COMPONENT = read('components/deals/offer-actions.tsx');
const CAMPAIGN_PAGE = read('app/(brand)/(onboarded)/campaigns/[id]/page.tsx');

/**
 * Read off the transition table rather than retyped, so a tenth status is a
 * failure here instead of a case this suite silently stops covering.
 */
const ALL_STATUSES = Object.keys(LEGAL_TRANSITIONS) as DealStatus[];
const NON_PENDING = ALL_STATUSES.filter((s) => s !== 'pending');

// -- The deal moves to declined ----------------------------------------------

describe('AC-018 — declining moves the deal and reports what came back', () => {
  it('moves the deal to declined through the state machine', async () => {
    const { deps, recorded } = makeDeps();

    const result = await decline(deps);

    expect(result).toEqual({
      ok: true,
      dealId: DEAL_ID,
      releasedAmount: TOTAL_PRICE,
    });
    expect(recorded.transitions).toEqual([
      {
        dealId: DEAL_ID,
        actorId: CREATOR_USER_ID,
        reason: DECLINE_EVENT_REASON,
      },
    ]);
  });

  it('releases the deal’s total_price exactly, read under the lock', async () => {
    // "The released amount equals the deal's `total_price` exactly." Read from
    // the locked row rather than recomputed from `unit_price × video_count`,
    // which is the version that disagrees with the deal if either was ever
    // snapshotted differently.
    const { deps } = makeDeps();

    const result = await decline(deps);

    expect(result).toMatchObject({ releasedAmount: TOTAL_PRICE });
    expect(DECLINE_MODULE).toContain('releasedAmount: row.totalPrice');
    expect(DECLINE_MODULE).not.toMatch(/unitPrice|videoCount/);
  });

  it('keeps the released amount an integer number of santim (invariant 4)', async () => {
    const { deps } = makeDeps();

    const result = await decline(deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Number.isInteger(result.releasedAmount)).toBe(true);
    }
  });
});

// -- The release is the status change ----------------------------------------

describe('AC-018 — the release and the status change cannot come apart', () => {
  it('performs exactly one write: the transition', async () => {
    // The AC asks for one transaction. The stronger property, and the one this
    // asserts, is that there is only one write to be atomic about — available
    // budget is derived, so nothing else has to move in step with the status.
    const { deps, recorded } = makeDeps();

    await decline(deps);

    expect(recorded.calls).toEqual(['loadDeal', 'transition', 'notify']);
  });

  it('excludes declined deals from the budget derivation', () => {
    // This is what makes the sentence above true rather than merely tidy. If
    // `declined` committed budget, the status change would release nothing and
    // AC-018 would need a second write to satisfy it.
    expect(COMMITS_BUDGET.declined).toBe(false);
    expect(COMMITS_BUDGET.pending).toBe(true);
  });

  it('touches neither the ledger nor the campaign row', () => {
    // Nothing was ever held: a deal is only declinable from `pending` and money
    // first moves at funding, so `refundDeal` would refuse this — `REFUNDABLE_FROM`
    // excludes `pending` and there is no `hold` provider reference to reverse.
    expect(DECLINE_MODULE).not.toMatch(/ledger|refundDeal|EscrowLedger/i);
    expect(DECLINE_MODULE).not.toMatch(/update\(campaign\)/);
    expect(DECLINE_MODULE).not.toMatch(/heldBalance|held_balance/);
  });

  it('leaves the status unmoved when the notification fails', async () => {
    // `withNotifications` owns the transaction, so a throw after the transition
    // rolls the transition back with it. Nothing is left half-applied.
    const { deps, recorded } = makeDeps({ failNotify: true });

    await expect(decline(deps)).rejects.toThrow('resend down');
    expect(recorded.committed).toBe(false);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('runs everything inside one transaction', () => {
    expect(DECLINE_MODULE).toContain('run: (fn) => withNotifications(fn)');
    expect(DECLINE_MODULE).toContain('return deps.run(async (tx, notify)');
  });

  it('lets a real failure out rather than reporting it as a refusal', async () => {
    // Only `TransitionError` means "this transition is not allowed". A dropped
    // connection caught by the same `catch` would surface as a 409 telling the
    // creator to refresh, and the transaction would have committed a decline
    // that never happened.
    const { deps, recorded } = makeDeps({
      transitionError: new Error('connection terminated'),
    });

    await expect(decline(deps)).rejects.toThrow('connection terminated');
    expect(recorded.committed).toBe(false);
    expect(recorded.notifications).toHaveLength(0);
  });
});

// -- Only from pending -------------------------------------------------------

describe('AC-018 — declining is only legal from pending', () => {
  it.each(NON_PENDING)(
    'refuses a %s deal with the machine’s own code',
    async (status) => {
      const { deps, recorded } = makeDeps({ status });

      const result = await decline(deps);

      expect(result).toEqual({
        ok: false,
        reason: 'illegal',
        code: getErrorCodeForInvalidTransition(status, 'declined'),
      });
      // Append-only: a refusal must leave no event behind.
      expect(recorded.transitions).toHaveLength(0);
      expect(recorded.notifications).toHaveLength(0);
    }
  );

  it.each(NON_PENDING.filter((s) => s !== 'expired'))(
    'answers %s with OFFER_NOT_PENDING',
    async (status) => {
      // The ticket names one code. `expired` is the single exception and it is
      // the state machine's doing, not this route's — see below.
      const { deps } = makeDeps({ status });

      const result = await decline(deps);

      expect(result).toMatchObject({ code: ErrorCode.OFFER_NOT_PENDING });
    }
  );

  it('answers an already-swept offer with OFFER_EXPIRED', async () => {
    // `OFFER_ACTIONS` in the state machine already includes `'declined'`, so an
    // `expired` deal reports the lapse rather than "not pending" — which would
    // be true but unhelpful. No code here does that; it falls out of
    // `getErrorCodeForInvalidTransition`.
    const { deps } = makeDeps({ status: 'expired' });

    const result = await decline(deps);

    expect(result).toMatchObject({ code: ErrorCode.OFFER_EXPIRED });
  });

  it('refuses a second decline rather than appending a second event', async () => {
    // Idempotency, and the concurrent-tap answer: the row is locked, so the
    // loser reads `declined` and arrives here as `declined → declined`.
    const { deps, recorded } = makeDeps({ status: 'declined' });

    const result = await decline(deps);

    expect(result).toMatchObject({
      ok: false,
      code: ErrorCode.OFFER_NOT_PENDING,
    });
    expect(recorded.transitions).toHaveLength(0);
  });
});

// -- A declined deal is final ------------------------------------------------

describe('AC-018 — a declined deal cannot be resurrected', () => {
  it('has no legal transition out of declined', () => {
    expect(LEGAL_TRANSITIONS.declined).toEqual([]);
  });

  it.each(ALL_STATUSES)('cannot reach %s from declined', (status) => {
    expect(LEGAL_TRANSITIONS.declined).not.toContain(status);
  });

  it('never re-commits the budget, whatever happens next', () => {
    // The other half of "cannot be resurrected": since nothing leads out of
    // `declined`, the released amount cannot be silently re-claimed.
    expect(COMMITS_BUDGET.declined).toBe(false);
  });
});

// -- Only the creator on the deal --------------------------------------------

describe('AC-018 — only the creator the offer was made to can decline', () => {
  it('puts the ownership scope in the where clause', () => {
    const { sql, params } = db
      .select()
      .from(deal)
      .where(buildDeclineOfferWhere(DEAL_ID, CREATOR_PROFILE_ID))
      .toSQL();

    // The creator id is the base the deal id narrows, so there is no argument
    // that produces a lookup without it.
    expect(params).toContain(CREATOR_PROFILE_ID);
    expect(params).toContain(DEAL_ID);
    expect(sql).toMatch(/"creator_id" = \$/);
    expect(DECLINE_MODULE).toContain(
      'buildDeclineOfferWhere(dealId, creatorProfileId)'
    );
  });

  it('does not return another creator’s deal at all', async () => {
    const { deps, recorded } = makeDeps();

    const result = await decline(deps, {
      creatorProfileId: OTHER_CREATOR_PROFILE_ID,
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(recorded.transitions).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('takes the creator id from the session, never from the request', async () => {
    const { deps, recorded } = makeDeps();

    await decline(deps);

    expect(recorded.loads).toEqual([
      { dealId: DEAL_ID, creatorProfileId: CREATOR_PROFILE_ID },
    ]);
    expect(DECLINE_ROUTE).toContain('creatorProfileId = ctx.creatorProfileId');
    expect(DECLINE_ROUTE).toContain('actorUserId = ctx.user.id');
  });

  it('locks the deal row it is about to move', () => {
    // What serialises a concurrent accept and decline: the loser waits here,
    // then reads the status the winner wrote and is refused.
    expect(DECLINE_MODULE).toMatch(/\.for\('update'/);
  });
});

// -- The deal_event -----------------------------------------------------------

describe('FR-007 — the transition appends a deal_event with the creator as actor', () => {
  it('delegates the status change and the event to transitionDeal', () => {
    expect(DECLINE_MODULE).toContain("transitionDeal(tx, dealId, 'declined'");
  });

  it('names the signed-in creator as the actor', async () => {
    const { deps, recorded } = makeDeps();

    await decline(deps);

    expect(recorded.transitions[0].actorId).toBe(CREATOR_USER_ID);
    expect(recorded.transitions[0].actorId).not.toBe(CREATOR_PROFILE_ID);
  });

  it('hand-writes neither a status nor a deal_event', () => {
    // Invariant 6 — every transition writes its event as it happens, and the
    // machine is the one place that knows how. A module that wrote either itself
    // could bypass the legality check entirely.
    expect(DECLINE_MODULE).not.toMatch(/update\(deal\)[\s\S]{0,80}status:/);
    expect(DECLINE_MODULE).not.toContain('insert(dealEvent)');
    expect(DECLINE_MODULE).not.toContain('dealEvent');
  });

  it('records a reason a reader can understand', () => {
    expect(DECLINE_EVENT_REASON).toMatch(/declined/i);
    expect(DECLINE_EVENT_REASON).not.toMatch(/KAN-\d+/);
  });
});

// -- The brand is told -------------------------------------------------------

describe('AC-018 — the brand is notified that the offer was declined', () => {
  it('addresses the brand’s user id, not the profile id', async () => {
    // The two-hop rule: business rows reference profile ids and notifications
    // address a user, so `campaign.brand_id` is walked through
    // `brand_profile.user_id`. The profile id here writes a row nobody reads.
    const { deps, recorded } = makeDeps();

    await decline(deps);

    expect(recorded.notifications).toHaveLength(1);
    expect(recorded.notifications[0].userId).toBe(BRAND_USER_ID);
    expect(recorded.notifications[0].userId).not.toBe(BRAND_PROFILE_ID);
    expect(recorded.notifications[0].userId).not.toBe(CREATOR_USER_ID);
    expect(DECLINE_MODULE).toContain('brandProfile.userId');
  });

  it('sends the facts the sentence states and no profile copy', async () => {
    const { deps, recorded } = makeDeps();

    await decline(deps);

    expect(recorded.notifications[0].type).toBe('offer_declined');
    expect(recorded.notifications[0].payload).toEqual({
      dealId: DEAL_ID,
      campaignId: CAMPAIGN_ID,
      campaignTitle: CAMPAIGN_NAME,
      creatorHandle: CREATOR_HANDLE,
      releasedAmount: TOTAL_PRICE,
    });
  });

  it('tells the brand a decline, not an expiry', () => {
    // Both release the same money, but they are different facts and a brand may
    // re-offer differently depending on which. Reusing `offer_expired` here
    // would send a body that says the offer lapsed.
    expect(DECLINE_MODULE).toContain("'offer_declined'");
    expect(DECLINE_MODULE).not.toContain("'offer_expired'");
  });

  it('names the creator by public handle, never a legal name (NFR-010)', () => {
    expect(DECLINE_MODULE).toContain('creatorProfile.tiktokHandle');
    expect(DECLINE_MODULE).not.toMatch(/fullName|legalName|\bemail\b/);
  });

  it('notifies inside the transaction, after the transition', async () => {
    const { deps, recorded } = makeDeps();

    await decline(deps);

    expect(recorded.calls.indexOf('transition')).toBeLessThan(
      recorded.calls.indexOf('notify')
    );
  });

  it('says nothing to the brand when the decline is refused', async () => {
    const { deps, recorded } = makeDeps({ status: 'accepted' });

    await decline(deps);

    expect(recorded.notifications).toHaveLength(0);
  });
});

// -- The endpoint ------------------------------------------------------------

describe('POST /api/deals/[id]/decline', () => {
  beforeEach(() => {
    guardMock.mockReset();
    guardMock.mockResolvedValue({
      user: {
        id: CREATOR_USER_ID,
        email: 'creator@example.com',
        name: 'Selam',
        role: 'creator',
      },
      brandProfileId: null,
      creatorProfileId: CREATOR_PROFILE_ID,
    });
  });

  it('returns 200 with the released amount', async () => {
    const { deps } = makeDeps();

    const response = await handleDeclineDeal(DEAL_ID, {
      declineOfferDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      deal_id: DEAL_ID,
      status: 'declined',
      released_amount: TOTAL_PRICE,
    });
  });

  it('takes no request body at all', () => {
    // §4.4 specifies none, and there is nothing a decline could carry: the deal
    // is in the path and the creator is in the session. So there is no schema,
    // no parse branch, and no 422 this endpoint can produce.
    expect(DECLINE_ROUTE).not.toContain('request.json()');
    expect(DECLINE_ROUTE).not.toContain('safeParse');
    expect(DECLINE_ROUTE).not.toContain('VALIDATION_ERROR');
  });

  it('gates on the creator role and this deal', async () => {
    const { deps } = makeDeps();

    await handleDeclineDeal(DEAL_ID, { declineOfferDeps: deps });

    expect(guardMock).toHaveBeenCalledWith({
      roles: ['creator'],
      resource: { kind: 'deal', id: DEAL_ID },
    });
  });

  it('runs the guard before anything else', async () => {
    const { deps, recorded } = makeDeps();
    guardMock.mockRejectedValue(new ForbiddenError('role brand not permitted'));

    const response = await handleDeclineDeal(DEAL_ID, {
      declineOfferDeps: deps,
    });

    expect(response.status).toBe(403);
    // Not merely denied — the action never ran, so no row was even read.
    expect(recorded.calls).toHaveLength(0);
  });

  it('refuses a malformed id before it reaches a uuid column', async () => {
    // Postgres answers a non-uuid compared against `uuid` with `22P02`, which
    // would turn a mistyped link into a 500. Denied rather than 404'd, like
    // every owner-scoped route.
    const { deps, recorded } = makeDeps();

    const response = await handleDeclineDeal('not-a-uuid', {
      declineOfferDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
    expect(guardMock).not.toHaveBeenCalled();
    expect(recorded.calls).toHaveLength(0);
  });

  it('denies a creator with no profile row', async () => {
    const { deps, recorded } = makeDeps();
    guardMock.mockResolvedValue({
      user: {
        id: CREATOR_USER_ID,
        email: 'creator@example.com',
        name: 'Selam',
        role: 'creator',
      },
      brandProfileId: null,
      creatorProfileId: null,
    });

    const response = await handleDeclineDeal(DEAL_ID, {
      declineOfferDeps: deps,
    });

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
  });

  it('collapses a vanished deal into 403, not 404', async () => {
    // The guard already denied anyone who does not own this deal, so a distinct
    // 404 here would only tell a caller which ids exist.
    const { deps } = makeDeps({ dealMissing: true });

    const response = await handleDeclineDeal(DEAL_ID, {
      declineOfferDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('returns 409 OFFER_NOT_PENDING with the AC’s own sentence', async () => {
    const { deps } = makeDeps({ status: 'accepted' });

    const response = await handleDeclineDeal(DEAL_ID, {
      declineOfferDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.OFFER_NOT_PENDING);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.OFFER_NOT_PENDING]);
  });

  it('passes the state machine’s code through rather than choosing one', async () => {
    const { deps } = makeDeps({ status: 'expired' });

    const response = await handleDeclineDeal(DEAL_ID, {
      declineOfferDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.OFFER_EXPIRED);
    expect(DECLINE_ROUTE).toContain('errorResponse(result.code)');
  });

  it('produces only the three responses §4.4 lists', () => {
    // 200, 409, 403. Anything else — a 404, a 422 — would be this route
    // inventing a contract the spec does not give it.
    const codes = DECLINE_ROUTE.match(/ErrorCode\.[A-Z_]+/g) ?? [];

    expect(new Set(codes)).toEqual(new Set(['ErrorCode.FORBIDDEN']));
  });

  it('runs on the Node runtime, because pg cannot run on the edge', () => {
    expect(DECLINE_ROUTE).toContain("export const runtime = 'nodejs'");
  });
});

// -- The surface the creator taps --------------------------------------------

describe('the decline surface', () => {
  it('posts to the decline route for this deal', () => {
    expect(ACTIONS_COMPONENT).toMatch(
      /fetch\(\s*`\/api\/deals\/\$\{encodeURIComponent\(dealId\)\}\/decline`/
    );
  });

  it('sends no body, matching the endpoint', () => {
    const call = ACTIONS_COMPONENT.slice(
      ACTIONS_COMPONENT.indexOf('/decline`')
    ).slice(0, 200);

    expect(call).toContain("method: 'POST'");
    expect(call).not.toContain('JSON.stringify');
  });

  it('confirms before an action that cannot be undone', () => {
    // `LEGAL_TRANSITIONS.declined` is empty and this button sits beside Accept.
    // `confirm` rather than a dialog, per `remove-from-cart-button.tsx` — no
    // dialog primitive is installed and adding one would widen the ticket.
    expect(ACTIONS_COMPONENT).toContain(
      'window.confirm(DECLINE_CONFIRM_MESSAGE)'
    );
  });

  it('is not gated on the agreement checkbox', () => {
    // A creator refusing the terms should not have to tick that they accept
    // them first.
    const buttons = ACTIONS_COMPONENT.match(/<button[\s\S]*?<\/button>/g) ?? [];
    const declineButton = buttons.filter((b) =>
      b.includes('DECLINE_DEAL_LABEL')
    );

    expect(declineButton).toHaveLength(1);
    expect(declineButton[0]).toContain('onClick={handleDecline}');
    expect(declineButton[0]).not.toContain('canAccept');
  });

  it('never lies about being idle while a request is in flight', () => {
    expect(ACTIONS_COMPONENT).toMatch(
      /declining \? DECLINING_LABEL : DECLINE_DEAL_LABEL/
    );
  });

  it('stops the two buttons firing at once', () => {
    // One deal, two mutually exclusive answers. Each control is disabled while
    // either request is open, so a double-tap cannot race itself.
    expect(ACTIONS_COMPONENT).toMatch(/if \(accepting \|\| declining\) return/);
    expect(ACTIONS_COMPONENT).toMatch(/disabled=\{accepting \|\| declining\}/);
  });

  it('shows the server’s own sentence rather than a second copy', () => {
    // Every code this endpoint returns has a message in `ErrorMessage`, and
    // those strings are acceptance criteria. A local paraphrase would be free to
    // drift from the one the API sends.
    expect(ACTIONS_COMPONENT).toMatch(
      /body\?\.error\?\.message \?\? DECLINE_FAILED_MESSAGE/
    );
  });

  it('re-reads the server’s view after the decline', () => {
    // Whether these controls render at all is server-rendered from
    // `deal.status`, so the refresh is what removes them.
    const handler = ACTIONS_COMPONENT.slice(
      ACTIONS_COMPONENT.indexOf('async function handleDecline')
    );

    expect(handler).toContain('DECLINE_SUCCESS_MESSAGE');
    expect(
      handler.match(/router\.refresh\(\)/g)?.length
    ).toBeGreaterThanOrEqual(2);
  });

  it('names no ticket in anything a creator reads', () => {
    expect(ACTIONS_COMPONENT).not.toMatch(/KAN-\d+/);
  });

  it('is a styled button, not Base UI’s client component', () => {
    expect(ACTIONS_COMPONENT).toContain('buttonVariants');
    expect(ACTIONS_COMPONENT).not.toMatch(/<Button\s/);
  });
});

// -- What the brand sees ------------------------------------------------------

describe('AC-018 — the brand’s remaining budget reflects the decline', () => {
  it('reads the derived budget rather than subtracting the cart', () => {
    // The bug AC-018 actually names: confirmation leaves `campaign_item` rows in
    // place, so `budget - sumCartTotal(...)` moved by nothing when a deal was
    // declined.
    expect(CAMPAIGN_PAGE).toContain('readCampaignBudget(campaign.id)');
    expect(CAMPAIGN_PAGE).not.toContain('getCartRunningTotal');
    expect(CAMPAIGN_PAGE).not.toContain('campaign.budget - ');
  });

  it('renders the available figure, not a locally recomputed one', () => {
    expect(CAMPAIGN_PAGE).toContain('formatEtb(available)');
    expect(CAMPAIGN_PAGE).toContain('formatEtb(committed)');
  });

  it('names the committed figure for what it is on a confirmed campaign', () => {
    // "Running Total" over a deals-derived number would name the wrong thing.
    expect(CAMPAIGN_PAGE).toMatch(
      /campaign\.status === 'draft' \? 'Running Total' : 'Committed'/
    );
  });

  it('keeps the derivation in one module, not restated on the page', () => {
    expect(BUDGET_MODULE).toContain('export const COMMITS_BUDGET');
    expect(CAMPAIGN_PAGE).not.toContain('COMMITS_BUDGET');
  });
});
