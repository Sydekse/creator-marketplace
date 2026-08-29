import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TIKTOK_HANDLE_PATTERN,
  isValidTiktokHandle,
  normalizeTiktokHandle,
  displayTiktokHandle,
  tiktokProfileUrl,
} from '../lib/creators/handle';
import { isBookable } from '../lib/creators/queries';
import {
  HANDLE_CONSTRAINT,
  USER_CONSTRAINT,
  createCreatorProfile,
} from '../lib/creators/create-profile';
import type {
  CreateProfileDeps,
  ProfileInsertValues,
} from '../lib/creators/create-profile';
import { ForbiddenError } from '../lib/authz';
import type { Tx } from '../lib/authz';
import type { NotifyDeps } from '../lib/notifications/notify';
import {
  ErrorCode,
  ErrorMessage,
  createCreatorSchema,
} from '../lib/validation';
import type { CreateCreatorInput } from '../lib/validation';

/**
 * KAN-21 — creator onboarding (US-001, AC-001, AC-003, AC-006).
 *
 * The load-bearing assertions here are the ones about *where* uniqueness is
 * enforced. AC-003 says a duplicate handle is rejected; the ticket's technical
 * note says the database constraint must be the thing that rejects it, so that
 * two simultaneous submissions cannot both pass a pre-check. A test that only
 * asserted "duplicate → 409" would pass against the racy implementation too.
 */

// -- The guard is mocked so route behaviour is testable without a session. ----
//
// `guard` is the only thing replaced; `ForbiddenError` and `toErrorResponse`
// stay real, so the 403 envelope under test is the one production returns.
const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleCreateCreator } = await import('../app/api/creators/route');

const CREATOR_ID = 'user-creator';

/** A payload that passes the schema, so each test can vary one field. */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    tiktokHandle: '@beautybyhana',
    niche: 'beauty',
    audience: { topCountries: ['ET'], ageRange: '18-24' },
    ...overrides,
  };
}

function postRequest(body: unknown, raw?: string) {
  return new Request('http://localhost/api/creators', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

/** A unique violation shaped the way `pg` shapes one. */
function uniqueViolation(constraint: string) {
  return Object.assign(
    new Error('duplicate key value violates unique constraint'),
    {
      code: '23505',
      constraint,
    }
  );
}

/**
 * Every `.tsx` under the given directories, for the source guards below. Walking
 * the tree rather than listing files is what makes a guard hold for a screen
 * nobody has written yet.
 */
function readTsx(dirs: string[]): Array<{ file: string; src: string }> {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith('.tsx') ? [full] : [];
    });
  }

  return dirs.flatMap((dir) =>
    walk(path.join(process.cwd(), dir)).map((file) => ({
      file: path.relative(process.cwd(), file),
      src: readFileSync(file, 'utf8'),
    }))
  );
}

beforeEach(() => {
  guardMock.mockReset();
  guardMock.mockResolvedValue({
    user: {
      id: CREATOR_ID,
      email: 'c@example.com',
      name: 'C',
      role: 'creator',
    },
    brandProfileId: null,
    creatorProfileId: null,
  });
});

// -- Normalisation (AC-003's canonical form) ---------------------------------

describe('normalizeTiktokHandle', () => {
  it.each([
    ['@BeautyByHana', '@beautybyhana'],
    ['beautybyhana', '@beautybyhana'],
    ['  beautybyhana  ', '@beautybyhana'],
    ['@BEAUTYBYHANA', '@beautybyhana'],
    // Every leading @ goes, not just the first. Left in place, '@@hana' would
    // be a key that never collides with '@hana' — an AC-003 bypass reachable by
    // a paste artefact rather than by intent.
    ['@@BeautyByHana', '@beautybyhana'],
    ['@@@hana', '@hana'],
    ['bea uty', '@beauty'],
    ['@hana_01.x', '@hana_01.x'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeTiktokHandle(input)).toBe(expected);
  });

  it('is idempotent — normalising a normalised handle changes nothing', () => {
    const once = normalizeTiktokHandle('@@BeautyByHana');
    expect(normalizeTiktokHandle(once)).toBe(once);
  });

  it('returns empty for an empty or at-only input rather than a bare "@"', () => {
    // '@' would look structurally valid at a glance; '' fails the pattern in a
    // way that is obvious in a test failure and to a reader.
    expect(normalizeTiktokHandle('')).toBe('');
    expect(normalizeTiktokHandle('@')).toBe('');
    expect(normalizeTiktokHandle('   ')).toBe('');
  });

  it('returns empty for a non-string, without throwing', () => {
    // Reachable from JSON: `{"tiktokHandle": 12345}`. The schema rejects it, but
    // the transform runs first and must not be the thing that 500s.
    expect(normalizeTiktokHandle(12345 as unknown as string)).toBe('');
    expect(normalizeTiktokHandle(null as unknown as string)).toBe('');
    expect(normalizeTiktokHandle(undefined as unknown as string)).toBe('');
  });
});

