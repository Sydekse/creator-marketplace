import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ForbiddenError } from '../lib/authz';
import {
  AUDIENCE_MARKET_LABELS,
  ENGAGEMENT_RATE_HINT,
} from '../lib/config/creator-profile';
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

// -- What the number means (KAN-200 item 7) ---------------------------------

/**
 * Nate's walkthrough on 2026-08-20: nothing anywhere said what "engagement rate"
 * was. Three people type the figure — the creator at onboarding, a brand into the
 * discovery filter, an admin correcting it before tier assignment — and it drives
 * `matchTier`, so three different readings of it put creators in the wrong bands.
 *
 * One constant, five sites. The load-bearing assertion is the *last* one: a
 * filter that defined the number differently from the field it filters on would
 * be worse than neither of them explaining it.
 */
describe('the engagement-rate explanation', () => {
  const SITES = [
    // The three inputs.
    'app/(creator)/creator/onboarding/creator-onboarding-form.tsx',
    DISCOVER_PAGE,
    'components/admin/awaiting-tier-list.tsx',
    // The two displays.
    CREATOR_DASHBOARD,
    DETAIL_PAGE,
  ];

  it('says what the figure measures and who reported it', () => {
    // Both halves are load-bearing. "A percentage" of an unstated denominator is
    // not a quantity, and a brand that thinks we measured this from the TikTok
    // API is being misled — verification is manual and this number is a claim.
    expect(ENGAGEMENT_RATE_HINT).toMatch(/percentage of followers/i);
    expect(ENGAGEMENT_RATE_HINT).toMatch(/self-reported/i);
    expect(ENGAGEMENT_RATE_HINT).not.toMatch(/KAN-\d+/);
  });

  it('reaches every screen that takes or shows the figure', () => {
    for (const file of SITES) {
      expect(src(file)).toContain('ENGAGEMENT_RATE_HINT');
    }
  });

  it('is retyped nowhere, so no screen can paraphrase it apart from itself', () => {
    // The failure this prevents is not a typo, it is drift: an edit to one
    // screen's copy that leaves the other four saying the old thing.
    const sentence = ENGAGEMENT_RATE_HINT.slice(0, 30);
    for (const file of SITES) {
      expect(src(file)).not.toContain(sentence);
    }
  });

  it('is visible text, not a tooltip', () => {
    // KAN-29's rule: hover-only copy tells a touch user nothing, and the admin
    // and creator both meet this figure on a phone.
    //
    // The guard is on `title=` specifically rather than on any attribute,
    // because the detail page legitimately passes it as `hint={…}` to a local
    // `Fact` — and `title="…"` is a real prop on `PageHeader`, so a blanket ban
    // on the attribute form would fail on markup that is fine.
    for (const file of SITES) {
      expect(src(file)).not.toMatch(/title=[{"]\s*ENGAGEMENT_RATE_HINT/);
    }
    // And the one indirection is rendered as text at the other end.
    expect(src(DETAIL_PAGE)).toMatch(/<p[^>]*>\s*\{hint\}/);
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
    // The default is still the stretched link to the detail view, with no
    // client interactivity on the card itself.
    expect(source).toContain('`/discover/${creator.id}`');
    expect(source).not.toContain('onClick');
    expect(source).not.toContain("'use client'");
    // …but the selection grid opts out: `detailsHref={null}` suppresses the
    // stretched link so the wrapping toggle owns the tile's click.
    expect(source).toContain('detailsHref === undefined');
    expect(source).toContain('{href && (');
  });

  it('shows no contact details (NFR-010)', () => {
    expect(source).not.toContain('email');
    expect(source).not.toContain('phone');
  });
});

/**
 * KAN-200 item 8, on the card specifically.
 *
 * The card used to be one big `<Link>`. Adding an outbound link inside it is not
 * a matter of dropping an `<a>` in: an `<a>` inside an `<a>` is invalid HTML, and
 * the browser recovers by closing the outer one early — so the external link ends
 * up a sibling of the card rather than inside it, and the layout quietly moves.
 * The fix is the stretched-link pattern, and each of its parts is load-bearing on
 * its own.
 */
describe('the card keeps two working links', () => {
  const source = src(CARD);

  it('covers the card with the detail link instead of wrapping it', () => {
    expect(source).toMatch(/<Card[^>]*className="relative/);
    expect(source).toMatch(/className="absolute inset-0/);
    // Self-closing, which is the whole of "wraps nothing" — an element with no
    // children cannot contain the outbound anchor. Asserted positively rather
    // than as `not.toMatch(/<Link[\s\S]*?<CardHeader/)`: the lazy any-character
    // form scans for the nearest `>` followed by the header and finds the
    // Link's own `/>`, so the negative version fails on correct code. Same trap
    // `ui-primitives.test.ts` documents on its trigger guard.
    expect(source).toMatch(/<Link[^<>]*\/>/);
  });

  it('names the covering link, which has no text of its own', () => {
    // An empty anchor announces as nothing. The handle is the only name a screen
    // reader could give it.
    expect(source).toMatch(/aria-label=\{creator\.tiktokHandle\}/);
  });

  it('lifts the outbound link above the covering one', () => {
    // Without `z-10` the stretched link sits on top and swallows the click, so
    // "View on TikTok" would silently open the detail page instead.
    expect(source).toMatch(/relative z-10/);
    expect(source).toContain('VIEW_ON_TIKTOK_LABEL');
  });

  it('moves the focus ring onto the card, now that the link is not the card', () => {
    // The ring was on the wrapping link. Left there it would draw around a
    // zero-content anchor, which is invisible.
    expect(source).toContain('focus-within:ring');
  });

  it('renders nothing when the handle cannot make a URL', () => {
    // `tiktokProfileUrl` returns null for a handle that no longer passes the
    // pattern; a 404 offered as "View on TikTok" reads as the creator not
    // existing.
    expect(source).toContain('profileUrl && (');
  });

  it('stays a Server Component — both links are links', () => {
    expect(source).not.toContain("'use client'");
    expect(source).not.toContain('onClick');
  });
});

describe('the discovery page renders results through the card', () => {
  const source = src(DISCOVER_PAGE);

  it('delegates the row to the selection grid, which renders the card', () => {
    // The mark-and-add flow: tiles toggle selection in a client island and the
    // card renders inside it with the stretched link suppressed.
    expect(source).toContain('SelectableCreatorGrid');
    expect(source).not.toContain("from '@/components/creator/creator-card'");
    const grid = src('components/discovery/selectable-creator-grid.tsx');
    expect(grid).toContain('CreatorCard');
    expect(grid).toContain('detailsHref={null}');
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
