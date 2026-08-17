import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, ErrorHttpStatus } from '../lib/validation/errors';
import {
  LEGAL_TRANSITIONS,
  TransitionError,
  getErrorCodeForInvalidTransition,
  transitionDeal,
} from '../lib/deals/state-machine';
import { PAYABLE_FROM, REFUNDABLE_FROM } from '../lib/payment/ledger';
import { ForbiddenError } from '../lib/authz';
import type { Tx } from '../lib/authz';
import type { DealStatus } from '../db/schema';

/**
 * `guard` is the one dependency that reads a request. Mocking it lets the real
 * `requireDealAccess` be asserted on the options it passes, which is where the
 * two-layer check actually lives — the `campaign-cart.test.ts` precedent.
 */
const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const {
  getDealHistory,
  dealHistoryQuery,
  requireDealAccess,
  selectDealHistory,
  toHistoryEvent,
} = await import('../lib/deals/queries');

beforeEach(() => {
  guardMock.mockReset();
});

const DEAL_ID = 'd0000000-0000-0000-0000-000000000001';
const ACTOR_ID = 'a0000000-0000-0000-0000-000000000001';

/**
 * Derived from the table itself, so a tenth status cannot be added to
 * `DealStatus` without every case below covering it too. `LEGAL_TRANSITIONS`
 * is annotated `Record<DealStatus, ...>`, so its keys are exactly the union.
 */
const ALL_STATUSES = Object.keys(LEGAL_TRANSITIONS) as DealStatus[];

const ALL_PAIRS: { from: DealStatus; to: DealStatus }[] = ALL_STATUSES.flatMap(
  (from) => ALL_STATUSES.map((to) => ({ from, to }))
);

function createMockTx(existingDeal: { id: string; status: DealStatus } | null) {
  const limit = vi.fn().mockResolvedValue(existingDeal ? [existingDeal] : []);
  const forUpdate = vi.fn(() => ({ limit }));
  const whereSelect = vi.fn(() => ({ for: forUpdate }));
  const from = vi.fn(() => ({ where: whereSelect }));
  const select = vi.fn(() => ({ from }));

  const whereUpdate = vi.fn().mockResolvedValue([]);
  const setUpdate = vi.fn(() => ({ where: whereUpdate }));
  const update = vi.fn(() => ({ set: setUpdate }));

  const valuesInsert = vi.fn().mockResolvedValue([]);
  const insert = vi.fn(() => ({ values: valuesInsert }));

  const tx = { select, update, insert } as unknown as Tx;

  return {
    tx,
    spies: {
      select,
      forUpdate,
      limit,
      update,
      setUpdate,
      insert,
      valuesInsert,
    },
  };
}

/**
 * FR-007, restated by hand.
 *
 * The exhaustive sweep below derives what it expects *from* `LEGAL_TRANSITIONS`,
 * so it proves the implementation obeys the table but can say nothing about
 * whether the table is right — an edge typo'd into it would be tested as
 * gospel. This literal is the independent statement of the requirement, and
 * the only place FR-007 is written down twice on purpose.
 */
const FR_007: Record<DealStatus, DealStatus[]> = {
  pending: ['accepted', 'declined', 'expired'],
  accepted: ['funded'],
  // `refunded` on the next three is the admin dispute path (AC-030).
  funded: ['delivered', 'refunded'],
  delivered: ['completed', 'revision_requested', 'refunded'],
  revision_requested: ['delivered', 'refunded'],
  declined: [],
  expired: [],
  completed: [],
  refunded: [],
};

