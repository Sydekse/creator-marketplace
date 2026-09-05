import { expect, type Page } from '@playwright/test';

/**
 * KAN-60 helpers — deterministic seeded data only (AC-9). Every test signs in
 * as one of the KAN-20 demo accounts, whose state the seed fully controls.
 */

export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'demo-Passw0rd!';

export const DEMO = {
  admin: 'admin@demo.com',
  brand: 'brand@demo.com',
  creator: 'creator@demo.com',
  creatorBeauty: 'creator.beauty@demo.com',
} as const;

/**
 * Sign in as a demo user on a fresh page context. Each test gets its own
 * context, so roles never leak between steps: the creator's session cannot
 * see the brand's pages.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  // Landing on a role home is the sign-in succeeding. Auth does several DB
  // round trips; against a remote database (local runs on Neon) that can
  // outlive the 5s default, so give it the same budget as other steps.
  await expect(page).not.toHaveURL(/sign-in/, { timeout: 15_000 });
  // The sign-in flow router.push()es to /dashboard, which server-redirects to
  // the role home — a client-side navigation. Wait for that redirect to commit
  // before the caller navigates again: webkit aborts a page.goto that races
  // the in-flight redirect with "Navigation ... is interrupted by another
  // navigation", and networkidle is a poor landmark here — it can stall
  // forever against a Next.js app, burning the full 120 s timeout (chromium
  // never reached it in CI). The role-home URL is the observable state change
  // the redirect produces.
  await page.waitForURL(/\/(brand|creator|admin)(\/|$)/);
}

/**
 * Wait for a just-navigated page's content to actually stream in, reloading
 * once if it never does.
 *
 * Clicking a link at automation speed — milliseconds after load, while
 * hydration and the router's prefetches are still in flight — can land on a
 * page whose banner renders but whose `main` stays empty: the RSC response
 * arrives (200 in the trace) and is never painted. Seen on the audit-log
 * step of flow 6 in CI and on a creator deal page locally, both only in
 * production mode and never on a reload of the same URL. Same family as
 * `openConfirmDialog`'s not-yet-hydrated click: unobservable from outside,
 * so check, reload, check again.
 */
export async function settledMain(page: Page): Promise<void> {
  await expect(async () => {
    const children = await page.evaluate(
      () => document.querySelector('main')?.childElementCount ?? 0
    );
    if (children === 0) {
      await page.reload();
    }
    expect(
      await page.evaluate(
        () => document.querySelector('main')?.childElementCount ?? 0
      )
    ).toBeGreaterThan(0);
  }).toPass({ timeout: 30_000 });
}

/** Open the creator's deal detail page by campaign name. */
export async function openCreatorDeal(page: Page, campaignName: string) {
  await page.goto('/creator/deals');
  await page
    .getByRole('link', { name: new RegExp(campaignName) })
    .first()
    .click();
  await page.waitForURL(/\/creator\/deals\/[0-9a-f-]+/);
  await settledMain(page);
}

/**
 * Open the shared ConfirmDialog by clicking its trigger button.
 *
 * The trigger is a client component: on the slow mobile runners the first
 * click can land before hydration attaches the onClick, and nothing opens
 * (flow 5's failure snapshot shows exactly that — the button focused,
 * no dialog). Clicking a not-yet-hydrated button is unobservable from the
 * outside, so retry: click, give the dialog a beat, click again if needed.
 */
