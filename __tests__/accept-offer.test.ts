import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCEPT_EVENT_REASON,
  acceptOffer,
  buildAcceptOfferWhere,
  isOfferExpired,
} from '../lib/deals/accept-offer';
import type {
  AcceptOfferDeps,
  AcceptOfferRow,
} from '../lib/deals/accept-offer';
import { MissingRightsTermsError } from '../lib/campaigns/confirm-campaign';
import {
  LEGAL_TRANSITIONS,
  TransitionError,
  getErrorCodeForInvalidTransition,
} from '../lib/deals/state-machine';
import { ForbiddenError } from '../lib/authz';
import type { Tx } from '../lib/authz';
import { db } from '../db';
import { deal } from '../db/schema';
import { ErrorCode, ErrorMessage } from '../lib/validation';
import type { DealStatus } from '../db/schema';

/**
 * KAN-36 — the creator accepts an offer and agrees to the usage-rights terms
 * (US-006, AC-017, Tech Spec §4.4).
 *
 * Four claims carry the weight here.
 *
 * **What gets recorded is the server's read, not the client's value** (AC-1,
 * F31). This one is a source guard rather than a behavioural assertion, and
 * deliberately so: the staleness comparison has already refused every case where
 * the two differ, so at the write they are necessarily equal and no fixture can
 * tell which one landed. The guard is what keeps the property true if that
 * comparison is ever loosened.
 *
 * **A refusal leaves no history behind** (AC-3). `deal_event` is append-only, so
 * a row written before a rejection cannot be taken back — every 4xx path asserts
 * the transition seam was not called.
 *
 * **The expiry check is this module's own** (AC-4). `LEGAL_TRANSITIONS` permits
 * `pending → accepted` and KAN-38's sweep does not exist, so a lapsed offer is
 * still `pending` in the database and the state machine would accept it. The
 * boundary is asserted on both sides of the deadline with an injected clock.
 *
 * **Acceptance goes through the state machine** (AC-6, invariant 6). Asserted as
 * a source guard as well as through the seam: the module must not hand-write a
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

const { handleAcceptDeal } = await import('../app/api/deals/[id]/accept/route');

const CREATOR_USER_ID = '99999999-9999-4999-8999-999999999999';
const CREATOR_PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CREATOR_PROFILE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEAL_ID = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN_ID = '44444444-4444-4444-8444-444444444444';
const BRAND_USER_ID = '55555555-5555-4555-8555-555555555555';
const BRAND_PROFILE_ID = '66666666-6666-4666-8666-666666666666';

/** The version in effect. What the server reads, and the only thing it stamps. */
const CURRENT_TERMS_ID = '77777777-7777-4777-8777-777777777777';
/** A superseded version — what a page left open overnight would still be showing. */
const STALE_TERMS_ID = '88888888-8888-4888-8888-888888888888';

const FIXED_NOW = new Date('2026-08-10T12:00:00.000Z');
const OFFER_DEADLINE = new Date('2026-08-12T12:00:00.000Z');

const TOTAL_PRICE = 450_000;
const CREATOR_HANDLE = '@selam';

interface Recorded {
  /** Seam names in call order — ordering asserted without reading source. */
  calls: string[];
  transitions: Array<{ dealId: string; actorId: string; reason: string }>;
  stamped: Array<{ dealId: string; rightsTermsId: string; acceptedAt: Date }>;
  notifications: Array<{ userId: string; type: string; payload: unknown }>;
  loads: Array<{ dealId: string; creatorProfileId: string }>;
  committed: boolean;
}

interface Overrides {
  status?: DealStatus;
  offerExpiresAt?: Date | null;
  dealMissing?: boolean;
  currentTerms?: { id: string } | null;
  now?: Date;
  failNotify?: boolean;
}

