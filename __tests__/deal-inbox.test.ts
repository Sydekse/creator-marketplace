import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../lib/authz';
import { expiryLabel, formatDeadline, NO_EXPIRY_LABEL } from '../lib/dates';
import {
  DEAL_HISTORY_EMPTY,
  DEAL_HISTORY_TITLE,
  SYSTEM_ACTOR_LABEL,
  ACCEPT_DEAL_LABEL,
  COMMISSION_LABEL,
  DECLINE_DEAL_LABEL,
  EXPECTED_PAYOUT_LABEL,
  NO_RIGHTS_TERMS_MESSAGE,
  OFFER_ACTIONS_UNAVAILABLE_MESSAGE,
  OFFER_EXPIRY_LABEL,
  PAYOUT_ESTIMATE_NOTE,
  SUBMIT_DELIVERABLE_LABEL,
  SUBMIT_DELIVERABLE_UNAVAILABLE_MESSAGE,
  TOTAL_PRICE_LABEL,
  UNIT_PRICE_LABEL,
  VIDEO_COUNT_LABEL,
  buildCreatorDealWhere,
  creatorDealQuery,
  readCreatorDeal,
  toDealDetail,
} from '../lib/deals/detail';
import type { CreatorDealDeps, CreatorDealJoinRow } from '../lib/deals/detail';
import { canAct, canDeliver } from '../lib/deals/state-machine';
import { DEAL_GROUPS, labelForStatus } from '../lib/deals/groups';
import {
  INBOX_DESCRIPTION,
  INBOX_TITLE,
  NO_DEALS_DESCRIPTION,
  NO_DEALS_TITLE,
  VIEW_DEAL_LABEL,
  inboxQuery,
  readDealInbox,
} from '../lib/deals/inbox';
import type { DealInboxDeps, InboxDealRow } from '../lib/deals/inbox';
import { getNavLinks } from '../lib/navigation';
import { computeSplit } from '../lib/payment/ledger';
import type { DealStatus } from '../db/schema';

/**
 * KAN-39 — the creator deal inbox (US-006, AC-1 – AC-7).
 *
 * Three claims carry most of the weight here.
 *
 * **AC-6** says a creator sees only their own deals. Asserted structurally on
 * both reads: `readDealInbox` takes no id at all, so there is no argument a
 * caller could pass to read someone else's offers, and `readCreatorDeal` builds
 * its `where` from the session's profile id rather than from its argument. The
 * denial paths are asserted to short-circuit *before* any query runs.
 *
 * **AC-3 and AC-4** name the statuses that may act. Both predicates read
 * `LEGAL_TRANSITIONS` rather than restating a status list, and both are asserted
 * exhaustively over all nine statuses — so the buttons cannot outlive the rule
 * that permits them, and a change to the machine fails here rather than shipping
 * a control that leads nowhere.
 *
 * **AC-2** says the detail view shows a payout net of commission. The fixture's
 * `commissionRate` deliberately differs from the configured platform rate, which
 * is what gives "uses the deal's own snapshotted rate" (invariant 8) teeth: a
 * regression to `COMMISSION_RATE` would still produce a plausible number.
 *
 * The rendering assertions are source guards. There is no DOM environment in
 * this repo (no jsdom, no Testing Library) — see the header of
 * `ui-primitives.test.ts` — so they assert what a file references, never what it
 * paints. Comments are stripped first, so a guard cannot be satisfied by prose.
 */

const CREATOR_PROFILE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const DEAL_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_DEAL_ID = 'b1e4b6a0-9c6e-4a1f-8f2d-0f6c1a2b3c4d';

const ALL_STATUSES: readonly DealStatus[] = [
  'pending',
  'accepted',
  'declined',
  'expired',
  'funded',
  'delivered',
  'revision_requested',
  'completed',
  'refunded',
];

const inboxRow = (over: Partial<InboxDealRow> = {}): InboxDealRow => ({
  id: DEAL_ID,
  status: 'pending',
  campaignName: 'Ramadan Beauty Push',
  companyName: 'Habesha Cosmetics',
  videoCount: 2,
  totalPrice: 300_000,
  offerExpiresAt: null,
  ...over,
});