export async function openConfirmDialog(
  page: Page,
  buttonName: string
): Promise<void> {
  await expect(async () => {
    if (!(await page.getByRole('dialog').isVisible())) {
      await page.getByRole('button', { name: buttonName }).first().click();
    }
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * Run `act` (a click that fires a client-side mutation) and require the
 * matching response to arrive ok before the caller moves on.
 *
 * Every mutating step in these flows is a client `fetch` — accept, fund,
 * deliver, approve (POST), metrics (PUT) — followed by `router.refresh()`.
 * Two traps: closing the page right after the click aborts the in-flight
 * request, and any "did it work" assertion that can be satisfied by
 * pre-existing copy (the fund dialog's own prompt contains "escrow") passes
 * before the money moved. Waiting on the response pins each step to the
 * thing that actually matters.
 */
export async function expectMutationOk(
  page: Page,
  pathSuffix: string,
  act: () => Promise<void>,
  method: 'POST' | 'PUT' = 'POST'
): Promise<void> {
  const responded = page.waitForResponse(
    (response) =>
      response.url().includes(pathSuffix) &&
      response.request().method() === method
  );
  await act();
  expect((await responded).ok(), `${method} ${pathSuffix} must succeed`).toBe(
    true
  );
}

/**
 * Submit a live TikTok URL on the creator deal page and wait until the
 * server-rendered progress copy ("N of M videos submitted") reflects it.
 *
 * Two races live here, and chromium-mobile in CI lost both (flow 1 on the
 * main run 33079554962 and again on #121):
 *
 * 1. The click returns before the POST commits — the form's handler fetches
 *    `/deliverable` asynchronously. Asserting straight after the click races
 *    the request itself, so wait for the response and require it ok.
 * 2. The copy is server-rendered and only swaps in after the form's
 *    `router.refresh()`. On the mobile-chromium runner that refresh can
 *    outlive a fixed expect window even though the POST has long committed.
 *    A reload re-reads the same server truth without trusting the refresh,
 *    so poll: check, reload, check again.
 */
export async function submitVideo(
  page: Page,
  videoUrl: string,
  progressCopy: string
): Promise<void> {
  await page.locator('#tiktokUrl').fill(videoUrl);
  await expectMutationOk(page, '/deliverable', () =>
    page.getByRole('button', { name: 'Submit your video' }).click()
  );
  await expect(async () => {
    if (!(await page.getByText(progressCopy).isVisible())) {
      await page.reload();
    }
    await expect(page.getByText(progressCopy)).toBeVisible({
      timeout: 4_000,
    });
  }).toPass({ timeout: 45_000 });
}

/**
 * Fill a set of controlled inputs and require the values to survive
 * hydration.
 *
 * The campaign brief's fields are `useState`-controlled: a fill that lands
 * before React hydrates is silently wiped when the component mounts and
 * re-asserts its empty state. Flow 2 lost exactly the first field this way on
 * webkit-desktop (three runs in a row on #142 — the failure screenshot shows
 * "Campaign name is required" with every later field intact, i.e. hydration
 * finished between the first fill and the second). Same family as
 * `openConfirmDialog`'s not-yet-hydrated click: unobservable from outside,
 * so fill, give the mount a beat to wipe it, and re-check until it sticks.
 */
export async function fillHydrated(
  page: Page,
  fields: ReadonlyArray<readonly [selector: string, value: string]>
): Promise<void> {
  await expect(async () => {
    for (const [selector, value] of fields) {
      const field = page.locator(selector);
      if ((await field.inputValue()) !== value) {
        await field.fill(value);
      }
    }
    await page.waitForTimeout(300);
    for (const [selector, value] of fields) {
      await expect(page.locator(selector)).toHaveValue(value, {
        timeout: 1_000,
      });
    }
  }).toPass({ timeout: 30_000 });
}

/** Open the brand's campaign page by name. */
export async function openCampaign(page: Page, campaignName: string) {
  await page.goto('/campaigns');
  // Live campaigns render as whole-card links and closed ones as ledger
  // rows — both carry an "Open {name}" accessible name. Drafts offer
  // "Edit brief" instead, inside the row that names the campaign.
  const open = page.getByRole('link', { name: `Open ${campaignName}` });
  if ((await open.count()) > 0) {
    await open.first().click();
  } else {
    await page
      .locator('.bd-caprow')
      .filter({ hasText: campaignName })
      .getByRole('link', { name: /Edit brief/i })
      .click();
  }
  await page.waitForURL(/\/campaigns\/[0-9a-f-]+/);
  await settledMain(page);
}
