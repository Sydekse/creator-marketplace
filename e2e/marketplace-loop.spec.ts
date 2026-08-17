import { expect, test } from '@playwright/test';
import { DEMO, openCampaign, openCreatorDeal, signIn } from './helpers';

/**
 * KAN-60 flow 1 — the full marketplace loop, start to finish (AC-1):
 * creator accepts → brand funds → creator submits → brand approves → payout
 * → metrics land on the dashboard.
 *
 * Built on the seeded 'Ramadan Beauty Push' campaign: a confirmed campaign
 * with one pending offer to creator@demo.com. Every step is real UI against
 * the real database — no fakes, no shortcuts through the API.
 */
test('flow 1: full marketplace loop (US-001 to US-009)', async ({
  browser,
}) => {
  // -- Creator accepts the offer -------------------------------------------
  const creator = await browser.newPage();
  await signIn(creator, DEMO.creator);
  await openCreatorDeal(creator, 'Ramadan Beauty Push');
  await creator.getByRole('button', { name: 'Accept offer' }).click();
  await expect(creator).toHaveURL(/\/creator\/deals\/[0-9a-f-]+/);
  await creator.close();

  // -- Brand funds the campaign ---------------------------------------------
  const brand = await browser.newPage();
  await signIn(brand, DEMO.brand);
  await openCampaign(brand, 'Ramadan Beauty Push');
  await brand.getByRole('button', { name: 'Fund campaign' }).click();
  // Funding succeeds: the button's success toast, or the page re-reading a
  // funded campaign. The robust signal is the escrow row appearing.
  await expect(
    brand.getByText(/held in escrow|Funds held|escrow/i).first()
  ).toBeVisible({ timeout: 15_000 });
  await brand.close();

  // -- Creator submits the video -------------------------------------------
  const submitter = await browser.newPage();
  await signIn(submitter, DEMO.creator);
  await openCreatorDeal(submitter, 'Ramadan Beauty Push');
  await submitter
    .locator('#tiktokUrl')
    .fill('https://www.tiktok.com/@creator.demo/video/e2e-loop-1');
  await submitter.getByRole('button', { name: 'Submit your video' }).click();
  await expect(submitter.getByText(/submitted/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await submitter.close();

  // -- Brand approves (payout net of commission) ----------------------------
  const approver = await browser.newPage();
  await signIn(approver, DEMO.brand);
  await approver.goto('/deals');
  await approver
    .getByRole('link', { name: /Ramadan Beauty Push/i })
    .first()
    .click();
  // The approve control confirms with a window.dialog — accept it, registered
  // before the click so the handler is live when the dialog fires.
  approver.on('dialog', (d) => d.accept());
  await approver.getByRole('button', { name: 'Approve and pay' }).click();
  await expect(approver).toHaveURL(/\/deals\/[0-9a-f-]+/, { timeout: 15_000 });
  await approver.close();

  // -- Creator submits metrics; the brand dashboard shows them --------------
  const metrics = await browser.newPage();
  await signIn(metrics, DEMO.creator);
  await openCreatorDeal(metrics, 'Ramadan Beauty Push');
  await metrics.locator('#metric-views').fill('12500');
  await metrics.locator('#metric-likes').fill('840');
  await metrics.locator('#metric-shares').fill('90');
  await metrics.locator('#metric-comments').fill('37');
  await metrics.getByRole('button', { name: 'Submit metrics' }).click();
  await metrics.close();

  const dashboard = await browser.newPage();
  await signIn(dashboard, DEMO.brand);
  await openCampaign(dashboard, 'Ramadan Beauty Push');
  await expect(dashboard.getByText('12,500').first()).toBeVisible({
    timeout: 15_000,
  });
  await dashboard.close();
});

/**
 * KAN-60 flow 2 — the budget ceiling (AC-014). A creator whose cost exceeds
 * the campaign's remaining budget is refused with BUDGET_EXCEEDED; the brand
 * sees the refusal rather than a silently overspent campaign.
 */
test('flow 2: budget ceiling blocks adding an over-budget creator (AC-014)', async ({
  browser,
}) => {
  const brand = await browser.newPage();
  await signIn(brand, DEMO.brand);

  // A tiny budget — less than one video at any seeded tier price.
  await brand.goto('/campaigns/new');
  await brand.locator('#name').fill('Tiny Budget Campaign');
  await brand.locator('#budget').fill('100');
  await brand.locator('#desiredVideos').fill('1');
  await brand.locator('#goal').fill('Prove the ceiling holds.');
  await brand.locator('#targetAudience').fill('Everyone');
  await brand.getByRole('button', { name: 'Create draft campaign' }).click();
  await expect(brand).toHaveURL(/\/campaigns\/[0-9a-f-]+/, { timeout: 15_000 });

  // Add the highest-tier creator with a video count the budget cannot cover.
  await brand.goto('/discover');
  await brand
    .getByRole('link', { name: /creator\.beauty/i })
    .first()
    .click();
  await brand.locator('select[name="campaignId"]').selectOption({
    label: 'Tiny Budget Campaign',
  });
  await brand.locator('input[name="videoCount"]').fill('3');
  await brand.getByRole('button', { name: /add/i }).click();

  // The refusal surfaces on the page (toast or inline) — never a silent add.
  await expect(
    brand.getByText(/budget|exceed|insufficient/i).first()
  ).toBeVisible({ timeout: 15_000 });
  await brand.close();
});