const joinRow = (
  over: Partial<CreatorDealJoinRow> = {}
): CreatorDealJoinRow => ({
  id: DEAL_ID,
  status: 'pending',
  campaignName: 'Ramadan Beauty Push',
  companyName: 'Habesha Cosmetics',
  videoCount: 2,
  unitPrice: 150_000,
  totalPrice: 300_000,
  // Deliberately not the configured platform rate — see the header.
  commissionRate: '0.17',
  offerExpiresAt: null,
  rightsTerms: null,
  ...over,
});

const okInboxDeps = (rows: InboxDealRow[] = []): DealInboxDeps => ({
  requireCreator: async () => ({ creatorProfileId: CREATOR_PROFILE_ID }),
  selectDeals: async () => rows,
});

const src = (file: string) =>
  readFileSync(join(process.cwd(), file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const INBOX_MODULE = 'lib/deals/inbox.ts';
const DETAIL_MODULE = 'lib/deals/detail.ts';
const COPY_MODULE = 'lib/deals/copy.ts';
const INBOX_PAGE = 'app/(creator)/creator/deals/page.tsx';
const DETAIL_PAGE = 'app/(creator)/creator/deals/[id]/page.tsx';
const NOT_FOUND_PAGE = 'app/(creator)/creator/deals/[id]/not-found.tsx';
const INBOX_COMPONENT = 'components/deals/deal-inbox.tsx';
const HISTORY_COMPONENT = 'components/deals/deal-history.tsx';
const ACTIONS_COMPONENT = 'components/deals/offer-actions.tsx';
const DASHBOARD_ROWS = 'components/creator/deal-groups.tsx';
const TEMPLATES = 'lib/notifications/templates.tsx';

const TSX_FILES = [
  INBOX_PAGE,
  DETAIL_PAGE,
  NOT_FOUND_PAGE,
  INBOX_COMPONENT,
  HISTORY_COMPONENT,
  ACTIONS_COMPONENT,
];

// -- AC-1: the list, grouped, pending first ----------------------------------

describe('the inbox groups deals with pending first', () => {
  it('puts pending at the head of the group order', () => {
    // Not a comparator: `DEAL_GROUPS` is the vocabulary, so "pending offers
    // first" cannot be reordered by an edit to a page.
    expect(DEAL_GROUPS[0]).toBe('pending');
  });

  it('returns all five groups even when the creator has one deal', async () => {
    const inbox = await readDealInbox(okInboxDeps([inboxRow()]));

    expect(inbox?.groups.map((g) => g.group)).toEqual([...DEAL_GROUPS]);
    expect(inbox?.isEmpty).toBe(false);
  });

  it('reports an empty inbox when there are no deals at all', async () => {
    const inbox = await readDealInbox(okInboxDeps([]));

    expect(inbox?.isEmpty).toBe(true);
    expect(inbox?.groups).toHaveLength(DEAL_GROUPS.length);
    expect(inbox?.groups.every((g) => g.count === 0)).toBe(true);
  });

  it.each(ALL_STATUSES)(
    'places a %s deal in exactly one group',
    async (status) => {
      const inbox = await readDealInbox(okInboxDeps([inboxRow({ status })]));

      const holding = inbox?.groups.filter((g) => g.count > 0) ?? [];
      expect(holding).toHaveLength(1);
      expect(holding[0].deals[0].status).toBe(status);
    }
  );

  it('counts each group', async () => {
    const inbox = await readDealInbox(
      okInboxDeps([
        inboxRow({ id: 'a', status: 'pending' }),
        inboxRow({ id: 'b', status: 'pending' }),
        inboxRow({ id: 'c', status: 'completed' }),
      ])
    );

    const pending = inbox?.groups.find((g) => g.group === 'pending');
    expect(pending?.count).toBe(2);
  });
});

describe('the inbox query', () => {
  const { sql, params } = inboxQuery(CREATOR_PROFILE_ID).toSQL();

  it('reads one creator, newest first', () => {
    expect(sql).toContain('"creator_id"');
    expect(params).toContain(CREATOR_PROFILE_ID);
    expect(sql).toMatch(/order by[\s\S]*desc/i);
  });

  it('joins the brand so AC-1 can say who is offering', () => {
    expect(sql).toMatch(/join "brand_profile"/i);
    expect(sql).toContain('"company_name"');
  });

  it('selects no contact column from the brand (NFR-010)', () => {
    expect(sql).not.toContain('"contact_email"');
    expect(sql).not.toContain('"contact_name"');
    expect(sql).not.toContain('"phone"');
  });
});

// -- AC-1: the deadline is visible, and in the right tense -------------------

describe('offer expiry reads in the tense the clock justifies', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');

  it('is future tense while the offer is open', () => {
    const label = expiryLabel(new Date('2026-08-17T09:00:00.000Z'), now);

    expect(label).toContain('Expires');
    expect(label).not.toContain('Expired');
    expect(label).toContain('UTC');
  });

  it('is past tense once the deadline has gone', () => {
    // Reachable today: KAN-38's expiry sweep has not shipped, so a `pending`
    // deal can sit past its deadline. "Expires on 3 Aug" would be false.
    const label = expiryLabel(new Date('2026-08-03T09:00:00.000Z'), now);

    expect(label).toContain('Expired');
  });

  it('treats the exact instant of expiry as expired', () => {
    expect(expiryLabel(now, now)).toContain('Expired');
  });

  it('says none is recorded rather than implying no deadline', () => {
    expect(expiryLabel(null, now)).toBe(NO_EXPIRY_LABEL);
    expect(NO_EXPIRY_LABEL).not.toMatch(/never|any ?time/i);
  });

  it('renders UTC regardless of the server zone', () => {
    // Explicit, not incidental: a server-local render changes a deadline's
    // meaning when the deployment region does.
    expect(formatDeadline('2026-08-17T09:00:00.000Z')).toContain('09:00');
  });

  it('accepts a Date and an ISO string alike', () => {
    const iso = '2026-08-17T09:00:00.000Z';
    expect(formatDeadline(iso)).toBe(formatDeadline(new Date(iso)));
  });
});

describe('the inbox list renders the deadline', () => {
  const source = src(INBOX_COMPONENT);

  it('reaches expiry through the shared label helper', () => {
    expect(source).toContain('expiryLabel');
    expect(source).toContain('offerExpiresAt');
  });

  it('takes the clock as a prop rather than reading it per row', () => {
    // Two rows rendered either side of a deadline must not disagree about the
    // same instant.
    expect(source).not.toContain('new Date()');
    expect(source).toContain('now');
  });

  it('links each row into the detail view', () => {
    expect(source).toMatch(/href=\{`\/creator\/deals\/\$\{deal\.id\}`\}/);
  });
});

// -- AC-2: everything needed to decide, on one screen ------------------------

describe('the detail read returns every field AC-2 names', () => {
  const detail = toDealDetail(joinRow());

  it.each([
    'companyName',
    'videoCount',
    'unitPrice',
    'totalPrice',
    'expectedPayout',
    'offerExpiresAt',
    'rightsTerms',
  ])('carries %s', (field) => {
    expect(detail).toHaveProperty(field);
  });

  it('computes the payout from the split, net of commission', () => {
    const { commission, payout } = computeSplit(300_000, '0.17');

    expect(detail.commission).toBe(commission);
    expect(detail.expectedPayout).toBe(payout);
    expect(detail.expectedPayout).toBe(300_000 - detail.commission);
  });

  it("uses the deal's own snapshotted rate, not the platform default", async () => {
    // Invariant 8. A later change to the configured rate must not retroactively
    // change what an already-offered deal appears to pay.
    const { COMMISSION_RATE } = await import('../lib/config/pricing');
    expect(joinRow().commissionRate).not.toBe(COMMISSION_RATE);

    const atPlatformRate = computeSplit(300_000, COMMISSION_RATE);
    expect(detail.expectedPayout).not.toBe(atPlatformRate.payout);
  });

  it('keeps the payout an integer number of santim (invariant 4)', () => {
    const odd = toDealDetail(joinRow({ totalPrice: 333_333 }));

    expect(Number.isInteger(odd.expectedPayout)).toBe(true);
    expect(Number.isInteger(odd.commission)).toBe(true);
    expect(odd.commission + odd.expectedPayout).toBe(333_333);
  });
});

describe('the detail query', () => {
  const { sql } = creatorDealQuery(
    buildCreatorDealWhere(DEAL_ID, CREATOR_PROFILE_ID)
  ).toSQL();

  it('left-joins the rights terms', () => {
    // `deal.rights_terms_id` is nullable; an inner join would make an older deal
    // vanish from the creator's own inbox rather than render without its terms.
    expect(sql).toMatch(/left join "rights_terms"/i);
  });

  it('inner-joins the campaign and the brand', () => {
    expect(sql).toMatch(/inner join "campaign"/i);
    expect(sql).toMatch(/inner join "brand_profile"/i);
  });

  it('reads at most one row', () => {
    expect(sql).toMatch(/limit/i);
  });
});

describe('the detail page renders the terms and does no arithmetic', () => {
  const source = src(DETAIL_PAGE);

  it.each([
    VIDEO_COUNT_LABEL,
    UNIT_PRICE_LABEL,
    TOTAL_PRICE_LABEL,
    EXPECTED_PAYOUT_LABEL,
    COMMISSION_LABEL,
    OFFER_EXPIRY_LABEL,
  ])('renders the %s label from its constant', (label) => {
    // The constant, not the text: a page that retypes the string can be
    // paraphrased apart from it by a later edit.
    expect(source).not.toContain(`>${label}<`);
  });

  it('mounts the usage-rights card inline (AC-2)', () => {
    expect(source).toContain('UsageRightsCard');
  });

  it('says so when a deal carries no terms rather than rendering an empty card', () => {
    expect(source).toContain('NO_RIGHTS_TERMS_MESSAGE');
    expect(NO_RIGHTS_TERMS_MESSAGE).not.toBe('');
  });

  it('labels the payout as an estimate', () => {
    // A pending deal has no ledger rows, so this figure describes money that
    // has not moved. KAN-25 AC-4 is why the dashboard's numbers are sums.
    expect(source).toContain('PAYOUT_ESTIMATE_NOTE');
    expect(PAYOUT_ESTIMATE_NOTE).toMatch(/estimat/i);
  });

  it('imports no split arithmetic', () => {
    expect(source).not.toContain('computeSplit');
    expect(source).not.toMatch(/[*/]\s*100\b/);
    expect(source).not.toMatch(/\*\s*0\.\d/);
  });
});

// -- AC-3: accept and decline only while pending -----------------------------

describe('canAct is exactly the pending status', () => {
  it.each(ALL_STATUSES)('%s', (status) => {
    expect(canAct(status)).toBe(status === 'pending');
  });

  it('is derived from the transition table, not a second status list', () => {
    const source = src('lib/deals/state-machine.ts');
    expect(source).toMatch(/canAct[\s\S]{0,160}LEGAL_TRANSITIONS/);
  });
});

describe('the offer actions are gated by the agreement (F31)', () => {
  const source = src(ACTIONS_COMPONENT);
  const page = src(DETAIL_PAGE);

  it('renders only under canAct', () => {
    expect(page).toMatch(/isPending \? <OfferActions/);
    expect(page).toContain('canAct(deal.status)');
  });

  it('mounts the agreement checkbox', () => {
    expect(source).toContain('UsageRightsAgreement');
  });

  it('starts unchecked, with no default the caller could skip', () => {
    // AC-3: the box cannot be pre-checked. The component is controlled with no
    // `defaultChecked`, so this initial value is the enforcement.
    expect(source).toContain('useState(false)');
    expect(source).not.toContain('useState(true)');
    expect(source).not.toContain('defaultChecked');
  });

  it('passes the state down as `checked`', () => {
    expect(source).toMatch(/checked=\{agreed\}/);
    expect(source).toMatch(/onCheckedChange=/);
  });

  it('wires the agreement into the accept control, not just into a variable', () => {
    // The version of this that passes vacuously computes `canAccept` and never
    // reaches the button — lint caught exactly that on this branch. So assert
    // the `disabled` expression itself references the gate.
    expect(source).toMatch(/disabled=\{[^}]*canAccept[^}]*\}/);
    expect(source).toMatch(/const canAccept = agreed &&/);
  });

  it('leaves declining ungated by the agreement', () => {
    // A creator refusing terms should not have to tick that they accept them.
    const declineButton = source.slice(
      source.indexOf('DECLINE_DEAL_LABEL') - 300
    );
    expect(declineButton).not.toMatch(/disabled=\{[^}]*canAccept/);
  });

  it('renders both labels from their constants', () => {
    expect(source).toContain('ACCEPT_DEAL_LABEL');
    expect(source).toContain('DECLINE_DEAL_LABEL');
    expect(ACCEPT_DEAL_LABEL).not.toBe(DECLINE_DEAL_LABEL);
  });

  it('explains the disabled state in a sentence, not a tooltip', () => {
    expect(source).toContain('OFFER_ACTIONS_UNAVAILABLE_MESSAGE');
    expect(OFFER_ACTIONS_UNAVAILABLE_MESSAGE.length).toBeGreaterThan(20);
  });
});