describe('displayTiktokHandle', () => {
  it.each([
    ['@nate', '@nate'],
    ['@@nate', '@nate'],
    ['nate', '@nate'],
  ])('renders one canonical prefix for %j', (input, expected) => {
    expect(displayTiktokHandle(input)).toBe(expected);
  });
});

describe('isValidTiktokHandle', () => {
  it.each(['@ab', '@hana', '@hana_01', '@a.b_c', `@${'a'.repeat(24)}`])(
    'accepts %j',
    (handle) => {
      expect(isValidTiktokHandle(handle)).toBe(true);
    }
  );

  it.each([
    ['', 'empty'],
    ['@', 'at only'],
    ['@a', 'one character'],
    [`@${'a'.repeat(25)}`, '25 characters'],
    ['hana', 'no leading at'],
    ['@Hana', 'uppercase survived normalisation'],
    ['@hana!', 'illegal character'],
    ['@ha na', 'internal space'],
    ['@@hana', 'double at'],
    ['@hana.', 'trailing period'],
  ])('rejects %j (%s)', (handle) => {
    expect(isValidTiktokHandle(handle)).toBe(false);
  });

  it('rejects an unnormalised handle, so the pattern doubles as an assertion', () => {
    // The pattern is written against the *post*-normalisation value on purpose:
    // if the transform were ever removed, every mixed-case handle would start
    // failing validation loudly instead of reaching the index raw.
    expect(TIKTOK_HANDLE_PATTERN.test('@BeautyByHana')).toBe(false);
  });
});

// -- The link out to the real profile (KAN-200) ------------------------------

/**
 * KAN-200 item 8: a brand had no way to check whether the account it was about
 * to pay actually exists. Verification is manual and every figure on the profile
 * is self-reported, so the TikTok page itself is the only primary source a brand
 * has before it commits money.
 *
 * These tests are mostly about the *null* half. A handle that no longer passes
 * the pattern must produce no link, because a 404 offered under the label "View
 * on TikTok" reads as the creator not existing — which is exactly the judgement
 * the brand came here to make, answered wrongly by a formatting bug.
 */
