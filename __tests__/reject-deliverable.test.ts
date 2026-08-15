import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REJECT_DELIVERABLE_EVENT_REASON,
  buildRejectDeliverableWhere,
  rejectDeliverable,
} from '../lib/deals/reject-deliverable';
import type {
  RejectDeliverableDeps,
  RejectDeliverableRow,
} from '../lib/deals/reject-deliverable';
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
 * KAN-47 — the brand rejects a delivered video with a reason (US-008,
 * AC-024, FR-007, Tech Spec §4.4 reject).
 *
 * Five claims carry the weight here.
 *
 * **No money moves, because there is no money call to make.** AC bullet 4 is
 * satisfied by the absence of a ledger call — the hold from funding stays
 * exactly where it is, and only approval (KAN-45) or refund (KAN-51) moves
 * it. Asserted as a source guard: this module imports nothing from the money
 * path.
 *
 * **The state machine is the status guard, which answers AC-5 on its own.**
 * `delivered → revision_requested` is the only legal edge, so every other
 * status surfaces `getErrorCodeForInvalidTransition(status,
 * 'revision_requested')` — `DEAL_NOT_DELIVERED` for a video that was never
 * submitted, and the machine's own code for a double-reject. This module
 * invents no status of its own.
 *
 * **The reason is stored twice, on purpose** (AC-3): on the deliverable row
 * (the durable record, reset on resubmission by KAN-46's upsert) and in the
 * creator's notification (what they act on). The `deal_event` reason stays a
 * fixed description, like every other event.
 *
 * **A refusal leaves no history behind.** `deal_event` is append-only, so
 * every refusal path asserts the transition seam was not reached, and a
 * rejection-record failure rolls the transition back with it — a deal the
 * brand sent back must always carry the note that says what to change.
 *
 * **AC-6 needs no new code and is asserted as such.** The creator's resubmit
 * edge (`revision_requested → delivered`) landed with KAN-46; the test pins
 * it so the loop visibly closes rather than being assumed.
 *
 * The UI assertions are source guards. There is no DOM environment in this
 * repo — see the header of `ui-primitives.test.ts` — so they assert what a
 * file references, never what it paints. Comments are stripped first, so a
 * guard cannot be satisfied by prose about the rule.
 */

const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleRejectDeliverable } =
  await import('../app/api/deals/[id]/reject/route');

const BRAND_USER_ID = '55555555-5555-4555-8555-555555555555';
const BRAND_PROFILE_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_BRAND_PROFILE_ID = '77777777-7777-4777-8777-777777777777';
const CREATOR_USER_ID = '99999999-9999-4999-8999-999999999999';
const CREATOR_PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEAL_ID = '33333333-3333-4333-8333-333333333333';

const REASON = 'Please show the packaging in the first three seconds.';
const CAMPAIGN_NAME = 'Ramadan Beauty Push';

interface Recorded {
  /** Seam names in call order — ordering asserted without reading source. */
  calls: string[];
  transitions: Array<{ dealId: string; actorId: string; reason: string }>;
  rejections: Array<{ dealId: string; reason: string; reviewedAt: Date }>;
  notifications: Array<{ userId: string; type: string; payload: unknown }>;
  loads: Array<{ dealId: string; brandProfileId: string }>;
  committed: boolean;
}

interface Overrides {
  status?: DealStatus;
  dealMissing?: boolean;
  failNotify?: boolean;
  transitionError?: Error;
  rejectionError?: Error;
}

