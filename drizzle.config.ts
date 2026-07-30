import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs outside the Next.js runtime, so `.env.local` is not loaded
// for us. `@next/env` applies the exact same file precedence Next.js uses.
loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: 'postgresql',
  // Two files, one migration history: business tables in `schema.ts`, the four
  // Better Auth tables in `auth-schema.ts`. Both must be listed or drizzle-kit
  // reads the absent one as a drop.
  schema: ['./db/schema.ts', './db/auth-schema.ts'],
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Neon manages its own Postgres roles. Without this, drizzle-kit treats them
  // as drift and tries to drop them.
  entities: {
    roles: { provider: 'neon' },
  },
  strict: true,
  verbose: true,
});
