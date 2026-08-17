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
  // Landing on a role home is the sign-in succeeding.
  await expect(page).not.toHaveURL(/sign-in/);
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

/** Open the creator's deal detail page by campaign name. */
export async function openCreatorDeal(page: Page, campaignName: string) {
  await page.goto('/creator/deals');
  await page
    .getByRole('link', { name: new RegExp(campaignName) })
    .first()
    .click();
}

/** Open the brand's campaign page by name. */
export async function openCampaign(page: Page, campaignName: string) {
  await page.goto('/campaigns');
  // The list renders the campaign name as the card title and the action as a
  // "View campaign" / "Edit brief" link — the name itself is not a link. So
  // the card is found by its text and the action link inside it is clicked.
  const card = page.locator('li').filter({ hasText: campaignName });
  await card.getByRole('link', { name: /View campaign|Edit brief/i }).click();
}