describe('tiktokProfileUrl', () => {
  it.each([
    // The stored canonical form drops straight in: the `@` is part of TikTok's
    // own path, which is why this needs no new column.
    ['@beautybyhana', 'https://www.tiktok.com/@beautybyhana'],
    ['@hana_01.x', 'https://www.tiktok.com/@hana_01.x'],
    ['@ab', 'https://www.tiktok.com/@ab'],
  ])('builds %j into %j', (handle, expected) => {
    expect(tiktokProfileUrl(handle)).toBe(expected);
  });

  it.each([
    // Every one of these is a handle a brand could be shown if the value were
    // taken from anywhere but the column, and each links to a different page or
    // to none.
    ['beautybyhana', 'no leading at'],
    ['@BeautyByHana', 'uppercase'],
    ['  @beautybyhana  ', 'surrounding space'],
    ['@@beautybyhana', 'double at'],
  ])('normalises %j (%s) before building the URL', (handle) => {
    expect(tiktokProfileUrl(handle)).toBe(
      'https://www.tiktok.com/@beautybyhana'
    );
  });

  it.each([
    ['', 'empty'],
    ['@', 'at only'],
    ['@a', 'one character'],
    [`@${'a'.repeat(25)}`, 'too long'],
    ['@hana!', 'illegal character'],
    ['@hana.', 'trailing period'],
  ])('returns null for %j (%s) rather than a broken link', (handle) => {
    expect(tiktokProfileUrl(handle)).toBeNull();
  });

  it('returns null for a non-string without throwing', () => {
    // Same reachability argument as `normalizeTiktokHandle`: this runs on a row
    // read from the database, and a render is a worse place to throw than a
    // parse.
    expect(tiktokProfileUrl(null as unknown as string)).toBeNull();
    expect(tiktokProfileUrl(12345 as unknown as string)).toBeNull();
  });

  it('agrees with isValidTiktokHandle on every input', () => {
    // The two must not drift: a handle the app is willing to store is one it
    // must be willing to link to, and vice versa. Asserting the relationship
    // rather than a second list of cases means adding a case to either function
    // cannot leave this behind.
    for (const handle of [
      '@beautybyhana',
      'beautybyhana',
      '@BeautyByHana',
      '@',
      '',
      '@a',
      '@hana!',
      `@${'a'.repeat(25)}`,
    ]) {
      const valid = isValidTiktokHandle(normalizeTiktokHandle(handle));
      expect(tiktokProfileUrl(handle) === null).toBe(!valid);
    }
  });

  it('is the only thing that builds a profile href', () => {
    // A second copy of the origin is how one screen ends up on `tiktok.com` and
    // another on `www.tiktok.com` after a domain change — and the check a brand
    // makes here is worth exactly as much as the link being right.
    //
    // Scoped to `href=`, not to the host, because the host legitimately appears
    // as *text* elsewhere: the landing page's marketing mock, the placeholder in
    // `lib/deals/copy.ts`, and `lib/validation/schemas.ts`, which parses video
    // post URLs — a different shape with its own long, short and mobile forms.
    // Widening this to any mention would fail on all three and teach the next
    // person to delete the guard.
    const offenders = readTsx(['app', 'components'])
      .filter(({ src }) => /href=[^>]*tiktok\.com/.test(src))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('is reached from both screens that show a brand a creator', () => {
    // The F31/F34 habit: a helper that nothing mounts is a helper that does not
    // exist. Both the discovery card and the creator detail page have to link
    // out, because a brand shortlisting from the list should not have to open a
    // profile to find out the account is dead.
    for (const file of [
      path.join('components', 'creator', 'creator-card.tsx'),
      path.join(
        'app',
        '(brand)',
        '(onboarded)',
        'discover',
        '[id]',
        'page.tsx'
      ),
      // The creator's own dashboard, so they can see what a brand sees.
      path.join('app', '(creator)', 'creator', 'page.tsx'),
    ]) {
      const src = readFileSync(
        fileURLToPath(new URL(`../${file}`, import.meta.url)),
        'utf8'
      );
      expect(src).toContain('tiktokProfileUrl');
      // One label, so the three cannot come to say different things.
      expect(src).toContain('VIEW_ON_TIKTOK_LABEL');
      // The tab we open must get no handle on ours, and we are not vouching for
      // an account nobody has checked. The detail page delegates the <a> to
      // MagneticAnchor; the rel still has to exist on whatever actually renders.
      const relSrc = src.includes('MagneticAnchor')
        ? readFileSync(
            fileURLToPath(
              new URL(
                '../components/motion/magnetic-anchor.tsx',
                import.meta.url
              )
            ),
            'utf8'
          )
        : src;
      expect(relSrc).toContain('noopener noreferrer nofollow');
    }
  });
});

// -- The schema: parsing is normalisation -----------------------------------

describe('createCreatorSchema', () => {
  it('outputs a canonical handle, so no parsed value can be unnormalised', () => {
    const parsed = createCreatorSchema.parse(
      validPayload({ tiktokHandle: ' @@BeautyByHana ' })
    );
    expect(parsed.tiktokHandle).toBe('@beautybyhana');
  });

  it('accepts a payload with both optional numbers omitted (AC-001)', () => {
    const parsed = createCreatorSchema.parse(validPayload());
    expect(parsed.followerCount).toBeUndefined();
    expect(parsed.engagementRate).toBeUndefined();
  });

  it('accepts the optional numbers when given', () => {
    const parsed = createCreatorSchema.parse(
      validPayload({ followerCount: 12000, engagementRate: 4.2 })
    );
    expect(parsed.followerCount).toBe(12000);
    expect(parsed.engagementRate).toBe(4.2);
  });

  it('accepts multiple audience markets and optional interests', () => {
    const parsed = createCreatorSchema.parse(
      validPayload({
        audience: {
          topCountries: ['ET', 'US', 'KE'],
          ageRange: '25-34',
          interests: ['skincare'],
        },
      })
    );
    expect(parsed.audience.topCountries).toEqual(['ET', 'US', 'KE']);
    expect(parsed.audience.interests).toEqual(['skincare']);
  });

  /**
   * Each rejection asserts the *field path* as well as the failure, because the
   * form maps `details` keys to inputs. A rule that fails under the wrong key
   * shows the creator a correct message next to the wrong box.
   */
  it.each([
    ['tiktokHandle', validPayload({ tiktokHandle: '@a' })],
    ['tiktokHandle', validPayload({ tiktokHandle: '@hana!' })],
    ['tiktokHandle', validPayload({ tiktokHandle: '' })],
    ['tiktokHandle', validPayload({ tiktokHandle: 12345 })],
    ['niche', validPayload({ niche: 'not-a-niche' })],
    ['niche', validPayload({ niche: undefined })],
    [
      'audience.topCountries',
      validPayload({ audience: { topCountries: [], ageRange: '18-24' } }),
    ],
    [
      'audience.topCountries',
      validPayload({ audience: { topCountries: ['XX'], ageRange: '18-24' } }),
    ],
    [
      'audience.ageRange',
      validPayload({ audience: { topCountries: ['ET'], ageRange: '18-34' } }),
    ],
    ['followerCount', validPayload({ followerCount: -1 })],
    ['followerCount', validPayload({ followerCount: 1.5 })],
    ['engagementRate', validPayload({ engagementRate: -0.1 })],
    ['engagementRate', validPayload({ engagementRate: 100.01 })],
    ['audience', validPayload({ audience: undefined })],
  ])('rejects an invalid payload under %s', (path, payload) => {
    const result = createCreatorSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path.join('.'));
    // Prefix rather than equality: an invalid *member* of an array reports at
    // `audience.topCountries.0`, not at the array itself. The form resolves
    // errors by prefix for exactly this reason — asserting equality here would
    // have hidden that a bad market code renders no message at all.
    expect(
      paths.some((issued) => issued === path || issued.startsWith(`${path}.`)),
      `expected an issue at or under "${path}", got ${JSON.stringify(paths)}`
    ).toBe(true);
  });

  it('caps engagement rate at 100, not at what numeric(5,2) would hold', () => {
    // The column would physically accept 999.99. A rate above 100% is not a
    // measurement, so the schema is the tighter of the two bounds.
    expect(
      createCreatorSchema.safeParse(validPayload({ engagementRate: 100 }))
        .success
    ).toBe(true);
    expect(
      createCreatorSchema.safeParse(validPayload({ engagementRate: 101 }))
        .success
    ).toBe(false);
  });
});

// -- The insert: verified, tiered and notified in one transaction ------------

/**
 * Fake transactional deps, the same shape the tier/notification suites use.
 *
 * `withNotifications` opens `notifyDeps.db.transaction` and hands the profile
 * insert whatever tx that produced; the notification row arrives through
 * `mockTx.insert` and is recorded. `committed` only flips when the callback
 * returns, mirroring real Postgres.
 */
const TIERS = [
  {
    id: 'tier-micro',
    name: 'Micro',
    pricePerVideo: 150_000,
    minFollowers: 10_000,
    minEngagement: '2.00',
    active: true,
  },
];

function txDeps() {
  const recorded: { rows: unknown[]; committed: boolean } = {
    rows: [],
    committed: false,
  };

  const mockTx = {
    insert: vi.fn(() => ({
      values: vi.fn((row: unknown) => {
        recorded.rows.push(row);
        // `insertRow` chains `.returning()` off `values` to read the
        // generated id, so the fake must return the next link in the chain.
        return { returning: async () => [{ id: 'n-1' }] };
      }),
    })),
    // `assignTier` writes the matched tier back through the same tx.
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => {}) })),
    })),
  } as unknown as Tx;

  const notifyDeps = {
    db: {
      transaction: async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
        const result = await fn(mockTx);
        recorded.committed = true;
        return result;
      },
    },
    provider: null,
    render: async () => ({ subject: '', text: '', html: '' }),
    log: { info: vi.fn(), error: vi.fn() },
    sleep: async () => {},
  } as unknown as NotifyDeps;

  return { notifyDeps, recorded };
}