describe('the client component stays on the browser side of the bundle', () => {
  // This is a build failure, not a style rule, and it happened on this branch:
  // `offer-actions.tsx` is `'use client'`, `lib/deals/detail.ts` imports `@/db`
  // for its query, and importing the copy from there pulled `pg` toward the
  // browser — `Can't resolve 'util/types'`, import trace
  // `offer-actions.tsx → detail.ts → db/index.ts → pg`. `lib/deals/copy.ts`
  // exists to hold the three strings on the pure side. Nothing about that is
  // visible in the source once it works, so it is worth a guard.
  const source = src(ACTIONS_COMPONENT);

  it('reads its copy from the pure module, never from the query module', () => {
    expect(source).toContain("from '@/lib/deals/copy'");
    expect(source).not.toContain("from '@/lib/deals/detail'");
  });

  it('keeps the copy module free of a database import', () => {
    // Same guard `lib/deals/groups.ts` carries, for the same reason: a module
    // that reaches for `db` is not importable from a client component.
    const copy = src(COPY_MODULE);
    expect(copy).not.toContain("from '@/db'");
    expect(copy).not.toContain('drizzle-orm');
  });

  it('leaves the server-side surface where callers already look for it', () => {
    // `detail.ts` re-exports all three, so "copy beside the query" still holds
    // and the split is invisible to every server-side caller.
    const detail = src(DETAIL_MODULE);
    expect(detail).toMatch(
      /export \{[^}]*ACCEPT_DEAL_LABEL[^}]*\} from '\.\/copy'/
    );
  });
});

