import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * AC2 — "every mutating Server Action and Route Handler calls the guard; there
 * is no mutation path that skips it." AC4 — an endpoint that declares no role
 * rejects everyone.
 *
 * Neither is provable by testing the endpoints that exist, because right now
 * none do. This walks the source tree instead and fails when a module exports a
 * mutating handler without routing through `lib/authz`.
 *
 * The point is Wave 4 onwards. The moment someone adds a POST to
 * `app/api/campaigns/route.ts` and forgets the guard, CI goes red naming the
 * file — rather than the omission surviving until an RBAC negative test in
 * Wave 15 happens to catch it.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Routes that legitimately have no guard.
 *
 * Kept as an explicit list rather than a pattern so that adding an exemption is
 * a visible line in a security test's diff and has to be argued for in review.
 */
const EXEMPT = new Set([
  // Better Auth's own catch-all. It *is* the authentication endpoint — sign-in
  // and sign-up must be reachable by callers who have no session yet. Role
  // self-assignment on this path is guarded separately, in the databaseHooks in
  // lib/auth.ts, and covered by __tests__/auth-policy.test.ts.
  'app/api/auth/[...all]/route.ts',
  // Unauthenticated liveness probe. Returns { ok: boolean } and touches no
  // business data — deliberately, so it can be curled from a preview deploy.
  'app/api/health/db/route.ts',
  // Vercel Cron trigger harness (KAN-56). Authenticated via shared CRON_SECRET
  // bearer token rather than a user session guard.
  'app/api/cron/route.ts',
]);

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });
}

interface Module {
  path: string;
  source: string;
}

/** Every module that can mutate: a route handler, or anything marked 'use server'. */
function mutatingModules(): Module[] {
  const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib'))];

  return files
    .map((full) => ({
      path: relative(ROOT, full).split('\\').join('/'),
      source: readFileSync(full, 'utf8'),
    }))
    .filter(({ source }) => {
      const isServerAction = /^\s*['"]use server['"]/m.test(source);
      const hasMutatingHandler = MUTATING_METHODS.some((method) =>
        new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(
          source
        )
      );
      return isServerAction || hasMutatingHandler;
    });
}

describe('every mutation routes through the guard', () => {
  const modules = mutatingModules().filter((m) => !EXEMPT.has(m.path));

  it('finds the source tree (guards against a silently empty scan)', () => {
    // If the walk broke, `modules` would be empty and every assertion below
    // would vacuously pass. Anchor on a file that certainly exists.
    const all = [...walk(join(ROOT, 'app'))].map((f) => relative(ROOT, f));
    expect(all).toContain(join('app', 'api', 'health', 'db', 'route.ts'));
  });

  it.each(modules.length > 0 ? modules : [{ path: '(none yet)', source: '' }])(
    '$path imports lib/authz',
    ({ path, source }) => {
      if (path === '(none yet)') return;
      expect(
        /from\s+['"](@\/lib\/authz|\.{1,2}\/.*authz)['"]/.test(source),
        `${path} exports a mutating handler but does not import the authorization guard. ` +
          `Every mutating Server Action and Route Handler must call guard() (NFR-005, AC2). ` +
          `If this module is genuinely exempt, add it to EXEMPT in this file with a reason.`
      ).toBe(true);
    }
  );

  it('keeps the exemption list honest', () => {
    // An exemption for a file that no longer exists is dead weight that would
    // silently cover a future file reusing the path.
    const existing = new Set(
      walk(join(ROOT, 'app')).map((f) =>
        relative(ROOT, f).split('\\').join('/')
      )
    );
    for (const path of EXEMPT) {
      expect(
        existing.has(path),
        `EXEMPT lists ${path}, which no longer exists`
      ).toBe(true);
    }
  });
});
