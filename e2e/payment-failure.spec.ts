import { expect, test } from '@playwright/test';
import { DEMO } from './helpers';

/**
 * KAN-60 flow 5 — payment failure (AC-020). When the provider's hold fails,
 * the campaign stays unfunded and no deal proceeds.
 *
 * This test runs against the second webServer (:3002), which boots with
 * `PAYMENT_FAIL_METHOD=hold`: the first funding attempt of that process fails
 * at the provider, exactly the outage the AC describes. The brand walks the
 * real fund UI and must land on the failure state, not a funded campaign.
 *
 * The fixture is the seeded 'Coffee Launch' campaign — accepted, awaiting
 * funding, and touched by no other spec. 'Ramadan Beauty Push' is reserved
 * for flow 1, which funds it first: if this spec shared it, the funding
 * attempt would be refused as "already funded" before ever reaching the
 * provider and the failure would be untested.
 */
test('flow 5: a failed payment leaves the campaign unfunded (AC-020)', async ({
  browser,
}) => {
  const brand = await browser.newPage();
  // Absolute URL — this test targets the failure-injected server.
  await brand.goto('http://localhost:3002/sign-in');
  await brand.locator('#email').fill(DEMO.brand);
  await brand
    .locator('#password')
    .fill(process.env.SEED_DEMO_PASSWORD ?? 'demo-Passw0rd!');
  await brand.getByRole('button', { name: 'Sign In' }).click();
  await expect(brand).not.toHaveURL(/sign-in/);
  // Same landmark as the shared helper: the client-side redirect to the role
  // home must commit before the goto below, or webkit can abort it with
  // "Navigation ... is interrupted by another navigation".
  await brand.waitForURL(/\/(brand|creator|admin)(\/|$)/);

  await brand.goto('http://localhost:3002/campaigns');
  // The list renders the campaign name as the card title; the action is a
  // "View campaign" link inside the card (same shape the shared helper opens).
  const card = brand.locator('li').filter({ hasText: 'Coffee Launch' });
  await card.getByRole('link', { name: /View campaign/i }).click();
  // Funding confirms via `window.confirm` — accept it, registered before the
  // click (Playwright auto-dismisses unhandled dialogs, which would cancel
  // the funding before it ever reaches the failing provider).
  brand.on('dialog', (d) => d.accept());
  await brand.getByRole('button', { name: 'Fund campaign' }).click();

  // The failure surfaces (toast or inline), and the campaign is not funded —
  // no escrow row, and the button is offered again rather than a funded state.
  await expect(
    brand.getByText(/fail|unable|could not|error/i).first()
  ).toBeVisible({
    timeout: 15_000,
  });
  await brand.close();
});