// -- AC-4: the deliverable path, once funded ---------------------------------

describe('canDeliver is exactly funded and revision_requested', () => {
  it.each(ALL_STATUSES)('%s', (status) => {
    expect(canDeliver(status)).toBe(
      status === 'funded' || status === 'revision_requested'
    );
  });

  it('is derived from the transition table', () => {
    const source = src('lib/deals/state-machine.ts');
    expect(source).toMatch(/canDeliver[\s\S]{0,160}LEGAL_TRANSITIONS/);
  });
});

describe('the deliverable path renders under canDeliver and nowhere else', () => {
  const source = src(DETAIL_PAGE);

  it('is conditioned on the predicate', () => {
    expect(source).toMatch(/canDeliver\(deal\.status\) \?/);
  });

  it('renders its label and its reason from constants', () => {
    expect(source).toContain('SUBMIT_DELIVERABLE_LABEL');
    expect(source).toContain('SUBMIT_DELIVERABLE_UNAVAILABLE_MESSAGE');
    expect(SUBMIT_DELIVERABLE_UNAVAILABLE_MESSAGE.length).toBeGreaterThan(20);
    expect(SUBMIT_DELIVERABLE_LABEL).not.toBe(ACCEPT_DEAL_LABEL);
  });
});

// -- AC-5: the state history is visible --------------------------------------