describe('FR-007 transition table (AC-002)', () => {
  it('matches the requirement edge for edge', () => {
    for (const status of ALL_STATUSES) {
      expect(
        [...LEGAL_TRANSITIONS[status]].sort(),
        `transitions out of ${status}`
      ).toEqual([...FR_007[status]].sort());
    }
  });

  it('covers every status, with no key the union does not have', () => {
    expect(ALL_STATUSES).toHaveLength(9);
    expect([...ALL_STATUSES].sort()).toEqual([...Object.keys(FR_007)].sort());
  });

  it('leaves the four terminal states with no way out', () => {
    for (const terminal of ['declined', 'expired', 'completed', 'refunded']) {
      expect(LEGAL_TRANSITIONS[terminal as DealStatus]).toEqual([]);
    }
  });

  it('lets nothing transition back to pending', () => {
    // A deal is *created* pending. Anything re-entering it would reopen an
    // offer that was already answered, and re-arm the expiry sweep on it.
    for (const status of ALL_STATUSES) {
      expect(LEGAL_TRANSITIONS[status]).not.toContain('pending');
    }
  });

  it('agrees with the ledger about which states money can leave', () => {
    // Two guards, one rule. If these drift, the ledger either refuses a refund
    // the machine permits or attempts one it forbids — and the second is a
    // provider call made before the transition that would have rejected it.
    const refundable = ALL_STATUSES.filter((s) =>
      LEGAL_TRANSITIONS[s].includes('refunded')
    );
    expect(refundable.sort()).toEqual([...REFUNDABLE_FROM].sort());
    expect(LEGAL_TRANSITIONS[PAYABLE_FROM]).toContain('completed');
  });
});

describe('transitionDeal — every ordered pair (AC-002, AC-004, NFR-009)', () => {
  const legal = ALL_PAIRS.filter(({ from, to }) =>
    LEGAL_TRANSITIONS[from].includes(to)
  );
  const illegal = ALL_PAIRS.filter(
    ({ from, to }) => !LEGAL_TRANSITIONS[from].includes(to)
  );

  it('splits 81 pairs into 11 legal and 70 illegal', () => {
    expect(ALL_PAIRS).toHaveLength(81);
    expect(legal).toHaveLength(11);
    expect(illegal).toHaveLength(70);
  });

  for (const { from, to } of legal) {
    it(`applies ${from} -> ${to}`, async () => {
      const { tx, spies } = createMockTx({ id: DEAL_ID, status: from });

      const result = await transitionDeal(tx, DEAL_ID, to, ACTOR_ID, {
        reason: 'why',
      });

      expect(result.status).toBe(to);
      expect(spies.setUpdate).toHaveBeenCalledWith({ status: to });
      expect(spies.valuesInsert).toHaveBeenCalledWith({
        dealId: DEAL_ID,
        fromStatus: from,
        toStatus: to,
        actorId: ACTOR_ID,
        reason: 'why',
      });
    });
  }

  for (const { from, to } of illegal) {
    it(`refuses ${from} -> ${to} and writes nothing`, async () => {
      const { tx, spies } = createMockTx({ id: DEAL_ID, status: from });

      await expect(transitionDeal(tx, DEAL_ID, to, ACTOR_ID)).rejects.toThrow(
        TransitionError
      );

      // AC-004: state unchanged. Neither the status write nor the event.
      expect(spies.update).not.toHaveBeenCalled();
      expect(spies.insert).not.toHaveBeenCalled();
    });
  }
});

