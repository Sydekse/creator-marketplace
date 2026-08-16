import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUBMIT_DELIVERABLE_EVENT_REASON,
  buildSubmitDeliverableWhere,
  submitDeliverable,
} from '../lib/deals/submit-deliverable';
import type {
  SubmitDeliverableDeps,
  SubmitDeliverableRow,
} from '../lib/deals/submit-deliverable';
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
 * KAN-46 — the creator submits the live TikTok post URL (US-008, AC-022,
 * AC-025, FR-007, Tech Spec §4.4).
 *
 * Five claims carry the weight here.
 *
 * **The status change and the deliverable row are one transaction, and the
 * deliverable write is an upsert** (AC-5). One deliverable per deal is a
 * database constraint (`deliverable.deal_id` is unique) — this is a code path
 * that satisfies it, and the source guards assert the default upsert reads
 * first and updates in place on resubmission rather than inserting a second
 * row that the constraint would then have to reject.
 *
 * **The status guard is the state machine, which answers AC-4 on its own.**
 * Only `funded` and `revision_requested` can reach `delivered`, so every other
 * status surfaces `getErrorCodeForInvalidTransition(status, 'delivered')` —
 * `DEAL_NOT_FUNDED` for work submitted before the money was held, and the
 * machine's own code for a double-tap. This module invents no status of its
 * own.
 *
 * **A refusal leaves no history behind.** `deal_event` is append-only, so
 * every refusal path asserts the transition seam was not reached, and an
 * upsert failure rolls the transition back with it — a deliverable row must
 * never exist for a deal that is not `delivered`.
 *
 * **The URL is stored and validated, never fetched** (AC-8, §6.3). The
 * allowlist check lives in `submitDeliverableSchema` before this action runs;
 * the module has no network call to point at.
 *
 * **The brand is told inside the transaction** (AC-6), addressed by `user.id`
 * through `brand_profile` — the two-hop rule from `lib/authz.ts`.
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

const { handleSubmitDeliverable } =
  await import('../app/api/deals/[id]/deliverable/route');

const CREATOR_USER_ID = '99999999-9999-4999-8999-999999999999';
const CREATOR_PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_CREATOR_PROFILE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEAL_ID = '33333333-3333-4333-8333-333333333333';
const BRAND_USER_ID = '55555555-5555-4555-8555-555555555555';
const BRAND_PROFILE_ID = '66666666-6666-4666-8666-666666666666';
const DELIVERABLE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const TIKTOK_URL =
  'https://www.tiktok.com/@demo_creator/video/1234567890123456';
const CAMPAIGN_NAME = 'Ramadan Beauty Push';
/** What the (fake) upsert reports as recorded — asserted back verbatim. */
const RECORDED_SUBMITTED_AT = new Date('2026-08-14T09:00:00.000Z');

interface Recorded {
  /** Seam names in call order — ordering asserted without reading source. */
  calls: string[];
  transitions: Array<{ dealId: string; actorId: string; reason: string }>;
  upserts: Array<{ dealId: string; tiktokUrl: string; submittedAt: Date }>;
  notifications: Array<{ userId: string; type: string; payload: unknown }>;
  loads: Array<{ dealId: string; creatorProfileId: string }>;
  committed: boolean;
}

interface Overrides {
  status?: DealStatus;
  dealMissing?: boolean;
  failNotify?: boolean;
  transitionError?: Error;
  upsertError?: Error;
}

