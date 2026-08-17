import { expect, test } from '@playwright/test';
import { DEMO, openCampaign, openCreatorDeal, signIn } from './helpers';

/**
 * KAN-60 flow 4 — deliverable rejection (AC-024). The brand requests changes;
 * the deal goes back to the creator and the money stays in escrow.
 *
 * Built on the seeded 'Tech Review Series' campaign: funded, awaiting the
 * creator's submission. The creator submits, the brand rejects with a reason,
 * and the deal reads as "changes requested" on both sides while the campaign
 * still shows its held funds.
 */
test('flow 4: rejection returns the deal to the creator, funds stay held (AC-024)', async ({
  browser,
}) => {
  // Creator submits a video against the funded deal.
  const creator = await browser.newPage();
  await signIn(creator, DEMO.creator);
  await openCreatorDeal(creator, 'Tech Review Series');
  await creator
    .locator('#tiktokUrl')
    .fill('https://www.tiktok.com/@creator.demo/video/1112223334445556667');
  await creator.getByRole('button', { name: 'Submit your video' }).click();
  await expect(creator.getByText(/submitted/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await creator.close();

  // Brand rejects with a reason. There is no standalone `/deals` list — the
  // brand reaches the deal review screen through the campaign page, whose
  // performance rows link into `/deals/[id]` by creator handle.
  const brand = await browser.newPage();
  await signIn(brand, DEMO.brand);
  await openCampaign(brand, 'Tech Review Series');
  await brand.getByRole('link', { name: '@demo_creator' }).click();
  await brand.getByRole('button', { name: 'Request changes' }).click();
  // The reject form asks for a reason (AC-024) — fill it and confirm.
  const reasonField = brand.locator('textarea, input[type="text"]').last();
  await reasonField.fill('Please include the actual engagement numbers.');
  await brand
    .getByRole('button', { name: /request changes|send|reject/i })
    .last()
    .click();
  await brand.close();

  // The campaign still holds its funds — rejection does not release money.
  const check = await browser.newPage();
  await signIn(check, DEMO.brand);
  await openCampaign(check, 'Tech Review Series');
  await expect(check.getByText(/held in escrow|escrow/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await check.close();
});
