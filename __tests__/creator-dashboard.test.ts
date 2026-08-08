import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../lib/authz';
import {
  EARNINGS_IN_ESCROW_LABEL,
  EARNINGS_NET_NOTE,
  EARNINGS_PAID_OUT_LABEL,
  NOT_BOOKABLE_DESCRIPTION,
  NO_DEALS_DESCRIPTION,
  NO_DEALS_TITLE,
  dealsQuery,
  earningsQuery,
  groupDeals,
  readCreatorDashboard,
} from '../lib/creators/dashboard';
import type {
  CreatorDashboardDeps,
  CreatorDealRow,
} from '../lib/creators/dashboard';
import { DEAL_GROUPS, GROUP_LABELS, groupForStatus } from '../lib/deals/groups';
import type { DealGroup } from '../lib/deals/groups';
import { computeSplit } from '../lib/payment/ledger';
import type { DealStatus } from '../db/schema';

/**
 * KAN-25 — the creator dashboard (US-001, AC-1 – AC-7).
 *
 * Three claims are worth more than the rest here.
 *
 * **AC-4** says the dashboard reads the ledger rather than recomputing its own
 * totals. That is asserted twice: on the emitted SQL, which shows *which* rows
 * each figure sums, and as a source guard that no module on this path imports
 * `computeSplit`. A component with nothing to compute with cannot drift.
 *
 * **AC-6** says a creator sees only their own data. Asserted structurally —
 * `readCreatorDashboard` takes no creator id, so there is no argument a caller
 * could pass to read somebody else's deals.
 *
 * **AC-2** says deals are grouped by state. Asserted exhaustively over all nine
 * `DealStatus` values, so a tenth status cannot be added without either a
 * mapping or a failing test.
 *
 * The rendering assertions are source guards. There is no DOM environment in
 * this repo (no jsdom, no Testing Library) — see the header of
 * `ui-primitives.test.ts` — so they assert what a component references, never
 * what it paints.
 */

const CREATOR_PROFILE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const OTHER_PROFILE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

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

const dealRow = (over: Partial<CreatorDealRow> = {}): CreatorDealRow => ({
  id: 'deal-1',
  status: 'pending',
  campaignName: 'Ramadan Beauty Push',
  videoCount: 2,
  totalPrice: 300_000,
  offerExpiresAt: null,
  ...over,
});

const okDeps = (
  rows: CreatorDealRow[] = [],
  earnings = { paidOut: 0, inEscrow: 0 }
): CreatorDashboardDeps => ({
  requireCreator: async () => ({ creatorProfileId: CREATOR_PROFILE_ID }),
  selectEarnings: async () => earnings,
  selectDeals: async () => rows,
});

