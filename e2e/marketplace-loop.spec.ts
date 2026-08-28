import { expect, test } from '@playwright/test';
import {
  DEMO,
  expectMutationOk,
  openCampaign,
  openConfirmDialog,
  openCreatorDeal,
  signIn,
  submitVideo,
} from './helpers';

/**
 * Flow 1 consumes its seeded state in the first step: once the offer is
 * accepted, no retry can ever find the usage-rights checkbox again. A retry
 * therefore burns the full test timeout at that checkbox and reports the
 * wrong failure — the CI logs on main (33079554962) and #121 both show it.
 * Fail once, fail honestly. (Flow 2 creates its own campaign, but a re-run
 * would collide with the leftover 'Tiny Budget Campaign' all the same.)
 */
test.describe.configure({ retries: 0 });

/**
 * Flow 1 walks eight fresh sign-in sessions end to end. On the webkit-mobile
 * CI runner that legitimately outgrows the suite's 120s default — its last
 * failure snapshot is an empty <main>, a page still loading when the budget
 * ran out, not a bug. Give the walk room; every step inside it still has its
 * own tight assertion timeout.
 */
test.setTimeout(300_000);

/**
 * KAN-60 flow 1 — the full marketplace loop, start to finish (AC-1):
 * creator accepts → brand funds → creator submits → brand approves → payout
 * → metrics land on the dashboard.
 *
 * Built on the seeded 'Ramadan Beauty Push' campaign: a confirmed campaign
 * with one pending offer to creator@demo.com. Every step is real UI against
 * the real database — no fakes, no shortcuts through the API.
 *
 * **The campaign is for two videos, deliberately** (F38). A deal delivers every
 * video it was paid for, so this walk submits both — and asserts that after the
 * first the brand has nothing to approve. That intermediate assertion is the one
 * that would have caught the original bug, where one link released all the money.
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
  await expectMutationOk(creator, '/accept', () =>
    creator.getByRole('button', { name: 'Accept offer' }).click()
  );
  await expect(creator).toHaveURL(/\/creator\/deals\/[0-9a-f-]+/);
  await creator.close();

  // -- Brand funds the campaign ---------------------------------------------
  const brand = await browser.newPage();
  await signIn(brand, DEMO.brand);
  await openCampaign(brand, 'Ramadan Beauty Push');
  // Funding moves money, so the shared ConfirmDialog asks first — open it
  // (hydration-safe), then confirm. The dialog's own prompt contains the
  // word "escrow", so no text assertion can prove the hold: only the POST
  // response can. Closing the page early would abort that in-flight request
  // and leave the campaign confirmed-but-unfunded (the CI failure where the
  // creator's deliverable form never rendered).
  await openConfirmDialog(brand, 'Fund campaign');
  await expectMutationOk(brand, '/fund', () =>
    brand
      .getByRole('dialog')
      .getByRole('button', { name: 'Fund campaign' })
      .click()
  );
  await brand.close();

  // -- Creator submits the first of two videos ------------------------------
  const submitter = await browser.newPage();
  await signIn(submitter, DEMO.creator);
  await openCreatorDeal(submitter, 'Ramadan Beauty Push');
  // One of two: the page reports the progress and the form is still there.
  await submitVideo(
    submitter,
    'https://www.tiktok.com/@creator.demo/video/1234567890123456789',
    '1 of 2 videos submitted'
  );
  await submitter.close();

  // -- The brand has nothing to approve yet (F38) ---------------------------
  // The assertion the original bug would have failed: one submitted video on a
  // two-video deal must not unlock a payout for both.
  const early = await browser.newPage();
  await signIn(early, DEMO.brand);
  await openCampaign(early, 'Ramadan Beauty Push');
  await early.getByRole('link', { name: '@demo_creator' }).click();
  await expect(early.getByText('1 of 2 videos submitted')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    early.getByRole('button', { name: 'Approve and pay' })
  ).toHaveCount(0);
  await early.close();

  // -- Creator submits the second video ------------------------------------
  const finisher = await browser.newPage();
  await signIn(finisher, DEMO.creator);
  await openCreatorDeal(finisher, 'Ramadan Beauty Push');
  await submitVideo(
    finisher,
    'https://www.tiktok.com/@creator.demo/video/2234567890123456789',
    '2 of 2 videos submitted'
  );
  await finisher.close();

  // -- Brand approves (payout net of commission) ----------------------------
  // The brand reaches the deal review screen through the campaign page: there
  // is no standalone `/deals` list — the campaign's performance rows carry the
  // link into `/deals/[id]` by creator handle.
  const approver = await browser.newPage();
  await signIn(approver, DEMO.brand);
  await openCampaign(approver, 'Ramadan Beauty Push');
  await approver.getByRole('link', { name: '@demo_creator' }).click();
  // The approve control asks first through the shared ConfirmDialog — open
  // it (hydration-safe), confirm, and hold for the payout POST.
  await openConfirmDialog(approver, 'Approve and pay');
  await expectMutationOk(approver, '/approve', () =>
    approver
      .getByRole('dialog')
      .getByRole('button', { name: 'Approve and pay' })
      .click()
  );
  await expect(approver).toHaveURL(/\/deals\/[0-9a-f-]+/, { timeout: 15_000 });
  await approver.close();

  // -- Creator submits metrics for each video; the dashboard shows them ------
  // One form per video (AC-026's "each video"), so the first is filled and the
  // dashboard is asserted on its numbers.
  const metrics = await browser.newPage();
  await signIn(metrics, DEMO.creator);
  await openCreatorDeal(metrics, 'Ramadan Beauty Push');
  await metrics.locator('#metric-views').first().fill('12500');
  await metrics.locator('#metric-likes').first().fill('840');
  await metrics.locator('#metric-shares').first().fill('90');
  await metrics.locator('#metric-comments').first().fill('37');
  // Same abort trap as every other mutation: the close below kills any
  // request still in flight, so hold for the metrics PUT first.
  await expectMutationOk(
    metrics,
    '/metrics',
    () =>
      metrics.getByRole('button', { name: 'Submit metrics' }).first().click(),
    'PUT'
  );
  await metrics.close();

  const dashboard = await browser.newPage();
  await signIn(dashboard, DEMO.brand);
  await openCampaign(dashboard, 'Ramadan Beauty Push');
  await expect(dashboard.getByText('12,500').first()).toBeVisible({
    timeout: 15_000,
  });
  // AC-027's coverage line, now that a deal really can be part-measured: one of
  // the two videos has numbers and the total says so rather than reading as
  // complete.
  await expect(dashboard.getByText(/Totals cover 1 of 2 videos/)).toBeVisible({
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
  // A new brief's next step is picking creators, so saving lands on discover.
  await expect(brand).toHaveURL(/\/discover$/, { timeout: 15_000 });

  // Add the highest-tier creator with a video count the budget cannot cover.
  // Tiles mark rather than navigate — "See details" is the way into a profile.
  const card = brand.locator('li', { hasText: '@demo_beauty' }).first();
  await card.getByRole('link', { name: /see details/i }).click();
  await expect(brand).toHaveURL(/\/discover\/[0-9a-f-]+/, { timeout: 15_000 });
  await brand.getByRole('combobox', { name: /select draft campaign/i }).click();
  await brand.getByRole('option', { name: 'Tiny Budget Campaign' }).click();
  await brand.getByRole('spinbutton', { name: /^videos$/i }).fill('3');
  await brand.getByRole('button', { name: 'Add to campaign' }).click();

  // The refusal is the server's BUDGET_EXCEEDED sentence, shown inline on
  // the form (and also toasted). Assert the form alert so the toast copy
  // cannot trip Playwright's strict locator. The campaign name contains
  // "Budget", so a /budget/ fragment would match the wrong node.
  await expect(brand.locator('form').getByRole('alert')).toHaveText(
    /exceeds your remaining budget/i,
    { timeout: 15_000 }
  );
  await brand.close();
});
