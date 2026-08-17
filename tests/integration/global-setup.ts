import { execSync } from 'node:child_process';

/**
 * KAN-59 AC-1/AC-7 — the integration suite runs against a real Postgres, not
 * an in-memory substitute. In CI that is an ephemeral database provisioned per
 * run (a `postgres:16` service container; pointing DATABASE_URL at a fresh
 * Neon branch works identically, since Neon is Postgres). Locally it is
 * whatever DATABASE_URL names — which must be a disposable test database: this
 * setup migrates and seeds it.
 *
 * Fails closed: no DATABASE_URL, no tests. A suite that silently ran against
 * fakes would be the very thing AC-1 exists to prevent.
 */
export default function setup(): void {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new Error(
      '[integration] DATABASE_URL is required. Point it at a disposable Postgres ' +
        '(CI provisions one per run) and re-run `npm run test:integration`.'
    );
  }

  // `drizzle-kit migrate` reads drizzle.config.ts, which loads .env.local via
  // @next/env — so the same database the tests will use gets the schema.
  execSync('npx drizzle-kit migrate', {
    stdio: 'inherit',
    env: process.env,
  });

  // The seed creates the demo users (through Better Auth, so they can sign in),
  // tiers, terms, and the full spread of deal states the tests build on.
  execSync('npx tsx db/seed.ts', {
    stdio: 'inherit',
    env: process.env,
  });
}
