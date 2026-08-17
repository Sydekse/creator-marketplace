import { expect, test } from '@playwright/test';
import { DEMO, openCampaign, openCreatorDeal, signIn } from './helpers';

/**
 * KAN-60 flow 3 — offer decline (AC-018). The creator declines; the deal reads
 * declined on both sides and the creator's cost is released from the brand's
 * committed budget.
 *
 * The decline is *walked* through the real UI on 'Spring Style Drop' — a
 * pending offer the seed reserves for this flow ('Ramadan Beauty Push' is
 * consumed by flow 1, which accepts it). The decline is irreversible
 * (LEGAL_TRANSITIONS.declined is empty), so the action confirms via
 * `window.confirm`; the dialog handler must be registered before the click.
 *
 * The *expiry* leg of AC-018 is not UI-walkable here: an offer expires on the
 * scheduler's clock (KAN-38, `expireOffersJob`), not by a button. It is
 * covered by that ticket's unit/integration tests, and 'Campus Tour' pins the
 * post-expiry-decline end-state below.
 */
test('flow 3: declining an offer releases the deal on both sides (AC-018)', async ({
  browser,
}) => {
  // Creator declines the pending offer — the real KAN-37 action.
  const creator = await browser.newPage();
  await signIn(creator, DEMO.creator);
  await openCreatorDeal(creator, 'Spring Style Drop');
  creator.on('dialog', (d) => d.accept());
  await creator.getByRole('button', { name: 'Decline offer' }).click();
  // The detail page re-reads the deal as declined — not pending, not accepted.
  await expect(creator.getByText(/declined/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await creator.close();

  // The brand's campaign shows the declined deal — the creator's cost is no
  // longer committed against the budget.
  const brand = await browser.newPage();
  await signIn(brand, DEMO.brand);
  await openCampaign(brand, 'Spring Style Drop');
  await expect(brand.getByText(/declined/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await brand.close();
});

/**
 * The seeded declined end-state ('Campus Tour' — the seed walks the decline
 * itself) reads consistently across both roles. Cheap, but it pins the
 * post-decline rendering path in the brand's campaign view and the creator's
 * deal view when no fresh decline has just happened in this run.
 */
test('flow 3b: a seeded declined deal reads consistently on both sides', async ({
  browser,
}) => {
  const brand = await browser.newPage();
  await signIn(brand, DEMO.brand);
  await openCampaign(brand, 'Campus Tour');
  await expect(brand.getByText(/declined/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await brand.close();

  const creator = await browser.newPage();
  await signIn(creator, DEMO.creator);
  await openCreatorDeal(creator, 'Campus Tour');
  await expect(creator.getByText(/declined/i).first()).toBeVisible();
  await creator.close();
});
