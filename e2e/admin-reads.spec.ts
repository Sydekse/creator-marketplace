import { expect, test } from '@playwright/test';
import { DEMO, signIn } from './helpers';

/**
 * KAN-78 — admin read surfaces over the KAN-53 layer: the campaign list and
 * the per-campaign ledger with its reconciliation verdict.
 *
 * Everything here is read-only and builds on 'Holiday Fashion', the seeded
 * *completed* campaign — no e2e flow ever mutates it (flows 1/4/6 touch
 * Ramadan, Tech Review and Fitness), so these assertions hold regardless of
 * which spec ran first. Its ledger is the completed shape: a hold, then a
 * release_payout and a commission that sum to the budget, and the running
 * balance therefore reconciles.
 */
test('KAN-78: the campaign list shows every campaign with its ledger position', async ({
  browser,
}) => {
  const admin = await browser.newPage();
  await signIn(admin, DEMO.admin);

  await admin.goto('/admin/campaigns');
  await expect(admin.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
  await expect(
    admin.getByRole('link', { name: 'Holiday Fashion' })
  ).toBeVisible();
  await expect(
    admin.getByRole('link', { name: 'Ramadan Beauty Push' })
  ).toBeVisible();
  // A funded campaign shows money held; the completed one shows paid out.
  await expect(admin.getByText('Paid out')).toBeVisible();
  await admin.close();
});

test('KAN-78: a campaign ledger lists entries and reconciles', async ({
  browser,
}) => {
  const admin = await browser.newPage();
  await signIn(admin, DEMO.admin);

  await admin.goto('/admin/campaigns');
  await admin.getByRole('link', { name: 'Holiday Fashion' }).click();

  // The completed deal's ledger: hold in, then payout + commission out.
  await expect(admin.getByText('Reconciled')).toBeVisible({ timeout: 15_000 });
  await expect(admin.locator('tbody')).toContainText('hold');
  await expect(admin.locator('tbody')).toContainText('release_payout');
  await expect(admin.locator('tbody')).toContainText('commission');

  // The totals cards render the money that left escrow. The heading role
  // disambiguates from the ledger row below, whose commission cell also
  // contains the word — getByText would resolve to both (strict mode
  // violation).
  await expect(admin.getByRole('heading', { name: 'Paid out' })).toBeVisible();
  await expect(
    admin.getByRole('heading', { name: 'Commission' })
  ).toBeVisible();
  await admin.close();
});
