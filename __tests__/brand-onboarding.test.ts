import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  USER_CONSTRAINT,
  createBrandProfile,
} from '../lib/brands/create-profile';
import type { CreateBrandProfileDeps } from '../lib/brands/create-profile';
import { updateBrandProfile } from '../lib/brands/update-profile';
import type { UpdateBrandProfileDeps } from '../lib/brands/update-profile';
import { ForbiddenError } from '../lib/authz';
import {
  ErrorCode,
  ErrorMessage,
  MAX_COMPANY_NAME_LENGTH,
  createBrandSchema,
  fieldErrorsAt,
  updateBrandSchema,
} from '../lib/validation';

/**
 * KAN-27 — brand onboarding (FR-001, Tech Spec §3.2 brand_profile).
 *
 * Five acceptance criteria, and they land in three places:
 *
 *   AC-1 prompted before creating a campaign  → the `(onboarded)` layout
 *   AC-2 exactly one profile per account      → the unique constraint
 *   AC-3 name on every offer a creator sees   → the schema chain, see below
 *   AC-4 no profile → redirected, not broken  → the `(onboarded)` layout
 *   AC-5 editable later                       → PATCH /api/brands/{id}
 *
 * AC-1 and AC-4 are the same mechanism seen from two sides, so they are
 * asserted together, structurally: layouts render through React and this repo
 * has no DOM environment, so the assertion is that the gate is in a *layout*
 * (which no future route can forget) rather than in each page (which they can).
 */

// -- The guard is mocked so route behaviour is testable without a session. ----
const guardMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/authz')>();
  return { ...actual, guard: guardMock };
});

const { handleCreateBrand } = await import('../app/api/brands/route');
const { handleUpdateBrand } = await import('../app/api/brands/[id]/route');

const BRAND_USER_ID = 'user-brand';
const BRAND_PROFILE_ID = '3f1a6c9e-1c2b-4f6d-9a1e-2b7c8d9e0f11';