describe('transitionDeal — locking and audit (AC-003, AC-005)', () => {
  it('locks the row FOR UPDATE before judging legality', async () => {
    const { tx, spies } = createMockTx({ id: DEAL_ID, status: 'pending' });

    await transitionDeal(tx, DEAL_ID, 'accepted', ACTOR_ID);

    expect(spies.forUpdate).toHaveBeenCalledWith('update');
    expect(spies.limit).toHaveBeenCalledWith(1);
  });

  it('judges the locked row, not a status the caller supplied', () => {
    // There is no `fromStatus` parameter, and that is the design: the only
    // status the guard can see is the one it just read under the lock, so a
    // stale value a caller read earlier cannot be smuggled past it.
    const source = readFileSync('lib/deals/state-machine.ts', 'utf8');
    const signature = source.slice(
      source.indexOf('export async function transitionDeal')
    );
    expect(signature.slice(0, signature.indexOf(')'))).not.toMatch(
      /fromStatus|from:/
    );
  });

  it('reads the row before it writes anything', async () => {
    const order: string[] = [];
    const { tx, spies } = createMockTx({ id: DEAL_ID, status: 'pending' });
    spies.limit.mockImplementation(async () => {
      order.push('select');
      return [{ id: DEAL_ID, status: 'pending' as DealStatus }];
    });
    spies.setUpdate.mockImplementation(() => {
      order.push('update');
      return { where: vi.fn().mockResolvedValue([]) };
    });
    spies.valuesInsert.mockImplementation(async () => {
      order.push('insert');
    });

    await transitionDeal(tx, DEAL_ID, 'accepted', ACTOR_ID);

    expect(order).toEqual(['select', 'update', 'insert']);
  });

  it('records a null actor for system actions', async () => {
    const { tx, spies } = createMockTx({ id: DEAL_ID, status: 'pending' });

    // The expiry sweep has no user behind it. `undefined` and explicit `null`
    // both have to land as SQL NULL — `undefined` would be dropped from the
    // insert and take the column default with it.
    await transitionDeal(tx, DEAL_ID, 'expired');

    expect(spies.valuesInsert).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null })
    );
  });

  it('accepts an explicit null actor as well as an omitted one', async () => {
    const { tx, spies } = createMockTx({ id: DEAL_ID, status: 'pending' });

    await transitionDeal(tx, DEAL_ID, 'expired', null);

    expect(spies.valuesInsert).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null })
    );
  });

  it('leaves reason undefined when none is given', async () => {
    const { tx, spies } = createMockTx({ id: DEAL_ID, status: 'pending' });

    await transitionDeal(tx, DEAL_ID, 'accepted', ACTOR_ID);

    expect(spies.valuesInsert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: undefined })
    );
  });

  it('returns the row carrying its new status', async () => {
    const { tx } = createMockTx({ id: DEAL_ID, status: 'delivered' });

    const result = await transitionDeal(tx, DEAL_ID, 'completed', ACTOR_ID);

    expect(result).toMatchObject({ id: DEAL_ID, status: 'completed' });
  });

  it('reports a missing deal as NOT_FOUND, not as an illegal transition', async () => {
    const { tx, spies } = createMockTx(null);

    await expect(
      transitionDeal(tx, DEAL_ID, 'accepted', ACTOR_ID)
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
  });
});

describe('transitionDeal — idempotency under retry (AC-008)', () => {
  // Every legal transition, replayed once it has already landed. The retry
  // arrives as `to -> to`, which is in no row of the table, so it is refused
  // by the same guard rather than applied a second time.
  for (const { from, to } of ALL_PAIRS.filter(({ from, to }) =>
    LEGAL_TRANSITIONS[from].includes(to)
  )) {
    it(`refuses a replay of ${from} -> ${to}`, async () => {
      const { tx, spies } = createMockTx({ id: DEAL_ID, status: to });

      await expect(transitionDeal(tx, DEAL_ID, to, ACTOR_ID)).rejects.toThrow(
        TransitionError
      );

      expect(spies.update).not.toHaveBeenCalled();
      expect(spies.insert).not.toHaveBeenCalled();
    });
  }
});

describe('getErrorCodeForInvalidTransition (AC-004)', () => {
  it('returns a code for all 81 pairs', () => {
    for (const { from, to } of ALL_PAIRS) {
      expect(Object.values(ErrorCode), `${from} -> ${to}`).toContain(
        getErrorCodeForInvalidTransition(from, to)
      );
    }
  });

  it('answers a lapsed offer with OFFER_EXPIRED, not OFFER_NOT_PENDING', () => {
    // The PRD gives the expired offer its own code and its own copy —
    // "inform creator the offer expired" rather than "refresh deal state".
    // Only `fromStatus` tells the two apart, which is why this function takes
    // both ends.
    expect(getErrorCodeForInvalidTransition('expired', 'accepted')).toBe(
      ErrorCode.OFFER_EXPIRED
    );
    expect(getErrorCodeForInvalidTransition('expired', 'declined')).toBe(
      ErrorCode.OFFER_EXPIRED
    );
  });

  it('does not answer a brand-side action on an expired deal that way', () => {
    // Funding is not something the creator did to the offer, so the useful
    // answer is still the failed precondition: it was never accepted.
    expect(getErrorCodeForInvalidTransition('expired', 'funded')).toBe(
      ErrorCode.NO_ACCEPTED_DEALS
    );
  });

  it('names the failed precondition for every other target', () => {
    const cases: [DealStatus, ErrorCode][] = [
      ['accepted', ErrorCode.OFFER_NOT_PENDING],
      ['declined', ErrorCode.OFFER_NOT_PENDING],
      ['expired', ErrorCode.OFFER_NOT_PENDING],
      ['funded', ErrorCode.NO_ACCEPTED_DEALS],
      ['delivered', ErrorCode.DEAL_NOT_FUNDED],
      ['refunded', ErrorCode.DEAL_NOT_FUNDED],
      ['completed', ErrorCode.DEAL_NOT_DELIVERED],
      ['revision_requested', ErrorCode.DEAL_NOT_DELIVERED],
      ['pending', ErrorCode.VALIDATION_ERROR],
    ];
    // `completed` is a terminal state and never the `from` of the expired
    // special case, so it exercises the plain target-keyed mapping.
    for (const [to, code] of cases) {
      expect(getErrorCodeForInvalidTransition('completed', to)).toBe(code);
    }
    expect(cases).toHaveLength(ALL_STATUSES.length);
  });

  it('gives every lifecycle refusal a 409 and the invented target a 422', () => {
    for (const { from, to } of ALL_PAIRS.filter(
      ({ from, to }) => !LEGAL_TRANSITIONS[from].includes(to)
    )) {
      const code = getErrorCodeForInvalidTransition(from, to);
      expect(ErrorHttpStatus[code], `${from} -> ${to}`).toBe(
        to === 'pending' ? 422 : 409
      );
    }
  });
});

