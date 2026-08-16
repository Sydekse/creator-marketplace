import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mirrors the `@/*` path alias from tsconfig.json so tests can import modules
// the same way application code does.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    // Spies are restored after every test, so a failing assertion can never
    // leave a mock (e.g. a silenced `console.error`) leaking into the rest of
    // the file — the run that matters is the one where something failed.
    restoreMocks: true,

    // KAN-59's integration suite needs a real Postgres and runs under its own
    // config (`test:integration`) with its own global setup. The plain unit
    // run stays hermetic and DB-free, so it must not collect those files.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      'tests/integration/**',
    ],
  },
});
