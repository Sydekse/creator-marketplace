import { defineConfig, devices } from '@playwright/test';

/**
 * KAN-60 — end-to-end suite over the seven critical flows (Tech Spec §9),
 * running against a real database and the real seeded data (KAN-20).
 *
 * Browser matrix (NFR-007): Chrome is `chromium`, Safari is `webkit` — the two
 * engines the PRD names — each at a desktop and a mobile viewport.
 *
 * The webServer boots the *built* app with `DATABASE_URL` (CI provisions a
 * fresh Postgres per run) and the console email provider (no `EMAIL_SEND`,
 * so nothing mails a real inbox). A second server on :3002 runs with
 * `PAYMENT_FAIL_METHOD=hold` — the one e2e flow (payment failure, AC-020)
 * that needs the provider to fail on demand.
 *
 * Neither server builds: `npm run build` must have run first (CI does it
 * explicitly before this step). Two webServers building concurrently would
 * race each other on the shared `.next` directory.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run start',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        // Better Auth needs an explicit base URL: without it the production
        // server derives the origin per request and sign-in redirects and
        // cookies break (the "Base URL is not set" warning). `.env.local`
        // supplies this locally; CI has no `.env.local`, so it must be set
        // here — per server, so each signs in against its own origin.
        BETTER_AUTH_URL: 'http://localhost:3000',
        // The payment provider stays the in-memory mock; email stays console.
        EMAIL_SEND: '',
        // E2E only: serial sign-ins are faster than the production rate limit
        // (3 per 10s per IP) allows, so the suite turns throttling off.
        E2E_DISABLE_RATE_LIMIT: '1',
      },
    },
    {
      command: 'npm run start -- -p 3002',
      url: 'http://localhost:3002',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        BETTER_AUTH_URL: 'http://localhost:3002',
        EMAIL_SEND: '',
        E2E_DISABLE_RATE_LIMIT: '1',
        // Flow 5: the first funding hold of this server fails, so the UI can
        // walk the AC-020 path (campaign stays unfunded) for real.
        PAYMENT_FAIL_METHOD: 'hold',
      },
    },
  ],
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'webkit-desktop',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
