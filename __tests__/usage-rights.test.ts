import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { currentRightsTermsQuery } from '../lib/rights-terms/current';
import { RIGHTS_TERMS } from '../lib/config/pricing';
import {
  AGREEMENT_HINT,
  AGREEMENT_LABEL,
} from '../components/deals/usage-rights-agreement';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const CARD_SOURCE = read('components/deals/usage-rights.tsx');
const AGREEMENT_SOURCE = read('components/deals/usage-rights-agreement.tsx');

/**
 * Code with the comments removed.
 *
 * Both components explain the rules they follow — "that one needs `'use
 * client'`", "a `defaultChecked` prop would put a pre-ticked agreement one
 * careless caller away". A guard reading the raw file cannot tell an
 * explanation apart from the thing it forbids, so it fails on the docstring
 * above the very code that satisfies it. Reading code only also makes the
 * presence guards mean more: they prove a thing is rendered, not mentioned.
 */
function code(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const CARD = code(CARD_SOURCE);
const AGREEMENT = code(AGREEMENT_SOURCE);

it('strips comments without stripping the components (guards are not vacuous)', () => {
  // Every `not.toMatch` below passes trivially against an empty string.
  expect(CARD).toContain('export function UsageRightsCard');
  expect(AGREEMENT).toContain('export function UsageRightsAgreement');
});

// -- AC-1: exactly one version is current -----------------------------------

/**
 * Asserted against the SQL the builder actually emits rather than against a
 * mocked `db` whose `where`/`orderBy` are `vi.fn()`s. A mock can only record
 * *that* a clause was added; it passes identically when the filter is `gte`,
 * the order is ascending, or the column is the wrong one — which are precisely
 * the three ways this query stops selecting the current version. `pg` opens no
 * socket until a query runs, so reading the real SQL costs nothing.
 */
describe('currentRightsTermsQuery emits the current-version SQL (AC-1)', () => {
  const { sql, params } = currentRightsTermsQuery().toSQL();

  it('reads the rights_terms table', () => {
    expect(sql).toMatch(/from\s+"rights_terms"/i);
  });

  it('excludes versions that have not taken effect yet', () => {
    // `<=`, never `>=`: a version dated next month has not taken effect, and
    // the inverted comparison would make the *newest unpublished* draft the one
    // a creator is asked to agree to.
    expect(sql).toMatch(/"effective_at"\s*<=\s*\$\d+/i);
    expect(sql).not.toMatch(/"effective_at"\s*>=/i);
  });

  it('compares against a single point in time, bound as a parameter', () => {
    // Two params: the cutoff and the limit. A cutoff spliced into the string
    // instead of bound would not show up as `$n` at all.
    expect(params).toHaveLength(2);
    expect(Number.isNaN(Date.parse(String(params[0])))).toBe(false);
    expect(params[1]).toBe(1);
  });

  it('takes the most recently effective row, not the oldest', () => {
    expect(sql).toMatch(/order by[\s\S]*"effective_at"\s+desc/i);
    expect(sql).not.toMatch(/"effective_at"\s+asc/i);
  });

  it('breaks a timestamp tie deterministically', () => {
    // Without the second key, two rows stamped identically leave "which version
    // is current" to whatever the planner returns. The AC says exactly one is
    // current; this is what makes that true rather than assumed.
    expect(sql).toMatch(
      /"effective_at"\s+desc,\s*"rights_terms"\."id"\s+desc/i
    );
  });

  it('returns at most one row', () => {
    expect(sql).toMatch(/limit\s+\$\d+/i);
  });
});

// -- AC-2: the terms are shown in full, inline ------------------------------

describe('the terms text is displayed in full on the offer screen (AC-2)', () => {
  it('renders the body itself, not a summary of it', () => {
    expect(CARD).toMatch(/\{terms\.body\}/);
  });

  it('is not behind a link or a dialog the creator can skip', () => {
    expect(CARD).not.toMatch(/<Link\b/);
    expect(CARD).not.toMatch(/href=/);
    expect(CARD).not.toMatch(/\bDialog\b/);
    expect(CARD).not.toMatch(/\bModal\b/);
  });

  it('preserves the paragraph breaks in the stored body', () => {
    // `RIGHTS_TERMS.body` is newline-joined; without this the whole document
    // collapses into one run-on block and "in full" becomes "unreadable".
    expect(RIGHTS_TERMS.body).toContain('\n');
    expect(CARD).toMatch(/whitespace-pre-wrap/);
  });

  it('names the version being shown', () => {
    expect(CARD).toMatch(/\{terms\.version\}/);
  });

  it('uses no typography classes the build cannot produce', () => {
    // Tailwind v4 drops unknown utilities silently — no error, no styling.
    // `prose` needs @tailwindcss/typography, which is not installed, so a
    // `prose` class here would read as deliberate formatting that renders as
    // nothing.
    expect(CARD).not.toMatch(/\bprose\b/);
    const deps = JSON.parse(read('package.json'));
    expect({
      ...deps.dependencies,
      ...deps.devDependencies,
    }).not.toHaveProperty('@tailwindcss/typography');
  });

  it('stays a server component', () => {
    // Static text ships no bundle. Same reasoning as `<button
    // className={buttonVariants({...})}>` on a server page.
    expect(CARD).not.toMatch(/'use client'/);
  });
});

// -- AC-3: agreement is an explicit, un-pre-checked action ------------------

describe('accepting requires an affirmative action (AC-3)', () => {
  it('has no way to start pre-checked', () => {
    expect(AGREEMENT).not.toMatch(/defaultChecked/);
    expect(AGREEMENT).not.toMatch(/checked\s*=\s*true/);
    expect(AGREEMENT).not.toMatch(/checked\s*=\s*\{\s*true\s*\}/);
  });

  it('requires the caller to supply the checked state', () => {
    // Required, not optional: an optional `checked` falling back to anything
    // puts a pre-ticked agreement one careless caller away.
    expect(AGREEMENT).toMatch(/checked:\s*boolean;/);
    expect(AGREEMENT).not.toMatch(/checked\?:/);
    expect(AGREEMENT).toMatch(/checked=\{checked\}/);
  });

  it('is a client component, because a checkbox is', () => {
    expect(AGREEMENT_SOURCE.startsWith("'use client';")).toBe(true);
  });

  it('cannot accept the offer by itself', () => {
    // An agreement control that also submits is one that can be made to submit.
    // The parent owns the state because the parent owns the button it gates.
    expect(AGREEMENT).not.toMatch(/<form\b/);
    expect(AGREEMENT).not.toMatch(/onSubmit/);
    expect(AGREEMENT).not.toMatch(/useActionState|formAction/);
  });

  it('ties the label to the box so the label is a hit target', () => {
    expect(AGREEMENT).toMatch(/htmlFor=\{id\}/);
    expect(AGREEMENT).toMatch(/id=\{id\}/);
  });

  it('states what agreeing means, and what it gates', () => {
    expect(AGREEMENT_LABEL).toMatch(/read and agree/i);
    expect(AGREEMENT_HINT).toMatch(/before accepting/i);
  });
});

// -- AC-4 / AC-5: published versions are immutable --------------------------

/**
 * "Publishing a new version never mutates previously accepted versions" is a
 * claim about the whole codebase, not about one module — a unit test of any
 * single file could not observe the ticket that breaks it. Same shape as the
 * `audit_log is insert-only` sweep.
 */
describe('rights_terms rows are never rewritten (AC-4, AC-5)', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(join(root, dir), { recursive: true })
      .map(String)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => join(root, dir, f));
  }

  const files = [
    ...sourceFiles('lib'),
    ...sourceFiles('app'),
    ...sourceFiles('db'),
  ];

  it('finds source files to check, so the sweep is not vacuous', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no drizzle update or delete against the table', () => {
    const offenders = files.filter((file) =>
      /\.\s*(update|delete)\s*\(\s*(schema\.)?rightsTerms\s*\)/.test(
        readFileSync(file, 'utf8')
      )
    );
    expect(offenders).toEqual([]);
  });

  it('has no raw SQL update or delete against the table', () => {
    const offenders = files.filter((file) =>
      /(update|delete\s+from)\s+"?rights_terms"?/i.test(
        readFileSync(file, 'utf8')
      )
    );
    expect(offenders).toEqual([]);
  });

  it('re-seeding leaves an existing version untouched', () => {
    // `onConflictDoUpdate` on the unique `version` would rewrite the body of a
    // version creators have already accepted — the exact failure AC-4 names,
    // arriving through the seed rather than through a feature.
    const seed = read('db/seed.ts');
    const insert = seed.slice(seed.indexOf('.insert(rightsTerms)'));
    expect(insert).toMatch(/onConflictDoNothing/);
    expect(insert.slice(0, 400)).not.toMatch(/onConflictDoUpdate/);
  });

  it('pins each deal to the version it accepted, by reference', () => {
    // A snapshot by foreign key, not a copy of the text and not a lookup at
    // read time: the deal keeps pointing at the row it was accepted under even
    // after a newer version becomes current (AC-5).
    const schema = read('db/schema.ts');
    expect(schema).toMatch(
      /rightsTermsId:\s*uuid\('rights_terms_id'\)\.references\(/
    );
    expect(schema).toMatch(
      /version:\s*text\('version'\)\.notNull\(\)\.unique\(\)/
    );
  });
});

// -- Q5 is still open -------------------------------------------------------

describe('placeholder terms are labelled as placeholder (Q5)', () => {
  it('does not read as real legal copy', () => {
    expect(RIGHTS_TERMS.body).toMatch(/PLACEHOLDER/i);
  });

  it('carries a version string regardless', () => {
    // Placeholder body is fine; an unversioned one is not — AC-5 has nothing to
    // point at without it.
    expect(RIGHTS_TERMS.version).toMatch(/^v\d+\.\d+$/);
  });

  it('shows no ticket numbers to a creator', () => {
    for (const copy of [
      RIGHTS_TERMS.body,
      AGREEMENT_LABEL,
      AGREEMENT_HINT,
      CARD,
      AGREEMENT,
    ]) {
      expect(copy).not.toMatch(/KAN-\d+/);
    }
  });
});