const src = (file: string) =>
  readFileSync(join(process.cwd(), file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  );

const DASHBOARD_MODULE = 'lib/creators/dashboard.ts';
const GROUPS_MODULE = 'lib/deals/groups.ts';
const EARNINGS = 'components/creator/earnings-summary.tsx';
const DEAL_GROUPS_FILE = 'components/creator/deal-groups.tsx';
const PAGE = 'app/(creator)/creator/page.tsx';

// -- AC-2: every status renders somewhere ------------------------------------

describe('deal grouping is total over the state machine', () => {
  it('maps all nine statuses to a known group', () => {
    // The compiler already enforces this through `satisfies Record<DealStatus,
    // DealGroup>`. Asserted at runtime too because the failure mode it prevents
    // is a deal that renders in no group at all — invisible on the only screen
    // a creator has to see it on, and silent.
    for (const status of ALL_STATUSES) {
      expect(DEAL_GROUPS).toContain(groupForStatus(status));
    }
  });

  it('covers the statuses the deal machine actually declares', () => {
    // Guards against this test's own fixture going stale: if a tenth status is
    // added to `DealStatus` and not to `ALL_STATUSES`, the loop above would
    // still pass while proving nothing about the new one. The schema's union is
    // not readable at runtime, so the check is on the source of truth's text.
    const schema = src('db/schema.ts');
    const union = schema.slice(
      schema.indexOf('export type DealStatus'),
      schema.indexOf('export type ReviewStatus')
    );
    for (const status of ALL_STATUSES) {
      expect(union).toContain(`'${status}'`);
    }
    expect(union.match(/'[a-z_]+'/g) ?? []).toHaveLength(ALL_STATUSES.length);
  });

  it('files revision_requested with in-progress, not awaiting approval', () => {
    // Grouped by who must act next. The brand rejected the deliverable, so the
    // creator re-delivers — putting this under "awaiting approval" would tell a
    // creator to wait when they are the blocker.
    expect(groupForStatus('revision_requested')).toBe('in_progress');
    expect(groupForStatus('delivered')).toBe('awaiting_approval');
  });

  it('keeps the three terminal states the AC does not name', () => {
    // AC-2 names four groups; the machine has nine statuses. Without the fifth
    // group a declined or expired offer would vanish rather than close.
    for (const status of ['declined', 'expired', 'refunded'] as const) {
      expect(groupForStatus(status)).toBe('closed');
    }
  });

  it('labels every group, in one place', () => {
    for (const group of DEAL_GROUPS) {
      expect(GROUP_LABELS[group].title.length).toBeGreaterThan(0);
      expect(GROUP_LABELS[group].empty.length).toBeGreaterThan(0);
    }
  });

  it('names no ticket in copy a creator reads', () => {
    for (const group of DEAL_GROUPS) {
      expect(GROUP_LABELS[group].title).not.toMatch(/KAN-\d+/);
      expect(GROUP_LABELS[group].empty).not.toMatch(/KAN-\d+/);
    }
  });

  it('holds no database import, so the vocabulary stays shareable', () => {
    // The deal inbox (KAN-39) groups the same nine statuses. A pure module is
    // importable from anywhere; one that reaches for `db` is not.
    const source = src(GROUPS_MODULE);
    expect(source).not.toContain("from '@/db'");
    expect(source).not.toContain('drizzle-orm');
  });
});

describe('groupDeals', () => {
  it('returns all five groups even when most are empty', () => {
    // Stable headings: a creator's dashboard should not reshuffle its layout as
    // deals move through the machine.
    const groups = groupDeals([dealRow()]);
    expect(groups.map((g) => g.group)).toEqual([...DEAL_GROUPS]);
  });

  it('partitions rows — every deal lands in exactly one group', () => {
    const rows = ALL_STATUSES.map((status, i) =>
      dealRow({ id: `deal-${i}`, status })
    );
    const groups = groupDeals(rows);

    const placed = groups.flatMap((g) => g.deals.map((d) => d.id));
    expect(placed).toHaveLength(rows.length);
    expect(new Set(placed).size).toBe(rows.length);
  });

  it('counts what it holds', () => {
    const rows = [
      dealRow({ id: 'a', status: 'accepted' }),
      dealRow({ id: 'b', status: 'funded' }),
      dealRow({ id: 'c', status: 'pending' }),
    ];
    const byGroup = new Map<DealGroup, number>(
      groupDeals(rows).map((g) => [g.group, g.count])
    );

    expect(byGroup.get('in_progress')).toBe(2);
    expect(byGroup.get('pending')).toBe(1);
    expect(byGroup.get('completed')).toBe(0);
  });

  it('keeps the order it was given inside a group', () => {
    // The query orders newest first; grouping must not reshuffle that.
    const groups = groupDeals([
      dealRow({ id: 'newer', status: 'accepted' }),
      dealRow({ id: 'older', status: 'funded' }),
    ]);
    const inProgress = groups.find((g) => g.group === 'in_progress');
    expect(inProgress?.deals.map((d) => d.id)).toEqual(['newer', 'older']);
  });
});

// -- AC-3 / AC-4: the figures come from the ledger ---------------------------

describe('the earnings query reads the ledger', () => {
  const { sql, params } = earningsQuery(CREATOR_PROFILE_ID).toSQL();

  it('sums only release_payout rows for what was paid out', () => {
    // Net of commission by construction: the split was applied when the row was
    // written, and the `commission` entry is a separate row this sum never
    // touches.
    expect(sql).toContain("'release_payout'");
    expect(sql).toMatch(/case when[\s\S]*then\s*-/i);
  });

  it('sums every entry for what is still held', () => {
    // `hold + release_payout + commission = 0` per settled deal, so the total
    // over all entries is exactly what remains in escrow.
    expect(sql).toMatch(/coalesce\(sum\(/i);
  });

  it('casts the aggregates, because SUM() returns bigint as a string', () => {
    // Without this, `paidOut` is a string that concatenates instead of adding —
    // the trap `sumBalance` in `lib/payment/ledger.ts` documents.
    expect(sql.match(/::int/g) ?? []).toHaveLength(2);
  });

  it('joins deal to reach the creator, and does so inner', () => {
    // `ledger_entry.deal_id` is nullable for campaign-level funding. Those rows
    // belong to no creator, and an inner join drops them — which is the correct
    // reading, not an omission.
    expect(sql).toContain('"deal"');
    expect(sql).toMatch(/inner join/i);
    expect(sql).not.toMatch(/left join/i);
  });

  it('filters by creator_profile.id and binds it', () => {
    // Two hops: `deal.creator_id` references `creator_profile.id`, never
    // `user.id`. Filtering on a user id would match nothing and read on screen
    // as "you have no deals".
    expect(sql).toContain('"creator_id"');
    expect(sql).not.toContain(CREATOR_PROFILE_ID);
    expect(params).toContain(CREATOR_PROFILE_ID);
  });

  it('computes no commission of its own', () => {
    expect(sql).not.toMatch(/0\.15|15\.00|\*\s*0\./);
  });
});

describe('the deals query', () => {
  const { sql, params } = dealsQuery(CREATOR_PROFILE_ID).toSQL();

  it('reads one creator, newest first', () => {
    expect(sql).toContain('"creator_id"');
    expect(params).toContain(CREATOR_PROFILE_ID);
    expect(sql).toMatch(/order by[\s\S]*desc/i);
  });

  it('joins the campaign for its name and nothing else', () => {
    expect(sql).toContain('"campaign"');
    expect(sql.match(/ join /gi) ?? []).toHaveLength(1);
  });

  it('selects the stored total, never a derived payout', () => {
    // `total_price` is a snapshot taken at offer time. Selecting a payout here
    // would put a computed figure beside the ledger's, which is the drift AC-4
    // forbids.
    expect(sql).toContain('"total_price"');
    expect(sql).not.toContain('commission');
  });

  it('reads one query for all five groups', () => {
    // Five queries would read the same index five times to partition the same
    // rows (AC-7, NFR-001).
    expect(sql.match(/select/gi) ?? []).toHaveLength(1);
  });
});

describe('AC-4 — nothing on this path recomputes a total', () => {
  it.each([DASHBOARD_MODULE, EARNINGS, DEAL_GROUPS_FILE, PAGE])(
    '%s imports no split arithmetic',
    (file) => {
      const source = src(file);
      expect(source).not.toContain('computeSplit');
      expect(source).not.toContain('COMMISSION_RATE');
    }
  );

  it.each([EARNINGS, DEAL_GROUPS_FILE])('%s does no arithmetic', (file) => {
    const source = src(file);
    // No percentage, no santim conversion, no multiplication of a money value.
    expect(source).not.toMatch(/[*/]\s*100\b/);
    expect(source).not.toMatch(/\*\s*0\.\d/);
    // `formatEtb` is the only route from integer santim to a string
    // (invariant 4).
    expect(source).toContain('formatEtb');
    expect(source).not.toContain('toFixed');
  });

  it('the earnings component only formats what it is handed', () => {
    const source = src(EARNINGS);
    expect(source).toContain('formatEtb(earnings.paidOut)');
    expect(source).toContain('formatEtb(earnings.inEscrow)');
  });
});

describe('the ledger sign convention the two figures rely on', () => {
  /**
   * Mirrors the SQL aggregates over a fixture built from the real
   * `computeSplit`, which is what makes this a test of the *assumption* rather
   * than of the query: if payout ever stopped being derived by subtraction, the
   * identity below would break and both dashboard figures would be wrong.
   */
  const sum = (entries: readonly { type: string; amount: number }[]) => ({
    paidOut: entries
      .filter((e) => e.type === 'release_payout')
      .reduce((n, e) => n - e.amount, 0),
    inEscrow: entries.reduce((n, e) => n + e.amount, 0),
  });

  const TOTAL = 300_000;
  const { commission, payout } = computeSplit(TOTAL, '15.00');

  it('leaves nothing in escrow once a deal pays out, and pays the net', () => {
    const settled = sum([
      { type: 'hold', amount: TOTAL },
      { type: 'release_payout', amount: -payout },
      { type: 'commission', amount: -commission },
    ]);

    expect(settled.inEscrow).toBe(0);
    expect(settled.paidOut).toBe(payout);
    // Net, not gross — the whole point of AC-4.
    expect(settled.paidOut).toBeLessThan(TOTAL);
    expect(settled.paidOut + commission).toBe(TOTAL);
  });

  it('leaves nothing in escrow after a refund, and pays nothing', () => {
    const refunded = sum([
      { type: 'hold', amount: TOTAL },
      { type: 'refund', amount: -TOTAL },
    ]);

    expect(refunded.inEscrow).toBe(0);
    expect(refunded.paidOut).toBe(0);
  });

  it('holds the full gross while a deal is in flight', () => {
    const held = sum([{ type: 'hold', amount: TOTAL }]);
    expect(held.inEscrow).toBe(TOTAL);
    expect(held.paidOut).toBe(0);
  });

  it('never reports a negative figure from well-formed entries', () => {
    for (const entries of [
      [{ type: 'hold', amount: TOTAL }],
      [
        { type: 'hold', amount: TOTAL },
        { type: 'release_payout', amount: -payout },
        { type: 'commission', amount: -commission },
      ],
      [
        { type: 'hold', amount: TOTAL },
        { type: 'refund', amount: -TOTAL },
      ],
    ]) {
      const totals = sum(entries);
      expect(totals.paidOut).toBeGreaterThanOrEqual(0);
      expect(totals.inEscrow).toBeGreaterThanOrEqual(0);
    }
  });
});

// -- AC-6: ownership ---------------------------------------------------------

describe('readCreatorDashboard', () => {
  it('takes no creator id — there is nothing to pass', () => {
    // The enforcement, not a convention: `guard` hands back the caller's own
    // `creatorProfileId` and every `where` is built from that. A function with
    // no id parameter cannot be called with someone else's.
    expect(readCreatorDashboard).toHaveLength(0);
    expect(src(DASHBOARD_MODULE)).toContain(
      'readCreatorDashboard(\n  deps: CreatorDashboardDeps = defaultDeps\n)'
    );
  });

  it('gates on the creator role inside the module', () => {
    // A read path protected only by its callers is protected exactly as well as
    // the least careful one.
    expect(src(DASHBOARD_MODULE)).toContain("guard({ roles: ['creator'] })");
  });

  it('returns the creator’s own dashboard', async () => {
    const rows = [dealRow({ status: 'completed' })];
    await expect(
      readCreatorDashboard(okDeps(rows, { paidOut: 255_000, inEscrow: 0 }))
    ).resolves.toMatchObject({
      earnings: { paidOut: 255_000, inEscrow: 0 },
      isEmpty: false,
    });
  });

  it('queries with the id the gate returned, not one it was given', async () => {
    const selectEarnings = vi.fn(async () => ({ paidOut: 0, inEscrow: 0 }));
    const selectDeals = vi.fn(async () => []);

    await readCreatorDashboard({
      requireCreator: async () => ({ creatorProfileId: CREATOR_PROFILE_ID }),
      selectEarnings,
      selectDeals,
    });

    expect(selectEarnings).toHaveBeenCalledWith(CREATOR_PROFILE_ID);
    expect(selectDeals).toHaveBeenCalledWith(CREATOR_PROFILE_ID);
    expect(selectEarnings).not.toHaveBeenCalledWith(OTHER_PROFILE_ID);
  });

  it.each(['brand', 'admin', 'anonymous'])(
    'denies a %s caller without querying',
    async (who) => {
      // Gate before query, so a denied caller cannot use response timing to
      // learn whether a creator has deals.
      const selectEarnings = vi.fn();
      const selectDeals = vi.fn();

      await expect(
        readCreatorDashboard({
          requireCreator: async () => {
            throw new ForbiddenError(`role ${who} not permitted`);
          },
          selectEarnings,
          selectDeals,
        })
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(selectEarnings).not.toHaveBeenCalled();
      expect(selectDeals).not.toHaveBeenCalled();
    }
  );

  it('returns null for a creator with no profile, and queries nothing', async () => {
    // The pre-onboarding state. The page redirects to the form rather than
    // rendering an empty dashboard.
    const selectEarnings = vi.fn();
    const selectDeals = vi.fn();

    await expect(
      readCreatorDashboard({
        requireCreator: async () => ({ creatorProfileId: null }),
        selectEarnings,
        selectDeals,
      })
    ).resolves.toBeNull();

    expect(selectEarnings).not.toHaveBeenCalled();
    expect(selectDeals).not.toHaveBeenCalled();
  });

  it('reports an empty dashboard as empty (AC-5)', async () => {
    const dashboard = await readCreatorDashboard(okDeps([]));
    expect(dashboard?.isEmpty).toBe(true);
    // All five groups still present, all empty.
    expect(dashboard?.groups).toHaveLength(DEAL_GROUPS.length);
    expect(dashboard?.groups.every((g) => g.count === 0)).toBe(true);
  });
});

// -- The page ---------------------------------------------------------------

describe('the creator dashboard page', () => {
  const source = src(PAGE);

  it('runs on the Node runtime, because pg needs Node APIs', () => {
    expect(source).toContain("export const runtime = 'nodejs'");
  });

  it('renders AC-1 through AC-3 in one place', () => {
    for (const component of [
      'VerificationStatus',
      'TierPricing',
      'EarningsSummary',
      'DealGroups',
    ]) {
      expect(source).toContain(component);
    }
  });

  it('no longer promises the deals in a later ticket', () => {
    expect(source).not.toContain('later ticket');
  });

  it('reads through the query module rather than selecting itself', () => {
    expect(source).toContain('readCreatorDashboard');
    expect(source).not.toContain('ledgerEntry');
    expect(source).not.toMatch(/\bfrom\s*\(/);
  });

  it('shows an empty state rather than a blank page (AC-5)', () => {
    expect(source).toContain('EmptyState');
    expect(source).toContain('dashboard.isEmpty');
  });

  it('says something different to a creator who is not bookable', () => {
    // "No offers yet" is the wrong sentence for someone who is not verified or
    // not priced: they are not waiting on a brand, and there is nothing for
    // them to do about it.
    expect(source).toContain('isBookable');
    expect(source).toContain('NOT_BOOKABLE_TITLE');
    expect(source).toContain('NO_DEALS_TITLE');
  });

  it('imports no client-only button and needs no tooltip', () => {
    expect(source).not.toMatch(/<Button\b/);
    // A literal `title="…"` is the hover tooltip the house rule forbids — it
    // tells a touch user nothing. `title={…}` is a component prop, which
    // `EmptyState` legitimately takes, so the guard is on the attribute form.
    expect(source).not.toMatch(/\stitle="/);
    expect(source).not.toContain("'use client'");
  });

  it('retypes none of the copy it renders', () => {
    for (const copy of [
      NO_DEALS_TITLE,
      NO_DEALS_DESCRIPTION,
      NOT_BOOKABLE_DESCRIPTION,
    ]) {
      expect(source).not.toContain(copy);
    }
  });
});

describe('dashboard copy', () => {
  it('names no ticket a creator would read', () => {
    for (const copy of [
      EARNINGS_PAID_OUT_LABEL,
      EARNINGS_IN_ESCROW_LABEL,
      EARNINGS_NET_NOTE,
      NO_DEALS_TITLE,
      NO_DEALS_DESCRIPTION,
      NOT_BOOKABLE_DESCRIPTION,
    ]) {
      expect(copy).not.toMatch(/KAN-\d+/);
    }
  });

  it('states that payouts are net, since AC-4 is invisible otherwise', () => {
    // A creator seeing only a net figure cannot tell a commission from a lower
    // price — the same argument `tier-pricing.tsx` makes for itemising it.
    expect(EARNINGS_NET_NOTE).toContain('net of the commission');
    expect(src(EARNINGS)).toContain('EARNINGS_NET_NOTE');
  });

  it('distinguishes held money from paid money', () => {
    // Escrow is committed by a brand but not the creator's until a deliverable
    // is approved. Conflating the two is the expensive misreading.
    expect(EARNINGS_IN_ESCROW_LABEL).toContain('escrow');
    expect(EARNINGS_PAID_OUT_LABEL).not.toContain('escrow');
    expect(NOT_BOOKABLE_DESCRIPTION).not.toBe(NO_DEALS_DESCRIPTION);
  });
});

// -- The seed ---------------------------------------------------------------

describe('the demo seed drives the real ledger', () => {
  const source = src('db/seed.ts');

  it('writes no ledger entry of its own', () => {
    // The figures a creator reads have to be the ones production code would
    // produce, or the demo proves nothing about AC-3 and AC-4.
    expect(source).not.toContain('insert(ledgerEntry)');
    expect(source).toContain('EscrowLedgerService');
    expect(source).toContain('holdForCampaign');
    expect(source).toContain('payoutForDeal');
    expect(source).toContain('refundDeal');
  });

  it('takes prices and the commission rate from config, never literals', () => {
    // Invariant 8, so Q1 and Q2 stay one-file answers.
    expect(source).toContain('COMMISSION_RATE');
    expect(source).toContain('pricingTier.pricePerVideo');
  });

  it('writes a deal_event for every transition it makes by hand', () => {
    // Invariant 6. A status update without its event is a hole in the audit
    // trail, and seeded holes are the ones nobody notices.
    expect(source).toContain('insert(dealEvent)');
    expect(source).toMatch(/update\(deal\)[\s\S]{0,200}dealEvent/);
  });

  it('is idempotent, because the money steps cannot be replayed', () => {
    // `holdForCampaign` throws on a second call, so a per-row
    // `onConflictDoNothing` would leave the inserts idempotent and the ledger
    // not.
    expect(source).toContain('already seeded');
  });
});
