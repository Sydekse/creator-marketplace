import { expect, test } from '@playwright/test';
import { DEMO, signIn } from './helpers';

/**
 * KAN-60 flow 6 — admin dispute resolution (AC-030, AC-031). The refund path
 * returns the funds and writes the audit log.
 *
 * The seeded 'Fitness January' campaign is flagged and delivered with money
 * held — exactly the worklist's flagged-or-refundable union. The admin walks
 * the real UI: /admin/worklist → Resolve dispute → refund + note → the row
 * leaves the worklist (the flag is cleared by resolution and `refunded` is not
 * refundable). The audit row and the ledger entry are asserted by the
 * integration suite's dispute test (tests/integration/dispute.test.ts); this
 * spec proves the UI path an admin actually uses.
 */
test('flow 6: an admin refunds a disputed deal from the worklist (AC-030)', async ({
  browser,
}) => {
  const admin = await browser.newPage();
  await signIn(admin, DEMO.admin);

  // The worklist shows the flagged deal with money held.
  await admin.goto('/admin/worklist');
  const row = admin.locator('li').filter({ hasText: 'Fitness January' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText(/Flagged/i)).toBeVisible();
  await expect(row.getByText(/delivered/i)).toBeVisible();

  // KAN-78 deal drill-down: the row links to the append-only event trail,
  // which the resolution is about to extend, carrying the campaign name for
  // context (F2). Asserted *before* the refund so the drill-down works however
  // the specs order themselves.
  await row.getByRole('link', { name: 'View deal history' }).click();
  await expect(admin.getByRole('heading', { name: 'Deal history' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(admin.getByText(/Campaign: Fitness January/i)).toBeVisible();
  await expect(admin.getByText('Delivered')).toBeVisible();
  await admin.goBack();
  await expect(row).toBeVisible();

  // Resolve: refund the brand, with the required audit note.
  await row.getByRole('button', { name: 'Resolve dispute' }).click();
  await row.getByLabel('Resolution').selectOption('refund');
  await row
    .getByLabel('Resolution note')
    .fill('Brand and creator agreed to cancel (e2e).');
  await row.getByRole('button', { name: 'Confirm resolution' }).click();

  // The success toast confirms the resolution landed.
  await expect(admin.getByText(/resolved/i).first()).toBeVisible({
    timeout: 15_000,
  });

  // And the row leaves the worklist — refunded is not refundable, and the
  // resolution cleared the flag, so the union no longer contains it.
  await expect(row).toHaveCount(0, { timeout: 15_000 });
  await admin.close();
});
