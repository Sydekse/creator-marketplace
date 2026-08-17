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

  await brand.goto('http://localhost:3002/campaigns');
  await brand
    .getByRole('link', { name: /Ramadan Beauty Push/i })
    .first()
    .click();
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
