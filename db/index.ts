import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { normalizeDatabaseUrl } from './connection-string';

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
    connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL),
    // Neon's pooled endpoint fronts the real connection limit, but serverless
    // functions scale horizontally — keep each instance's slice small.
    max: 5,
    // Neon closes connections idle for ~5 minutes on its side, and `pg`
    // discovers that only by handing the dead socket to the next query
    // ("Connection terminated unexpectedly" on a session lookup). Retire idle
    // clients well before Neon does so the pool never serves a corpse.
    idleTimeoutMillis: 30_000,
    // And never hang a request forever on a connection that will not come
    // up. Generous because a suspended Neon compute takes several seconds
    // to wake — a timeout shorter than the cold start turns every first
    // query after idle into a 500.
    connectionTimeoutMillis: 20_000,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__dbPool = pool;
}

// `pg` opens no socket until the first query, so importing this module during
// `next build` — where CI has no DATABASE_URL — is safe.
export const db = drizzle(pool, { schema });