function postRequest(body: unknown, raw?: string) {
  return new Request('http://localhost/api/brands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

function patchRequest(body: unknown, raw?: string) {
  return new Request(`http://localhost/api/brands/${BRAND_PROFILE_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

/** A unique violation shaped the way `pg` shapes one. */
function uniqueViolation(constraint: string) {
  return Object.assign(
    new Error('duplicate key value violates unique constraint'),
    { code: '23505', constraint }
  );
}

function readSource(relative: string) {
  return readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    'utf8'
  );
}

beforeEach(() => {
  guardMock.mockReset();
  guardMock.mockResolvedValue({
    user: {
      id: BRAND_USER_ID,
      email: 'b@example.com',
      name: 'B',
      role: 'brand',
    },
    brandProfileId: BRAND_PROFILE_ID,
    creatorProfileId: null,
  });
});

// -- The schema --------------------------------------------------------------

describe('createBrandSchema', () => {
  it('accepts a company name', () => {
    expect(
      createBrandSchema.parse({ companyName: 'Habesha Coffee' }).companyName
    ).toBe('Habesha Coffee');
  });

  it('trims, so the stored name has no padding', () => {
    // A padded name renders with a visible gap on every offer, and two brands
    // typing the same name with different padding look like different rows.
    expect(
      createBrandSchema.parse({ companyName: '  Habesha Coffee  ' }).companyName
    ).toBe('Habesha Coffee');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['tabs and newlines only', '\t\n '],
  ])(
    'rejects a %s name (AC-3: an offer needs a name to show)',
    (_case, value) => {
      const result = createBrandSchema.safeParse({ companyName: value });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues[0].message).toBe('Company name is required.');
    }
  );

  it('rejects a missing name', () => {
    expect(createBrandSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-string name', () => {
    // Reachable from JSON: `{"companyName": 42}`.
    expect(createBrandSchema.safeParse({ companyName: 42 }).success).toBe(
      false
    );
  });

  it('reports every failure under the companyName path', () => {
    // The form maps `details` keys to inputs. An issue under the wrong key
    // shows a correct message next to no box at all.
    const result = createBrandSchema.safeParse({ companyName: '' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.path.join('.'))).toEqual([
      'companyName',
    ]);
  });

  it('accepts a name of exactly the maximum length', () => {
    const name = 'a'.repeat(MAX_COMPANY_NAME_LENGTH);
    expect(createBrandSchema.parse({ companyName: name }).companyName).toBe(
      name
    );
  });

  it('rejects a name one character over the maximum', () => {
    expect(
      createBrandSchema.safeParse({
        companyName: 'a'.repeat(MAX_COMPANY_NAME_LENGTH + 1),
      }).success
    ).toBe(false);
  });

  it('measures length after trimming, not before', () => {
    // Otherwise a name that fits would be rejected for its own whitespace.
    const name = `  ${'a'.repeat(MAX_COMPANY_NAME_LENGTH)}  `;
    expect(createBrandSchema.safeParse({ companyName: name }).success).toBe(
      true
    );
  });

  it('strips unknown keys, so a userId in the body cannot reach the insert', () => {
    const parsed = createBrandSchema.parse({
      companyName: 'Habesha Coffee',
      userId: 'someone-else',
    });
    expect(parsed).not.toHaveProperty('userId');
  });
});

describe('updateBrandSchema', () => {
  it('applies the same rules as create', () => {
    expect(
      updateBrandSchema.parse({ companyName: '  Renamed  ' }).companyName
    ).toBe('Renamed');
    expect(updateBrandSchema.safeParse({ companyName: '' }).success).toBe(
      false
    );
  });

  it('is a distinct schema, not an alias', () => {
    // The two are interchangeable today. Keeping them separate is what stops a
    // future create-only field from silently becoming editable.
    expect(updateBrandSchema).not.toBe(createBrandSchema);
  });
});

// -- The insert: the constraint is the arbiter (AC-2) ------------------------

describe('createBrandProfile', () => {
  const input = createBrandSchema.parse({ companyName: 'Habesha Coffee' });

  function deps(insert: CreateBrandProfileDeps['insert']) {
    return { insert };
  }

  it('inserts and returns the created row', async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ id: 'brand-1', companyName: 'Habesha Coffee' });

    await expect(
      createBrandProfile(BRAND_USER_ID, input, deps(insert))
    ).resolves.toEqual({
      ok: true,
      profile: { id: 'brand-1', companyName: 'Habesha Coffee' },
    });
  });

  it('takes the owner from its argument, never from the payload', async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ id: 'brand-1', companyName: 'Habesha Coffee' });

    await createBrandProfile(BRAND_USER_ID, input, deps(insert));

    expect(insert.mock.calls[0][0].userId).toBe(BRAND_USER_ID);
  });

  it('writes only ownership and the name', async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ id: 'brand-1', companyName: 'Habesha Coffee' });

    await createBrandProfile(BRAND_USER_ID, input, deps(insert));

    // `id` and `created_at` are the database's to mint (invariant 11).
    expect(Object.keys(insert.mock.calls[0][0]).sort()).toEqual([
      'companyName',
      'userId',
    ]);
  });

  it('maps the user constraint to a profile conflict (AC-2)', async () => {
    const insert = vi.fn().mockRejectedValue(uniqueViolation(USER_CONSTRAINT));
    await expect(
      createBrandProfile(BRAND_USER_ID, input, deps(insert))
    ).resolves.toEqual({ ok: false, conflict: 'profile' });
  });

  it('re-throws a non-unique database error rather than reporting a conflict', async () => {
    // A connection failure reported as "you already have a profile" sends the
    // brand looking for a profile that does not exist.
    const insert = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('boom'), { code: '08006' }));
    await expect(
      createBrandProfile(BRAND_USER_ID, input, deps(insert))
    ).rejects.toThrow('boom');
  });

  it('re-throws a unique violation on an unrecognised constraint', async () => {
    const insert = vi
      .fn()
      .mockRejectedValue(uniqueViolation('brand_profile_something_new_unique'));
    await expect(
      createBrandProfile(BRAND_USER_ID, input, deps(insert))
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('re-throws a unique violation with no constraint name', async () => {
    const insert = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(
      createBrandProfile(BRAND_USER_ID, input, deps(insert))
    ).rejects.toThrow('dup');
  });

  it('re-throws a thrown non-object', async () => {
    const insert = vi.fn().mockRejectedValue('a string');
    await expect(
      createBrandProfile(BRAND_USER_ID, input, deps(insert))
    ).rejects.toBe('a string');
  });
});

/**
 * The structural half of AC-2.
 *
 * A check-then-insert implementation would satisfy every behavioural test
 * above — it would still catch `23505` for the request its SELECT lost the race
 * to. The only way to assert "the constraint is the arbiter" is to assert the
 * pre-check does not exist.
 */
describe('one profile per account is enforced by the constraint', () => {
  const source = readSource('../lib/brands/create-profile.ts');

  it('runs no query before the insert', async () => {
    const calls: string[] = [];
    const insert = vi.fn().mockImplementation(async () => {
      calls.push('insert');
      return { id: 'brand-1', companyName: 'Habesha Coffee' };
    });

    await createBrandProfile(
      BRAND_USER_ID,
      createBrandSchema.parse({ companyName: 'Habesha Coffee' }),
      { insert }
    );

    expect(calls).toEqual(['insert']);
  });

  it('contains no select', () => {
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/\.select\s*\(/);
    expect(withoutComments).not.toMatch(/\.from\s*\(/);
    expect(withoutComments).not.toMatch(/\bfindFirst\b|\bfindMany\b/);
    // A where-clause pre-check needs a comparison helper, and this module
    // imports none from drizzle-orm.
    expect(withoutComments).not.toMatch(/from\s+['"]drizzle-orm['"]/);
  });

  it('handles the unique violation it relies on', () => {
    expect(source).toContain('23505');
  });

  /**
   * The constraint name is matched as a *string* against what Postgres reports,
   * so it is only correct while the migration agrees. A rename would send every
   * duplicate down the re-throw branch — AC-2's 409 quietly becoming a 500,
   * with no other test noticing, because every test above supplies the name it
   * expects.
   */
  it('names a constraint that actually exists in the migration', () => {
    const migration = readSource('../drizzle/0000_serious_ender_wiggin.sql');
    expect(migration).toContain(
      `CONSTRAINT "${USER_CONSTRAINT}" UNIQUE("user_id")`
    );
  });
});

// -- POST /api/brands --------------------------------------------------------

describe('POST /api/brands', () => {
  const okInsert: CreateBrandProfileDeps = {
    insert: async (values) => ({
      id: 'brand-1',
      companyName: values.companyName,
    }),
  };

  it('returns 201 with a snake_case body on success (AC-1)', async () => {
    const response = await handleCreateBrand(
      postRequest({ companyName: '  Habesha Coffee  ' }),
      okInsert
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'brand-1',
      // Trimmed on the way in and echoed as stored, so the brand sees the value
      // the database actually holds.
      company_name: 'Habesha Coffee',
    });
  });

  it('returns 409 PROFILE_EXISTS on a second profile for one account (AC-2)', async () => {
    const response = await handleCreateBrand(
      postRequest({ companyName: 'Habesha Coffee' }),
      {
        insert: async () => {
          throw uniqueViolation(USER_CONSTRAINT);
        },
      }
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.PROFILE_EXISTS);
    expect(body.error.message).toBe('You already have a profile.');
    expect(body.error.message).toBe(ErrorMessage[ErrorCode.PROFILE_EXISTS]);
    // No field to attach it to — this is about the account, not the input.
    expect(body.error.details).toBeUndefined();
  });

  it('reuses the creator side’s code rather than inventing a second one', () => {
    // Two codes for "one account, one profile" would mean two strings to keep
    // in step with the same rule.
    expect(ErrorCode.PROFILE_EXISTS).toBe('PROFILE_EXISTS');
  });

  it('returns 422 VALIDATION_ERROR with field details on an empty name', async () => {
    const response = await handleCreateBrand(
      postRequest({ companyName: '   ' }),
      okInsert
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.error.details.companyName).toEqual([
      'Company name is required.',
    ]);
  });

  it('returns 422 on a malformed JSON body', async () => {
    const response = await handleCreateBrand(
      postRequest(null, '{not json'),
      okInsert
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: ErrorCode.VALIDATION_ERROR },
    });
  });

  it('returns 403 when the guard denies, and never reaches the insert', async () => {
    guardMock.mockRejectedValue(
      new ForbiddenError('role creator not permitted')
    );
    const insert = vi.fn();

    const response = await handleCreateBrand(
      postRequest({ companyName: 'Habesha Coffee' }),
      { insert }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: ErrorCode.FORBIDDEN },
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it('authorizes before parsing, so an invalid body still 403s', async () => {
    // Otherwise the validation response is an oracle: an unauthorized caller
    // could map the accepted payload shape by watching which fields it names.
    guardMock.mockRejectedValue(new ForbiddenError('no session'));

    const response = await handleCreateBrand(
      postRequest({ garbage: true }),
      okInsert
    );

    expect(response.status).toBe(403);
  });

  it('gates on the brand role only', async () => {
    await handleCreateBrand(
      postRequest({ companyName: 'Habesha Coffee' }),
      okInsert
    );
    expect(guardMock).toHaveBeenCalledWith({ roles: ['brand'] });
  });

  it('ignores a userId supplied in the body', async () => {
    // Account takeover if honoured. The schema does not declare the field, so
    // it is stripped, and the owner comes from the session.
    const insert = vi
      .fn()
      .mockResolvedValue({ id: 'brand-1', companyName: 'Habesha Coffee' });

    await handleCreateBrand(
      postRequest({ companyName: 'Habesha Coffee', userId: 'someone-else' }),
      { insert }
    );

    expect(insert.mock.calls[0][0].userId).toBe(BRAND_USER_ID);
  });

  it('re-throws a non-Forbidden error instead of flattening it to 403', async () => {
    guardMock.mockRejectedValue(new Error('database down'));
    await expect(
      handleCreateBrand(postRequest({ companyName: 'X' }), okInsert)
    ).rejects.toThrow('database down');
  });
});

// -- The edit (AC-5) ---------------------------------------------------------

describe('updateBrandProfile', () => {
  function deps(update: UpdateBrandProfileDeps['update']) {
    return { update };
  }

  const input = updateBrandSchema.parse({ companyName: 'Renamed Roasters' });

  it('returns the updated row', async () => {
    const update = vi.fn().mockResolvedValue({
      id: BRAND_PROFILE_ID,
      companyName: 'Renamed Roasters',
    });

    await expect(
      updateBrandProfile(BRAND_PROFILE_ID, BRAND_USER_ID, input, deps(update))
    ).resolves.toEqual({
      ok: true,
      profile: { id: BRAND_PROFILE_ID, companyName: 'Renamed Roasters' },
    });
  });

  it('scopes the write by owner as well as by id', async () => {
    // A second lock behind the guard: no caller of this function can write
    // across accounts, even one that forgot to guard.
    const update = vi.fn().mockResolvedValue({
      id: BRAND_PROFILE_ID,
      companyName: 'Renamed Roasters',
    });

    await updateBrandProfile(
      BRAND_PROFILE_ID,
      BRAND_USER_ID,
      input,
      deps(update)
    );

    expect(update.mock.calls[0][0]).toEqual({
      id: BRAND_PROFILE_ID,
      userId: BRAND_USER_ID,
      companyName: 'Renamed Roasters',
    });
  });

  it('reports a vanished row as not_found rather than throwing', async () => {
    const update = vi.fn().mockResolvedValue(null);
    await expect(
      updateBrandProfile(BRAND_PROFILE_ID, BRAND_USER_ID, input, deps(update))
    ).resolves.toEqual({ ok: false, reason: 'not_found' });
  });

  it('never writes user_id or id', () => {
    // Renaming must not be able to change who owns the row.
    const source = readSource('../lib/brands/update-profile.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const set = source.match(/\.set\(\{([^}]*)\}\)/);
    expect(set, 'expected a .set({ ... }) call').not.toBeNull();
    expect(set![1]).toContain('companyName');
    expect(set![1]).not.toContain('userId');
    expect(set![1]).not.toContain('id:');
  });
});

describe('PATCH /api/brands/{id}', () => {
  const okUpdate: UpdateBrandProfileDeps = {
    update: async ({ id, companyName }) => ({ id, companyName }),
  };

  it('returns 200 with the renamed profile (AC-5)', async () => {
    const response = await handleUpdateBrand(
      patchRequest({ companyName: '  Renamed Roasters  ' }),
      BRAND_PROFILE_ID,
      okUpdate
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: BRAND_PROFILE_ID,
      company_name: 'Renamed Roasters',
    });
  });

  it('checks ownership, not just the role (invariant 2)', async () => {
    await handleUpdateBrand(
      patchRequest({ companyName: 'Renamed Roasters' }),
      BRAND_PROFILE_ID,
      okUpdate
    );

    expect(guardMock).toHaveBeenCalledWith({
      roles: ['brand'],
      resource: { kind: 'brandProfile', id: BRAND_PROFILE_ID },
    });
  });

  it('returns 403 for a profile the caller does not own, without updating', async () => {
    guardMock.mockRejectedValue(
      new ForbiddenError('does not own brandProfile')
    );
    const update = vi.fn();

    const response = await handleUpdateBrand(
      patchRequest({ companyName: 'Renamed Roasters' }),
      '9c2d1e4b-5a6f-4c8d-9e0a-1b2c3d4e5f60',
      { update }
    );

    expect(response.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['not-a-uuid', 'plain text'],
    ['', 'empty'],
    ["' OR 1=1--", 'sql-ish'],
    ['3f1a6c9e-1c2b-4f6d-9a1e-2b7c8d9e0f1', 'one character short'],
  ])('denies a malformed id (%s, %s) before any query', async (id) => {
    // `brand_profile.id` is a uuid column: an unfiltered non-uuid comparison is
    // a Postgres 22P02, i.e. a 500 for a request that is merely malformed. It
    // denies exactly like a foreign id so the endpoint is not an existence
    // oracle either.
    const update = vi.fn();

    const response = await handleUpdateBrand(
      patchRequest({ companyName: 'Renamed Roasters' }),
      id,
      { update }
    );

    expect(response.status).toBe(403);
    expect(guardMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts an uppercase uuid', async () => {
    const response = await handleUpdateBrand(
      patchRequest({ companyName: 'Renamed Roasters' }),
      BRAND_PROFILE_ID.toUpperCase(),
      okUpdate
    );

    expect(response.status).toBe(200);
  });

  it('returns 422 with field details on an empty name', async () => {
    const response = await handleUpdateBrand(
      patchRequest({ companyName: '' }),
      BRAND_PROFILE_ID,
      okUpdate
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.error.details.companyName).toEqual([
      'Company name is required.',
    ]);
  });

  it('returns 422 on a malformed JSON body', async () => {
    const response = await handleUpdateBrand(
      patchRequest(null, '{not json'),
      BRAND_PROFILE_ID,
      okUpdate
    );

    expect(response.status).toBe(422);
  });

  it('authorizes before parsing', async () => {
    guardMock.mockRejectedValue(new ForbiddenError('no session'));

    const response = await handleUpdateBrand(
      patchRequest({ garbage: true }),
      BRAND_PROFILE_ID,
      okUpdate
    );

    expect(response.status).toBe(403);
  });

  it('returns 403, not 404, when the row vanished after the guard', async () => {
    // Keeping "deleted" and "not yours" indistinguishable from outside.
    const response = await handleUpdateBrand(
      patchRequest({ companyName: 'Renamed Roasters' }),
      BRAND_PROFILE_ID,
      { update: async () => null }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: ErrorCode.FORBIDDEN },
    });
  });

  it('re-throws a non-Forbidden error instead of flattening it to 403', async () => {
    guardMock.mockRejectedValue(new Error('database down'));
    await expect(
      handleUpdateBrand(
        patchRequest({ companyName: 'X' }),
        BRAND_PROFILE_ID,
        okUpdate
      )
    ).rejects.toThrow('database down');
  });
});

// -- AC-1 and AC-4: the gate is a layout, not a per-page habit ---------------

describe('a brand with no profile is redirected to onboarding', () => {
  const layout = readSource('../app/(brand)/(onboarded)/layout.tsx');

  it('redirects to onboarding when the profile read comes back empty', () => {
    expect(layout).toMatch(
      /if\s*\(!profile\)\s*redirect\('\/brand\/onboarding'\)/
    );
  });

  it('reads the profile from the session user, not from a parameter', () => {
    expect(layout).toContain('getBrandProfileByUserId(user.id)');
  });

  it('keeps the role gate as well as the profile gate', () => {
    // The profile check is an addition to `requireRole`, not a replacement:
    // dropping the role gate would let a creator into brand routes as soon as
    // they had any profile row.
    expect(layout).toContain("requireRole('brand')");
  });

  /**
   * AC-4 says "rather than shown a broken campaign screen". The campaign
   * screens are KAN-29/KAN-30 and do not exist yet, so the criterion is about
   * routes nobody has written. A per-page redirect is a rule each of them has
   * to remember; a layout is one they cannot opt out of.
   */
  it('puts the gate in a layout so future brand routes inherit it', () => {
    expect(layout).toMatch(/export default async function \w+Layout/);
  });

  it('leaves the onboarding page outside the gated group, so it cannot loop', () => {
    // Same directory would mean the gate redirected to a route it also gates.
    const onboarding = readSource('../app/(brand)/brand/onboarding/page.tsx');
    expect(onboarding).toContain("redirect('/brand')");
    expect(onboarding).toContain("requireRole('brand')");
  });
});

// -- AC-3: the name is available on every offer ------------------------------

/**
 * "The company name appears on every deal offer the creator sees."
 *
 * Deal offers are Wave 6+ (KAN-31 onward) and do not exist, so this is asserted
 * where it is actually decided — in the data, not in a component. Every deal
 * hangs off a campaign, every campaign off a `brand_profile`, and
 * `company_name` is `not null` and validated non-empty above. Together those
 * make the name reachable and non-blank for any offer that can exist, which is
 * the part of AC-3 this ticket can hold. Rendering it is the offer ticket's
 * job, and this test is what tells that ticket the name is already there.
 */
describe('every deal offer can reach a non-empty company name', () => {
  const schema = readSource('../db/schema.ts');

  it('links deal -> campaign -> brand_profile', () => {
    expect(schema).toMatch(
      /campaignId:[\s\S]*?references\(\(\) => campaign\.id\)/
    );
    expect(schema).toMatch(
      /brandId:[\s\S]*?references\(\(\) => brandProfile\.id\)/
    );
  });

  it('requires a company name at the column level', () => {
    expect(schema).toMatch(/companyName: text\('company_name'\)\.notNull\(\)/);
  });

  it('cannot be satisfied by a blank name', () => {
    // `not null` alone would accept '' and ' ', which render as nothing on an
    // offer. The schema is the half that closes that.
    expect(createBrandSchema.safeParse({ companyName: '' }).success).toBe(
      false
    );
    expect(createBrandSchema.safeParse({ companyName: ' ' }).success).toBe(
      false
    );
    expect(updateBrandSchema.safeParse({ companyName: ' ' }).success).toBe(
      false
    );
  });
});

// -- Shared form error resolution -------------------------------------------

describe('fieldErrorsAt', () => {
  it('returns undefined when nothing matches, so it doubles as an is-invalid test', () => {
    expect(fieldErrorsAt({}, 'companyName')).toBeUndefined();
    expect(fieldErrorsAt({ other: ['nope'] }, 'companyName')).toBeUndefined();
  });

  it('returns messages in the shape <FieldError> renders', () => {
    expect(
      fieldErrorsAt({ companyName: ['Required.'] }, 'companyName')
    ).toEqual([{ message: 'Required.' }]);
  });

  it('matches nested paths, which is the whole reason it is not a lookup', () => {
    // zod reports a bad array member at `audience.topCountries.0` while the
    // input is named `audience.topCountries`.
    expect(
      fieldErrorsAt(
        { 'audience.topCountries.0': ['Invalid market.'] },
        'audience.topCountries'
      )
    ).toEqual([{ message: 'Invalid market.' }]);
  });

  it('does not match a sibling field with a shared prefix', () => {
    // The dot is required, so `companyNameLegacy` errors stay off `companyName`.
    expect(
      fieldErrorsAt({ companyNameLegacy: ['Nope.'] }, 'companyName')
    ).toBeUndefined();
  });

  it('collects messages from several matching paths', () => {
    expect(
      fieldErrorsAt({ 'a.b': ['one'], 'a.c': ['two'], a: ['zero'] }, 'a')?.map(
        (e) => e.message
      )
    ).toEqual(['one', 'two', 'zero']);
  });
});