/**
 * "A single transition function owns all `deal.status` writes." That is a claim
 * about the whole codebase, not about one module, so it is checked by reading
 * the codebase — the `audit_log is insert-only` precedent. A unit test of any
 * one file could not observe the ticket that breaks it, and this invariant
 * decays silently: the next ticket adds its own `tx.update(deal).set({ status
 * })`, nothing complains, and the only thing lost is the `deal_event` the
 * transition it skipped would have written.
 */
describe('toHistoryEvent — the actor columns (AC-005, AC-009)', () => {
  const base = {
    id: 'e1',
    fromStatus: 'pending',
    toStatus: 'accepted',
    reason: null,
    createdAt: new Date(0),
  };

  it('folds a present actor into one object', () => {
    expect(
      toHistoryEvent({ ...base, actorId: ACTOR_ID, actorName: 'Amina' })
    ).toEqual({ ...base, actor: { id: ACTOR_ID, name: 'Amina' } });
  });

  it('reports the system as no actor rather than a blank name', () => {
    // AC-005 allows a null actor_id for system actions, and the expiry sweep is
    // the one that uses it. `{ id: null, name: null }` would render as an empty
    // byline; null renders as "the system".
    expect(
      toHistoryEvent({ ...base, actorId: null, actorName: null })
    ).toMatchObject({ actor: null });
  });

  it('reports a deleted account as no actor too', () => {
    // `user.name` is not null, so an actorId with no name means the left join
    // found nothing. Attributing the action to a blank is worse than to nobody.
    expect(
      toHistoryEvent({ ...base, actorId: ACTOR_ID, actorName: null })
    ).toMatchObject({ actor: null });
  });

  it('carries no column the join did not select', () => {
    const event = toHistoryEvent({
      ...base,
      actorId: ACTOR_ID,
      actorName: 'Amina',
    });
    expect(Object.keys(event).sort()).toEqual([
      'actor',
      'createdAt',
      'fromStatus',
      'id',
      'reason',
      'toStatus',
    ]);
  });
});

