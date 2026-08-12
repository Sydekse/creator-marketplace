import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import {
  COMMITS_BUDGET,
  COMMITTING_STATUSES,
  readCampaignBudget,
  sumCommittedByDeals,
} from '../lib/campaigns/budget';
import type { CampaignBudgetDeps } from '../lib/campaigns/budget';
import { ForbiddenError } from '../lib/authz';
import { LEGAL_TRANSITIONS } from '../lib/deals/state-machine';
import { REFUNDABLE_FROM } from '../lib/payment/ledger';
import { db } from '../db';
import { deal } from '../db/schema';
import type { CampaignStatus, DealStatus } from '../db/schema';

/**
 * KAN-37 — where a campaign's available budget comes from (AC-018, AC-014).
 *
 * **Available budget is derived and never stored** (KAN-40 spike §6). There is no
 * `held_balance` column, so this module is the definition of "remaining" rather
 * than a cache of it — which is why AC-018's release needs no write of its own.
 *
 * The bug this replaced is worth keeping in view, because it is what AC-018
 * names: the campaign page computed `budget - sumCartTotal(...)`, and confirming
 * a campaign copies cart rows into deals **without deleting them**. So a declined
 * deal moved the brand's Remaining figure by exactly zero. Two properties fix
 * that and both are asserted below — the source switches to deals once offers
 * exist, and the two sources are never summed together.
 */

const CAMPAIGN_ID = '44444444-4444-4444-8444-444444444444';
const BUDGET = 1_000_000;

interface Recorded {
  guarded: string[];
  cartSums: number;
  dealSums: number;
}

interface Overrides {
  status?: CampaignStatus;
  missing?: boolean;
  denied?: boolean;
  cart?: number;
  deals?: number;
}

function makeDeps(overrides: Overrides = {}): {
  deps: CampaignBudgetDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = { guarded: [], cartSums: 0, dealSums: 0 };

  const deps: CampaignBudgetDeps = {
    requireOwnership: async (campaignId) => {
      recorded.guarded.push(campaignId);
      if (overrides.denied) {
        throw new ForbiddenError('not your campaign');
      }
    },
    getCampaign: async () =>
      overrides.missing
        ? null
        : { budget: BUDGET, status: overrides.status ?? 'draft' },
    sumCart: async () => {
      recorded.cartSums += 1;
      return overrides.cart ?? 0;
    },
    sumDeals: async () => {
      recorded.dealSums += 1;
      return overrides.deals ?? 0;
    },
  };

  return { deps, recorded };
}

/**
 * A stand-in for `db`/`tx` that records the `where` it was handed and answers
 * with fixed rows.
 *
 * Enough of the builder to satisfy `sumCommittedByDeals`, and no more — the
 * point is to get hold of the real clause the module built so it can be rendered
 * through drizzle. Asserting the SQL rather than the source is what makes "the
 * campaign filter cannot go missing" a property of the query instead of a
 * property of how the file happens to be written.
 */
