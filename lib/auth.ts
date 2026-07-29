import type { UserRole } from '@/db/schema';

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

/**
 * Returns the currently authenticated user, or `null` if unauthenticated.
 *
 * Until KAN-16 wires Better Auth, this always returns `null` — every protected
 * route redirects to sign-in. Once auth lands, replace the body with the real
 * session lookup (server-side cookie → session → user).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  return null;
}
