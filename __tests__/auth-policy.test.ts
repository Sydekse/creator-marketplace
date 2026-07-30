import { describe, expect, it } from 'vitest';
import {
  RoleNotSelfAssignableError,
  SELF_REGISTERABLE_ROLES,
  USER_ROLES,
  assertSelfRegisterableRole,
  isSelfRegisterableRole,
  isUserRole,
} from '@/lib/auth-policy';
import { roleHomePath, safeRedirectPath } from '@/lib/navigation';

/**
 * These cover the server-side half of the role rule (FR-001, NFR-005). The Zod
 * schema in `auth.test.ts` guards the form; this guards the request, which is
 * the layer an attacker actually reaches.
 */

describe('isUserRole', () => {
  it.each(USER_ROLES)('accepts the %s role', (role) => {
    expect(isUserRole(role)).toBe(true);
  });

  it.each([
    'Admin',
    'ADMIN',
    'superuser',
    '',
    ' creator',
    'creator ',
    null,
    undefined,
    42,
    {},
    ['admin'],
  ])('rejects %o', (value) => {
    expect(isUserRole(value)).toBe(false);
  });
});

describe('isSelfRegisterableRole', () => {
  it.each(SELF_REGISTERABLE_ROLES)('accepts %s', (role) => {
    expect(isSelfRegisterableRole(role)).toBe(true);
  });

  it('rejects admin', () => {
    expect(isSelfRegisterableRole('admin')).toBe(false);
  });
});

describe('assertSelfRegisterableRole', () => {
  it.each(SELF_REGISTERABLE_ROLES)('returns %s unchanged', (role) => {
    expect(assertSelfRegisterableRole(role)).toBe(role);
  });

  it('throws on a self-assigned admin role', () => {
    expect(() => assertSelfRegisterableRole('admin')).toThrow(
      RoleNotSelfAssignableError
    );
  });

  // The original guard compared against the literal 'admin', so every one of
  // these would have been written to the database unchallenged.
  it.each(['Admin', 'ADMIN', 'aDmIn', 'superuser', '', null, undefined, 1])(
    'throws on %o rather than storing it',
    (value) => {
      expect(() => assertSelfRegisterableRole(value)).toThrow(
        RoleNotSelfAssignableError
      );
    }
  );

  it('carries the rejected value for logging without leaking a message', () => {
    try {
      assertSelfRegisterableRole('admin');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RoleNotSelfAssignableError);
      expect((error as RoleNotSelfAssignableError).received).toBe('admin');
    }
  });
});

describe('roleHomePath', () => {
  it.each([
    ['brand', '/brand'],
    ['creator', '/creator'],
    ['admin', '/admin'],
  ] as const)('sends %s to %s', (role, expected) => {
    expect(roleHomePath(role)).toBe(expected);
  });

  it('gives every role a distinct landing route', () => {
    const paths = USER_ROLES.map(roleHomePath);
    expect(new Set(paths).size).toBe(USER_ROLES.length);
  });
});

describe('safeRedirectPath', () => {
  it.each(['/brand', '/admin/verification', '/deals?status=pending'])(
    'allows the same-origin path %s',
    (value) => {
      expect(safeRedirectPath(value)).toBe(value);
    }
  );

  it.each([
    '//evil.example',
    'https://evil.example',
    'http://evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'brand',
    '',
    null,
    undefined,
    123,
  ])('refuses %o', (value) => {
    expect(safeRedirectPath(value)).toBeNull();
  });
});