function makeDeps(overrides: Overrides = {}): {
  deps: RejectDeliverableDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    calls: [],
    transitions: [],
    rejections: [],
    notifications: [],
    loads: [],
    committed: false,
  };

  const status = overrides.status ?? 'delivered';
  const tx = {} as Tx;

  const deps: RejectDeliverableDeps = {
    loadDeal: async (_tx, dealId, brandProfileId) => {
      recorded.calls.push('loadDeal');
      recorded.loads.push({ dealId, brandProfileId });
      // The ownership scope is in the `where`, so a deal whose campaign
      // belongs to another brand does not come back at all. The fake honours
      // that rather than returning the row and trusting a later check.
      if (overrides.dealMissing) return null;
      if (brandProfileId !== BRAND_PROFILE_ID) return null;

      return {
        id: dealId,
        status,
        campaignName: CAMPAIGN_NAME,
        creatorUserId: CREATOR_USER_ID,
      } satisfies RejectDeliverableRow;
    },
    transition: async (_tx, dealId, actorId, reason) => {
      recorded.calls.push('transition');
      if (overrides.transitionError) throw overrides.transitionError;
      const legal = LEGAL_TRANSITIONS[status].includes('revision_requested');
      if (!legal) {
        throw new TransitionError(
          `cannot reject from ${status}`,
          getErrorCodeForInvalidTransition(status, 'revision_requested')
        );
      }
      recorded.transitions.push({ dealId, actorId, reason });
    },
    recordRejection: async (_tx, dealId, reason, reviewedAt) => {
      recorded.calls.push('recordRejection');
      if (overrides.rejectionError) throw overrides.rejectionError;
      recorded.rejections.push({ dealId, reason, reviewedAt });
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
      }) as Parameters<RejectDeliverableDeps['run']>[0] extends (
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

function reject(
  deps: RejectDeliverableDeps,
  over: {
    dealId?: string;
    brandProfileId?: string;
    reason?: string;
  } = {}
) {
  return rejectDeliverable(
    over.dealId ?? DEAL_ID,
    {
      brandProfileId: over.brandProfileId ?? BRAND_PROFILE_ID,
      actorUserId: BRAND_USER_ID,
      reason: over.reason ?? REASON,
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

const REJECT_MODULE = read('lib/deals/reject-deliverable.ts');
const REJECT_ROUTE = read('app/api/deals/[id]/reject/route.ts');

/**
 * Read off the transition table rather than retyped, so a tenth status is a
 * failure here instead of a case this suite silently stops covering.
 */
const ALL_STATUSES = Object.keys(LEGAL_TRANSITIONS) as DealStatus[];
const REJECTABLE = ALL_STATUSES.filter((s) =>
  LEGAL_TRANSITIONS[s].includes('revision_requested')
);
const NON_REJECTABLE = ALL_STATUSES.filter(
  (s) => !LEGAL_TRANSITIONS[s].includes('revision_requested')
);

// -- AC-024: the deal moves and the rejection is recorded --------------------

describe('AC-024 — rejecting moves the deal and records the reason', () => {
  it('moves the deal to revision_requested through the state machine', async () => {
    const { deps, recorded } = makeDeps();

    const result = await reject(deps);

    expect(result).toEqual({
      ok: true,
      dealId: DEAL_ID,
      status: 'revision_requested',
      reason: REASON,
    });
    expect(recorded.transitions).toEqual([
      {
        dealId: DEAL_ID,
        actorId: BRAND_USER_ID,
        reason: REJECT_DELIVERABLE_EVENT_REASON,
      },
    ]);
  });

  it('records the rejection on the deliverable with a timestamp (AC-3)', async () => {
    const { deps, recorded } = makeDeps();

    await reject(deps);

    expect(recorded.rejections).toHaveLength(1);
    expect(recorded.rejections[0]).toMatchObject({
      dealId: DEAL_ID,
      reason: REASON,
    });
    expect(recorded.rejections[0].reviewedAt).toBeInstanceOf(Date);
  });

  it('stores review_status rejected with the note on the row', () => {
    // AC-3's durable half: the default `recordRejection` writes the reason
    // where the resubmission path (KAN-46's upsert) later resets it.
    const recorder = REJECT_MODULE.slice(
      REJECT_MODULE.indexOf('recordRejection:')
    );
    expect(recorder).toMatch(/reviewStatus: 'rejected'/);
    expect(recorder).toContain('reviewedAt');
    expect(recorder).toContain('rejectionReason: reason');
  });
});

// -- AC-2: a reason is mandatory ----------------------------------------------

describe('AC-2 — rejecting without a reason is refused before any write', () => {
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

  it('refuses an empty reason with the AC’s own sentence', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleRejectDeliverable(
      post({ reason: '' }),
      DEAL_ID,
      { rejectDeliverableDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe(ErrorCode.REASON_REQUIRED);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.REASON_REQUIRED]);
    expect(body.error.details?.reason).toBeDefined();
    expect(recorded.calls).toHaveLength(0);
  });

  it('refuses a missing reason and a spaces-only reason the same way', async () => {
    // Trimmed, a spaces-only note is an empty note (AC-2's "empty reason").
    for (const body of [{}, { reason: '   ' }]) {
      const { deps } = makeDeps();

      const response = await handleRejectDeliverable(post(body), DEAL_ID, {
        rejectDeliverableDeps: deps,
      });
      const parsed = await response.json();

      expect(response.status).toBe(422);
      expect(parsed.error.code).toBe(ErrorCode.REASON_REQUIRED);
    }
  });

  it('refuses a body that is not JSON at all', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleRejectDeliverable(post('not json'), DEAL_ID, {
      rejectDeliverableDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(recorded.calls).toHaveLength(0);
  });

  it('passes the trimmed reason to the action', async () => {
    const { deps, recorded } = makeDeps();

    await handleRejectDeliverable(post({ reason: `  ${REASON}  ` }), DEAL_ID, {
      rejectDeliverableDeps: deps,
    });

    expect(recorded.rejections[0].reason).toBe(REASON);
  });
});

// -- AC-4: no money moves -----------------------------------------------------

describe('AC-4 — rejection moves no money in either direction', () => {
  it('imports nothing from the money path', () => {
    // The strongest form of "no ledger entry is written": there is no ledger
    // call to make. The hold from funding stays exactly where it is.
    expect(REJECT_MODULE).not.toMatch(/ledger|EscrowLedger|refundDeal/i);
    expect(REJECT_MODULE).not.toContain('ledger_entry');
    expect(REJECT_MODULE).not.toContain('update(campaign)');
    expect(REJECT_MODULE).not.toContain('heldBalance');
  });

  it('touches only the deal, its deliverable, and the notification', async () => {
    const { deps, recorded } = makeDeps();

    await reject(deps);

    expect(recorded.calls).toEqual([
      'loadDeal',
      'transition',
      'recordRejection',
      'notify',
    ]);
  });
});

// -- AC-5: only a delivered deal can be rejected ------------------------------

describe('AC-5 — rejecting is only legal from delivered', () => {
  it('rejects from exactly the statuses the machine allows', () => {
    expect(REJECTABLE).toEqual(['delivered']);
  });

  it.each(NON_REJECTABLE)(
    'refuses a %s deal with the machine’s own code',
    async (status) => {
      const { deps, recorded } = makeDeps({ status });

      const result = await reject(deps);

      expect(result).toEqual({
        ok: false,
        reason: 'illegal',
        code: getErrorCodeForInvalidTransition(status, 'revision_requested'),
      });
      // Append-only: a refusal must leave no event, no note and no email.
      expect(recorded.transitions).toHaveLength(0);
      expect(recorded.rejections).toHaveLength(0);
      expect(recorded.notifications).toHaveLength(0);
    }
  );

  it('answers an undeclivered deal with DEAL_NOT_DELIVERED', async () => {
    // AC-5's named code. A `funded` deal is the case the AC describes: money
    // held, nothing to judge yet.
    const { deps } = makeDeps({ status: 'funded' });

    const result = await reject(deps);

    expect(result).toMatchObject({ code: ErrorCode.DEAL_NOT_DELIVERED });
  });

  it('refuses a second rejection rather than writing a second event', async () => {
    const { deps, recorded } = makeDeps({ status: 'revision_requested' });

    const result = await reject(deps);

    expect(result).toMatchObject({
      ok: false,
      reason: 'illegal',
      code: getErrorCodeForInvalidTransition(
        'revision_requested',
        'revision_requested'
      ),
    });
    expect(recorded.rejections).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
  });
});

// -- AC-6: the resubmit edge closes the loop ----------------------------------

describe('AC-6 — the creator can resubmit from revision_requested', () => {
  it('is the edge KAN-46 already ships, pinned here so the loop visibly closes', () => {
    expect(LEGAL_TRANSITIONS.revision_requested).toContain('delivered');
  });
});

// -- AC-7: each rejection appends its own deal_event --------------------------

describe('FR-007 — the transition appends a deal_event with the brand as actor', () => {
  it('delegates the status change and the event to transitionDeal', () => {
    expect(REJECT_MODULE).toContain(
      "transitionDeal(tx, dealId, 'revision_requested'"
    );
  });

  it('hand-writes neither a status nor a deal_event', () => {
    expect(REJECT_MODULE).not.toMatch(/update\(deal\)[\s\S]{0,80}status:/);
    expect(REJECT_MODULE).not.toContain('insert(dealEvent)');
    expect(REJECT_MODULE).not.toContain('dealEvent');
  });

  it('names the signed-in brand as the actor', async () => {
    const { deps, recorded } = makeDeps();

    await reject(deps);

    expect(recorded.transitions[0].actorId).toBe(BRAND_USER_ID);
    expect(recorded.transitions[0].actorId).not.toBe(CREATOR_USER_ID);
  });

  it('records a reason a reader can understand', () => {
    expect(REJECT_DELIVERABLE_EVENT_REASON).toMatch(
      /requested changes|revision/i
    );
    expect(REJECT_DELIVERABLE_EVENT_REASON).not.toMatch(/KAN-\d+/);
  });

  it('keeps the event reason a description, not the note itself', () => {
    // The reason has a home (deliverable + notification); restating it on the
    // event would make the history unbounded and duplicate the note. The
    // transition is handed the fixed description, never the client's reason.
    expect(REJECT_MODULE).toMatch(
      /await deps\.transition\(\s*tx,\s*dealId,\s*input\.actorUserId,\s*REJECT_DELIVERABLE_EVENT_REASON\s*\)/
    );
    expect(REJECT_MODULE).not.toMatch(/transition\([^)]*input\.reason/);
  });
});

// -- AC-8: only the owning brand ----------------------------------------------

describe('AC-8 — only the brand owning the deal’s campaign can reject', () => {
  it('puts the ownership scope in the where clause', () => {
    const { sql, params } = db
      .select()
      .from(deal)
      .where(buildRejectDeliverableWhere(DEAL_ID, BRAND_PROFILE_ID))
      .toSQL();

    // The brand id is the base the deal id narrows, so there is no argument
    // that produces a lookup without it.
    expect(params).toContain(BRAND_PROFILE_ID);
    expect(params).toContain(DEAL_ID);
    expect(sql).toMatch(/"brand_id" = \$/);
    expect(REJECT_MODULE).toContain(
      'buildRejectDeliverableWhere(dealId, brandProfileId)'
    );
  });

  it('does not return another brand’s deal at all', async () => {
    const { deps, recorded } = makeDeps();

    const result = await reject(deps, {
      brandProfileId: OTHER_BRAND_PROFILE_ID,
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(recorded.transitions).toHaveLength(0);
    expect(recorded.rejections).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('takes the brand id from the session, never from the request', async () => {
    const { deps, recorded } = makeDeps();

    await reject(deps);

    expect(recorded.loads).toEqual([
      { dealId: DEAL_ID, brandProfileId: BRAND_PROFILE_ID },
    ]);
    expect(REJECT_ROUTE).toContain('brandProfileId = ctx.brandProfileId');
    expect(REJECT_ROUTE).toContain('actorUserId = ctx.user.id');
  });

  it('locks the deal row it is about to move', () => {
    // What serialises a concurrent approve/reject of the same delivery: the
    // loser waits here, then reads the status the winner wrote and is refused.
    expect(REJECT_MODULE).toMatch(/\.for\('update'/);
  });
});

// -- The creator is told ------------------------------------------------------

describe('AC-1/AC-3 — the creator is notified with the reason', () => {
  it('addresses the creator’s user id, not the profile id', async () => {
    // The two-hop rule: business rows reference profile ids and notifications
    // address a user, so `deal.creator_id` is walked through
    // `creator_profile.user_id`. The profile id here writes a row nobody reads.
    const { deps, recorded } = makeDeps();

    await reject(deps);

    expect(recorded.notifications).toHaveLength(1);
    expect(recorded.notifications[0].userId).toBe(CREATOR_USER_ID);
    expect(recorded.notifications[0].userId).not.toBe(CREATOR_PROFILE_ID);
    expect(recorded.notifications[0].userId).not.toBe(BRAND_USER_ID);
    expect(REJECT_MODULE).toContain('creatorProfile.userId');
  });

  it('sends the revision_requested type with the reason verbatim', async () => {
    const { deps, recorded } = makeDeps();

    await reject(deps);

    expect(recorded.notifications[0].type).toBe('revision_requested');
    expect(recorded.notifications[0].payload).toEqual({
      dealId: DEAL_ID,
      campaignTitle: CAMPAIGN_NAME,
      reason: REASON,
    });
  });

  it('says the funds stay held, which is the email template’s promise', () => {
    // The template (lib/notifications/templates.tsx) tells the creator their
    // payment stays in escrow — true only because this action never touches
    // the ledger (AC-4). Pinned so the two halves cannot drift apart.
    const templates = read('lib/notifications/templates.tsx');
    expect(templates).toContain(
      'Your payment stays in escrow while you re-submit.'
    );
  });

  it('notifies inside the transaction, after the write', async () => {
    const { deps, recorded } = makeDeps();

    await reject(deps);

    expect(recorded.calls.indexOf('recordRejection')).toBeLessThan(
      recorded.calls.indexOf('notify')
    );
  });

  it('says nothing to the creator when the rejection rolls back', async () => {
    const { deps, recorded } = makeDeps({ failNotify: true });

    await expect(reject(deps)).rejects.toThrow('resend down');
    expect(recorded.committed).toBe(false);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('says nothing when the rejection is refused', async () => {
    const { deps, recorded } = makeDeps({ status: 'funded' });

    await reject(deps);

    expect(recorded.notifications).toHaveLength(0);
  });
});

// -- Atomicity ----------------------------------------------------------------

describe('the rejection is one transaction', () => {
  it('runs everything inside one transaction', () => {
    expect(REJECT_MODULE).toContain('run: (fn) => withNotifications(fn)');
    expect(REJECT_MODULE).toContain('return deps.run(async (tx, notify)');
  });

  it('lets a real failure out rather than reporting it as a refusal', async () => {
    // Only `TransitionError` means "the machine said no".
    const { deps, recorded } = makeDeps({
      transitionError: new Error('connection terminated'),
    });

    await expect(reject(deps)).rejects.toThrow('connection terminated');
    expect(recorded.committed).toBe(false);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('rolls the transition back when recording the note fails', async () => {
    // A deal the brand sent back must always carry the note saying what to
    // change — the opposite half of "a note must never exist for a deal that
    // is not revision_requested".
    const { deps, recorded } = makeDeps({
      rejectionError: new Error('no deliverable row'),
    });

    await expect(reject(deps)).rejects.toThrow('no deliverable row');
    expect(recorded.committed).toBe(false);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('refuses to record a rejection against a deal with no deliverable row', () => {
    // A `delivered` deal is guaranteed one by KAN-46, so a miss is corrupted
    // data — and rejecting without the note would strand the creator with a
    // revision and no instructions.
    const recorder = REJECT_MODULE.slice(
      REJECT_MODULE.indexOf('recordRejection:')
    );
    expect(recorder).toContain('if (!existing)');
  });
});

// -- The endpoint -------------------------------------------------------------

describe('POST /api/deals/[id]/reject', () => {
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

  it('returns 200 with what was recorded', async () => {
    const { deps } = makeDeps();

    const response = await handleRejectDeliverable(
      post({ reason: REASON }),
      DEAL_ID,
      { rejectDeliverableDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      deal_id: DEAL_ID,
      status: 'revision_requested',
      reason: REASON,
    });
  });

  it('gates on the brand role and this deal', async () => {
    const { deps } = makeDeps();

    await handleRejectDeliverable(post({ reason: REASON }), DEAL_ID, {
      rejectDeliverableDeps: deps,
    });

    expect(guardMock).toHaveBeenCalledWith({
      roles: ['brand'],
      resource: { kind: 'deal', id: DEAL_ID },
    });
  });

  it('runs the guard before the body is parsed', async () => {
    const { deps, recorded } = makeDeps();
    guardMock.mockRejectedValueOnce(new ForbiddenError('not the owner'));

    const response = await handleRejectDeliverable(
      post({ reason: REASON }),
      DEAL_ID,
      { rejectDeliverableDeps: deps }
    );

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
    expect(REJECT_ROUTE.indexOf('guardFn')).toBeLessThan(
      REJECT_ROUTE.indexOf('request.json()')
    );
  });

  it('refuses a malformed id before it reaches a uuid column', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleRejectDeliverable(
      post({ reason: REASON }, 'not-a-uuid'),
      'not-a-uuid',
      { rejectDeliverableDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
    expect(guardMock).not.toHaveBeenCalled();
    expect(recorded.calls).toHaveLength(0);
  });

  it('denies a brand with no profile row', async () => {
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

    const response = await handleRejectDeliverable(
      post({ reason: REASON }),
      DEAL_ID,
      { rejectDeliverableDeps: deps }
    );

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
  });

  it('collapses a vanished deal into 403, not 404', async () => {
    const { deps } = makeDeps({ dealMissing: true });

    const response = await handleRejectDeliverable(
      post({ reason: REASON }),
      DEAL_ID,
      { rejectDeliverableDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('returns 409 DEAL_NOT_DELIVERED for a deal that was never delivered', async () => {
    const { deps } = makeDeps({ status: 'funded' });

    const response = await handleRejectDeliverable(
      post({ reason: REASON }),
      DEAL_ID,
      { rejectDeliverableDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.DEAL_NOT_DELIVERED);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.DEAL_NOT_DELIVERED]);
  });

  it('passes the state machine’s code through rather than choosing one', async () => {
    const { deps } = makeDeps({ status: 'accepted' });
    const code = getErrorCodeForInvalidTransition(
      'accepted',
      'revision_requested'
    );

    const response = await handleRejectDeliverable(
      post({ reason: REASON }),
      DEAL_ID,
      { rejectDeliverableDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(code);
    expect(REJECT_ROUTE).toContain('errorResponse(result.code)');
  });

  it('runs on the Node runtime, because pg cannot run on the edge', () => {
    expect(REJECT_ROUTE).toContain("export const runtime = 'nodejs'");
  });
});

function post(body: unknown, id = DEAL_ID): Request {
  return new Request(`http://localhost/api/deals/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
