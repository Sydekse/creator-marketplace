import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// One connection pool per process.
//
// `next dev` re-evaluates modules on every hot reload, and each evaluation would
// otherwise construct a fresh Pool and leak the old one's sockets. Caching the
// pool on `globalThis` (which survives hot reload) keeps it to exactly one.
// Production builds evaluate once, so the cache is dev-only.
const globalForDb = globalThis as typeof globalThis & { __dbPool?: Pool };

const pool =
  globalForDb.__dbPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Neon's pooled endpoint fronts the real connection limit, but serverless
    // functions scale horizontally — keep each instance's slice small.
    max: 5,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__dbPool = pool;
}

// `pg` opens no socket until the first query, so importing this module during
// `next build` — where CI has no DATABASE_URL — is safe.
export const db = drizzle(pool, { schema });
