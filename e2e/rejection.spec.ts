import { expect, test } from '@playwright/test';
import {
  DEMO,
  expectMutationOk,
  openCampaign,
  openCreatorDeal,
  settledMain,
  signIn,
  submitVideo,
} from './helpers';

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

  // Brand rejects with a reason. There is no standalone `/deals` list — the
  // brand reaches the deal review screen through the campaign page, whose
  // performance rows link into `/deals/[id]` by creator handle.
  const brand = await browser.newPage();
  await signIn(brand, DEMO.brand);
  await openCampaign(brand, 'Tech Review Series');
  await brand.getByRole('link', { name: '@demo_creator' }).click();
  await brand.waitForURL(/\/deals\/[0-9a-f-]+/);
  await settledMain(brand);
  await brand.getByLabel('Revision category').click();
  await brand
    .getByRole('option', { name: 'Message accuracy', exact: true })
    .click();
  // The reject form asks for a reason (AC-024) — fill it and confirm.
  const reasonField = brand.locator('textarea, input[type="text"]').last();
  await reasonField.fill('Please include the actual engagement numbers.');
  await expectMutationOk(brand, '/reject', () =>
    brand.getByRole('button', { name: 'Request changes', exact: true }).click()
  );
  await creator.reload();
  await settledMain(creator);
  await expect(creator.getByText('Message accuracy').first()).toBeVisible();
  await expect(
    creator.getByText('Please include the actual engagement numbers.').first()
  ).toBeVisible();
  await creator.getByText('Version history', { exact: true }).click();
  await expect(creator.getByText('Revision requested · brand')).toBeVisible();
  await submitVideo(
    creator,
    'https://www.tiktok.com/@creator.demo/video/1112223334445556668',
    '1 of 1 video submitted'
  );
  await expect(
    creator.getByRole('heading', { name: 'Video 1 · Version 2', exact: true })
  ).toBeVisible();
  await brand.reload();
  await settledMain(brand);
  await brand.getByLabel('Revision category').click();
  await brand
    .getByRole('option', { name: 'Audio / visual quality', exact: true })
    .click();
  await brand.locator('textarea').fill('Please improve the audio.');
  await expectMutationOk(brand, '/reject', () =>
    brand.getByRole('button', { name: 'Request changes', exact: true }).click()
  );
  await creator.reload();
  await settledMain(creator);
  await submitVideo(
    creator,
    'https://www.tiktok.com/@creator.demo/video/1112223334445556669',
    '1 of 1 video submitted'
  );
  await expect(
    creator.getByRole('heading', { name: 'Video 1 · Version 3', exact: true })
  ).toBeVisible();
  await creator.getByText('Version history', { exact: true }).click();
  await expect(
    creator.getByRole('heading', { name: 'Version 1', exact: true })
  ).toBeVisible();
  await expect(
    creator.getByRole('heading', { name: 'Version 2', exact: true })
  ).toBeVisible();
  await expect(
    creator.getByText('Please improve the audio.').first()
  ).toBeVisible();
  await creator.close();
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
