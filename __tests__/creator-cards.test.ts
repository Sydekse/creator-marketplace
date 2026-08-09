import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ForbiddenError } from '../lib/authz';
import { AUDIENCE_MARKET_LABELS } from '../lib/config/creator-profile';
import {
  ADD_TO_CAMPAIGN_LABEL,
  NO_DRAFT_CAMPAIGN_MESSAGE,
} from '../lib/campaigns/constants';
import {
  buildCreatorDetailWhere,
  creatorDetailQuery,
  readAudience,
  readCreatorDetail,
} from '../lib/creators/detail';
import type { CreatorDetail, CreatorDetailDeps } from '../lib/creators/detail';
import {
  NOT_PROVIDED,
  formatEngagementRate,
  formatFollowerCount,
} from '../lib/creators/profile-facts';

/**
 * KAN-29 — creator cards and the detail view (US-004, AC-012).
 *
 * Two things are asserted here that the browser cannot be trusted to show:
 * that the detail view is gated and bookable-only, so a brand cannot reach a
 * creator by typing an id that the filtered list would never have returned; and
 * that an absent optional number renders as absent rather than as zero, on both
 * of the screens that render it.
 *
 * The rendering half is source guards. There is no DOM environment in this repo
 * (no jsdom, no Testing Library) — see the header of `ui-primitives.test.ts` —
 * so these assert what the components reference, not what they paint.
 */

const dialect = new PgDialect();
const BRAND_USER = { id: 'user-brand', role: 'brand' } as const;

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const detail = (over: Partial<CreatorDetail> = {}): CreatorDetail => ({
  id: ID,
  tiktokHandle: '@demo_creator',
  niche: 'lifestyle',
  followerCount: 25_000,
  engagementRate: '3.50',
  audience: { markets: ['Ethiopia'], ageRange: '18-34' },
  tierId: 'tier-micro',
  tierName: 'Micro',
  pricePerVideo: 150_000,
  ...over,
});

const okDeps = (row: CreatorDetail | null = detail()): CreatorDetailDeps => ({
  requireBrand: async () => BRAND_USER,
  select: async () => row,
});