describe('selectDealHistory — every row, in the order given (AC-009)', () => {
  const row = (id: string, actorName: string | null) => ({
    id,
    fromStatus: 'pending',
    toStatus: 'accepted',
    reason: null,
    createdAt: new Date(0),
    actorId: actorName ? ACTOR_ID : null,
    actorName,
  });

  it('folds all of them, not just the first', async () => {
    // A `rows[0]`-shaped bug is invisible against a one-row fixture, and a deal
    // history is the opposite of one row long.
    const events = await selectDealHistory(DEAL_ID, async () => [
      row('e1', 'Amina'),
      row('e2', null),
      row('e3', 'Dawit'),
    ]);

    expect(events.map((e) => e.actor?.name ?? null)).toEqual([
      'Amina',
      null,
      'Dawit',
    ]);
  });

  it('preserves the order the query returned', async () => {
    // The ordering is the database's job — asserted on the emitted SQL below.
    // This half is that nothing re-sorts the rows on the way out.
    const events = await selectDealHistory(DEAL_ID, async () => [
      row('e3', null),
      row('e1', null),
      row('e2', null),
    ]);

    expect(events.map((e) => e.id)).toEqual(['e3', 'e1', 'e2']);
  });

  it('passes the deal id through to the query', async () => {
    const run = vi.fn(async () => []);

    await selectDealHistory(DEAL_ID, run);

    expect(run).toHaveBeenCalledWith(DEAL_ID);
  });

  it('returns nothing for a deal with no events', async () => {
    await expect(selectDealHistory(DEAL_ID, async () => [])).resolves.toEqual(
      []
    );
  });
});

describe('requireDealAccess — the real gate (NFR-005, invariant 2)', () => {
  it('asks for both layers, and admits both sides of the deal', async () => {
    guardMock.mockResolvedValue({});

    await requireDealAccess(DEAL_ID);

    const [options] = guardMock.mock.calls[0];
    // Layer 1: the three roles that have any business reading a deal.
    expect([...options.roles].sort()).toEqual(['admin', 'brand', 'creator']);
    // Layer 2: the ownership check, which is the half that stops a signed-in
    // brand reading another brand's deal.
    expect(options.resource).toEqual({ kind: 'deal', id: DEAL_ID });
    // An admin resolving a dispute owns nothing on the deal.
    expect(options.allowAdmin).toBe(true);
  });

  it('is what getDealHistory uses when no deps are injected', async () => {
    // The deps seam exists for tests. If the default ever drifts from the gate
    // above, every test in this file would still pass while the shipped path
    // went ungated.
    guardMock.mockRejectedValue(new ForbiddenError('nope'));

    await expect(getDealHistory(DEAL_ID)).rejects.toThrow(ForbiddenError);
    expect(guardMock).toHaveBeenCalledWith(
      expect.objectContaining({ resource: { kind: 'deal', id: DEAL_ID } })
    );
  });
});

