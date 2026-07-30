import type { UserRole } from '@/db/schema';

/**
 * Role policy, kept free of Better Auth and database imports so it can be
 * unit-tested directly and reused by any server guard.
 *
 * The rule this file exists to enforce: a visitor may self-register as a brand
 * or a creator. `admin` is assigned only by seed or by an existing admin, and
 * never by anything the client sends.
 *
 * FR-001 puts all three roles under one authentication system and NFR-005 makes
 * role enforcement server-side. Neither is satisfied by a form that omits the
 * admin option — the omission is cosmetic, so the allowlist below is applied
 * again on the server before the row is written.
 */

export const USER_ROLES = ['brand', 'creator', 'admin'] as const;

export const SELF_REGISTERABLE_ROLES = ['brand', 'creator'] as const;

export type SelfRegisterableRole = (typeof SELF_REGISTERABLE_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === 'string' &&
    (USER_ROLES as readonly string[]).includes(value)
  );
}

export function isSelfRegisterableRole(
  value: unknown
): value is SelfRegisterableRole {
  return (
    typeof value === 'string' &&
    (SELF_REGISTERABLE_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Allowlist, not a blocklist.
 *
 * Rejecting only the literal string 'admin' would let `Admin`, `ADMIN`, or an
 * entirely made-up role through and write a row that no longer satisfies the
 * `UserRole` union the rest of the codebase types against.
 */
export function assertSelfRegisterableRole(
  value: unknown
): SelfRegisterableRole {
  if (!isSelfRegisterableRole(value)) {
    throw new RoleNotSelfAssignableError(value);
  }
  return value;
}

export class RoleNotSelfAssignableError extends Error {
  readonly received: unknown;

  constructor(received: unknown) {
    super('Choose either the brand or the creator role to sign up.');
    this.name = 'RoleNotSelfAssignableError';
    this.received = received;
  }
}
