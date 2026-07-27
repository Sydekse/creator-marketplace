import { sql } from 'drizzle-orm';
import { db } from '@/db';

// `pg` needs Node APIs; it cannot run on the edge runtime.
export const runtime = 'nodejs';

/**
 * Database connectivity probe (KAN-15 AC: "the app connects successfully from a
 * local dev server and from a Vercel preview deploy").
 *
 * Hit /api/health/db after deploying to confirm DATABASE_URL resolves and the
 * pool can reach Postgres.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    // No error detail in the response on purpose — driver errors embed the
    // connection string, including the password (NFR-010).
    return Response.json({ ok: false }, { status: 503 });
  }
}
