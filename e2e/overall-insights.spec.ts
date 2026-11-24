import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { campaign, deal, deliverable, videoMetric } from '@/db/schema';
import {
  createInsightFixtures,
  type InsightFixtures,
} from './insight-fixtures';
import { DEMO, signIn } from './helpers';

let fixtures: InsightFixtures;
let duplicateCampaign: string;
let pageCampaigns: string[];
const report = (page: Page) =>
  page.getByLabel('Overall insights', { exact: true });
const metric = (page: Page, label: string) =>
  report(page)
    .locator('dt')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first()
    .locator('..');
const selected = (...ids: string[]) =>
  `/insights?${new URLSearchParams(ids.map((id) => ['campaign', id]))}`;

test.beforeAll(async () => {
  fixtures = await createInsightFixtures();
  const [original] = await db
    .select()
    .from(campaign)
    .where(eq(campaign.id, fixtures.populated));
  const rows = await db
    .insert(campaign)
    .values(
      Array.from({ length: 21 }, (_, i) => ({
        brandId: original.brandId,
        name: `Overall pagination ${String(i + 1).padStart(2, '0')} ${crypto.randomUUID().slice(0, 6)}`,
        budget: 100_000,
        desiredVideos: 1,
        status: 'draft' as const,
      }))
    )
    .returning({ id: campaign.id });
  pageCampaigns = rows.map((row) => row.id);
  const [extra] = await db
    .insert(campaign)
    .values({
      brandId: original.brandId,
      name: `Overall repeated video ${crypto.randomUUID().slice(0, 6)}`,
      budget: 100_000,
      desiredVideos: 1,
      status: 'completed',
    })
    .returning();
  duplicateCampaign = extra.id;
  const [sourceDeal] = await db
    .select()
    .from(deal)
    .where(eq(deal.id, fixtures.dealIds.alpha));
  const [sourceVideo] = await db
    .select()
    .from(deliverable)
    .where(eq(deliverable.dealId, sourceDeal.id))
    .limit(1);
  const [sourceMetric] = await db
    .select()
    .from(videoMetric)
    .where(eq(videoMetric.deliverableId, sourceVideo.id));
  const [copyDeal] = await db
    .insert(deal)
    .values({
      campaignId: extra.id,
      creatorId: sourceDeal.creatorId,
      status: 'completed',
      videoCount: 1,
      unitPrice: sourceDeal.unitPrice,
      totalPrice: sourceDeal.unitPrice,
      commissionRate: sourceDeal.commissionRate,
      rightsTermsId: sourceDeal.rightsTermsId,
      rightsAcceptedAt: sourceDeal.rightsAcceptedAt,
    })
    .returning();
  const [copyVideo] = await db
    .insert(deliverable)
    .values({
      dealId: copyDeal.id,
      tiktokUrl: sourceVideo.tiktokUrl,
      tiktokVideoId: sourceVideo.tiktokVideoId,
      videoOrdinal: 1,
      submissionVersion: 1,
      historyCompleteness: 'legacy_baseline',
      reviewStatus: 'approved',
    })
    .returning();
  await db.insert(videoMetric).values({
    deliverableId: copyVideo.id,
    submissionVersion: 1,
    views: sourceMetric.views,
    likes: sourceMetric.likes,
    comments: sourceMetric.comments,
    shares: sourceMetric.shares,
    source: 'creator',
  });
});

test.beforeEach(async ({ page }) => {
  await signIn(page, DEMO.brand);
});

test('cross-campaign duplicates stay excluded in grouped comparisons', async ({
  page,
}) => {
  await page.goto(selected(fixtures.populated));
  await expect(metric(page, 'Comparable CPV')).toContainText('0.0533 ETB');
  await page.goto(selected(fixtures.populated, duplicateCampaign));
  await expect(metric(page, 'Comparable CPV')).toContainText('0.055 ETB');
  await expect(
    page.getByText(/4 current video records share a known TikTok identity/)
  ).toBeVisible();
  const populated = page
    .getByRole('list', { name: 'Exact campaign comparisons' })
    .locator(':scope > li')
    .filter({ hasText: 'populated' });
  await expect(populated).toContainText('0.055 ETB');
  const extra = page
    .getByRole('list', { name: 'Exact campaign comparisons' })
    .locator(':scope > li')
    .filter({ hasText: 'Overall repeated video' });
  await expect(extra).toContainText('Unavailable');
});

