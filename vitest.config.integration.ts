import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// KAN-59 — integration tests against a real Postgres. Run with
// `npm run test:integration`; they require DATABASE_URL (the global setup
// refuses to run without one) and migrate + seed the database first.
//
// Kept as a separate config so the unit suite stays DB-free: nothing here
// leaks into `vitest run`, and nothing in the unit config pulls `pg` into a
// run that does not need it.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    restoreMocks: true,
    // The suite is sequential and shares one migrated+seeded database; the
    // money tests mutate rows, so files must not race each other.
    fileParallelism: false,
    pool: 'forks',
  },
});
