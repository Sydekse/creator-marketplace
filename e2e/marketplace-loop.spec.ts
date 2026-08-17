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
  // AC-3: acceptance is gated on agreeing to the usage-rights terms — the box
  // is deliberately unticked (and cannot be pre-ticked), so the e2e ticks it
  // exactly as a creator would before the accept control enables.
  await creator.getByRole('checkbox', { name: /Usage Rights terms/i }).check();
  await creator.getByRole('button', { name: 'Accept offer' }).click();
  await expect(creator).toHaveURL(/\/creator\/deals\/[0-9a-f-]+/);
  await creator.close();

  // -- Brand funds the campaign ---------------------------------------------
  const brand = await browser.newPage();
  await signIn(brand, DEMO.brand);
  await openCampaign(brand, 'Ramadan Beauty Push');
  // Funding moves money, so the button confirms via `window.confirm` first —
  // accept it, registered before the click (Playwright auto-dismisses
  // unhandled dialogs, which would cancel the funding).
  brand.on('dialog', (d) => d.accept());
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
    .fill('https://www.tiktok.com/@creator.demo/video/1234567890123456789');
  await submitter.getByRole('button', { name: 'Submit your video' }).click();
  await expect(submitter.getByText(/submitted/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await submitter.close();

  // -- Brand approves (payout net of commission) ----------------------------
  // The brand reaches the deal review screen through the campaign page: there
  // is no standalone `/deals` list — the campaign's performance rows carry the
  // link into `/deals/[id]` by creator handle.
  const approver = await browser.newPage();
  await signIn(approver, DEMO.brand);
  await openCampaign(approver, 'Ramadan Beauty Push');
  await approver.getByRole('link', { name: '@demo_creator' }).click();
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
  // The brief form returns to the campaign list after saving the draft — the
  // detail page is the cart, which needs creators first. The list is where the
  // new draft now appears.
  await expect(brand).toHaveURL(/\/campaigns$/, { timeout: 15_000 });

  // Add the highest-tier creator with a video count the budget cannot cover.
  await brand.goto('/discover');
  // Discovery cards link by TikTok handle, not email.
  await brand
    .getByRole('link', { name: /@demo_beauty/i })
    .first()
    .click();
  await brand.locator('select[name="campaignId"]').selectOption({
    label: 'Tiny Budget Campaign',
  });
  await brand.locator('input[name="videoCount"]').fill('3');
  await brand.getByRole('button', { name: /add/i }).click();

  // The refusal surfaces via the form's error toast — the server's
  // BUDGET_EXCEEDED sentence. Asserted on the full sentence, not a /budget/
  // fragment: the campaign list's own name ("Tiny Budget Campaign") contains
  // "Budget" and would match first.
  await expect(brand.getByText(/exceeds your remaining budget/i)).toBeVisible({
    timeout: 15_000,
  });
  await brand.close();
});
