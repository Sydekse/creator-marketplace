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

    // KAN-60's Playwright specs run under their own runner (`test:e2e`) and
    // need a built app plus browsers. The plain unit run must not collect
    // them — Playwright's `test()` throws outside its own runner.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      'e2e/**',
    ],
  },
});