describe('the detail page shows the deal history', () => {
  const page = src(DETAIL_PAGE);
  const component = src(HISTORY_COMPONENT);

  it('calls the existing history read rather than a second query', () => {
    expect(page).toContain('getDealHistory');
    expect(page).toContain('DealHistory');
  });

  it('reads the history after the ownership check, not alongside it', () => {
    // `getDealHistory` throws where `readCreatorDeal` returns null, and this app
    // has no error boundary — running them together turns a stale link into an
    // unstyled 500 instead of the not-found page.
    expect(page).not.toContain('Promise.all');
    const detailAt = page.indexOf('readCreatorDeal(');
    const historyAt = page.indexOf('getDealHistory(');
    expect(detailAt).toBeGreaterThan(-1);
    expect(historyAt).toBeGreaterThan(detailAt);
    expect(page.indexOf('notFound()')).toBeLessThan(historyAt);
  });

  it('names a null actor as the system rather than leaving it blank', () => {
    expect(component).toContain('SYSTEM_ACTOR_LABEL');
    expect(SYSTEM_ACTOR_LABEL.trim()).not.toBe('');
  });

  it('renders statuses through the label map, never raw', () => {
    expect(component).toContain('labelForStatus');
    expect(component).not.toContain('event.toStatus}');
  });

  it('has an empty state and a title', () => {
    expect(component).toContain('DEAL_HISTORY_TITLE');
    expect(component).toContain('DEAL_HISTORY_EMPTY');
    expect(DEAL_HISTORY_TITLE).not.toBe(DEAL_HISTORY_EMPTY);
  });

  it('does not re-sort what the query already ordered', () => {
    expect(component).not.toContain('.sort(');
  });
});