function captureClient(rows: Array<{ total: number }>) {
  const captured: { where?: SQL } = {};

  const builder = {
    from: () => builder,
    where: (condition: SQL) => {
      captured.where = condition;
      return builder;
    },
    then: (
      resolve: (v: Array<{ total: number }>) => unknown,
      reject?: (e: unknown) => unknown
    ) => Promise.resolve(rows).then(resolve, reject),
  };

  const client = {
    select: () => builder,
  } as unknown as typeof db;

  return { client, captured: captured as { where: SQL } };
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const BUDGET_MODULE = stripComments(
  readFileSync('lib/campaigns/budget.ts', 'utf8')
);
const CART_QUERIES = stripComments(
  readFileSync('lib/campaigns/cart-queries.ts', 'utf8')
);

/** Read off the transition table, so a tenth status fails here too. */
const ALL_STATUSES = Object.keys(LEGAL_TRANSITIONS) as DealStatus[];

// -- Which deals lay claim to the money --------------------------------------

describe('COMMITS_BUDGET', () => {
  it('has an answer for every deal status', () => {
    // `satisfies Record<DealStatus, boolean>` makes this a compile error too. The
    // runtime assertion is what catches a status added to the schema union
    // without the map being rebuilt against it.
    expect(Object.keys(COMMITS_BUDGET).sort()).toEqual(
      [...ALL_STATUSES].sort()
    );
  });

  it.each(ALL_STATUSES)(
    'answers %s with a boolean, never undefined',
    (status) => {
      expect(typeof COMMITS_BUDGET[status]).toBe('boolean');
    }
  );

  it('releases exactly the three statuses whose cost stopped being claimed', () => {
    const released = ALL_STATUSES.filter((s) => !COMMITS_BUDGET[s]);

    expect(released.sort()).toEqual(['declined', 'expired', 'refunded']);
  });

  it('still counts a completed deal', () => {
    // Reads oddly for a finished deal, and is the point: that money moved from
    // `escrowed` to `spent` and both are "not available". A brand cannot
    // re-spend what it has already paid out.
    expect(COMMITS_BUDGET.completed).toBe(true);
  });

  it('counts every status a deal can be in while money is at stake', () => {
    expect(COMMITS_BUDGET.pending).toBe(true);
    expect(COMMITS_BUDGET.accepted).toBe(true);
    expect(COMMITS_BUDGET.funded).toBe(true);
    expect(COMMITS_BUDGET.delivered).toBe(true);
    expect(COMMITS_BUDGET.revision_requested).toBe(true);
  });

  it('agrees with the ledger about what a refund is', () => {
    // `refunded` is `false` here because the money came back. The ledger is the
    // half that put it back, and it refuses to refund from anywhere else — so
    // the two guards describe one path rather than two that could drift.
    expect(COMMITS_BUDGET.refunded).toBe(false);
    for (const status of REFUNDABLE_FROM) {
      expect(COMMITS_BUDGET[status]).toBe(true);
    }
  });

  it('lists the committing statuses without typing them out again', () => {
    // Derived from the map, so the `IN (...)` list and the map cannot disagree.
    expect(COMMITTING_STATUSES.sort()).toEqual(
      ALL_STATUSES.filter((s) => COMMITS_BUDGET[s]).sort()
    );
    expect(COMMITTING_STATUSES).not.toContain('declined');
    expect(COMMITTING_STATUSES).not.toContain('expired');
    expect(COMMITTING_STATUSES).not.toContain('refunded');
  });

  it('is spelled once, and derived rather than restated', () => {
    expect(BUDGET_MODULE).toContain('satisfies Record<DealStatus, boolean>');
    expect(BUDGET_MODULE).toContain(
      '.filter((status) => COMMITS_BUDGET[status])'
    );
  });
});

// -- The SQL ------------------------------------------------------------------

describe('sumCommittedByDeals', () => {
  it('scopes to the campaign and to the committing statuses', async () => {
    // The clause the module actually built, rendered through drizzle rather than
    // read out of the source — what matters is that neither half of the `where`
    // can go missing, and a regex over the file cannot say that.
    const { client, captured } = captureClient([{ total: 700_000 }]);

    await sumCommittedByDeals(CAMPAIGN_ID, client);
    const { sql, params } = db
      .select()
      .from(deal)
      .where(captured.where)
      .toSQL();

    expect(params).toContain(CAMPAIGN_ID);
    expect(sql).toMatch(/"campaign_id" = \$/);
    // Every committing status, and none of the three that released.
    for (const status of COMMITTING_STATUSES) {
      expect(params).toContain(status);
    }
    expect(params).not.toContain('declined');
    expect(params).not.toContain('expired');
    expect(params).not.toContain('refunded');
  });

  it('returns the sum the database gave it, unrounded and unscaled', async () => {
    const { client } = captureClient([{ total: 700_000 }]);

    expect(await sumCommittedByDeals(CAMPAIGN_ID, client)).toBe(700_000);
  });

  it('answers zero for a campaign with no live deals', async () => {
    // `coalesce` covers the `sum(...) IS NULL` case in SQL; this covers the
    // no-rows-at-all case in JS. Either returning `undefined` renders Remaining
    // as `NaN`.
    const { client } = captureClient([]);

    expect(await sumCommittedByDeals(CAMPAIGN_ID, client)).toBe(0);
  });

  it('sums total_price as an integer, coalescing an empty campaign to zero', () => {
    // Integer santim (invariant 4). Without the `::int`, Postgres answers
    // `sum(integer)` with a `bigint`, which node-postgres hands back as a
    // string — and `'0' - 0` is the kind of arithmetic that works until it
    // doesn't. Without the `coalesce`, a campaign with no live deals sums to
    // `null` and Remaining renders as `NaN`.
    expect(BUDGET_MODULE).toContain(
      'coalesce(sum(${deal.totalPrice}), 0)::int'
    );
  });

  it('takes a client so a transaction can pass its own tx', () => {
    // A query issued on the global `db` while the caller's transaction holds a
    // row lock waits for a connection the pool has already lent out — the
    // deadlock `remove-from-cart.ts` documents.
    expect(BUDGET_MODULE).toContain('client: typeof db | Tx = db');
    expect(BUDGET_MODULE).toContain('await client');
  });

  it('is not itself guarded, unlike the read above it', () => {
    // Deliberate, and the same split `sumCartTotal` has: taking a lock and then
    // running an authz query on a second connection is the deadlock again. The
    // guarded entry point is `readCampaignBudget`.
    const body = BUDGET_MODULE.slice(
      BUDGET_MODULE.indexOf('export async function sumCommittedByDeals'),
      BUDGET_MODULE.indexOf('export interface CampaignBudget')
    );

    expect(body).not.toContain('guard(');
    expect(body).not.toContain('requireOwnership');
    expect(typeof sumCommittedByDeals).toBe('function');
  });
});

// -- The guarded read ---------------------------------------------------------

describe('readCampaignBudget', () => {
  it('returns the ceiling, what is committed, and what is left', async () => {
    const { deps } = makeDeps({ status: 'draft', cart: 350_000 });

    const result = await readCampaignBudget(CAMPAIGN_ID, deps);

    expect(result).toEqual({
      budget: BUDGET,
      committed: 350_000,
      available: 650_000,
    });
  });

  it('sums the cart while the campaign is a draft, and only the cart', async () => {
    // No deals exist before confirmation, so the cart is the only record of what
    // the brand intends to spend.
    const { deps, recorded } = makeDeps({ status: 'draft', cart: 350_000 });

    await readCampaignBudget(CAMPAIGN_ID, deps);

    expect(recorded.cartSums).toBe(1);
    expect(recorded.dealSums).toBe(0);
  });

  it.each<CampaignStatus>([
    'confirmed',
    'funded',
    'in_progress',
    'completed',
    'cancelled',
  ])(
    'sums the deals once a campaign is %s, and only the deals',
    async (status) => {
      // The whole point of the module. Confirmation leaves the cart rows in place
      // as the brand's record of what was carted and at what price, so every one
      // of them now has a deal — adding both would double-count every creator.
      const { deps, recorded } = makeDeps({
        status,
        deals: 350_000,
        cart: 999,
      });

      const result = await readCampaignBudget(CAMPAIGN_ID, deps);

      expect(recorded.dealSums).toBe(1);
      expect(recorded.cartSums).toBe(0);
      expect(result).toMatchObject({ committed: 350_000, available: 650_000 });
    }
  );

  it('lets a declined deal show up as budget the brand can spend again', async () => {
    // AC-018 end to end at this layer: two deals of 350_000 committed, one
    // declined, and the released amount is exactly that deal's `total_price`.
    const both = makeDeps({ status: 'confirmed', deals: 700_000 });
    const afterDecline = makeDeps({ status: 'confirmed', deals: 350_000 });

    const before = await readCampaignBudget(CAMPAIGN_ID, both.deps);
    const after = await readCampaignBudget(CAMPAIGN_ID, afterDecline.deps);

    expect(after!.available - before!.available).toBe(350_000);
  });

  it('returns null for a campaign that is not there', async () => {
    const { deps, recorded } = makeDeps({ missing: true });

    expect(await readCampaignBudget(CAMPAIGN_ID, deps)).toBeNull();
    // No sum on a campaign whose budget is unknown — there is nothing to
    // subtract from.
    expect(recorded.cartSums).toBe(0);
    expect(recorded.dealSums).toBe(0);
  });

  it('gates itself rather than trusting its callers', async () => {
    // The `readDiscovery` / `readCreatorDetail` rule: a read protected only by
    // its callers is protected as well as its least careful caller.
    const { deps, recorded } = makeDeps({ denied: true });

    await expect(readCampaignBudget(CAMPAIGN_ID, deps)).rejects.toThrow(
      ForbiddenError
    );
    // Not merely denied — nothing was read at all.
    expect(recorded.cartSums).toBe(0);
    expect(recorded.dealSums).toBe(0);
  });

  it('gates on this campaign, both layers (NFR-005)', () => {
    expect(BUDGET_MODULE).toContain("roles: ['brand']");
    expect(BUDGET_MODULE).toContain(
      "resource: { kind: 'campaign', id: campaignId }"
    );
  });

  it('passes the id to the guard rather than closing over one', () => {
    // `defaultDeps` is one module-level object shared by every call, so a
    // closure here would reference an id that is not in scope — and the version
    // of that mistake which compiles is the one that silently drops the
    // ownership half and leaves only the role gate.
    const { deps, recorded } = makeDeps();
    expect(BUDGET_MODULE).toContain('requireOwnership: (campaignId) =>');
    expect(BUDGET_MODULE).toContain('deps.requireOwnership(campaignId)');

    return readCampaignBudget(CAMPAIGN_ID, deps).then(() => {
      expect(recorded.guarded).toEqual([CAMPAIGN_ID]);
    });
  });

  it('refuses a malformed id before it reaches a uuid column', async () => {
    // Postgres answers a non-uuid compared against `uuid` with `22P02` — a 500
    // for what is really a mistyped link (F16).
    const { deps, recorded } = makeDeps();

    expect(await readCampaignBudget('not-a-uuid', deps)).toBeNull();
    expect(recorded.guarded).toEqual([]);
  });

  it('shape-checks ahead of the guard, unlike the creator read', async () => {
    // `readCreatorDetail` guards first. Here the guard resolves the campaign's
    // owner, which means it runs that same `uuid` comparison — so checking after
    // it would be checking too late. A malformed id belongs to nobody, so
    // refusing it early tells a denied caller nothing it did not already know.
    const { deps } = makeDeps({ denied: true });

    await expect(readCampaignBudget('', deps)).resolves.toBeNull();
    expect(BUDGET_MODULE.indexOf('UUID_REGEX.test(campaignId)')).toBeLessThan(
      BUDGET_MODULE.indexOf('deps.requireOwnership(campaignId)')
    );
  });

  it('never sums both sources in one call', async () => {
    const calls = await Promise.all(
      (
        [
          'draft',
          'confirmed',
          'funded',
          'in_progress',
          'completed',
          'cancelled',
        ] as CampaignStatus[]
      ).map(async (status) => {
        const { deps, recorded } = makeDeps({ status });
        await readCampaignBudget(CAMPAIGN_ID, deps);
        return recorded.cartSums + recorded.dealSums;
      })
    );

    expect(calls).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('keeps the derivation in one expression', () => {
    // `available` is `budget - committed` here and nowhere else. Two subtractions
    // is how a page and an API start disagreeing about the same number.
    expect(BUDGET_MODULE).toContain('available: row.budget - committed');
    expect(BUDGET_MODULE.match(/row\.budget - committed/g)).toHaveLength(1);
  });
});

// -- What the cart module keeps, and what it gave up --------------------------

describe('the cart sum after the handover', () => {
  it('no longer exports the read the campaign page used', () => {
    // `getCartRunningTotal` had exactly one caller and `readCampaignBudget`
    // replaced it. Left in place it would be a guarded read of the wrong number,
    // waiting for someone to pick it.
    expect(CART_QUERIES).not.toContain('getCartRunningTotal');
  });

  it('still exports the transaction-safe sum, which has other callers', () => {
    // `add-to-cart.ts` and `remove-from-cart.ts` both call it inside a tx, and
    // both are draft-only paths where the cart *is* what is committed.
    expect(CART_QUERIES).toContain('export async function sumCartTotal');
  });

  it('is the only cart sum the campaign page can reach', () => {
    // The page reads `readCampaignBudget` and nothing else about money. Importing
    // `sumCartTotal` there would put the superseded arithmetic back within reach
    // of one autocomplete.
    const page = stripComments(
      readFileSync('app/(brand)/(onboarded)/campaigns/[id]/page.tsx', 'utf8')
    );

    expect(page).toContain(
      "import { listCartItems } from '@/lib/campaigns/cart-queries'"
    );
    expect(page).not.toContain('sumCartTotal');
  });

  it('is reused rather than reimplemented', () => {
    // One definition of the cart sum, imported. A second copy here is how the
    // draft figure and the ceiling `addToCart` enforces would start to differ.
    expect(BUDGET_MODULE).toContain(
      "import { sumCartTotal } from './cart-queries'"
    );
    expect(BUDGET_MODULE).not.toContain('campaignItem');
  });
});

// -- The seam is not the only thing holding this up ---------------------------

describe('the module against its own default dependencies', () => {
  it('reads the campaign once, by id, for just the two columns it needs', () => {
    const defaults = BUDGET_MODULE.slice(
      BUDGET_MODULE.indexOf('const defaultDeps')
    );
    const body = defaults.slice(
      defaults.indexOf('getCampaign:'),
      defaults.indexOf('sumCart:')
    );

    expect(body).toContain('budget: campaign.budget');
    expect(body).toContain('status: campaign.status');
    expect(body).toContain('eq(campaign.id, campaignId)');
    expect(body).toContain('.limit(1)');
  });

  it('wires its defaults to the real guard and the real sums', () => {
    expect(BUDGET_MODULE).toContain(
      'sumCart: (campaignId) => sumCartTotal(campaignId)'
    );
    expect(BUDGET_MODULE).toContain(
      'sumDeals: (campaignId) => sumCommittedByDeals(campaignId)'
    );
  });

  it('does not reach for the ledger', () => {
    // `available` is derived from statuses, not from entries. The ledger's view
    // is `escrowed`, which is a different question and a different sum.
    expect(BUDGET_MODULE).not.toMatch(/ledgerEntry|EscrowLedger|refundDeal/);
  });

  it('is a read, and only a read', () => {
    // Nothing here writes, which is the other half of "the status change is the
    // release": a budget this module could update is a budget that can disagree
    // with the deals it was derived from.
    expect(BUDGET_MODULE).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(BUDGET_MODULE).not.toContain('transaction(');
  });
});