function makeDeps(overrides: Overrides = {}): {
  deps: AcceptOfferDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    calls: [],
    transitions: [],
    stamped: [],
    notifications: [],
    loads: [],
    committed: false,
  };

  const status = overrides.status ?? 'pending';
  const tx = {} as Tx;

  const deps: AcceptOfferDeps = {
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
        offerExpiresAt:
          overrides.offerExpiresAt === undefined
            ? OFFER_DEADLINE
            : overrides.offerExpiresAt,
        campaignId: CAMPAIGN_ID,
        campaignName: 'Ramadan Beauty Push',
        brandUserId: BRAND_USER_ID,
        creatorHandle: CREATOR_HANDLE,
      } satisfies AcceptOfferRow;
    },
    getRightsTerms: async () => {
      recorded.calls.push('getRightsTerms');
      return overrides.currentTerms === undefined
        ? { id: CURRENT_TERMS_ID }
        : overrides.currentTerms;
    },
    transition: async (_tx, dealId, actorId, reason) => {
      recorded.calls.push('transition');
      const legal = status === 'pending';
      if (!legal) {
        throw new TransitionError(
          `cannot accept from ${status}`,
          getErrorCodeForInvalidTransition(status, 'accepted')
        );
      }
      recorded.transitions.push({ dealId, actorId, reason });
    },
    stampRights: async (_tx, dealId, rightsTermsId, acceptedAt) => {
      recorded.calls.push('stampRights');
      recorded.stamped.push({ dealId, rightsTermsId, acceptedAt });
    },
    now: () => overrides.now ?? FIXED_NOW,
    run: async (fn) => {
      const notify = (async (
        userId: string,
        type: string,
        payload: unknown
      ) => {
        recorded.calls.push('notify');
        if (overrides.failNotify) throw new Error('resend down');
        recorded.notifications.push({ userId, type, payload });
      }) as Parameters<AcceptOfferDeps['run']>[0] extends (
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

function accept(
  deps: AcceptOfferDeps,
  over: {
    dealId?: string;
    creatorProfileId?: string;
    submittedRightsTermsId?: string;
  } = {}
) {
  return acceptOffer(
    over.dealId ?? DEAL_ID,
    {
      creatorProfileId: over.creatorProfileId ?? CREATOR_PROFILE_ID,
      actorUserId: CREATOR_USER_ID,
      submittedRightsTermsId: over.submittedRightsTermsId ?? CURRENT_TERMS_ID,
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

const ACCEPT_MODULE = read('lib/deals/accept-offer.ts');
const ACCEPT_ROUTE = read('app/api/deals/[id]/accept/route.ts');
const ACTIONS_COMPONENT = read('components/deals/offer-actions.tsx');
const SCHEMA = read('db/schema.ts');
const SEED = read('db/seed.ts');

/**
 * Read off the transition table rather than retyped, so a tenth status is a
 * failure here instead of a case this suite silently stops covering.
 */
const ALL_STATUSES = Object.keys(LEGAL_TRANSITIONS) as DealStatus[];
const NON_PENDING = ALL_STATUSES.filter((s) => s !== 'pending');

// -- AC-1: the deal moves, and the agreement is recorded ---------------------

describe('AC-1 — accepting records the agreement with its timestamp', () => {
  it('moves the deal to accepted through the state machine', async () => {
    const { deps, recorded } = makeDeps();

    const result = await accept(deps);

    expect(result).toEqual({
      ok: true,
      dealId: DEAL_ID,
      rightsTermsId: CURRENT_TERMS_ID,
      rightsAcceptedAt: FIXED_NOW,
    });
    expect(recorded.transitions).toEqual([
      {
        dealId: DEAL_ID,
        actorId: CREATOR_USER_ID,
        reason: ACCEPT_EVENT_REASON,
      },
    ]);
  });

  it('stamps both rights columns, neither of them null', async () => {
    const { deps, recorded } = makeDeps();

    await accept(deps);

    expect(recorded.stamped).toHaveLength(1);
    expect(recorded.stamped[0].rightsTermsId).toBe(CURRENT_TERMS_ID);
    expect(recorded.stamped[0].acceptedAt).toEqual(FIXED_NOW);
  });

  it('records the version the server read, never the one the client sent', async () => {
    // F31, and the reason `stampRights` is handed `current.id`.
    //
    // **No fixture can distinguish the two at the write.** The comparison above
    // has already refused every case where they differ, so by the time the stamp
    // runs `submittedRightsTermsId === current.id` necessarily. That is what
    // makes this worth a source guard rather than a behavioural assertion: a
    // module that stamped the submitted value would pass every test in this
    // file, and would then be wrong the moment the comparison is loosened.
    expect(ACCEPT_MODULE).toContain('stampRights(tx, dealId, current.id');
    expect(ACCEPT_MODULE).not.toMatch(
      /stampRights\([^)]*submittedRightsTermsId/
    );

    // What is checkable: the stamp tracks what the seam returned, across two
    // different current versions.
    for (const id of [CURRENT_TERMS_ID, STALE_TERMS_ID]) {
      const { deps, recorded } = makeDeps({ currentTerms: { id } });

      await accept(deps, { submittedRightsTermsId: id });

      expect(recorded.stamped[0].rightsTermsId).toBe(id);
    }
  });

  it('uses the submitted id for the comparison and nothing else', async () => {
    // The client's value reaches exactly one branch. If it also reached the
    // write, a loosened comparison would silently record the wrong version
    // rather than failing loudly.
    const uses = ACCEPT_MODULE.match(/input\.submittedRightsTermsId/g) ?? [];

    expect(uses).toHaveLength(1);
    expect(ACCEPT_MODULE).toContain(
      'input.submittedRightsTermsId !== current.id'
    );
  });

  it('uses one instant for the stamp and the expiry check', async () => {
    // Two `now()` calls could straddle the deadline: an offer that passed the
    // check would then record an acceptance timestamp after it expired.
    const { deps, recorded } = makeDeps();

    await accept(deps);

    expect(recorded.stamped[0].acceptedAt).toEqual(FIXED_NOW);
    expect(ACCEPT_MODULE.match(/deps\.now\(\)/g)).toHaveLength(1);
  });

  it('takes the actor from the session, never from the request', async () => {
    const { deps, recorded } = makeDeps();

    await accept(deps);

    expect(recorded.transitions[0].actorId).toBe(CREATOR_USER_ID);
    // `actorUserId` reaches the action from `guard()`; the body schema has one
    // field and it is not an id of a person.
    expect(ACCEPT_ROUTE).toContain('actorUserId = ctx.user.id');
  });
});

// -- AC-2: never accepted with either field null -----------------------------

describe('AC-2 — a deal can never be accepted with a null rights column', () => {
  it('is a database constraint, not just a code path', () => {
    expect(SCHEMA).toContain('deal_rights_accepted_when_accepted');
    // Drizzle interpolates the column references, so the assertion is on the
    // predicate's shape rather than on the SQL it renders to.
    expect(SCHEMA).toMatch(
      /\$\{t\.rightsTermsId\} is not null and \$\{t\.rightsAcceptedAt\} is not null/
    );
  });

  it('exempts only the statuses that never accepted anything', () => {
    // `pending`, `declined` and `expired` have nothing to record. Every status
    // at or past `accepted` is covered — which is what makes this structural
    // rather than a property of one code path.
    const check = SCHEMA.slice(
      SCHEMA.indexOf('deal_rights_accepted_when_accepted')
    ).slice(0, 400);

    for (const status of ['pending', 'declined', 'expired']) {
      expect(check).toContain(`'${status}'`);
    }
    for (const status of NON_PENDING.filter(
      (s) => s !== 'declined' && s !== 'expired'
    )) {
      expect(check).not.toContain(`'${status}'`);
    }
  });

  it('ships as a migration rather than a schema edit alone', () => {
    const migration = readFileSync(
      'drizzle/0005_slow_winter_soldier.sql',
      'utf8'
    );

    expect(migration).toContain('deal_rights_accepted_when_accepted');
    expect(migration).toMatch(/ALTER TABLE "deal" ADD CONSTRAINT/i);
  });

  it('writes the status and the rights columns in one transaction', async () => {
    // Both inside the single `run` callback, so no reader ever observes a deal
    // at `accepted` with null rights columns — the constraint enforces that from
    // the database's side and this is the path that satisfies it.
    const { deps, recorded } = makeDeps();

    await accept(deps);

    expect(recorded.calls).toEqual([
      'loadDeal',
      'getRightsTerms',
      'transition',
      'stampRights',
      'notify',
    ]);
    expect(recorded.committed).toBe(true);
  });

  it('stamps after the transition, never before', async () => {
    const { deps, recorded } = makeDeps();

    await accept(deps);

    expect(recorded.calls.indexOf('transition')).toBeLessThan(
      recorded.calls.indexOf('stampRights')
    );
  });

  it('leaves the seed able to walk a deal past accepted', () => {
    // `walkDealTo` used to move the status and then stamp `rights_accepted_at`
    // in a *second* UPDATE, which the constraint rejects at the first statement.
    // The seed now does what the real action does: one `.set({...})`, which is
    // what `transitionDemoDeal`'s trailing argument is folded into.
    expect(SEED).toMatch(/\.set\(\{ status: to, \.\.\.also \}\)/);
    expect(SEED).toMatch(/'accepted',[\s\S]{0,80}\{ rightsAcceptedAt/);

    // And no lone update that stamps the timestamp on its own.
    expect(SEED).not.toMatch(/\.set\(\{\s*rightsAcceptedAt/);
  });
});

// -- AC-3: the terms version is required, and must be the current one --------

describe('AC-3 — accepting without the current terms is refused', () => {
  it('refuses a superseded version with stale_terms', async () => {
    const { deps } = makeDeps();

    const result = await accept(deps, {
      submittedRightsTermsId: STALE_TERMS_ID,
    });

    expect(result).toEqual({ ok: false, reason: 'stale_terms' });
  });

  it('writes no deal_event when the terms were stale', async () => {
    // `deal_event` is append-only (invariant 5), so a row written before the
    // refusal could not be taken back. The check runs before the transition for
    // exactly this reason.
    const { deps, recorded } = makeDeps();

    await accept(deps, { submittedRightsTermsId: STALE_TERMS_ID });

    expect(recorded.transitions).toHaveLength(0);
    expect(recorded.stamped).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
    expect(recorded.calls).not.toContain('transition');
  });

  it('reads the current version inside the caller’s transaction', () => {
    // The pool is `max: 5`; a query on the global `db` while `tx` holds a
    // `FOR UPDATE` lock can deadlock — documented in `remove-from-cart.ts`.
    expect(ACCEPT_MODULE).toContain('getCurrentRightsTerms(tx)');
    expect(ACCEPT_MODULE).not.toMatch(/getCurrentRightsTerms\(\s*db\s*\)/);
    expect(ACCEPT_MODULE).not.toMatch(/from\s+'@\/db'\s*;/);
  });

  it('throws rather than 4xx when no version is in effect at all', async () => {
    // An unseeded environment, not something the creator did. There is no
    // sentence that would help and no action they could take.
    const { deps, recorded } = makeDeps({ currentTerms: null });

    await expect(accept(deps)).rejects.toBeInstanceOf(MissingRightsTermsError);
    expect(recorded.transitions).toHaveLength(0);
    expect(recorded.committed).toBe(false);
  });
});

// -- AC-4: non-pending and expired offers ------------------------------------

describe('AC-4 — a non-pending offer is refused with the machine’s own code', () => {
  it.each(NON_PENDING)('refuses %s', async (status) => {
    const { deps, recorded } = makeDeps({ status });

    const result = await accept(deps);

    expect(result).toEqual({
      ok: false,
      reason: 'illegal',
      code: getErrorCodeForInvalidTransition(status, 'accepted'),
    });
    // The refusal comes from the state machine, so no status is written.
    expect(recorded.stamped).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('answers a second accept with OFFER_NOT_PENDING, not a second event', async () => {
    // Idempotency. The retry arrives as `accepted → accepted`, which is not a
    // legal edge, so it is refused rather than appending a duplicate.
    const { deps, recorded } = makeDeps({ status: 'accepted' });

    const result = await accept(deps);

    expect(result).toEqual({
      ok: false,
      reason: 'illegal',
      code: ErrorCode.OFFER_NOT_PENDING,
    });
    expect(recorded.transitions).toHaveLength(0);
  });

  it('lets an unrelated failure out rather than reporting it as illegal', async () => {
    // Only `TransitionError` means "the machine said no". Swallowing everything
    // would turn a connection drop into a 409 the creator cannot act on.
    const { deps } = makeDeps();

    await expect(
      accept({
        ...deps,
        transition: async () => {
          throw new Error('connection terminated');
        },
      })
    ).rejects.toThrow('connection terminated');
  });
});

describe('AC-4 — a lapsed offer is refused even while still pending', () => {
  it('refuses a deadline in the past', async () => {
    const { deps, recorded } = makeDeps({
      now: new Date(OFFER_DEADLINE.getTime() + 1),
    });

    const result = await accept(deps);

    expect(result).toEqual({ ok: false, reason: 'expired' });
    expect(recorded.transitions).toHaveLength(0);
  });

  it('accepts one millisecond before the deadline', async () => {
    const { deps } = makeDeps({
      now: new Date(OFFER_DEADLINE.getTime() - 1),
    });

    const result = await accept(deps);

    expect(result).toMatchObject({ ok: true });
  });

  it('treats the deadline itself as closed', () => {
    // Inclusive, so accepting at exactly that instant does not depend on whether
    // KAN-38's sweep happened to run first.
    expect(isOfferExpired(OFFER_DEADLINE, OFFER_DEADLINE)).toBe(true);
    expect(
      isOfferExpired(OFFER_DEADLINE, new Date(OFFER_DEADLINE.getTime() - 1))
    ).toBe(false);
  });

  it('never lapses a deal with no deadline', async () => {
    // Every offer KAN-33 issues carries one; a null is an older row, and
    // refusing it would invent a rule the brand never set.
    expect(isOfferExpired(null, FIXED_NOW)).toBe(false);

    const { deps } = makeDeps({ offerExpiresAt: null });
    expect(await accept(deps)).toMatchObject({ ok: true });
  });

  it('refuses without writing expired, which is KAN-38’s transition', async () => {
    // That transition releases the reserved budget back to the brand (AC-018).
    // Tapping Accept too late must not trigger it as a side effect. The module
    // has an `expired` *result reason* — what it must never have is a transition
    // to that status.
    const { deps, recorded } = makeDeps({
      now: new Date(OFFER_DEADLINE.getTime() + 1),
    });

    await accept(deps);

    expect(recorded.calls).not.toContain('transition');
    expect(ACCEPT_MODULE).not.toMatch(/transitionDeal\([^)]*'expired'/);
    expect(ACCEPT_MODULE).toContain("transitionDeal(tx, dealId, 'accepted'");
  });

  it('checks the deadline itself, not the status', () => {
    // The sweep does not exist yet, so a lapsed offer is still `pending` in the
    // database and `transitionDeal` would accept it without complaint.
    expect(ACCEPT_MODULE).toContain('isOfferExpired(row.offerExpiresAt');
  });
});

// -- AC-6: only the creator named on the deal --------------------------------

describe('AC-6 — only the creator the offer was made to can accept', () => {
  it('puts the ownership scope in the where clause', () => {
    const { sql, params } = db
      .select()
      .from(deal)
      .where(buildAcceptOfferWhere(DEAL_ID, CREATOR_PROFILE_ID))
      .toSQL();

    // The creator id is the base the deal id narrows, so there is no argument
    // that produces a lookup without it.
    expect(params).toContain(CREATOR_PROFILE_ID);
    expect(params).toContain(DEAL_ID);
    expect(sql).toMatch(/"creator_id" = \$/);
    expect(ACCEPT_MODULE).toContain(
      'buildAcceptOfferWhere(dealId, creatorProfileId)'
    );
  });

  it('does not return another creator’s deal at all', async () => {
    const { deps, recorded } = makeDeps();

    const result = await accept(deps, {
      creatorProfileId: OTHER_CREATOR_PROFILE_ID,
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(recorded.transitions).toHaveLength(0);
    expect(recorded.stamped).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('takes the creator id from the session, never from the deal id', async () => {
    const { deps, recorded } = makeDeps();

    await accept(deps);

    expect(recorded.loads).toEqual([
      { dealId: DEAL_ID, creatorProfileId: CREATOR_PROFILE_ID },
    ]);
    expect(ACCEPT_ROUTE).toContain('creatorProfileId = ctx.creatorProfileId');
  });

  it('locks the deal row it is about to move', () => {
    // What serialises two concurrent accepts: the second waits here, then reads
    // `accepted` and is refused rather than writing a duplicate event.
    expect(ACCEPT_MODULE).toMatch(/\.for\('update'/);
  });
});

// -- AC-7: through the state machine, and only through it --------------------

describe('AC-7 — acceptance goes through the deal state machine', () => {
  it('delegates the status change and the event to transitionDeal', () => {
    expect(ACCEPT_MODULE).toContain("transitionDeal(tx, dealId, 'accepted'");
  });

  it('hand-writes neither a status nor a deal_event', () => {
    // Invariant 6 — every transition writes its event as it happens, and the
    // machine is the one place that knows how. A module that wrote either itself
    // could bypass the legality check entirely.
    expect(ACCEPT_MODULE).not.toMatch(/update\(deal\)[\s\S]{0,80}status:/);
    expect(ACCEPT_MODULE).not.toContain('insert(dealEvent)');
    expect(ACCEPT_MODULE).not.toContain('dealEvent');
  });

  it('records a reason a reader can understand', () => {
    expect(ACCEPT_EVENT_REASON).toMatch(/accepted/i);
    expect(ACCEPT_EVENT_REASON).not.toMatch(/KAN-\d+/);
  });

  it('updates only the rights columns of its own accord', () => {
    const stamp = ACCEPT_MODULE.slice(ACCEPT_MODULE.indexOf('stampRights:'));

    expect(stamp).toMatch(/\.set\(\{ rightsTermsId, rightsAcceptedAt/);
  });
});

// -- AC-8: the brand is told ------------------------------------------------

describe('AC-8 — the brand is notified that the offer was accepted', () => {
  it('addresses the brand’s user id, not the profile id', async () => {
    // The two-hop rule: business rows reference profile ids and notifications
    // address a user, so `campaign.brand_id` is walked through
    // `brand_profile.user_id`. The profile id here writes a row nobody reads.
    const { deps, recorded } = makeDeps();

    await accept(deps);

    expect(recorded.notifications).toHaveLength(1);
    expect(recorded.notifications[0].userId).toBe(BRAND_USER_ID);
    expect(recorded.notifications[0].userId).not.toBe(BRAND_PROFILE_ID);
    expect(recorded.notifications[0].userId).not.toBe(CREATOR_USER_ID);
    expect(ACCEPT_MODULE).toContain('brandProfile.userId');
  });

  it('sends the facts the sentence states and no profile copy', async () => {
    const { deps, recorded } = makeDeps();

    await accept(deps);

    expect(recorded.notifications[0].type).toBe('offer_accepted');
    expect(recorded.notifications[0].payload).toEqual({
      dealId: DEAL_ID,
      campaignId: CAMPAIGN_ID,
      campaignTitle: 'Ramadan Beauty Push',
      creatorHandle: CREATOR_HANDLE,
      totalPrice: TOTAL_PRICE,
    });
  });

  it('names the creator by public handle, never a legal name (NFR-010)', () => {
    expect(ACCEPT_MODULE).toContain('creatorProfile.tiktokHandle');
    expect(ACCEPT_MODULE).not.toMatch(/fullName|legalName|\bemail\b/);
  });

  it('keeps money an integer number of santim (invariant 4)', async () => {
    const { deps, recorded } = makeDeps();

    await accept(deps);

    const payload = recorded.notifications[0].payload as {
      totalPrice: number;
    };
    expect(Number.isInteger(payload.totalPrice)).toBe(true);
  });

  it('sends nothing when the acceptance rolls back', async () => {
    // The row is written inside the transaction and the email is flushed
    // strictly after commit, so a failure takes both with it.
    const { deps, recorded } = makeDeps({ failNotify: true });

    await expect(accept(deps)).rejects.toThrow('resend down');
    expect(recorded.notifications).toHaveLength(0);
    expect(recorded.committed).toBe(false);
  });

  it('notifies inside the transaction, after the write', async () => {
    const { deps, recorded } = makeDeps();

    await accept(deps);

    expect(recorded.calls.indexOf('stampRights')).toBeLessThan(
      recorded.calls.indexOf('notify')
    );
  });
});

// -- The endpoint ------------------------------------------------------------

describe('POST /api/deals/[id]/accept', () => {
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

  function post(body: unknown, id = DEAL_ID): Request {
    return new Request(`http://localhost/api/deals/${id}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  it('returns 200 with what was recorded', async () => {
    const { deps } = makeDeps();

    const response = await handleAcceptDeal(
      post({ rightsTermsId: CURRENT_TERMS_ID }),
      DEAL_ID,
      { acceptOfferDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      deal_id: DEAL_ID,
      status: 'accepted',
      rights_terms_id: CURRENT_TERMS_ID,
      rights_accepted_at: FIXED_NOW.toISOString(),
    });
  });

  it('rejects an accept call that omits rights_terms_id', async () => {
    // AC-3, at the edge of the system: accepting without naming a terms version
    // is not a thing the endpoint can do, and it is refused before any query.
    const { deps, recorded } = makeDeps();

    const response = await handleAcceptDeal(post({}), DEAL_ID, {
      acceptOfferDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(recorded.calls).toHaveLength(0);
  });

  it.each([
    ['a non-uuid terms id', { rightsTermsId: 'yes-i-agree' }],
    ['a null terms id', { rightsTermsId: null }],
    ['no body fields at all', {}],
  ])('refuses %s with 422 and runs nothing', async (_label, body) => {
    const { deps, recorded } = makeDeps();

    const response = await handleAcceptDeal(post(body), DEAL_ID, {
      acceptOfferDeps: deps,
    });

    expect(response.status).toBe(422);
    expect(recorded.calls).toHaveLength(0);
  });

  it('refuses a body that is not JSON at all', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleAcceptDeal(post('not json'), DEAL_ID, {
      acceptOfferDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(recorded.calls).toHaveLength(0);
  });

  it('returns 409 RIGHTS_TERMS_STALE for a superseded version', async () => {
    const { deps } = makeDeps();

    const response = await handleAcceptDeal(
      post({ rightsTermsId: STALE_TERMS_ID }),
      DEAL_ID,
      { acceptOfferDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.RIGHTS_TERMS_STALE);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.RIGHTS_TERMS_STALE]);
  });

  it('tells the creator to reload rather than that the offer moved on', () => {
    // `OFFER_NOT_PENDING`'s sentence would be plainly false here — the offer
    // still is pending — and would send them looking for a status change that
    // never happened.
    const message = ErrorMessage[ErrorCode.RIGHTS_TERMS_STALE];

    expect(message).not.toBe(ErrorMessage[ErrorCode.OFFER_NOT_PENDING]);
    expect(message).toMatch(/reload|refresh/i);
    expect(message).not.toMatch(/KAN-\d+/);
  });

  it('returns 409 OFFER_EXPIRED past the deadline', async () => {
    const { deps } = makeDeps({
      now: new Date(OFFER_DEADLINE.getTime() + 1),
    });

    const response = await handleAcceptDeal(
      post({ rightsTermsId: CURRENT_TERMS_ID }),
      DEAL_ID,
      { acceptOfferDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.OFFER_EXPIRED);
  });

  it.each(NON_PENDING)('maps %s to the machine’s own code', async (status) => {
    const { deps } = makeDeps({ status });
    const code = getErrorCodeForInvalidTransition(status, 'accepted');

    const response = await handleAcceptDeal(
      post({ rightsTermsId: CURRENT_TERMS_ID }),
      DEAL_ID,
      { acceptOfferDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(code);
    expect(body.error.message).toBe(ErrorMessage[code]);
  });

  it('collapses a deal that vanished into 403, not 404', async () => {
    // A distinct code would make the URL an existence oracle for deal ids.
    const { deps } = makeDeps({ dealMissing: true });

    const response = await handleAcceptDeal(
      post({ rightsTermsId: CURRENT_TERMS_ID }),
      DEAL_ID,
      { acceptOfferDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('gates before the body is parsed', async () => {
    // AC-5. A caller who does not own this deal never gets as far as having
    // their JSON read, so a 403 and a 422 cannot be played off each other to
    // learn whether a deal id exists.
    const { deps, recorded } = makeDeps();
    guardMock.mockRejectedValueOnce(new ForbiddenError('not the owner'));

    const response = await handleAcceptDeal(post({}), DEAL_ID, {
      acceptOfferDeps: deps,
    });

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
  });

  it.each(['brand', 'admin'])(
    'refuses a %s and never enters acceptOffer',
    async (role) => {
      const { deps, recorded } = makeDeps();
      guardMock.mockRejectedValueOnce(new ForbiddenError(`role ${role}`));

      const response = await handleAcceptDeal(
        post({ rightsTermsId: CURRENT_TERMS_ID }),
        DEAL_ID,
        { acceptOfferDeps: deps }
      );

      expect(response.status).toBe(403);
      expect(recorded.calls).toHaveLength(0);
    }
  );

  it('refuses an anonymous caller', async () => {
    const { deps, recorded } = makeDeps();
    guardMock.mockRejectedValueOnce(new ForbiddenError('no session'));

    const response = await handleAcceptDeal(
      post({ rightsTermsId: CURRENT_TERMS_ID }),
      DEAL_ID,
      { acceptOfferDeps: deps }
    );

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
  });

  it('refuses a creator with no profile row', async () => {
    // Nothing left to authorise: a creator with no profile cannot own a deal.
    const { deps, recorded } = makeDeps();
    guardMock.mockResolvedValueOnce({
      user: {
        id: CREATOR_USER_ID,
        email: 'creator@example.com',
        name: 'Selam',
        role: 'creator',
      },
      brandProfileId: null,
      creatorProfileId: null,
    });

    const response = await handleAcceptDeal(
      post({ rightsTermsId: CURRENT_TERMS_ID }),
      DEAL_ID,
      { acceptOfferDeps: deps }
    );

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
  });

  it('rejects a malformed id without touching the database', async () => {
    // Postgres answers a non-uuid compared against a `uuid` column with 22P02,
    // which would turn a mistyped link into a 500 (F16).
    const { deps, recorded } = makeDeps();

    const response = await handleAcceptDeal(
      post({ rightsTermsId: CURRENT_TERMS_ID }, 'not-a-uuid'),
      'not-a-uuid',
      { acceptOfferDeps: deps }
    );

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
    expect(guardMock).not.toHaveBeenCalled();
  });

  it('asks the guard for the deal, not merely for the role', () => {
    // Two layers: role, then ownership on the resource itself (NFR-005).
    expect(ACCEPT_ROUTE).toMatch(/roles: \['creator'\]/);
    expect(ACCEPT_ROUTE).toMatch(/resource: \{ kind: 'deal', id \}/);
  });

  it('runs on the node runtime, since pg needs node APIs', () => {
    expect(ACCEPT_ROUTE).toContain("export const runtime = 'nodejs'");
  });
});

// -- The surface the creator taps --------------------------------------------

describe('the accept surface', () => {
  it('gates the button on the agreement, not the endpoint on the button', () => {
    // NFR-005. Disabling a control stops an accident, not an attacker — the
    // endpoint requires the field, compares it, and stamps its own read.
    expect(ACTIONS_COMPONENT).toMatch(/const canAccept = agreed &&/);
    expect(ACCEPT_ROUTE).toContain('acceptDealSchema.safeParse(body)');
  });

  it('names no ticket in anything a creator reads', () => {
    // Every string the component renders comes from a constant, and none of
    // them may leak a KAN number.
    expect(ACTIONS_COMPONENT).not.toMatch(/KAN-\d+/);
  });

  it('explains itself in a sentence, never a tooltip', () => {
    // Hover-only copy tells a touch user nothing (KAN-29's rule). Scoped to
    // intrinsic elements, since `title` is also an ordinary React prop.
    expect(ACTIONS_COMPONENT).not.toMatch(/<[a-z][a-zA-Z0-9]*\s[^>]*\stitle=/);
  });

  it('is a styled button, not Base UI’s client component', () => {
    expect(ACTIONS_COMPONENT).toContain('buttonVariants');
    expect(ACTIONS_COMPONENT).not.toMatch(/<Button\s/);
  });
});