describe('AC-001 — one function owns every deal.status write', () => {
  const root = join(__dirname, '..');

  function sourceFiles(dir: string): string[] {
    return readdirSync(join(root, dir), { recursive: true })
      .map(String)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => join(root, dir, f));
  }

  // Application code only. `db/seed.ts` is excluded on purpose: it drives demo
  // deals straight to statuses that have no endpoint to reach them through yet,
  // and it writes its own `deal_event` for each, so the audit trail stays whole
  // even though the machine is bypassed.
  const files = [...sourceFiles('lib'), ...sourceFiles('app')].filter(
    (f) => f !== join(root, 'lib/deals/state-machine.ts')
  );

  it('finds the state machine to exclude, so the filter is not vacuous', () => {
    // If the path above ever stops matching, both checks below would still pass
    // — by testing a list that no longer contains the one file they exempt.
    expect(files.length).toBeGreaterThan(0);
    expect(files).not.toContain(join(root, 'lib/deals/state-machine.ts'));
    expect(
      readFileSync(join(root, 'lib/deals/state-machine.ts'), 'utf8')
    ).toMatch(
      /update\(deal\)\s*\.set\(\{ status: toStatus, \.\.\.opts\?\.set \}\)/
    );
  });

  it('has no other drizzle write to deal.status', () => {
    const offenders = files.filter((file) =>
      /\.\s*update\(\s*(schema\.)?deal\s*\)[\s\S]{0,160}?status\s*:/.test(
        readFileSync(file, 'utf8')
      )
    );
    expect(offenders).toEqual([]);
  });

  it('has no raw SQL write to deal.status', () => {
    const offenders = files.filter((file) =>
      /update\s+"?deal"?\s+set[\s\S]{0,80}?status/i.test(
        readFileSync(file, 'utf8')
      )
    );
    expect(offenders).toEqual([]);
  });

  it('has no other insert into deal_event', () => {
    // The converse half of AC-005. An event written outside the transition is
    // an audit row with no status change behind it.
    const offenders = files.filter((file) =>
      /\.\s*insert\(\s*(schema\.)?dealEvent\s*\)/.test(
        readFileSync(file, 'utf8')
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('getDealHistory — gating (AC-009, NFR-005)', () => {
  const ok = () => Promise.resolve({});

  it('runs the guard before the query', async () => {
    const order: string[] = [];

    await getDealHistory(DEAL_ID, {
      requireAccess: async () => {
        order.push('guard');
      },
      select: async () => {
        order.push('select');
        return [];
      },
    });

    expect(order).toEqual(['guard', 'select']);
  });

  it('passes the deal id to the guard so layer 2 can run', async () => {
    const requireAccess = vi.fn(ok);

    await getDealHistory(DEAL_ID, { requireAccess, select: async () => [] });

    // A guard called with no id can only check the role, which would let any
    // signed-in brand read any other brand's deal history.
    expect(requireAccess).toHaveBeenCalledWith(DEAL_ID);
  });

  it('never queries when the guard denies', async () => {
    const select = vi.fn(async () => []);

    await expect(
      getDealHistory(DEAL_ID, {
        requireAccess: async () => {
          throw new ForbiddenError('not yours');
        },
        select,
      })
    ).rejects.toThrow(ForbiddenError);

    expect(select).not.toHaveBeenCalled();
  });

  it('refuses a malformed id without reaching the guard or the query', async () => {
    const requireAccess = vi.fn(ok);
    const select = vi.fn(async () => []);

    await expect(
      getDealHistory('not-a-uuid', { requireAccess, select })
    ).rejects.toThrow(ForbiddenError);

    // Postgres answers a non-uuid compared to a uuid column with 22P02, so an
    // unchecked id turns a mistyped link into a 500.
    expect(requireAccess).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('denies a malformed id the same way it denies someone else’s', async () => {
    // Both are ForbiddenError with no detail, so the endpoint cannot be walked
    // as an existence oracle for deal ids (Tech Spec §6.3).
    const deps = {
      requireAccess: async () => {
        throw new ForbiddenError('does not own deal');
      },
      select: async () => [],
    };

    const malformed = await getDealHistory('nope', deps).catch((e) => e);
    const unowned = await getDealHistory(DEAL_ID, deps).catch((e) => e);

    expect(malformed).toBeInstanceOf(ForbiddenError);
    expect(unowned).toBeInstanceOf(ForbiddenError);
    expect(malformed.constructor).toBe(unowned.constructor);
  });

  it('returns what the query returned', async () => {
    const rows = [
      {
        id: 'e1',
        fromStatus: 'pending',
        toStatus: 'accepted',
        reason: null,
        createdAt: new Date(0),
        actor: null,
      },
    ];

    await expect(
      getDealHistory(DEAL_ID, {
        requireAccess: ok,
        select: async () => rows,
      })
    ).resolves.toEqual(rows);
  });
});

describe('getDealHistory — the emitted SQL (AC-009)', () => {
  const { sql } = dealHistoryQuery(DEAL_ID).toSQL();

  it('orders oldest first, which is what an audit trail means by in order', () => {
    expect(sql).toMatch(/order by[\s\S]*"created_at"\s+asc/i);
    expect(sql).not.toMatch(/"created_at"\s+desc/i);
  });

  it('breaks a tie on id rather than leaving the order to the planner', () => {
    // `deal_event.created_at` defaults to now(), and Postgres now() is
    // *transaction start* time — two events written for one deal in a single
    // transaction carry byte-identical timestamps.
    expect(sql).toMatch(/"created_at"\s+asc,\s*"deal_event"\."id"\s+asc/i);
  });

  it('left joins the actor so system events survive', () => {
    // An inner join would drop every transition with a null actor_id, which is
    // the whole expiry sweep.
    expect(sql).toMatch(/left join/i);
    expect(sql).not.toMatch(/inner join/i);
  });

  it('filters to the one deal', () => {
    expect(sql).toMatch(/where[\s\S]*deal_id/i);
  });

  it('selects no column beyond the actor’s name and id', () => {
    // NFR-010: the actor is shown so a human can be held to the action, and
    // nothing else about them travels with it.
    expect(sql).not.toMatch(/email|password|image/i);
  });
});
