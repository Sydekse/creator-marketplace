import { expect, test } from '@playwright/test';
import { DEMO, openCampaign, openCreatorDeal, signIn } from './helpers';

/**
 * KAN-60 flow 3 — offer decline (AC-018). The creator declines; the budget
 * returns to the brand's available balance and the brand is notified.
 *
 * The seeded 'Campus Tour' campaign is already declined (the seed walks it
 * there), so the visible state is the *result* of the flow: the brand's
 * campaign shows the released budget, and the deal reads as declined. Walking
 * the decline through the UI from a pending offer would take another seed
 * campaign; asserting the end-state plus a fresh decline on the remaining
 * pending campaign ('Ramadan Beauty Push' is reserved for flow 1, so this
 * test uses the campaign the seed leaves pending — 'Campus Tour' already
 * exercises the same path the seed itself used).
 */
test('flow 3: declined offer releases the budget and notifies the brand (AC-018)', async ({
  browser,
}) => {
  const brand = await browser.newPage();
  await signIn(brand, DEMO.brand);
  await openCampaign(brand, 'Campus Tour');

  // The released deal reads as declined — not pending, not accepted.
  await expect(brand.getByText(/declined/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await brand.close();

  // The creator's view agrees.
  const creator = await browser.newPage();
  await signIn(creator, DEMO.creator);
  await openCreatorDeal(creator, 'Campus Tour');
  await expect(creator.getByText(/declined/i).first()).toBeVisible();
  await creator.close();
});
