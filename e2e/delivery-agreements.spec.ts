import { expect, test, type Browser, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { creatorProfile, deal, user } from '@/db/schema';
import {
  DEMO,
  signIn,
  fillHydrated,
  openConfirmDialog,
  expectMutationOk,
  settledMain,
  submitVideo,
} from './helpers';

async function authenticatedPage(browser: Browser, email: string) {
  const context = await browser.newContext();
  const login = await context.newPage();
  await signIn(login, email);
  const page = await context.newPage();
  await login.close();
  return page;
}
const agreement = (page: Page) => page.locator('#delivery-agreement');

test('mutual delivery agreement survives full delivery and appears in owned insights', async ({
  browser,
}, info) => {
  test.setTimeout(240_000);
  const brand = await authenticatedPage(browser, DEMO.brand);
  const creator = await authenticatedPage(browser, DEMO.creator);
  const admin = await authenticatedPage(browser, DEMO.admin);
  try {
    await brand.goto('/campaigns/new');
    await expect(brand.locator('#deliveryWindowDays')).toHaveValue('');
    await fillHydrated(brand, [
      ['#name', `Delivery agreement ${crypto.randomUUID().slice(0, 8)}`],
      ['#budget', '1000000'],
      ['#desiredVideos', '1'],
      ['#deliveryWindowDays', '7'],
    ]);
    const created = brand.waitForResponse(
      (r) =>
        r.url().endsWith('/api/campaigns') && r.request().method() === 'POST'
    );
    await brand.getByRole('button', { name: 'Create draft campaign' }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    // The brief form pushes to /discover after creating. Let that client
    // navigation commit before the next goto — webkit aborts a page.goto that
    // races an in-flight push ("interrupted by another navigation"), the same
    // trap signIn documents for the role-home redirect.
    await brand.waitForURL(/\/discover/);
    const { id: campaignId } = await response.json();
    const [profile] = await db
      .select({ id: creatorProfile.id })
      .from(creatorProfile)
      .innerJoin(user, eq(creatorProfile.userId, user.id))
      .where(eq(user.email, DEMO.creator));
    const cart = await brand.request.post(
      `/api/campaigns/${campaignId}/items`,
      { data: { creatorId: profile.id, videoCount: 1 } }
    );
    expect(cart.ok()).toBe(true);
    await brand.goto(`/campaigns/${campaignId}`);
    await settledMain(brand);
    await openConfirmDialog(brand, 'Send offers');
    await expect(brand.getByRole('dialog')).toContainText(
      'Within 7 days after funding'
    );
    await expectMutationOk(brand, '/confirm', () =>
      brand
        .getByRole('dialog')
        .getByRole('button', { name: 'Send offers' })
        .click()
    );
    const [offer] = await db
      .select()
      .from(deal)
      .where(eq(deal.campaignId, campaignId));
    await creator.goto(`/creator/deals/${offer.id}`);
    await settledMain(creator);
    await expect(agreement(creator)).toContainText(
      'Within 7 days after funding'
    );
    const stale = await creator.request.post(`/api/deals/${offer.id}/accept`, {
      data: {
        rightsTermsId: offer.rightsTermsId,
        deliveryWindowDays: 8,
        deliveryTermsVersion: 'funding-24h-v1',
      },
    });
    expect(stale.status()).toBe(409);
    await creator
      .getByRole('checkbox', { name: /Usage Rights terms/i })
      .check();
    await expectMutationOk(creator, '/accept', () =>
      creator.getByRole('button', { name: 'Accept offer' }).click()
    );
    await brand.goto(`/campaigns/${campaignId}`);
    await settledMain(brand);
    await openConfirmDialog(brand, 'Fund campaign');
    await expectMutationOk(brand, '/fund', () =>
      brand
        .getByRole('dialog')
        .getByRole('button', { name: 'Fund campaign' })
        .click()
    );
    const [funded] = await db.select().from(deal).where(eq(deal.id, offer.id));
    const later = new Date(+funded.currentDeliveryDueAt! + 2 * 86_400_000)
      .toISOString()
      .slice(0, 16);
    await creator.goto(`/creator/deals/${offer.id}`);
    await settledMain(creator);
    await agreement(creator)
      .locator('summary')
      .filter({ hasText: 'Request a delivery extension' })
      .click();
    await agreement(creator)
      .getByLabel('Proposed delivery deadline (UTC)')
      .fill(later);
    await agreement(creator)
      .getByLabel('Extension note')
      .fill('Please allow two days for the reshoot location.');
    await expectMutationOk(creator, '/deadline', () =>
      agreement(creator)
        .getByRole('button', { name: 'Request extension', exact: true })
        .click()
    );
    await brand.goto(`/deals/${offer.id}`);
    await settledMain(brand);
    await expect(agreement(brand)).toContainText(
      'Extension pending — not yet agreed'
    );
    await expect(
      agreement(brand).getByRole('button', { name: 'Accept extension' })
    ).toBeVisible();
    await creator.reload();
    await settledMain(creator);
    await expect(
      agreement(creator).getByRole('button', { name: 'Accept extension' })
    ).toHaveCount(0);
    await expect(
      agreement(creator).getByRole('button', { name: 'Withdraw extension' })
    ).toBeVisible();
    await admin.goto(`/admin/deals/${offer.id}`);
    await settledMain(admin);
    await expect(agreement(admin)).toContainText(
      'Extension pending — not yet agreed'
    );
    await expect(agreement(admin).getByRole('button')).toHaveCount(0);
    const accepted = brand.waitForResponse(
      (r) => r.url().endsWith('/deadline') && r.request().method() === 'PATCH'
    );
    await agreement(brand)
      .getByRole('button', { name: 'Accept extension' })
      .click();
    expect((await accepted).status()).toBe(200);
    await creator.reload();
    await settledMain(creator);
    await brand.reload();
    await settledMain(brand);
    const currentDeadline = (page: Page) =>
      // The v4 card shows the operative deadline as the hero numeral rather
      // than a dt/dd ledger row.
      agreement(page).locator('.bd-agreehero-num');
    const finalDue = await currentDeadline(brand).innerText();
    await expect(currentDeadline(creator)).toHaveText(finalDue);
    await agreement(creator)
      .locator('summary')
      .filter({ hasText: 'Extension history' })
      .click();
    await expect(agreement(creator)).toContainText('accepted by brand');
    await submitVideo(
      creator,
      'https://www.tiktok.com/@creator.demo/video/8877665544332211000',
      '1 of 1 video submitted'
    );
    await expect(agreement(creator)).toContainText('Initial delivery on time');
    await expect(
      agreement(creator)
        .locator('summary')
        .filter({ hasText: 'Request a delivery extension' })
    ).toHaveCount(0);
    await brand.goto(`/campaigns/${campaignId}`);
    await settledMain(brand);
    const timing = brand.getByRole('region', {
      name: 'Campaign delivery timing',
    });
    await expect(timing).toContainText('1 / 1');
    await expect(timing).toContainText('0 overdue');
    await expect(
      brand.getByText('Your collaboration history', { exact: true })
    ).toBeVisible();
    await creator.goto('/notifications');
    await settledMain(creator);
    await expect(
      creator.getByText('Delivery extension accepted', { exact: true }).first()
    ).toBeVisible();
    await brand.goto(`/deals/${offer.id}`);
    await settledMain(brand);
    await agreement(brand).scrollIntoViewIfNeeded();
    await brand.screenshot({
      path: info.outputPath('delivery-agreement.png'),
      scale: 'css',
      animations: 'disabled',
    });
    const size = await brand.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
  } finally {
    await Promise.all([
      brand.context().close(),
      creator.context().close(),
      admin.context().close(),
    ]);
  }
});
