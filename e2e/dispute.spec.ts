import { expect, test } from '@playwright/test';
import {
  DEMO,
  openCampaign,
  openCreatorDeal,
  settledMain,
  signIn,
} from './helpers';

/**
 * KAN-60 flow 6 — admin dispute resolution (AC-030, AC-031). The refund path
 * returns the funds and writes the audit log.
 *
 * The fixture is 'Summer Dispute', a pending offer this spec walks to
 * *delivered* through the real UI first — creator accepts → brand funds →
 * creator submits. That matters: the mock provider's holds live in the server
 * process, so the hold the admin refunds must have been placed by the running
 * server (a hold the seed placed died with the seed process, and the refund
 * would fail on a dead provider ref). Funding through the UI is what puts the
 * hold where the resolution can reach it.
 *
 * Then the admin walks the real UI: /admin/worklist → View deal history (the
 * KAN-78 drill-down, with the campaign name for context) → back → Resolve
 * dispute → refund + note → the row leaves the worklist (`refunded` is not
 * refundable). The audit row and the ledger entry are asserted by the
 * integration suite's dispute test; this spec proves the UI path an admin
 * actually uses.
 */
test('flow 6: an admin refunds a disputed deal from the worklist (AC-030)', async ({
  browser,
}) => {
  // -- Walk the deal to delivered, all through the real UI ------------------
  const creator = await browser.newPage();
  await signIn(creator, DEMO.creator);
  await openCreatorDeal(creator, 'Summer Dispute');
  // AC-3: acceptance is gated on agreeing to the usage-rights terms.
  await creator.getByRole('checkbox', { name: /Usage Rights terms/i }).check();
  await creator.getByRole('button', { name: 'Accept offer' }).click();
  await expect(creator).toHaveURL(/\/creator\/deals\/[0-9a-f-]+/);
  await creator.close();

  const brand = await browser.newPage();
  await signIn(brand, DEMO.brand);
  await openCampaign(brand, 'Summer Dispute');
  // Funding asks first through the shared ConfirmDialog — click Fund, then
  // the dialog's confirm button.
  await brand.getByRole('button', { name: 'Fund campaign' }).click();
  await brand
    .getByRole('dialog')
    .getByRole('button', { name: 'Fund campaign' })
    .click();
  // Funding places the hold in this server process — the escrow row is the
  // proof it landed (same signal flow 1 uses).
  await expect(
    brand.getByText(/held in escrow|Funds held|escrow/i).first()
  ).toBeVisible({ timeout: 15_000 });
  await brand.close();

  const submitter = await browser.newPage();
  await signIn(submitter, DEMO.creator);
  await openCreatorDeal(submitter, 'Summer Dispute');
  await submitter
    .locator('#tiktokUrl')
    .fill('https://www.tiktok.com/@creator.demo/video/9876543210987654321');
  await submitter.getByRole('button', { name: 'Submit your video' }).click();
  await expect(submitter.getByText(/submitted/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await submitter.close();

  // -- Admin refunds from the worklist --------------------------------------
  const admin = await browser.newPage();
  await signIn(admin, DEMO.admin);

  // The worklist shows the delivered deal with money held (REFUNDABLE_FROM).
  await admin.goto('/admin/worklist');
  // Match the worklist row by its heading — sonner toasts are <li> elements
  // too, and the flag toast contains the campaign name, so a plain text
  // filter would resolve to both and trip strict mode.
  const row = admin
    .getByRole('listitem')
    .filter({ has: admin.getByRole('heading', { name: 'Summer Dispute' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText(/delivered/i)).toBeVisible();

  // KAN-81: flagging is attention metadata — raise the flag from the worklist
  // and the row shows it immediately (the resolution below clears it).
  await row.getByRole('button', { name: 'Flag for dispute' }).click();
  await expect(row.getByText('Flagged')).toBeVisible();

  // KAN-78 deal drill-down: the row links to the append-only event trail,
  // which the resolution is about to extend, carrying the campaign name for
  // context (F2). Asserted *before* the refund so the drill-down works however
  // the specs order themselves.
  await row.getByRole('link', { name: 'View deal history' }).click();
  await expect(
    admin.getByRole('heading', { name: 'Deal history', level: 1 })
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(admin.getByText(/Campaign: Summer Dispute/i)).toBeVisible();
  await expect(admin.getByText('Video submitted').first()).toBeVisible();
  await expect(
    admin.getByRole('heading', { name: 'Video 1 · Version 1', exact: true })
  ).toBeVisible();
  await admin.getByText('Version history', { exact: true }).click();
  await expect(
    admin.getByText('Submitted · creator', { exact: true })
  ).toBeVisible();

  // Opening resolution must not silently refresh tokens behind the displayed video.
  let fetchedNewerEvidence = false;
  await admin.route('**/api/admin/deals/*/videos', async (route) => {
    fetchedNewerEvidence = true;
    const response = await route.fetch();
    const evidence = await response.json();
    await route.fulfill({
      json: {
        ...evidence,
        videos: evidence.videos.map((video: { submissionVersion: number }) => ({
          ...video,
          submissionVersion: video.submissionVersion + 1,
        })),
      },
    });
  });
  await admin.route('**/api/admin/deals/*/resolve', async (route) => {
    expect(route.request().postDataJSON().expectedVersions).toMatchObject([
      { submissionVersion: 1 },
    ]);
    await route.fulfill({
      status: 409,
      json: {
        error: {
          code: 'DELIVERABLE_VERSION_STALE',
          message: 'This video changed. Reload the page and try again.',
        },
      },
    });
  });
  await admin.getByRole('button', { name: 'Resolve dispute' }).click();
  await expect(
    admin.getByRole('link', { name: 'Video 1 · Version 1', exact: true })
  ).toBeVisible();
  await admin.getByLabel('Resolution', { exact: true }).selectOption('release');
  await admin.getByLabel('Resolution note').fill('Review displayed version.');
  await admin.getByRole('button', { name: 'Confirm resolution' }).click();
  await expect(
    admin.getByText('This video changed.', { exact: false })
  ).toBeVisible();
  expect(fetchedNewerEvidence).toBe(false);
  await admin.unroute('**/api/admin/deals/*/videos');
  await admin.unroute('**/api/admin/deals/*/resolve');
  await admin.goBack();
  await expect(row).toBeVisible();

  // Resolve: refund the brand, with the required audit note.
  await row.getByRole('button', { name: 'Resolve dispute' }).click();
  await expect(
    row.getByRole('link', { name: 'Video 1 · Version 1', exact: true })
  ).toHaveAttribute(
    'href',
    'https://www.tiktok.com/@creator.demo/video/9876543210987654321'
  );
  await row.getByLabel('Resolution', { exact: true }).selectOption('refund');
  await row
    .getByLabel('Resolution note')
    .fill('Brand and creator agreed to cancel (e2e).');
  await row.getByRole('button', { name: 'Confirm resolution' }).click();

  // The success toast confirms the resolution landed.
  await expect(admin.getByText(/resolved/i).first()).toBeVisible({
    timeout: 15_000,
  });

  // And the row leaves the worklist — refunded is not refundable.
  await expect(row).toHaveCount(0, { timeout: 15_000 });

  // KAN-81 AC-031: the console links to the append-only audit log, which now
  // carries both admin actions — the flag and the resolution, note included.
  await admin.goto('/admin');
  // The admin console has both a nav link and a card link to Audit log.
  // Use the card link (the larger one) by scoping to the card grid.
  await admin.locator('a[href="/admin/audit-log"]').last().click();
  await admin.waitForURL(/\/admin\/audit-log/);
  await settledMain(admin);
  await expect(admin.getByRole('heading', { name: 'Audit log' })).toBeVisible({
    timeout: 15_000,
  });
  // Scope to <li> audit rows to avoid matching the hidden <option> elements
  // in the filter <select> dropdown, which carry the same label text.
  const rows = admin.getByRole('listitem');
  await expect(rows.getByText('Deal flagged')).toBeVisible();
  await expect(rows.getByText('Dispute resolved')).toBeVisible();
  await expect(
    rows.getByText(/Brand and creator agreed to cancel/)
  ).toBeVisible();
  await admin.close();
});