test('pagination never changes the total selection and every campaign remains reachable', async ({
  page,
}) => {
  await page.goto(`${selected(...pageCampaigns)}&sort=name`);
  await expect(report(page)).toContainText('21 selected campaigns');
  const list = page.getByRole('list', { name: 'Exact campaign comparisons' });
  await expect(list.locator(':scope > li')).toHaveCount(20);
  await page
    .getByRole('navigation', { name: 'Campaign pages' })
    .getByRole('link', { name: 'Next', exact: true })
    .click();
  await expect(list.locator(':scope > li')).toHaveCount(1);
  await expect(list).toContainText('Overall pagination 21');
  await expect(report(page)).toContainText('21 selected campaigns');
  expect(new URL(page.url()).searchParams.getAll('campaign')).toHaveLength(21);
  await page.reload();
  await expect(list).toContainText('Overall pagination 21');
  await page
    .getByRole('navigation', { name: 'Campaign pages' })
    .getByRole('link', { name: 'Previous', exact: true })
    .click();
  await expect(list.locator(':scope > li')).toHaveCount(20);
});

test('overall results, creator history and drill-down follow the same selected campaigns', async ({
  page,
}, info) => {
  await page.goto(selected(fixtures.populated, fixtures.solo));
  await expect(report(page)).toContainText('2 selected campaigns');
  await expect(metric(page, 'Recorded views')).toContainText('13,800');
  await expect(
    page.getByText('Repeated identities across selected campaigns', {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Delivery & collaboration', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Creators across selected campaigns',
      exact: true,
    })
  ).toBeVisible();
  const creators = page.getByRole('list', {
    name: 'Exact creator comparisons',
  });
  const alpha = creators
    .locator(':scope > li')
    .filter({ hasText: fixtures.handles.alpha });
  await alpha
    .locator('summary')
    .filter({ hasText: 'Your collaboration history in selected campaigns' })
    .click();
  await expect(alpha).toContainText('Offers ever accepted / issued');
  await expect(alpha).toContainText(
    'Initial delivery without a missed agreed deadline'
  );
  const campaignLink = page
    .getByRole('list', { name: 'Exact campaign comparisons' })
    .getByRole('link')
    .filter({ hasText: 'populated' });
  await campaignLink.click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${fixtures.populated}$`));
  await expect(
    page.getByRole('region', { name: 'Campaign insights', exact: true })
  ).toBeVisible();
  await page.goBack();
  await expect(report(page)).toContainText('2 selected campaigns');
  await page.screenshot({
    path: info.outputPath('overall-insights.png'),
    scale: 'css',
    animations: 'disabled',
  });
});

test('GET filters retain shareable state and handle empty or invalid selections honestly', async ({
  page,
}) => {
  await page.goto(selected(fixtures.populated, fixtures.draft));
  await page.getByLabel('Current campaign status').selectOption('draft');
  await page.getByLabel('Campaign created from (UTC)').fill('2020-01-01');
  await page.getByLabel('Campaign created through (UTC)').fill('2030-12-31');
  await page.getByLabel('Campaign order').selectOption('name');
  await page
    .getByRole('button', { name: 'Apply filters', exact: true })
    .click();
  await expect(report(page)).toContainText('1 selected campaigns');
  await expect(metric(page, 'Recorded views')).toContainText('Pending');
  await expect(metric(page, 'Settled spend')).toContainText('0');
  const url = page.url();
  expect(new URL(url).searchParams.getAll('campaign')).toEqual(
    expect.arrayContaining([fixtures.populated, fixtures.draft])
  );
  await page.reload();
  await expect(page.getByLabel('Current campaign status')).toHaveValue('draft');
  await expect(page.getByLabel('Campaign created from (UTC)')).toHaveValue(
    '2020-01-01'
  );
  await page.getByLabel('Current campaign status').selectOption('completed');
  await page
    .getByRole('button', { name: 'Apply filters', exact: true })
    .click();
  await expect(
    page.getByText('No campaigns match these filters', { exact: true })
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(url);
  await expect(report(page)).toContainText('1 selected campaigns');
  await page.goto('/insights?from=2026-02-30');
  await expect(
    page.getByText('Unable to use these filters', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Cost & recorded results', exact: true })
  ).toHaveCount(0);
  await page.goto(`/insights?campaign=${crypto.randomUUID()}`);
  await expect(
    page.getByText('Unable to use these filters', { exact: true })
  ).toBeVisible();
});

test('dashboard link and navigation reach Insights without clipping at mobile and tablet widths', async ({
  page,
}) => {
  const summary = page.getByLabel('Overall insights summary', { exact: true });
  await expect(summary).toContainText('Recorded views');
  await summary.getByRole('link', { name: 'View Insights' }).click();
  await expect(page).toHaveURL(/\/insights$/);
  const original = page.viewportSize()!;
  for (const width of [390, 820, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const menu = page.getByRole('button', { name: 'Toggle navigation menu' });
    if (width < 1100) {
      await expect(menu).toBeVisible();
      await expect(async () => {
        if (!(await page.getByRole('dialog').isVisible())) await menu.click();
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 10_000 });
      await expect(
        page
          .getByRole('dialog')
          .getByRole('link', { name: 'Insights', exact: true })
      ).toHaveAttribute('aria-current', 'page');
      await page
        .getByRole('dialog')
        .getByRole('link', { name: 'Insights', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toBeHidden();
    } else {
      await expect(menu).toBeHidden();
      const nav = page
        .getByRole('navigation', { name: 'Primary navigation' })
        .filter({ visible: true });
      await expect(
        nav.getByRole('link', { name: 'Insights', exact: true })
      ).toHaveAttribute('aria-current', 'page');
      for (const link of await nav.getByRole('link').all()) {
        const parent = await nav.boundingBox();
        const child = await link.boundingBox();
        expect(child!.x + child!.width).toBeLessThanOrEqual(
          parent!.x + parent!.width + 1
        );
      }
    }
    const size = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
  }
  await page.setViewportSize(original);
});

test('exact results and native filters remain usable without chart JavaScript', async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    javaScriptEnabled: false,
  });
  const plain = await context.newPage();
  try {
    await plain.goto(selected(fixtures.populated, fixtures.draft));
    await expect(metric(plain, 'Recorded views')).toContainText('13,800');
    await plain.getByLabel('Current campaign status').selectOption('draft');
    await plain
      .getByRole('button', { name: 'Apply filters', exact: true })
      .click();
    await expect(report(plain)).toContainText('1 selected campaigns');
    await expect(metric(plain, 'Recorded views')).toContainText('Pending');
  } finally {
    await context.close();
  }
});

test('comparison changes retain filters and render under reduced motion without hydration errors', async ({
  page,
}) => {
  const fresh = await page.context().newPage();
  const errors: string[] = [];
  fresh.on('pageerror', (error) => errors.push(error.message));
  try {
    await fresh.emulateMedia({ reducedMotion: 'reduce' });
    await fresh.goto(selected(fixtures.populated));
    await fresh
      .getByRole('navigation', { name: 'Comparison measure' })
      .getByRole('link', { name: 'Engagement', exact: true })
      .click();
    await expect(fresh).toHaveURL(/metric=cpe/);
    expect(new URL(fresh.url()).searchParams.getAll('campaign')).toEqual([
      fixtures.populated,
    ]);
    await expect(
      fresh
        .getByRole('navigation', { name: 'Comparison measure' })
        .getByRole('link', { name: 'Engagement', exact: true })
    ).toHaveAttribute('aria-current', 'page');
    await expect(report(fresh)).toContainText('1 selected campaigns');
    expect(errors).toEqual([]);
  } finally {
    await fresh.close();
  }
});