const src = (file: string) =>
  readFileSync(join(process.cwd(), file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  );

const CARD = 'components/creator/creator-card.tsx';
const DETAIL_PAGE = 'app/(brand)/(onboarded)/discover/[id]/page.tsx';
const NOT_FOUND = 'app/(brand)/(onboarded)/discover/[id]/not-found.tsx';
const DISCOVER_PAGE = 'app/(brand)/(onboarded)/discover/page.tsx';
const CREATOR_DASHBOARD = 'app/(creator)/creator/page.tsx';

// -- The bookable rule, at the second entry point ---------------------------

describe('buildCreatorDetailWhere — an id does not widen what a brand can see', () => {
  it('carries both halves of the bookable pair (AC-006)', () => {
    // The property `buildDiscoveryWhere` has, asserted for the other way in.
    // A pending, rejected or un-tiered creator is not reachable by URL, so the
    // filtered list is not the only thing keeping them out of view.
    const { sql } = dialect.sqlToQuery(buildCreatorDetailWhere(ID));
    expect(sql).toContain('"status"');
    expect(sql).toContain('"tier_id" is not null');
  });

  it('narrows with the id rather than replacing the pair', () => {
    const { sql } = dialect.sqlToQuery(buildCreatorDetailWhere(ID));
    expect(sql).toContain('"id" =');
    expect(sql).toContain(' and ');
    expect(sql).not.toContain(' or ');
  });

  it('binds the id rather than interpolating it', () => {
    const { sql, params } = dialect.sqlToQuery(buildCreatorDetailWhere(ID));
    expect(sql).not.toContain(ID);
    expect(params).toContain(ID);
  });
});

// -- NFR-010 ----------------------------------------------------------------

describe('the detail query selects no PII', () => {
  const { sql } = creatorDetailQuery(buildCreatorDetailWhere(ID)).toSQL();

  it('selects no contact column', () => {
    expect(sql).not.toContain('email');
    expect(sql).not.toContain('phone');
  });

  it('joins the tier and nothing else', () => {
    // The account table is where a name and an address live. Never joining it
    // is what makes "cards show no PII" a fact about the query rather than a
    // habit of whoever writes the next component over this row.
    expect(sql).toContain('"pricing_tier"');
    expect(sql).not.toContain('"user"');
    expect(sql.match(/ join /g) ?? []).toHaveLength(1);
  });

  it('reads one row', () => {
    expect(sql).toContain('limit');
  });
});

// -- The gate ---------------------------------------------------------------

describe('readCreatorDetail', () => {
  it('returns the creator for a brand', async () => {
    await expect(readCreatorDetail(ID, okDeps())).resolves.toMatchObject({
      id: ID,
      tierName: 'Micro',
      pricePerVideo: 150_000,
    });
  });

  it.each(['creator', 'admin', 'anonymous'])(
    'denies a %s caller',
    async (who) => {
      const select = vi.fn();
      await expect(
        readCreatorDetail(ID, {
          requireBrand: async () => {
            throw new ForbiddenError(`role ${who} not permitted`);
          },
          select,
        })
      ).rejects.toBeInstanceOf(ForbiddenError);
      // Gate before query, so a denied caller cannot use response timing to
      // learn which ids exist.
      expect(select).not.toHaveBeenCalled();
    }
  );

  it('denies a non-brand caller before it even looks at the id', async () => {
    // Order matters: answering a malformed id early for everyone would let an
    // unauthenticated caller distinguish "not a uuid" from "denied".
    const select = vi.fn();
    await expect(
      readCreatorDetail('not-a-uuid', {
        requireBrand: async () => {
          throw new ForbiddenError('anonymous');
        },
        select,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(select).not.toHaveBeenCalled();
  });

  it.each([
    ['not-a-uuid', 'a word'],
    ['', 'an empty segment'],
    ["3f2504e0-4f89-41d3-9a0c-0305e82c3301' or '1'='1", 'a quoted payload'],
    ['3f2504e0-4f89-41d3-9a0c-0305e82c330', 'one character short'],
  ])('returns null for %s (%s) without querying', async (id) => {
    // Postgres answers a non-uuid comparison with `22P02`, so without the shape
    // check each of these is a 500 on a request that is merely mistyped.
    const select = vi.fn();
    await expect(
      readCreatorDetail(id, { requireBrand: async () => BRAND_USER, select })
    ).resolves.toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it('accepts an upper-case uuid', async () => {
    const select = vi.fn(async () => null);
    await readCreatorDetail(ID.toUpperCase(), {
      requireBrand: async () => BRAND_USER,
      select,
    });
    expect(select).toHaveBeenCalledOnce();
  });

  it('answers a missing creator and an unbookable one identically', async () => {
    // Both are `null`. Distinguishing them would make the URL an existence
    // oracle for a table a brand cannot otherwise enumerate — a brand could
    // learn that a handle they know is registered but not yet verified.
    await expect(readCreatorDetail(ID, okDeps(null))).resolves.toBeNull();
  });
});

// -- The audience jsonb -----------------------------------------------------

describe('readAudience', () => {
  it('labels known market codes', () => {
    expect(readAudience({ topCountries: ['ET', 'KE'] }).markets).toEqual([
      AUDIENCE_MARKET_LABELS.ET,
      AUDIENCE_MARKET_LABELS.KE,
    ]);
  });

  it('keeps an unknown market code rather than rendering undefined', () => {
    expect(readAudience({ topCountries: ['ZZ'] }).markets).toEqual(['ZZ']);
  });

  it('passes through the age range the seed writes', () => {
    // `'18-34'` is not one of `AGE_RANGES` — the seed writes it anyway, and
    // `db/seed.ts` types the field to admit it. A reader that narrowed to the
    // enum would drop the value on every seeded row, which is every row anyone
    // demos against.
    expect(readAudience({ topCountries: [], ageRange: '18-34' }).ageRange).toBe(
      '18-34'
    );
  });

  it.each([
    ['null', null],
    ['a string', 'ET'],
    ['a number', 42],
    ['an array', ['ET']],
  ])('survives %s in the column', (_label, value) => {
    // Unconstrained `jsonb`: the shape is a convention the form follows, not
    // something the database enforces.
    expect(readAudience(value)).toEqual({ markets: [], ageRange: null });
  });

  it('survives a partial object', () => {
    expect(readAudience({})).toEqual({ markets: [], ageRange: null });
    expect(readAudience({ ageRange: 25 })).toEqual({
      markets: [],
      ageRange: null,
    });
    expect(readAudience({ topCountries: 'ET' })).toEqual({
      markets: [],
      ageRange: null,
    });
  });

  it('drops non-string members rather than labelling them', () => {
    expect(readAudience({ topCountries: ['ET', 7, null] }).markets).toEqual([
      AUDIENCE_MARKET_LABELS.ET,
    ]);
  });
});

// -- The optional numbers ---------------------------------------------------

describe('profile facts — absent is not zero', () => {
  it('renders an absent follower count as not provided', () => {
    expect(formatFollowerCount(null)).toBe(NOT_PROVIDED);
    expect(formatFollowerCount(null)).not.toBe('0');
  });

  it('renders an absent engagement rate as not provided', () => {
    expect(formatEngagementRate(null)).toBe(NOT_PROVIDED);
    expect(formatEngagementRate(null)).not.toBe('0%');
  });

  it('separates thousands so two cards are comparable at a glance', () => {
    expect(formatFollowerCount(25_000)).toBe('25,000');
    expect(formatFollowerCount(250_000)).toBe('250,000');
    expect(formatFollowerCount(0)).toBe('0');
  });

  it('keeps the rate a string, trailing zeros and all', () => {
    // `numeric(5,2)` reaches drizzle as a string precisely so it survives the
    // trip. Passing it through `Number` renders '3.50' as 3.5, so two creators
    // measured to the same precision would display differently.
    expect(formatEngagementRate('3.50')).toBe('3.50%');
    expect(formatEngagementRate('10.00')).toBe('10.00%');
  });

  it('is the only definition of the rule', () => {
    // Both screens that render these two fields go through this module, so a
    // blank optional field cannot read as a gap on one and a claim on the other.
    for (const file of [CARD, CREATOR_DASHBOARD]) {
      expect(src(file)).toContain('formatFollowerCount');
      expect(src(file)).toContain('formatEngagementRate');
    }
  });
});

// -- The card ---------------------------------------------------------------

describe('the creator card shows AC-012 in full', () => {
  const source = src(CARD);

  it('renders all four required facts', () => {
    // Niche, follower count, engagement rate and price-per-video. Two of these
    // were already being fetched and then not rendered before this ticket.
    expect(source).toContain('NICHE_LABELS');
    expect(source).toContain('formatFollowerCount');
    expect(source).toContain('formatEngagementRate');
    expect(source).toContain('creator.pricePerVideo');
  });

  it('reads the price off the tier row, computing nothing', () => {
    // AC-012's "never stale or independently computed": `formatEtb` is the only
    // thing between the joined column and the screen, so there is no arithmetic
    // here that could diverge from what the creator is shown on `/creator`.
    expect(source).toContain('formatEtb(creator.pricePerVideo)');
    expect(source).not.toMatch(/[*/]\s*100\b/);
    expect(source).not.toContain('commission');
  });

  it('links into the detail view rather than handling a click', () => {
    expect(source).toContain('href={`/discover/${creator.id}`}');
    expect(source).not.toContain('onClick');
    expect(source).not.toContain("'use client'");
  });

  it('shows no contact details (NFR-010)', () => {
    expect(source).not.toContain('email');
    expect(source).not.toContain('phone');
  });
});

describe('the discovery page renders results through the card', () => {
  const source = src(DISCOVER_PAGE);

  it('delegates the row to CreatorCard', () => {
    expect(source).toContain('CreatorCard');
  });

  it('no longer inlines what the card owns', () => {
    // The facts moved; the URL, the filter form and the pager stayed.
    expect(source).not.toContain('formatFollowerCount');
    expect(source).toContain('readDiscovery');
    expect(source).toContain('NO_MATCHES_TITLE');
  });
});

// -- The detail view --------------------------------------------------------

describe('the detail page', () => {
  const source = src(DETAIL_PAGE);

  it('awaits params, which is a Promise in this Next major', () => {
    expect(source).toMatch(/params:\s*Promise</);
    expect(source).toMatch(/await\s+params/);
  });

  it('runs on the Node runtime, because pg needs Node APIs', () => {
    expect(source).toContain("export const runtime = 'nodejs'");
  });

  it('reads through the query module rather than selecting itself', () => {
    expect(source).toContain('readCreatorDetail');
    expect(source).not.toContain('creatorProfile');
    expect(source).not.toContain("'verified'");
    expect(source).not.toMatch(/\bfrom\s*\(/);
  });

  it('shows the three facts the AC names for the detail view', () => {
    expect(source).toContain('creator.audience');
    expect(source).toContain('creator.tierName');
    expect(source).toContain('creator.tiktokHandle');
  });

  it('sends every kind of miss to the same not-found', () => {
    expect(source).toContain('notFound()');
    expect(() => src(NOT_FOUND)).not.toThrow();
    expect(src(NOT_FOUND)).toContain('/discover');
  });

  it('shows no contact details (NFR-010)', () => {
    expect(source).not.toContain('email');
    expect(source).not.toContain('phone');
  });
});

describe('the add-to-campaign action', () => {
  const source = src(DETAIL_PAGE);

  it('renders the AddToCartForm client component', () => {
    expect(source).toContain('<AddToCartForm');
    expect(source).toContain('creatorId={creator.id}');
    expect(source).toContain('campaigns={campaigns');
  });

  it('names no ticket in copy a brand reads', () => {
    // Comments may cite a KAN number; user-facing strings may not.
    expect(ADD_TO_CAMPAIGN_LABEL).not.toMatch(/KAN-\d+/);
    expect(NO_DRAFT_CAMPAIGN_MESSAGE).not.toMatch(/KAN-\d+/);
    expect(NO_DRAFT_CAMPAIGN_MESSAGE).toBe(
      'You need a draft campaign before you can shortlist a creator.'
    );
  });

  it('is not retyped on the form', () => {
    const formSource = src('components/campaign/add-to-cart-form.tsx');
    // If the form retypes the literal instead of using the constant, it will contain the text in quotes
    expect(formSource).not.toMatch(/['"]Add to campaign['"]/);
  });
});