describe('every status has a human label', () => {
  it.each(ALL_STATUSES)('%s is renamed for a person', (status) => {
    const label = labelForStatus(status);

    expect(label).not.toBe(status);
    expect(label).not.toContain('_');
  });

  it('falls back to the raw value for a status this build has never seen', () => {
    // A row written by a newer deploy: showing it verbatim is more honest than
    // dropping the event.
    expect(labelForStatus('teleported')).toBe('teleported');
  });
});

// -- AC-6: a creator sees only their own deals -------------------------------

describe('ownership is structural on the inbox', () => {
  it('takes no arguments other than its test seam', () => {
    // There is no argument a caller could pass to read somebody else's offers.
    expect(readDealInbox).toHaveLength(0);
  });

  it('refuses a non-creator before any query runs', async () => {
    const selectDeals = vi.fn();

    await expect(
      readDealInbox({
        requireCreator: async () => {
          throw new ForbiddenError('not a creator');
        },
        selectDeals,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(selectDeals).not.toHaveBeenCalled();
  });

  it('returns null for a creator with no profile row, without querying', async () => {
    const selectDeals = vi.fn();

    const inbox = await readDealInbox({
      requireCreator: async () => ({ creatorProfileId: null }),
      selectDeals,
    });

    expect(inbox).toBeNull();
    expect(selectDeals).not.toHaveBeenCalled();
  });

  it('passes the session profile id to the query, never anything else', async () => {
    const selectDeals = vi.fn(async () => []);

    await readDealInbox({
      requireCreator: async () => ({ creatorProfileId: CREATOR_PROFILE_ID }),
      selectDeals,
    });

    expect(selectDeals).toHaveBeenCalledWith(CREATOR_PROFILE_ID);
  });
});

describe('ownership is in the where clause on the detail read', () => {
  it('ANDs the session profile id into the lookup', () => {
    const { params } = creatorDealQuery(
      buildCreatorDealWhere(DEAL_ID, CREATOR_PROFILE_ID)
    ).toSQL();

    expect(params).toContain(CREATOR_PROFILE_ID);
    expect(params).toContain(DEAL_ID);
  });

  it('gates before it looks at the id', async () => {
    const select = vi.fn();

    await expect(
      readCreatorDeal('not-a-uuid', {
        requireCreator: async () => {
          throw new ForbiddenError('not a creator');
        },
        select,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(select).not.toHaveBeenCalled();
  });

  it('short-circuits a malformed id before Postgres sees it', async () => {
    // An unchecked id compared against a `uuid` column raises 22P02, turning a
    // mistyped link into a 500 (F16).
    const select = vi.fn();

    const deal = await readCreatorDeal('../../etc/passwd', {
      requireCreator: async () => ({ creatorProfileId: CREATOR_PROFILE_ID }),
      select,
    });

    expect(deal).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it.each([
    ['a malformed id', 'not-a-uuid'],
    ['an unknown id', OTHER_DEAL_ID],
  ])('answers %s with null, indistinguishably', async (_label, id) => {
    const deps: CreatorDealDeps = {
      requireCreator: async () => ({ creatorProfileId: CREATOR_PROFILE_ID }),
      // A real deal belonging to another creator misses the same way: the
      // creator id is ANDed into the where, so the row is simply not returned.
      select: async () => null,
    };

    expect(await readCreatorDeal(id, deps)).toBeNull();
  });

  it('returns null rather than throwing, so the page can 404', async () => {
    // Deliberately not `guard({resource:{kind:'deal'}})`, which throws. This app
    // has no error boundary, so a thrown denial renders an unstyled 500.
    const source = src(DETAIL_MODULE);

    expect(source).not.toMatch(/resource:\s*\{\s*kind:\s*'deal'/);
    expect(src(DETAIL_PAGE)).toContain('notFound()');
  });
});

describe('the not-found page is not an existence oracle', () => {
  const source = src(NOT_FOUND_PAGE);

  it('says nothing about why the deal is missing', () => {
    expect(source).not.toMatch(
      /not yours|belongs to|does not exist|forbidden/i
    );
  });

  it('offers the way back as a styled link, never a Button wrapping one', () => {
    expect(source).toContain('buttonVariants');
    expect(source).not.toMatch(/<Button\s+render=/);
  });
});

// -- AC-7: one query, not five -----------------------------------------------

describe('the list is one round trip', () => {
  it('queries once for all five groups', async () => {
    const selectDeals = vi.fn(async () => [
      inboxRow({ id: 'a', status: 'pending' }),
      inboxRow({ id: 'b', status: 'completed' }),
      inboxRow({ id: 'c', status: 'declined' }),
    ]);

    await readDealInbox({
      requireCreator: async () => ({ creatorProfileId: CREATOR_PROFILE_ID }),
      selectDeals,
    });

    // The grouping is a partition of the same rows; five queries would read the
    // same index five times to produce the same set (NFR-001).
    expect(selectDeals).toHaveBeenCalledTimes(1);
  });

  it('groups in memory rather than in the database', () => {
    const source = src(INBOX_MODULE);

    expect(source).toContain('groupDeals');
    expect(source).not.toMatch(/group by/i);
  });
});

// -- Copy ---------------------------------------------------------------------

describe('user-facing copy', () => {
  const CONSTANTS: Array<[string, string]> = [
    ['INBOX_TITLE', INBOX_TITLE],
    ['INBOX_DESCRIPTION', INBOX_DESCRIPTION],
    ['NO_DEALS_TITLE', NO_DEALS_TITLE],
    ['NO_DEALS_DESCRIPTION', NO_DEALS_DESCRIPTION],
    ['VIEW_DEAL_LABEL', VIEW_DEAL_LABEL],
    ['ACCEPT_DEAL_LABEL', ACCEPT_DEAL_LABEL],
    ['DECLINE_DEAL_LABEL', DECLINE_DEAL_LABEL],
    ['OFFER_ACTIONS_UNAVAILABLE_MESSAGE', OFFER_ACTIONS_UNAVAILABLE_MESSAGE],
    ['SUBMIT_DELIVERABLE_LABEL', SUBMIT_DELIVERABLE_LABEL],
    [
      'SUBMIT_DELIVERABLE_UNAVAILABLE_MESSAGE',
      SUBMIT_DELIVERABLE_UNAVAILABLE_MESSAGE,
    ],
    ['NO_RIGHTS_TERMS_MESSAGE', NO_RIGHTS_TERMS_MESSAGE],
    ['PAYOUT_ESTIMATE_NOTE', PAYOUT_ESTIMATE_NOTE],
    ['DEAL_HISTORY_TITLE', DEAL_HISTORY_TITLE],
    ['DEAL_HISTORY_EMPTY', DEAL_HISTORY_EMPTY],
    ['SYSTEM_ACTOR_LABEL', SYSTEM_ACTOR_LABEL],
    ['NO_EXPIRY_LABEL', NO_EXPIRY_LABEL],
  ];

  it.each(CONSTANTS)('%s names no ticket', (_name, value) => {
    expect(value).not.toMatch(/KAN-\d+/);
  });

  it.each(CONSTANTS)('%s is a real sentence', (_name, value) => {
    expect(value.trim()).not.toBe('');
    expect(value).not.toMatch(/TODO|FIXME|placeholder/i);
  });

  it.each(TSX_FILES)('%s uses no title tooltip', (file) => {
    // Hover-only copy tells a touch user nothing. A disabled control explains
    // itself in a sentence beside it.
    //
    // Scoped to intrinsic elements — a lowercase tag — because `title` is also
    // an ordinary React prop: `EmptyState` takes one as its heading, and
    // flagging that would make the guard something to work around rather than
    // something to obey.
    expect(src(file)).not.toMatch(/<[a-z][a-zA-Z0-9]*\s[^>]*\stitle=/);
  });

  it("does not duplicate the dashboard's empty-state sentence", async () => {
    // Two byte-identical copies drift silently, and no test can tell which one a
    // page meant to render.
    const dashboard = await import('../lib/creators/dashboard');

    expect(NO_DEALS_DESCRIPTION).not.toBe(dashboard.NO_DEALS_DESCRIPTION);
  });
});

// -- Route consistency (closes F17's creator half) ---------------------------

describe('every path to the inbox names the same route', () => {
  const ROUTE = '/creator/deals';

  it('is where the creator nav points', () => {
    const deals = getNavLinks('creator').find((l) => l.label === 'My Deals');

    expect(deals?.href).toBe(ROUTE);
  });

  it('is where the email CTAs point', () => {
    const templates = src(TEMPLATES);
    const ctas = [...templates.matchAll(/appUrl\('([^']+)'\)/g)].map(
      (m) => m[1]
    );

    // Four of them — offer received, deliverable approved, revision requested,
    // payout sent — all naming a route that now exists. The exact count rather
    // than "at least one": a regression that dropped three of them would still
    // pass a `> 0` assertion.
    expect(ctas.filter((href) => href === ROUTE)).toHaveLength(4);
    expect(ctas).not.toContain('/deals');
  });

  it('is where the dashboard rows link', () => {
    expect(src(DASHBOARD_ROWS)).toMatch(
      /href=\{`\/creator\/deals\/\$\{deal\.id\}`\}/
    );
  });

  it('has a page file at that path', () => {
    expect(() => src(INBOX_PAGE)).not.toThrow();
    expect(() => src(DETAIL_PAGE)).not.toThrow();
  });
});

// -- The guards can fail ------------------------------------------------------

describe('the source guards are not vacuous', () => {
  it('would catch a title tooltip on a real element', () => {
    const tooltip = /<[a-z][a-zA-Z0-9]*\s[^>]*\stitle=/;

    expect('<button disabled title="not yet">Accept</button>').toMatch(tooltip);
    // And would not flag the React prop of the same name.
    expect('<EmptyState title="No offers yet." />').not.toMatch(tooltip);
  });

  it('would catch a pre-checked agreement', () => {
    expect('const [agreed, setAgreed] = useState(true);').toContain(
      'useState(true)'
    );
  });

  it('would catch a ticket number in copy', () => {
    expect('Accept offer (KAN-36)').toMatch(/KAN-\d+/);
  });

  it('would catch a gate computed but never applied', () => {
    const applied = /disabled=\{[^}]*canAccept[^}]*\}/;

    expect('<button disabled>Accept</button>').not.toMatch(applied);
    expect('<button disabled={!canAccept}>Accept</button>').toMatch(applied);
  });

  it('would catch a raw status in the timeline', () => {
    expect('<span>{event.toStatus}</span>').toContain('event.toStatus}');
  });

  it('reads real files, so a renamed path fails loudly', () => {
    expect(() => src('components/deals/does-not-exist.tsx')).toThrow();
  });
});