function makeDeps(overrides: Overrides = {}): {
  deps: SubmitDeliverableDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    calls: [],
    transitions: [],
    upserts: [],
    notifications: [],
    loads: [],
    committed: false,
  };

  const status = overrides.status ?? 'funded';
  const tx = {} as Tx;

  const deps: SubmitDeliverableDeps = {
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
        campaignName: CAMPAIGN_NAME,
        brandUserId: BRAND_USER_ID,
      } satisfies SubmitDeliverableRow;
    },
    transition: async (_tx, dealId, actorId, reason) => {
      recorded.calls.push('transition');
      if (overrides.transitionError) throw overrides.transitionError;
      const legal = LEGAL_TRANSITIONS[status].includes('delivered');
      if (!legal) {
        throw new TransitionError(
          `cannot deliver from ${status}`,
          getErrorCodeForInvalidTransition(status, 'delivered')
        );
      }
      recorded.transitions.push({ dealId, actorId, reason });
    },
    upsertDeliverable: async (_tx, dealId, tiktokUrl, submittedAt) => {
      recorded.calls.push('upsertDeliverable');
      if (overrides.upsertError) throw overrides.upsertError;
      recorded.upserts.push({ dealId, tiktokUrl, submittedAt });
      // The seam owns what gets recorded, the same way the real upsert returns
      // the row's own `submitted_at` rather than the caller's argument.
      return { id: DELIVERABLE_ID, submittedAt: RECORDED_SUBMITTED_AT };
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
      }) as Parameters<SubmitDeliverableDeps['run']>[0] extends (
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

function submit(
  deps: SubmitDeliverableDeps,
  over: {
    dealId?: string;
    creatorProfileId?: string;
    tiktokUrl?: string;
  } = {}
) {
  return submitDeliverable(
    over.dealId ?? DEAL_ID,
    {
      creatorProfileId: over.creatorProfileId ?? CREATOR_PROFILE_ID,
      actorUserId: CREATOR_USER_ID,
      tiktokUrl: over.tiktokUrl ?? TIKTOK_URL,
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

const SUBMIT_MODULE = read('lib/deals/submit-deliverable.ts');
const SUBMIT_ROUTE = read('app/api/deals/[id]/deliverable/route.ts');
const FORM_COMPONENT = read('components/deals/deliverable-form.tsx');
const DETAIL_PAGE = read('app/(creator)/creator/deals/[id]/page.tsx');
const DETAIL_MODULE = read('lib/deals/detail.ts');
const SCHEMA = read('db/schema.ts');

/**
 * Read off the transition table rather than retyped, so a tenth status is a
 * failure here instead of a case this suite silently stops covering.
 */
const ALL_STATUSES = Object.keys(LEGAL_TRANSITIONS) as DealStatus[];
const DELIVERABLE_TARGETS = ALL_STATUSES.filter((s) =>
  LEGAL_TRANSITIONS[s].includes('delivered')
);
const NON_DELIVERABLE = ALL_STATUSES.filter(
  (s) => !LEGAL_TRANSITIONS[s].includes('delivered')
);

// -- AC-022: the deal moves to delivered -------------------------------------

describe('AC-022 — submitting moves the deal and records the deliverable', () => {
  it('moves the deal to delivered through the state machine', async () => {
    const { deps, recorded } = makeDeps();

    const result = await submit(deps);

    expect(result).toEqual({
      ok: true,
      dealId: DEAL_ID,
      deliverableId: DELIVERABLE_ID,
      submittedAt: RECORDED_SUBMITTED_AT,
      status: 'delivered',
    });
    expect(recorded.transitions).toEqual([
      {
        dealId: DEAL_ID,
        actorId: CREATOR_USER_ID,
        reason: SUBMIT_DELIVERABLE_EVENT_REASON,
      },
    ]);
  });

  it('stores the URL and a submission timestamp with the deal', async () => {
    const { deps, recorded } = makeDeps();

    await submit(deps);

    expect(recorded.upserts).toHaveLength(1);
    expect(recorded.upserts[0]).toMatchObject({
      dealId: DEAL_ID,
      tiktokUrl: TIKTOK_URL,
    });
    expect(recorded.upserts[0].submittedAt).toBeInstanceOf(Date);
  });

  it('returns the submission time the row recorded (AC-6)', async () => {
    // The response echoes the upsert's own value rather than the action's
    // clock, so the client is told what is actually stored.
    const { deps } = makeDeps();

    const result = await submit(deps);

    expect(result).toMatchObject({ submittedAt: RECORDED_SUBMITTED_AT });
    expect(SUBMIT_MODULE).toContain('submittedAt: stored.submittedAt');
  });
});

// -- AC-4: only funded (or revision_requested) deals -------------------------

describe('AC-4 — submitting before the money is held is refused', () => {
  it('delivers from exactly the statuses the machine allows', () => {
    // `funded` and `revision_requested` — a rejected deliverable puts the
    // creator back on the hook, and the machine already says so.
    expect(DELIVERABLE_TARGETS.sort()).toEqual([
      'funded',
      'revision_requested',
    ]);
  });

  it.each(NON_DELIVERABLE)(
    'refuses a %s deal with the machine’s own code',
    async (status) => {
      const { deps, recorded } = makeDeps({ status });

      const result = await submit(deps);

      expect(result).toEqual({
        ok: false,
        reason: 'illegal',
        code: getErrorCodeForInvalidTransition(status, 'delivered'),
      });
      // Append-only: a refusal must leave no event, no row and no email.
      expect(recorded.transitions).toHaveLength(0);
      expect(recorded.upserts).toHaveLength(0);
      expect(recorded.notifications).toHaveLength(0);
    }
  );

  it('answers an unfunded accepted deal with DEAL_NOT_FUNDED', async () => {
    // AC-4's named code. `accepted` is the deal that got as far as agreeing
    // but whose campaign was never funded — the exact case the AC describes.
    const { deps } = makeDeps({ status: 'accepted' });

    const result = await submit(deps);

    expect(result).toMatchObject({ code: ErrorCode.DEAL_NOT_FUNDED });
  });

  it('refuses a second submission rather than writing a second event', async () => {
    // Idempotency and the concurrent-tap answer: the row is locked, so the
    // loser reads `delivered` and arrives here as `delivered → delivered`.
    const { deps, recorded } = makeDeps({ status: 'delivered' });

    const result = await submit(deps);

    expect(result).toMatchObject({
      ok: false,
      reason: 'illegal',
      code: getErrorCodeForInvalidTransition('delivered', 'delivered'),
    });
    expect(recorded.upserts).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
  });
});

// -- AC-5: one deliverable per deal ------------------------------------------

describe('AC-5 — exactly one deliverable exists per deal', () => {
  it('is a database constraint, not just a code path', () => {
    // The unique on `deliverable.deal_id` is the backstop; the upsert below is
    // the path that satisfies it without ever tripping it.
    expect(SCHEMA).toMatch(
      /dealId: uuid\('deal_id'\)[\s\S]{0,120}\.unique\(\)/
    );
  });

  it('reads the row first and updates in place on resubmission', () => {
    // The default upsert must not be a blind insert: on `revision_requested`
    // the row already exists and AC-5 says it is *updated*, not duplicated.
    const upsert = SUBMIT_MODULE.slice(
      SUBMIT_MODULE.indexOf('upsertDeliverable:')
    );
    expect(upsert).toContain('.from(deliverable)');
    expect(upsert).toMatch(/if \(existing\)/);
    expect(upsert).toMatch(/\.update\(deliverable\)/);
    expect(upsert).toContain('.insert(deliverable)');
    expect(upsert).toContain("reviewStatus: 'pending'");
  });

  it('resets the review state so a fresh submission reads as pending', () => {
    // A stale rejection note must not follow a new video around.
    const upsert = SUBMIT_MODULE.slice(
      SUBMIT_MODULE.indexOf('upsertDeliverable:')
    );
    expect(upsert).toContain('reviewedAt: null');
    expect(upsert).toContain('rejectionReason: null');
  });

  it('upserts through a seam, so the write is observable', async () => {
    const { deps, recorded } = makeDeps();

    await submit(deps);

    expect(recorded.calls).toContain('upsertDeliverable');
    expect(recorded.upserts).toHaveLength(1);
  });
});

// -- AC-6: recorded and the brand is told ------------------------------------

describe('AC-6 — the brand is notified that a video awaits review', () => {
  it('addresses the brand’s user id, not the profile id', async () => {
    // The two-hop rule: business rows reference profile ids and notifications
    // address a user, so `campaign.brand_id` is walked through
    // `brand_profile.user_id`. The profile id here writes a row nobody reads.
    const { deps, recorded } = makeDeps();

    await submit(deps);

    expect(recorded.notifications).toHaveLength(1);
    expect(recorded.notifications[0].userId).toBe(BRAND_USER_ID);
    expect(recorded.notifications[0].userId).not.toBe(BRAND_PROFILE_ID);
    expect(recorded.notifications[0].userId).not.toBe(CREATOR_USER_ID);
    expect(SUBMIT_MODULE).toContain('brandProfile.userId');
  });

  it('sends the deliverable_submitted type with the facts the sentence states', async () => {
    const { deps, recorded } = makeDeps();

    await submit(deps);

    expect(recorded.notifications[0].type).toBe('deliverable_submitted');
    expect(recorded.notifications[0].payload).toEqual({
      dealId: DEAL_ID,
      deliverableId: DELIVERABLE_ID,
      campaignTitle: CAMPAIGN_NAME,
    });
  });

  it('notifies inside the transaction, after the write', async () => {
    const { deps, recorded } = makeDeps();

    await submit(deps);

    expect(recorded.calls).toEqual([
      'loadDeal',
      'transition',
      'upsertDeliverable',
      'notify',
    ]);
  });

  it('says nothing when the submission rolls back', async () => {
    const { deps, recorded } = makeDeps({ failNotify: true });

    await expect(submit(deps)).rejects.toThrow('resend down');
    expect(recorded.committed).toBe(false);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('says nothing to the brand when the submission is refused', async () => {
    const { deps, recorded } = makeDeps({ status: 'accepted' });

    await submit(deps);

    expect(recorded.notifications).toHaveLength(0);
  });
});

// -- Atomicity ----------------------------------------------------------------

describe('the submission is one transaction', () => {
  it('runs everything inside one transaction', () => {
    expect(SUBMIT_MODULE).toContain('run: (fn) => withNotifications(fn)');
    expect(SUBMIT_MODULE).toContain('return deps.run(async (tx, notify)');
  });

  it('lets a real failure out rather than reporting it as a refusal', async () => {
    // Only `TransitionError` means "the machine said no". A dropped connection
    // caught by the same `catch` would surface as a 409 and the transaction
    // would have committed nothing anyway.
    const { deps, recorded } = makeDeps({
      transitionError: new Error('connection terminated'),
    });

    await expect(submit(deps)).rejects.toThrow('connection terminated');
    expect(recorded.committed).toBe(false);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('rolls the transition back when the deliverable write fails', async () => {
    // A deliverable row must never exist for a deal that is not `delivered`
    // — and, the other way, a deal must never be told it delivered a video
    // the transaction then lost.
    const { deps, recorded } = makeDeps({
      upsertError: new Error('unique violation'),
    });

    await expect(submit(deps)).rejects.toThrow('unique violation');
    expect(recorded.committed).toBe(false);
    expect(recorded.notifications).toHaveLength(0);
  });
});

// -- AC-7: only the creator on the deal --------------------------------------

describe('AC-7 — only the creator on the deal can submit', () => {
  it('puts the ownership scope in the where clause', () => {
    const { sql, params } = db
      .select()
      .from(deal)
      .where(buildSubmitDeliverableWhere(DEAL_ID, CREATOR_PROFILE_ID))
      .toSQL();

    // The creator id is the base the deal id narrows, so there is no argument
    // that produces a lookup without it.
    expect(params).toContain(CREATOR_PROFILE_ID);
    expect(params).toContain(DEAL_ID);
    expect(sql).toMatch(/"creator_id" = \$/);
    expect(SUBMIT_MODULE).toContain(
      'buildSubmitDeliverableWhere(dealId, creatorProfileId)'
    );
  });

  it('does not return another creator’s deal at all', async () => {
    const { deps, recorded } = makeDeps();

    const result = await submit(deps, {
      creatorProfileId: OTHER_CREATOR_PROFILE_ID,
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(recorded.transitions).toHaveLength(0);
    expect(recorded.upserts).toHaveLength(0);
    expect(recorded.notifications).toHaveLength(0);
  });

  it('takes the creator id from the session, never from the request', async () => {
    const { deps, recorded } = makeDeps();

    await submit(deps);

    expect(recorded.loads).toEqual([
      { dealId: DEAL_ID, creatorProfileId: CREATOR_PROFILE_ID },
    ]);
    expect(SUBMIT_ROUTE).toContain('creatorProfileId = ctx.creatorProfileId');
    expect(SUBMIT_ROUTE).toContain('actorUserId = ctx.user.id');
  });

  it('locks the deal row it is about to move', () => {
    // What serialises a concurrent double-submit: the loser waits here, then
    // reads `delivered` and is refused before it reaches the upsert.
    expect(SUBMIT_MODULE).toMatch(/\.for\('update'/);
  });
});

// -- FR-007: through the state machine ----------------------------------------

describe('FR-007 — the transition appends a deal_event with the creator as actor', () => {
  it('delegates the status change and the event to transitionDeal', () => {
    expect(SUBMIT_MODULE).toContain("transitionDeal(tx, dealId, 'delivered'");
  });

  it('hand-writes neither a status nor a deal_event', () => {
    // Invariant 6 — every transition writes its event as it happens, and the
    // machine is the one place that knows how.
    expect(SUBMIT_MODULE).not.toMatch(/update\(deal\)[\s\S]{0,80}status:/);
    expect(SUBMIT_MODULE).not.toContain('insert(dealEvent)');
    expect(SUBMIT_MODULE).not.toContain('dealEvent');
  });

  it('records a reason a reader can understand', () => {
    expect(SUBMIT_DELIVERABLE_EVENT_REASON).toMatch(/submitted/i);
    expect(SUBMIT_DELIVERABLE_EVENT_REASON).not.toMatch(/KAN-\d+/);
  });

  it('keeps the demo seed’s history identical to a real submission', () => {
    // The seed walks its demo deal to `delivered` itself; if it used a
    // different sentence, a demo history would read differently from a real
    // one for the same transition.
    const seed = read('db/seed.ts');
    expect(seed).toContain(`'${SUBMIT_DELIVERABLE_EVENT_REASON}'`);
  });
});

// -- AC-8: validated and stored, never fetched --------------------------------

describe('AC-8 — the URL is never fetched server-side', () => {
  it('has no network call anywhere in the action', () => {
    expect(SUBMIT_MODULE).not.toContain('fetch(');
    expect(SUBMIT_MODULE).not.toContain('axios');
    expect(SUBMIT_MODULE).not.toMatch(/https?\.get\(/);
  });

  it('renders the URL as plain text, never fetching it for a preview', () => {
    // AC-8 from the client's side too: the input is a text field with no embed,
    // no unfurl and no image, so a pasted link cannot make the browser talk to
    // an arbitrary host either (Tech Spec §6.3).
    expect(FORM_COMPONENT).not.toMatch(/<img|<iframe|<embed|object>/i);
    expect(FORM_COMPONENT).not.toContain('URL.createObjectURL');
  });

  it('validates with the allowlist schema and nothing else', () => {
    // The route parses with `submitDeliverableSchema` and hands the result
    // straight to the action — no second interpretation of the URL anywhere.
    expect(SUBMIT_ROUTE).toContain('submitDeliverableSchema.safeParse(body)');
    expect(SUBMIT_MODULE).not.toMatch(/new URL\(/);
    expect(SUBMIT_MODULE).not.toMatch(/\.hostname/);
  });
});

// -- The endpoint -------------------------------------------------------------

describe('POST /api/deals/[id]/deliverable', () => {
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
    return new Request(`http://localhost/api/deals/${id}/deliverable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  it('returns 200 with what was recorded', async () => {
    const { deps } = makeDeps();

    const response = await handleSubmitDeliverable(
      post({ tiktokUrl: TIKTOK_URL }),
      DEAL_ID,
      { submitDeliverableDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      deal_id: DEAL_ID,
      deliverable_id: DELIVERABLE_ID,
      status: 'delivered',
      submitted_at: RECORDED_SUBMITTED_AT.toISOString(),
    });
  });

  it('gates on the creator role and this deal', async () => {
    const { deps } = makeDeps();

    await handleSubmitDeliverable(post({ tiktokUrl: TIKTOK_URL }), DEAL_ID, {
      submitDeliverableDeps: deps,
    });

    expect(guardMock).toHaveBeenCalledWith({
      roles: ['creator'],
      resource: { kind: 'deal', id: DEAL_ID },
    });
  });

  it('runs the guard before the body is parsed', async () => {
    // A caller who does not own this deal never gets as far as having their
    // JSON read, so a 403 and a 422 cannot be played off each other to learn
    // whether a deal id exists.
    const { deps, recorded } = makeDeps();
    guardMock.mockRejectedValueOnce(new ForbiddenError('not the owner'));

    const response = await handleSubmitDeliverable(
      post({ tiktokUrl: TIKTOK_URL }),
      DEAL_ID,
      { submitDeliverableDeps: deps }
    );

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
    expect(SUBMIT_ROUTE.indexOf('guardFn')).toBeLessThan(
      SUBMIT_ROUTE.indexOf('request.json()')
    );
  });

  it('refuses a malformed id before it reaches a uuid column', async () => {
    // Postgres answers a non-uuid compared against a `uuid` column with 22P02,
    // which would turn a mistyped link into a 500 (F16).
    const { deps, recorded } = makeDeps();

    const response = await handleSubmitDeliverable(
      post({ tiktokUrl: TIKTOK_URL }, 'not-a-uuid'),
      'not-a-uuid',
      { submitDeliverableDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
    expect(guardMock).not.toHaveBeenCalled();
    expect(recorded.calls).toHaveLength(0);
  });

  it('denies a creator with no profile row', async () => {
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

    const response = await handleSubmitDeliverable(
      post({ tiktokUrl: TIKTOK_URL }),
      DEAL_ID,
      { submitDeliverableDeps: deps }
    );

    expect(response.status).toBe(403);
    expect(recorded.calls).toHaveLength(0);
  });

  it('collapses a vanished deal into 403, not 404', async () => {
    // The guard already denied anyone who does not own this deal, so a distinct
    // 404 here would only tell a caller which ids exist.
    const { deps } = makeDeps({ dealMissing: true });

    const response = await handleSubmitDeliverable(
      post({ tiktokUrl: TIKTOK_URL }),
      DEAL_ID,
      { submitDeliverableDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('returns 422 INVALID_TIKTOK_URL with the AC’s own sentence (AC-025)', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleSubmitDeliverable(
      post({ tiktokUrl: 'https://youtube.com/watch?v=123' }),
      DEAL_ID,
      { submitDeliverableDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe(ErrorCode.INVALID_TIKTOK_URL);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.INVALID_TIKTOK_URL]);
    expect(body.error.details?.tiktokUrl).toBeDefined();
    expect(recorded.calls).toHaveLength(0);
  });

  it('refuses a missing or blank URL with the same code', async () => {
    // §4.4's one 422 for this endpoint, whatever shape the bad input takes.
    for (const body of [{}, { tiktokUrl: '' }, { tiktokUrl: '   ' }]) {
      const response = await handleSubmitDeliverable(post(body), DEAL_ID, {
        submitDeliverableDeps: makeDeps().deps,
      });
      const parsed = await response.json();

      expect(response.status).toBe(422);
      expect(parsed.error.code).toBe(ErrorCode.INVALID_TIKTOK_URL);
    }
  });

  it('refuses a body that is not JSON at all', async () => {
    const { deps, recorded } = makeDeps();

    const response = await handleSubmitDeliverable(post('not json'), DEAL_ID, {
      submitDeliverableDeps: deps,
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(recorded.calls).toHaveLength(0);
  });

  it('passes the trimmed URL to the action', async () => {
    // Paste noise — leading and trailing whitespace — is trimmed by the schema
    // so the stored value is the clean link, and the response echoes the
    // clean one.
    const { deps, recorded } = makeDeps();

    await handleSubmitDeliverable(
      post({ tiktokUrl: `  ${TIKTOK_URL}  ` }),
      DEAL_ID,
      { submitDeliverableDeps: deps }
    );

    expect(recorded.upserts[0].tiktokUrl).toBe(TIKTOK_URL);
  });

  it('returns 409 DEAL_NOT_FUNDED for an unfunded deal', async () => {
    const { deps } = makeDeps({ status: 'accepted' });

    const response = await handleSubmitDeliverable(
      post({ tiktokUrl: TIKTOK_URL }),
      DEAL_ID,
      { submitDeliverableDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(ErrorCode.DEAL_NOT_FUNDED);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.DEAL_NOT_FUNDED]);
  });

  it('passes the state machine’s code through rather than choosing one', async () => {
    const { deps } = makeDeps({ status: 'delivered' });
    const code = getErrorCodeForInvalidTransition('delivered', 'delivered');

    const response = await handleSubmitDeliverable(
      post({ tiktokUrl: TIKTOK_URL }),
      DEAL_ID,
      { submitDeliverableDeps: deps }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe(code);
    expect(SUBMIT_ROUTE).toContain('errorResponse(result.code)');
  });

  it('runs on the Node runtime, because pg cannot run on the edge', () => {
    expect(SUBMIT_ROUTE).toContain("export const runtime = 'nodejs'");
  });
});

// -- The surface the creator taps --------------------------------------------

describe('the deliverable form', () => {
  it('posts to the deliverable route for this deal', () => {
    expect(FORM_COMPONENT).toMatch(
      /fetch\(\s*`\/api\/deals\/\$\{encodeURIComponent\(dealId\)\}\/deliverable`/
    );
    expect(FORM_COMPONENT).toContain("method: 'POST'");
  });

  it('sends only the parsed URL, nothing else', () => {
    // The deal is in the path, the creator is in the session, and the body is
    // the trimmed value parsing produced.
    expect(FORM_COMPONENT).toContain('body: JSON.stringify(parsed.data)');
    expect(FORM_COMPONENT).not.toMatch(/actorUserId|creatorProfileId/);
  });

  it('validates with the same schema the server enforces', () => {
    // One copy of the allowlist rule: the form parses it first to show the
    // field error inline, and the endpoint is the authority anyway (NFR-005).
    expect(FORM_COMPONENT).toContain('submitDeliverableSchema.safeParse');
    expect(FORM_COMPONENT).toContain('zodIssuesToDetails(parsed.error)');
  });

  it('shows the server’s own sentence rather than a second copy', () => {
    expect(FORM_COMPONENT).toMatch(
      /error\?\.message \?\? SUBMIT_DELIVERABLE_FAILED_MESSAGE/
    );
  });

  it('renders the server’s field errors through the same path', () => {
    // 422 INVALID_TIKTOK_URL carries `details`; the form keys its field error
    // on them, exactly as the client-side parse keys its own.
    expect(FORM_COMPONENT).toContain('setErrors(error.details');
  });

  it('treats an unreachable server differently from a rejection', () => {
    // No response means no envelope and no code to branch on.
    expect(FORM_COMPONENT).toContain(
      'SUBMIT_DELIVERABLE_NETWORK_ERROR_MESSAGE'
    );
  });

  it('re-reads the server’s view after submitting', () => {
    // Whether the form renders at all is server-rendered from `deal.status`;
    // the refresh is what swaps it for the submitted-video section.
    expect(FORM_COMPONENT).toContain('SUBMIT_DELIVERABLE_SUCCESS_MESSAGE');
    expect(
      FORM_COMPONENT.match(/router\.refresh\(\)/g)?.length
    ).toBeGreaterThanOrEqual(2);
  });

  it('guards re-entry, so a double-fire cannot race itself', () => {
    // `disabled={submitting}` stops most double-clicks, but Enter + click in
    // the same tick can still fire twice; the sibling accept/decline surface
    // guards the same way.
    expect(FORM_COMPONENT).toMatch(/if \(submitting\) return;/);
  });

  it('never lies about being idle while a request is in flight', () => {
    // Whitespace-tolerant: prettier may wrap the ternary across lines.
    expect(FORM_COMPONENT).toMatch(
      /submitting\s*\?\s*SUBMITTING_DELIVERABLE_LABEL\s*:\s*SUBMIT_DELIVERABLE_LABEL/
    );
    expect(FORM_COMPONENT).toMatch(/disabled=\{submitting\}/);
  });

  it('reads its copy from the pure module, never from the query module', () => {
    // Same bundle boundary as `offer-actions.tsx`: `detail.ts` imports `@/db`
    // and a client component importing it pulls `pg` toward the browser.
    expect(FORM_COMPONENT).toContain("from '@/lib/deals/copy'");
    expect(FORM_COMPONENT).not.toContain("from '@/lib/deals/detail'");
  });

  it('names no ticket in anything a creator reads', () => {
    expect(FORM_COMPONENT).not.toMatch(/KAN-\d+/);
  });
});

describe('the deal detail page mounts the submission surface', () => {
  it('renders the form under canDeliver and nowhere else', () => {
    expect(DETAIL_PAGE).toMatch(
      /canDeliver\(deal\.status\) \? <DeliverableForm/
    );
  });

  it('shows what was submitted once a deliverable exists', () => {
    // The submitted URL and timestamp are facts the creator is entitled to
    // read back (AC-6) — on `revision_requested` this is what they are
    // replacing.
    expect(DETAIL_PAGE).toMatch(/deal\.deliverable \?/);
    expect(DETAIL_PAGE).toContain('SUBMITTED_DELIVERABLE_LABEL');
    expect(DETAIL_PAGE).toContain('SUBMITTED_AT_LABEL');
  });

  it('shows the URL as text, never as a link or embed', () => {
    // Nothing on the creator side navigates to or fetches the link (AC-8);
    // the brand-side "links to the live post" requirement is KAN-49's.
    expect(DETAIL_PAGE).toMatch(/deal\.deliverable\.tiktokUrl}/);
    expect(DETAIL_PAGE).not.toMatch(/<a[^>]*deal\.deliverable/);
    expect(DETAIL_PAGE).not.toMatch(/<img|<iframe/);
  });

  it('carries the deliverable on the detail read', () => {
    expect(DETAIL_MODULE).toContain('deliverable: DeliverableView | null');
    expect(DETAIL_MODULE).toContain(
      '.leftJoin(deliverable, eq(deliverable.dealId, deal.id))'
    );
  });
});