/**
 * Full deps for `createCreatorProfile`, everything faked. `sessionHandle` and
 * `sessionStats` are explicit `null`s — an email sign-up with no TikTok link —
 * so no test here touches the `user` table or the TikTok API.
 */
function profileDeps(
  insert: CreateProfileDeps['insert'],
  overrides: Partial<CreateProfileDeps> = {}
) {
  const { notifyDeps, recorded } = txDeps();
  const deps: Partial<CreateProfileDeps> = {
    insert,
    sessionHandle: async () => null,
    sessionStats: async () => null,
    notifyDeps,
    assignTierDeps: { loadTiers: async () => TIERS },
    ...overrides,
  };
  return { deps, recorded };
}

/** An insert fake that echoes what the pipeline wrote. */
function okInsertFn() {
  return vi.fn(async (_tx: Tx, values: ProfileInsertValues) => ({
    id: 'profile-1',
    status: 'verified',
    tiktokHandle: values.tiktokHandle,
  }));
}

describe('createCreatorProfile', () => {
  const input = createCreatorSchema.parse(validPayload()) as CreateCreatorInput;

  it('inserts and returns the created row with the tier outcome', async () => {
    const insert = okInsertFn();
    const { deps } = profileDeps(insert);

    const result = await createCreatorProfile(CREATOR_ID, input, deps);

    expect(result).toEqual({
      ok: true,
      profile: {
        id: 'profile-1',
        status: 'verified',
        tiktokHandle: '@beautybyhana',
      },
      // No numbers typed and no TikTok stats — live, but unmatchable.
      tier: { assigned: false, reason: 'missing_data' },
    });
  });

  it('inserts already verified with a verification timestamp (phase 2)', async () => {
    // There is no admin queue any more: the insert itself is the promotion.
    const insert = okInsertFn();
    const { deps } = profileDeps(insert);

    await createCreatorProfile(CREATOR_ID, input, deps);

    const values = insert.mock.calls[0][1];
    expect(values.status).toBe('verified');
    expect(values.verifiedAt).toBeInstanceOf(Date);
    // Tier is assigned by `assignTier` *after* the insert — never written here,
    // so the rule in tier-assignment.ts stays the only thing that tiers.
    expect(values).not.toHaveProperty('tierId');
  });

  it('assigns a tier in the same transaction when the numbers clear a floor', async () => {
    const insert = okInsertFn();
    const { deps, recorded } = profileDeps(insert);

    const result = await createCreatorProfile(
      CREATOR_ID,
      createCreatorSchema.parse(
        validPayload({ followerCount: 12_000, engagementRate: 4.2 })
      ),
      deps
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tier).toEqual({
      assigned: true,
      tierId: 'tier-micro',
      tierName: 'Micro',
      pricePerVideo: 150_000,
    });
    expect(recorded.committed).toBe(true);
  });

  it('emits the profile-live notification inside the transaction', async () => {
    const insert = okInsertFn();
    const { deps, recorded } = profileDeps(insert);

    await createCreatorProfile(CREATOR_ID, input, deps);

    expect(recorded.rows).toEqual([
      {
        userId: CREATOR_ID,
        type: 'verification_result',
        payload: { creatorProfileId: 'profile-1', outcome: 'approved' },
      },
    ]);
    expect(recorded.committed).toBe(true);
  });

  it('prefers session stats over typed numbers', async () => {
    // A number TikTok reported is not one the creator gets to improve in
    // DevTools — the body's values only fill gaps the API left.
    const insert = okInsertFn();
    const { deps } = profileDeps(insert, {
      sessionStats: async () => ({
        followerCount: 54_321,
        engagementRate: '7.89',
      }),
    });

    await createCreatorProfile(
      CREATOR_ID,
      createCreatorSchema.parse(
        validPayload({ followerCount: 999_999, engagementRate: 99 })
      ),
      deps
    );

    const values = insert.mock.calls[0][1];
    expect(values.followerCount).toBe(54_321);
    expect(values.engagementRate).toBe('7.89');
  });

  it('falls back to typed numbers when the stats service returns null', async () => {
    // The email sign-up path, and every API failure: missing scope, expired
    // token, zero-view account. Degrade, never block.
    const insert = okInsertFn();
    const { deps } = profileDeps(insert);

    await createCreatorProfile(
      CREATOR_ID,
      createCreatorSchema.parse(
        validPayload({ followerCount: 12_000, engagementRate: 4.2 })
      ),
      deps
    );

    const values = insert.mock.calls[0][1];
    expect(values.followerCount).toBe(12_000);
    expect(values.engagementRate).toBe('4.20');
  });

  it('takes the owner from its argument, never from the payload', async () => {
    const insert = okInsertFn();
    const { deps } = profileDeps(insert);

    await createCreatorProfile(CREATOR_ID, input, deps);

    expect(insert.mock.calls[0][1].userId).toBe(CREATOR_ID);
  });

  it('sends engagement rate as a fixed-scale string for numeric(5,2)', async () => {
    const insert = okInsertFn();
    const { deps } = profileDeps(insert);

    await createCreatorProfile(
      CREATOR_ID,
      createCreatorSchema.parse(validPayload({ engagementRate: 4.2 })),
      deps
    );

    expect(insert.mock.calls[0][1].engagementRate).toBe('4.20');
  });

  it('sends absent optional numbers as null, not zero', async () => {
    const insert = okInsertFn();
    const { deps } = profileDeps(insert);

    await createCreatorProfile(CREATOR_ID, input, deps);

    expect(insert.mock.calls[0][1].followerCount).toBeNull();
    expect(insert.mock.calls[0][1].engagementRate).toBeNull();
  });

  it('maps the handle constraint to a handle conflict', async () => {
    const insert = vi
      .fn()
      .mockRejectedValue(uniqueViolation(HANDLE_CONSTRAINT));
    const { deps } = profileDeps(insert);
    await expect(
      createCreatorProfile(CREATOR_ID, input, deps)
    ).resolves.toEqual({ ok: false, conflict: 'handle' });
  });

  it('maps the user constraint to a profile conflict, not a handle one', async () => {
    // Telling a creator their own handle belongs to a stranger sends them to
    // support instead of to their dashboard.
    const insert = vi.fn().mockRejectedValue(uniqueViolation(USER_CONSTRAINT));
    const { deps } = profileDeps(insert);
    await expect(
      createCreatorProfile(CREATOR_ID, input, deps)
    ).resolves.toEqual({ ok: false, conflict: 'profile' });
  });

  it('a conflict rolls back the whole transaction — no notification survives', async () => {
    const insert = vi
      .fn()
      .mockRejectedValue(uniqueViolation(HANDLE_CONSTRAINT));
    const { deps, recorded } = profileDeps(insert);

    await createCreatorProfile(CREATOR_ID, input, deps);

    expect(recorded.committed).toBe(false);
  });

  it('re-throws a non-unique database error rather than reporting a conflict', async () => {
    // A connection failure reported as "handle taken" would send the creator
    // hunting for a new handle over an outage.
    const insert = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('boom'), { code: '08006' }));
    const { deps } = profileDeps(insert);
    await expect(createCreatorProfile(CREATOR_ID, input, deps)).rejects.toThrow(
      'boom'
    );
  });

  it('re-throws a unique violation on an unrecognised constraint', async () => {
    const insert = vi
      .fn()
      .mockRejectedValue(
        uniqueViolation('creator_profile_something_new_unique')
      );
    const { deps } = profileDeps(insert);
    await expect(
      createCreatorProfile(CREATOR_ID, input, deps)
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('re-throws a thrown non-object', async () => {
    const insert = vi.fn().mockRejectedValue('a string');
    const { deps } = profileDeps(insert);
    await expect(createCreatorProfile(CREATOR_ID, input, deps)).rejects.toBe(
      'a string'
    );
  });

  it('stores the Login Kit handle over whatever the body sent', async () => {
    const insert = okInsertFn();
    const { deps } = profileDeps(insert, {
      sessionHandle: async () => '@fromtiktok',
    });

    await createCreatorProfile(CREATOR_ID, input, deps);

    expect(insert.mock.calls[0][1].tiktokHandle).toBe('@fromtiktok');
  });
});

/**
 * The structural half of AC-003.
 *
 * A check-then-insert implementation would satisfy every behavioural test
 * above: it would still catch `23505` for the case its SELECT lost the race to.
 * The only way to assert "the constraint is the arbiter" is to assert the
 * pre-check does not exist.
 */
describe('uniqueness is enforced by the constraint, not a pre-check', () => {
  const source = readFileSync(
    fileURLToPath(
      new URL('../lib/creators/create-profile.ts', import.meta.url)
    ),
    'utf8'
  );

  it('runs no query before the insert', async () => {
    const calls: string[] = [];
    const insert = vi.fn().mockImplementation(async () => {
      calls.push('insert');
      return {
        id: 'profile-1',
        status: 'verified',
        tiktokHandle: '@beautybyhana',
      };
    });
    const { deps } = profileDeps(insert);

    await createCreatorProfile(
      CREATOR_ID,
      createCreatorSchema.parse(validPayload()),
      deps
    );

    // The profile seam is touched once, and it is the write. (The notification
    // row and the tier read ride the same transaction *after* it.)
    expect(calls).toEqual(['insert']);
  });

  it('contains no select against tiktok_handle', () => {
    // Reading the source is the point: a future edit that adds
    // `db.select()...where(eq(creatorProfile.tiktokHandle, ...))` re-introduces
    // the race, and would otherwise pass every other test in this file.
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/\.select\s*\(/);
    expect(withoutComments).not.toMatch(/\.from\s*\(/);
    expect(withoutComments).not.toMatch(/\bfindFirst\b|\bfindMany\b/);
    // A where-clause pre-check needs a comparison helper. This module imports
    // none from drizzle-orm — `.returning()` needs only the column reference,
    // which is why the column name itself is not the thing being asserted on.
    expect(withoutComments).not.toMatch(/from\s+['"]drizzle-orm['"]/);
  });

  it('handles the unique violation it relies on', () => {
    // Paired with the assertion above: no pre-check *and* no 23505 handling
    // would mean duplicates surface as a 500 rather than as AC-003's message.
    expect(source).toContain('23505');
  });

  /**
   * The constraint names are matched as *strings* against what Postgres reports,
   * so they are only correct as long as the migration agrees. A rename in a
   * later migration would leave every duplicate falling through to the re-throw
   * branch — AC-003's 409 quietly becoming a 500, with no other test noticing,
   * because every test above supplies the name it expects.
   */
  it('names constraints that actually exist in the migration', () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL('../drizzle/0000_serious_ender_wiggin.sql', import.meta.url)
      ),
      'utf8'
    );

    expect(migration).toContain(
      `CONSTRAINT "${HANDLE_CONSTRAINT}" UNIQUE("tiktok_handle")`
    );
    expect(migration).toContain(
      `CONSTRAINT "${USER_CONSTRAINT}" UNIQUE("user_id")`
    );
  });
});

// -- The endpoint -----------------------------------------------------------

describe('POST /api/creators', () => {
  /**
   * Full fake deps for the route. No Login Kit handle and no TikTok stats in
   * these fixtures — an email sign-up. Explicit `null`s, not absent ones, keep
   * the route off the `user` table and the TikTok API.
   */
  function routeDeps(
    insert: CreateProfileDeps['insert'] = async (_tx, values) => ({
      id: 'profile-1',
      status: 'verified',
      tiktokHandle: values.tiktokHandle,
    })
  ): Partial<CreateProfileDeps> {
    return profileDeps(insert).deps;
  }

  it('returns 201 with a snake_case body on success (AC-001)', async () => {
    const response = await handleCreateCreator(
      postRequest(validPayload({ tiktokHandle: '@BeautyByHana' })),
      routeDeps()
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'profile-1',
      status: 'verified',
      // Normalised on the way in, and echoed as stored — so the client shows
      // the creator the value the database actually holds.
      tiktok_handle: '@beautybyhana',
      // The tier decision made in the same transaction, so the confirmation
      // can say whether the profile is already bookable (phase 2).
      tier: { assigned: false, reason: 'missing_data' },
    });
  });

  it('lands the creator live immediately — verified, no review queue', async () => {
    const response = await handleCreateCreator(
      postRequest(validPayload()),
      routeDeps()
    );
    const body = await response.json();
    expect(body.status).toBe('verified');
  });

  it('reports the assigned tier when the typed numbers clear a floor', async () => {
    const response = await handleCreateCreator(
      postRequest(validPayload({ followerCount: 12_000, engagementRate: 4.2 })),
      routeDeps()
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.tier).toEqual({
      assigned: true,
      id: 'tier-micro',
      name: 'Micro',
      price_per_video: 150_000,
    });
  });

  it("returns 409 with AC-003's exact string on a duplicate handle", async () => {
    const response = await handleCreateCreator(
      postRequest(validPayload()),
      routeDeps(async () => {
        throw uniqueViolation(HANDLE_CONSTRAINT);
      })
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.TIKTOK_HANDLE_TAKEN);
    // The acceptance criterion is the string, character for character.
    expect(body.error.message).toBe(
      'This TikTok account is already registered.'
    );
    // Keyed to the field so the form can show it inline.
    expect(body.error.details).toEqual({
      tiktokHandle: ['This TikTok account is already registered.'],
    });
  });

  it('rejects a differently-cased duplicate with the same 409', async () => {
    // The AC-003 proof that normalisation happens *before* the uniqueness
    // check: '@Demo_Creator' must collide with the stored '@demo_creator'.
    const stored = new Set(['@demo_creator']);
    const response = await handleCreateCreator(
      postRequest(validPayload({ tiktokHandle: '@Demo_Creator' })),
      routeDeps(async (_tx, values) => {
        if (stored.has(values.tiktokHandle)) {
          throw uniqueViolation(HANDLE_CONSTRAINT);
        }
        return {
          id: 'profile-1',
          status: 'verified',
          tiktokHandle: values.tiktokHandle,
        };
      })
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.TIKTOK_HANDLE_TAKEN);
  });

  it('returns 409 PROFILE_EXISTS when the creator already has a profile', async () => {
    const response = await handleCreateCreator(
      postRequest(validPayload()),
      routeDeps(async () => {
        throw uniqueViolation(USER_CONSTRAINT);
      })
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.PROFILE_EXISTS);
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.PROFILE_EXISTS]);
    // No field to attach to — this is about the account, not the input.
    expect(body.error.details).toBeUndefined();
  });

  it('returns 422 VALIDATION_ERROR with field details on an invalid payload', async () => {
    const response = await handleCreateCreator(
      postRequest(validPayload({ tiktokHandle: '@a' })),
      routeDeps()
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(Object.keys(body.error.details)).toContain('tiktokHandle');
  });

  it('returns 422 on a malformed JSON body', async () => {
    const response = await handleCreateCreator(
      postRequest(null, '{not json'),
      routeDeps()
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('returns 403 when the guard denies, and never reaches the insert', async () => {
    guardMock.mockRejectedValue(new ForbiddenError('role brand not permitted'));
    const insert = vi.fn();

    const response = await handleCreateCreator(
      postRequest(validPayload()),
      routeDeps(insert)
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
    expect(insert).not.toHaveBeenCalled();
  });

  it('authorizes before parsing, so an invalid body still 403s', async () => {
    // Otherwise the validation response is an oracle: an unauthorized caller
    // could map the accepted payload shape by watching which fields it names.
    guardMock.mockRejectedValue(new ForbiddenError('no session'));

    const response = await handleCreateCreator(
      postRequest({ garbage: true }),
      routeDeps()
    );

    expect(response.status).toBe(403);
  });

  it('gates on the creator role only', async () => {
    await handleCreateCreator(postRequest(validPayload()), routeDeps());
    expect(guardMock).toHaveBeenCalledWith({ roles: ['creator'] });
  });

  it('ignores a userId supplied in the body', async () => {
    // Account takeover if honoured. The schema does not declare the field, so
    // it is stripped, and the owner comes from the session.
    const insert = vi.fn(async (_tx: Tx, values: ProfileInsertValues) => ({
      id: 'profile-1',
      status: 'verified',
      tiktokHandle: values.tiktokHandle,
    }));

    await handleCreateCreator(
      postRequest(validPayload({ userId: 'someone-else' })),
      routeDeps(insert)
    );

    expect(insert.mock.calls[0][1].userId).toBe(CREATOR_ID);
  });

  it('re-throws a non-Forbidden error instead of flattening it to 403', async () => {
    guardMock.mockRejectedValue(new Error('database down'));
    await expect(
      handleCreateCreator(postRequest(validPayload()), routeDeps())
    ).rejects.toThrow('database down');
  });
});

// -- Bookability (AC-006) --------------------------------------------------

describe('isBookable', () => {
  it.each([
    {
      case: 'pending, untiered',
      status: 'pending_verification',
      tierId: null,
      tierActive: null,
      expected: false,
    },
    {
      case: 'pending but tiered',
      status: 'pending_verification',
      tierId: 'tier-1',
      tierActive: true,
      expected: false,
    },
    {
      case: 'rejected but tiered',
      status: 'rejected',
      tierId: 'tier-1',
      tierActive: true,
      expected: false,
    },
    {
      case: 'rejected, untiered',
      status: 'rejected',
      tierId: null,
      tierActive: null,
      expected: false,
    },
    // The half of AC-006 that is easy to forget: verified is not enough. An
    // untiered creator has no price, so the campaign cart cannot price them.
    {
      case: 'verified but untiered',
      status: 'verified',
      tierId: null,
      tierActive: null,
      expected: false,
    },
    {
      case: 'verified and tiered',
      status: 'verified',
      tierId: 'tier-1',
      tierActive: true,
      expected: true,
    },
  ] as const)(
    '$case → $expected',
    ({ status, tierId, tierActive, expected }) => {
      expect(isBookable({ status, tierId, tierActive })).toBe(expected);
    }
  );

  it('excludes a pending creator from brand-facing discovery', () => {
    // The acceptance criterion is that a pending_verification creator "does not
    // appear anywhere in brand-facing discovery". Discovery is KAN-28 and does
    // not exist yet, so the rule is asserted here against the predicate that
    // discovery is required to import.
    const rows = [
      {
        status: 'pending_verification' as const,
        tierId: 'tier-1',
        tierActive: true,
      },
      { status: 'verified' as const, tierId: 'tier-1', tierActive: true },
    ];
    expect(rows.filter(isBookable)).toEqual([
      { status: 'verified', tierId: 'tier-1', tierActive: true },
    ]);
  });
});

describe('Login Kit handle is what onboarding shows and stores', () => {
  it('reads the stored handle on the onboarding page, not only the session extra', () => {
    const page = readFileSync(
      fileURLToPath(
        new URL('../app/(creator)/creator/onboarding/page.tsx', import.meta.url)
      ),
      'utf8'
    );
    expect(page).toContain('sessionTiktokHandle');
    expect(page).toContain('lockedHandle=');
  });

  it('POST /api/creators always wires sessionTiktokHandle when the caller omits it', () => {
    const route = readFileSync(
      fileURLToPath(new URL('../app/api/creators/route.ts', import.meta.url)),
      'utf8'
    );
    expect(route).toMatch(/sessionHandle:\s*[\s\S]*sessionTiktokHandle/);
    expect(route).not.toMatch(/: undefined\s*\);/);
  });
});
