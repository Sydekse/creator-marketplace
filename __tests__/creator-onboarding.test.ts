import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TIKTOK_HANDLE_PATTERN,
  isValidTiktokHandle,
  normalizeTiktokHandle,
} from '../lib/creators/handle';
import { isBookable } from '../lib/creators/queries';
import {
  HANDLE_CONSTRAINT,
  USER_CONSTRAINT,
  createCreatorProfile,
} from '../lib/creators/create-profile';
import type { CreateProfileDeps } from '../lib/creators/create-profile';
import { ForbiddenError } from '../lib/authz';
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

// -- The insert: the constraint is the arbiter (AC-003) ---------------------

describe('createCreatorProfile', () => {
  const input = createCreatorSchema.parse(validPayload()) as CreateCreatorInput;

  function deps(insert: CreateProfileDeps['insert']): CreateProfileDeps {
    return { insert };
  }

  it('inserts and returns the created row', async () => {
    const insert = vi.fn().mockResolvedValue({
      id: 'profile-1',
      status: 'pending_verification',
      tiktokHandle: '@beautybyhana',
    });

    const result = await createCreatorProfile(CREATOR_ID, input, deps(insert));

    expect(result).toEqual({
      ok: true,
      profile: {
        id: 'profile-1',
        status: 'pending_verification',
        tiktokHandle: '@beautybyhana',
      },
    });
  });

  it('never sets status, so the pending default cannot be overridden', async () => {
    // Promotion to 'verified' is KAN-22's admin action. If this module ever
    // started passing a status, a caller could self-verify.
    const insert = vi.fn().mockResolvedValue({
      id: 'profile-1',
      status: 'pending_verification',
      tiktokHandle: '@beautybyhana',
    });

    await createCreatorProfile(CREATOR_ID, input, deps(insert));

    expect(insert.mock.calls[0][0]).not.toHaveProperty('status');
    expect(insert.mock.calls[0][0]).not.toHaveProperty('tierId');
    expect(insert.mock.calls[0][0]).not.toHaveProperty('verifiedAt');
  });

  it('takes the owner from its argument, never from the payload', async () => {
    const insert = vi.fn().mockResolvedValue({
      id: 'profile-1',
      status: 'pending_verification',
      tiktokHandle: '@beautybyhana',
    });

    await createCreatorProfile(CREATOR_ID, input, deps(insert));

    expect(insert.mock.calls[0][0].userId).toBe(CREATOR_ID);
  });

  it('sends engagement rate as a fixed-scale string for numeric(5,2)', async () => {
    const insert = vi.fn().mockResolvedValue({
      id: 'profile-1',
      status: 'pending_verification',
      tiktokHandle: '@beautybyhana',
    });

    await createCreatorProfile(
      CREATOR_ID,
      createCreatorSchema.parse(validPayload({ engagementRate: 4.2 })),
      deps(insert)
    );

    expect(insert.mock.calls[0][0].engagementRate).toBe('4.20');
  });

  it('sends absent optional numbers as null, not zero', async () => {
    const insert = vi.fn().mockResolvedValue({
      id: 'profile-1',
      status: 'pending_verification',
      tiktokHandle: '@beautybyhana',
    });

    await createCreatorProfile(CREATOR_ID, input, deps(insert));

    expect(insert.mock.calls[0][0].followerCount).toBeNull();
    expect(insert.mock.calls[0][0].engagementRate).toBeNull();
  });

  it('maps the handle constraint to a handle conflict', async () => {
    const insert = vi
      .fn()
      .mockRejectedValue(uniqueViolation(HANDLE_CONSTRAINT));
    await expect(
      createCreatorProfile(CREATOR_ID, input, deps(insert))
    ).resolves.toEqual({ ok: false, conflict: 'handle' });
  });

  it('maps the user constraint to a profile conflict, not a handle one', async () => {
    // Telling a creator their own handle belongs to a stranger sends them to
    // support instead of to their dashboard.
    const insert = vi.fn().mockRejectedValue(uniqueViolation(USER_CONSTRAINT));
    await expect(
      createCreatorProfile(CREATOR_ID, input, deps(insert))
    ).resolves.toEqual({ ok: false, conflict: 'profile' });
  });

  it('re-throws a non-unique database error rather than reporting a conflict', async () => {
    // A connection failure reported as "handle taken" would send the creator
    // hunting for a new handle over an outage.
    const insert = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('boom'), { code: '08006' }));
    await expect(
      createCreatorProfile(CREATOR_ID, input, deps(insert))
    ).rejects.toThrow('boom');
  });

  it('re-throws a unique violation on an unrecognised constraint', async () => {
    const insert = vi
      .fn()
      .mockRejectedValue(
        uniqueViolation('creator_profile_something_new_unique')
      );
    await expect(
      createCreatorProfile(CREATOR_ID, input, deps(insert))
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('re-throws a thrown non-object', async () => {
    const insert = vi.fn().mockRejectedValue('a string');
    await expect(
      createCreatorProfile(CREATOR_ID, input, deps(insert))
    ).rejects.toBe('a string');
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
        status: 'pending_verification',
        tiktokHandle: '@beautybyhana',
      };
    });

    await createCreatorProfile(
      CREATOR_ID,
      createCreatorSchema.parse(validPayload()),
      { insert }
    );

    // One database interaction, and it is the write.
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
  const okInsert: CreateProfileDeps = {
    insert: async (values) => ({
      id: 'profile-1',
      status: 'pending_verification',
      tiktokHandle: values.tiktokHandle,
    }),
  };

  it('returns 201 with a snake_case body on success (AC-001)', async () => {
    const response = await handleCreateCreator(
      postRequest(validPayload({ tiktokHandle: '@BeautyByHana' })),
      okInsert
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'profile-1',
      status: 'pending_verification',
      // Normalised on the way in, and echoed as stored — so the client shows
      // the creator the value the database actually holds.
      tiktok_handle: '@beautybyhana',
    });
  });

  it('lands the creator in pending_verification, not verified', async () => {
    const response = await handleCreateCreator(
      postRequest(validPayload()),
      okInsert
    );
    const body = await response.json();
    expect(body.status).toBe('pending_verification');
  });

  it("returns 409 with AC-003's exact string on a duplicate handle", async () => {
    const response = await handleCreateCreator(postRequest(validPayload()), {
      insert: async () => {
        throw uniqueViolation(HANDLE_CONSTRAINT);
      },
    });

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
      {
        insert: async (values) => {
          if (stored.has(values.tiktokHandle)) {
            throw uniqueViolation(HANDLE_CONSTRAINT);
          }
          return {
            id: 'profile-1',
            status: 'pending_verification',
            tiktokHandle: values.tiktokHandle,
          };
        },
      }
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.TIKTOK_HANDLE_TAKEN);
  });

  it('returns 409 PROFILE_EXISTS when the creator already has a profile', async () => {
    const response = await handleCreateCreator(postRequest(validPayload()), {
      insert: async () => {
        throw uniqueViolation(USER_CONSTRAINT);
      },
    });

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
      okInsert
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(Object.keys(body.error.details)).toContain('tiktokHandle');
  });

  it('returns 422 on a malformed JSON body', async () => {
    const response = await handleCreateCreator(
      postRequest(null, '{not json'),
      okInsert
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('returns 403 when the guard denies, and never reaches the insert', async () => {
    guardMock.mockRejectedValue(new ForbiddenError('role brand not permitted'));
    const insert = vi.fn();

    const response = await handleCreateCreator(postRequest(validPayload()), {
      insert,
    });

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
      okInsert
    );

    expect(response.status).toBe(403);
  });

  it('gates on the creator role only', async () => {
    await handleCreateCreator(postRequest(validPayload()), okInsert);
    expect(guardMock).toHaveBeenCalledWith({ roles: ['creator'] });
  });

  it('ignores a userId supplied in the body', async () => {
    // Account takeover if honoured. The schema does not declare the field, so
    // it is stripped, and the owner comes from the session.
    const insert = vi.fn().mockResolvedValue({
      id: 'profile-1',
      status: 'pending_verification',
      tiktokHandle: '@beautybyhana',
    });

    await handleCreateCreator(
      postRequest(validPayload({ userId: 'someone-else' })),
      { insert }
    );

    expect(insert.mock.calls[0][0].userId).toBe(CREATOR_ID);
  });

  it('re-throws a non-Forbidden error instead of flattening it to 403', async () => {
    guardMock.mockRejectedValue(new Error('database down'));
    await expect(
      handleCreateCreator(postRequest(validPayload()), okInsert)
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
