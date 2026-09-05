import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { DEMO, signIn } from './helpers';
import {
  createInsightFixtures,
  type InsightFixtures,
} from './insight-fixtures';

let fixtures: InsightFixtures;

test.beforeAll(async () => {
  fixtures = await createInsightFixtures();
});

test.beforeEach(async ({ page }) => {
  await signIn(page, DEMO.brand);
});

const panel = (page: Page) =>
  page.getByRole('region', { name: 'Campaign insights', exact: true });

function stat(root: Locator, label: string) {
  return root
    .locator('dt')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('..');
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const folder = info.outputPath('screenshots');
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: resolve(folder, `${info.project.name}-${name}.png`),
    fullPage: true,
    scale: 'css',
    animations: 'disabled',
  });
  if (name === 'populated-comparison') {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(folder, `${info.project.name}-above-fold.png`),
      scale: 'css',
      animations: 'disabled',
    });
    await panel(page)
      .getByText('Cost & view contribution', { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(folder, `${info.project.name}-contribution-detail.png`),
      scale: 'css',
      animations: 'disabled',
    });
  }
}

async function noPageOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(
    size.scroll,
    'Tables must scroll locally, not widen the page'
  ).toBeLessThanOrEqual(size.width + 1);
}

async function openDisclosure(page: Page, name: string, touch: boolean) {
  const summary = panel(page).locator('summary').filter({ hasText: name });
  await expect(async () => {
    if ((await summary.locator('..').getAttribute('open')) === null) {
      if (touch) await summary.tap();
      else {
        await summary.focus();
        await expect(summary).toBeFocused();
        await page.keyboard.press('Enter');
      }
    }
    await expect(summary.locator('..')).toHaveAttribute('open', '', {
      timeout: 1_000,
    });
  }).toPass({ timeout: 15_000 });
  return summary.locator('..');
}

async function assertHeadline(page: Page) {
  const root = panel(page);
  await expect(root).toBeVisible();
  const expected = [
    ['Settled spend', '830.00 ETB'],
    ['Committed cost', '1,010.00 ETB'],
    ['Comparable CPV', '0.0533 ETB'],
    ['Comparable CPE', '3.9 ETB'],
    ['Deals completed', '6 / 8'],
  ];
  for (const [label, value] of expected)
    await expect(stat(root, label).locator('dd').first()).toHaveText(value);
  await expect(stat(root, 'Comparable CPV')).toContainText(
    '4 completed measured deals · 5 videos · 640.00 ETB cost'
  );
  await expect(stat(root, 'Comparable CPE')).toContainText(
    '4 completed measured deals · 5 videos · 390.00 ETB cost'
  );
  await expect(stat(root, 'Deals completed')).toContainText(
    '10 submitted / 11 ordered videos'
  );
  await expect(stat(root, 'views').locator('dd').first()).toHaveText('13,800');
  await expect(stat(root, 'views')).toContainText('8 / 11 videos measured');
  await expect(stat(root, 'likes').locator('dd').first()).toHaveText('118');
  await expect(stat(root, 'comments').locator('dd').first()).toHaveText('0');
  await expect(stat(root, 'shares')).toContainText('9 / 11 videos measured');
  await expect(root.getByText('999,999', { exact: true })).toHaveCount(0);
}

async function assertComparisons(page: Page) {
  const root = panel(page);
  const cpv = root.getByRole('region', { name: 'CPV exact creator values' });
  const cpe = root.getByRole('region', { name: 'CPE exact creator values' });
  const h = fixtures.handles;
  const expected = [
    [cpv, h.legacy, '40.00 ETB6.3%', '2,00016.7%', '0.02 ETB'],
    [cpv, h.alpha, '200.00 ETB31.3%', '4,00033.3%', '0.05 ETB'],
    [cpv, h.beta, '300.00 ETB46.9%', '6,00050.0%', '0.05 ETB'],
    [cpv, h.zero, '100.00 ETB15.6%', '00.0%', 'Unavailable'],
    [cpe, h.gamma, '50.00 ETB12.8%', '5050.0%', '1 ETB'],
    [cpe, h.legacy, '40.00 ETB10.3%', '2020.0%', '2 ETB'],
    [cpe, h.alpha, '200.00 ETB51.3%', '3030.0%', '6.6667 ETB'],
    [cpe, h.zero, '100.00 ETB25.6%', '00.0%', 'Unavailable'],
  ] as const;
  for (const [table, handle, cost, results, ratio] of expected) {
    const row = table.getByRole('row').filter({ hasText: `@${handle}` });
    await expect(row.getByRole('cell')).toHaveText([cost, results, ratio]);
  }
  for (const table of [cpv, cpe]) {
    for (const handle of [h.duplicate, h.refunded, h.missing]) {
      const row = table.getByRole('row').filter({ hasText: `@${handle}` });
      await expect(row.getByRole('cell').last()).toHaveText('Unavailable');
      await expect(row.getByRole('rowheader')).toContainText(
        '0 deals · 0 videos'
      );
    }
  }
  await expect(
    cpe
      .getByRole('row')
      .filter({ hasText: `@${h.beta}` })
      .getByRole('cell')
      .last()
  ).toHaveText('Unavailable');
  await expect(
    cpv
      .getByRole('row')
      .filter({ hasText: `@${h.gamma}` })
      .getByRole('cell')
      .last()
  ).toHaveText('Unavailable');
  await expect(cpv.locator('tbody th')).toContainText([
    `@${h.legacy}`,
    `@${h.alpha}`,
    `@${h.beta}`,
  ]);
}

async function paintedBars(chart: Locator) {
  await expect(chart).toBeVisible();
  await expect
    .poll(() => chart.locator('.recharts-bar-rectangle path').count())
    .toBeGreaterThan(0);
  await expect(async () => {
    const box = await chart.boundingBox();
    expect(box?.height).toBeGreaterThan(100);
    expect(box?.width).toBeGreaterThan(100);
  }).toPass({ timeout: 5_000 });
  const bars = await chart
    .locator('.recharts-bar-rectangle path')
    .evaluateAll((paths) =>
      paths.map((path) => {
        const box = (path as SVGGraphicsElement).getBBox();
        return {
          width: box.width,
          height: box.height,
          fill: getComputedStyle(path).fill,
          opacity: getComputedStyle(path).opacity,
        };
      })
    );
  for (const bar of bars.filter((bar) => bar.width > 0)) {
    expect(bar.height).toBeGreaterThan(0);
    expect(bar.fill).not.toBe('none');
    expect(bar.fill).not.toBe('rgba(0, 0, 0, 0)');
    expect(Number(bar.opacity)).toBeGreaterThan(0);
  }
}

async function contributionGeometry(
  chart: Locator,
  expected: readonly (readonly number[])[]
) {
  await paintedBars(chart);
  const series = chart.locator('.recharts-bar');
  await expect(series).toHaveCount(2);
  for (const [index, percentages] of expected.entries()) {
    const widths = await series
      .nth(index)
      .locator('.recharts-bar-rectangle path')
      .evaluateAll((paths) =>
        paths
          .map((path) => (path as SVGGraphicsElement).getBBox().width)
          .filter((width) => width > 0)
      );
    expect(widths).toHaveLength(percentages.length);
    const total = widths.reduce((sum, width) => sum + width, 0);
    widths.forEach((width, i) => {
      expect((width / total) * 100).toBeCloseTo(percentages[i], 2);
    });
  }
}

async function efficiencyGeometry(chart: Locator, values: readonly number[]) {
  await paintedBars(chart);
  const widths = await chart
    .locator('.recharts-bar-rectangle path')
    .evaluateAll((paths) =>
      paths
        .map((path) => (path as SVGGraphicsElement).getBBox().width)
        .filter((width) => width > 0)
    );
  expect(widths).toHaveLength(values.length);
  const widthSum = widths.reduce((sum, width) => sum + width, 0);
  const valueSum = values.reduce((sum, value) => sum + value, 0);
  widths.forEach((width, index) => {
    expect(width / widthSum).toBeCloseTo(values[index] / valueSum, 4);
  });
}

test('draft retains its cart and confirmed missing metrics keeps funding useful', async ({
  page,
}, info) => {
  await page.goto(`/campaigns/${fixtures.draft}`);
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Cart (0)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit brief' })).toBeVisible();
  await expect(
    page.getByText('Your cart is empty', { exact: true })
  ).toBeVisible();
  await page.goto(`/campaigns/${fixtures.empty}`);
  const root = panel(page);
  await expect(root).toBeVisible();
  await expect(stat(root, 'Settled spend').locator('dd').first()).toHaveText(
    '0.00 ETB'
  );
  await expect(stat(root, 'Committed cost').locator('dd').first()).toHaveText(
    '100.00 ETB'
  );
  await expect(stat(root, 'Comparable CPV').locator('dd').first()).toHaveText(
    'Unavailable'
  );
  await expect(stat(root, 'views').locator('dd').first()).toHaveText('Pending');
  await expect(root.getByText('Metrics pending', { exact: true })).toHaveCount(
    2
  );
  await expect(root.getByRole('img')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Fund campaign/i })
  ).toBeEnabled();
  await expect(page.locator('aside')).toContainText('Committed');
  await noPageOverflow(page);
  await screenshot(page, info, 'confirmed-missing-metrics');
});

test('populated math and painted contributions reconcile without hover', async ({
  page,
}, info) => {
  await page.goto(`/campaigns/${fixtures.populated}`);
  await assertHeadline(page);
  await assertComparisons(page);
  const root = panel(page);
  await expect(
    root.getByText('Repeated video identity', { exact: true })
  ).toBeVisible();
  await expect(
    root.getByText('Some reported counts are marked stale', { exact: true })
  ).toBeVisible();
  await contributionGeometry(
    root.getByRole('img', {
      name: 'Cost share (%) and views share (%). Exact values follow.',
    }),
    [
      [6.25, 31.25, 46.875, 15.625],
      [100 / 6, 100 / 3, 50],
    ]
  );
  await contributionGeometry(
    root.getByRole('img', {
      name: 'Cost share (%) and engagements share (%). Exact values follow.',
    }),
    [
      [5000 / 390, 4000 / 390, 20000 / 390, 10000 / 390],
      [50, 20, 30],
    ]
  );
  await expect(page.locator('aside')).toContainText('180.00 ETB');
  await expect(page.locator('aside')).toContainText('705.50 ETB');
  await expect(page.locator('aside')).toContainText('124.50 ETB');
  await expect(page.locator('aside')).toContainText('80.00 ETB');
  await noPageOverflow(page);
  await screenshot(page, info, 'populated-comparison');
});

test('keyboard and touch expose revision, timing and exact efficiency evidence with reduced motion', async ({
  page: signedInPage,
  isMobile,
}, info) => {
  // A fresh authenticated tab isolates hydration from the dashboard's
  // in-flight prefetch requests being aborted on navigation in WebKit.
  const page = await signedInPage.context().newPage();
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/campaigns/${fixtures.populated}`);
  const root = panel(page);
  await paintedBars(
    root.getByRole('img', {
      name: 'Cost share (%) and views share (%). Exact values follow.',
    })
  );
  const cpv = await openDisclosure(page, 'View CPV chart', isMobile);
  await efficiencyGeometry(cpv.getByRole('img'), [0.02, 0.05, 0.05]);
  const cpe = await openDisclosure(page, 'View CPE chart', isMobile);
  await efficiencyGeometry(cpe.getByRole('img'), [1, 2, 20 / 3]);
  const exactValues = root.getByRole('region', {
    name: 'CPV exact creator values',
  });
  await exactValues.focus();
  await expect(exactValues).toBeFocused();
  if (isMobile) {
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => exactValues.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
  }
  const evidence = await openDisclosure(
    page,
    'Deal & video efficiency evidence',
    isMobile
  );
  await expect(evidence).toContainText('creator reported');
  await expect(evidence).toContainText('admin reported');
  await expect(evidence).toContainText('marked stale');
  await expect(
    evidence.getByText('Video 1 · repeated identity, comparison suppressed')
  ).toHaveCount(1);
  await expect(evidence).toContainText('CPV Unavailable · CPE Unavailable');
  await screenshot(page, info, 'video-efficiency-evidence');
  const creator = await openDisclosure(
    page,
    `@${fixtures.handles.alpha} · collaboration evidence`,
    isMobile
  );
  await expect(
    stat(creator, 'Offers ever accepted / issued').locator('dd').first()
  ).toHaveText('1 / 1');
  await expect(stat(creator, 'Deals revised / reached review')).toContainText(
    '1 brand / 0 admin / 0 unknown-actor revised deals'
  );
  await expect(
    stat(creator, 'Videos revised / fully captured reviewed')
  ).toContainText('1 / 2');
  await expect(
    stat(creator, 'Approved without revision / batch approved')
      .locator('dd')
      .first()
  ).toHaveText('1 / 2');
  for (const label of ['Full delivery', 'Replacement'])
    await expect(stat(creator, label).locator('dd').first()).toHaveText(
      '2 hr · n=1'
    );
  await expect(
    stat(creator, 'Review decision').locator('dd').first()
  ).toHaveText('1.5 hr · n=2');
  await expect(creator).toContainText(
    '1 feedback · 1 brand / 0 admin / 0 unknown'
  );
  await efficiencyGeometry(
    creator.getByRole('img', {
      name: 'Median hours. Exact values follow.',
    }),
    [2, 1.5, 2]
  );
  const gamma = await openDisclosure(
    page,
    `@${fixtures.handles.gamma} · collaboration evidence`,
    isMobile
  );
  await expect(gamma).toContainText(
    '1 admin-released videos are not brand approvals (1 deals)'
  );
  const legacy = await openDisclosure(
    page,
    `@${fixtures.handles.legacy} · collaboration evidence`,
    isMobile
  );
  await expect(
    stat(legacy, 'Videos revised / fully captured reviewed')
  ).toContainText('1 limited histories excluded');
  await expect(
    stat(legacy, 'Approved without revision / batch approved')
      .locator('dd')
      .first()
  ).toHaveText('0 / 0');
  await expect(stat(legacy, 'Full delivery').locator('dd').first()).toHaveText(
    'Unavailable · n=0'
  );
  await expect(
    root.getByRole('link', { name: 'Open waiting deal', exact: true })
  ).toHaveAttribute('href', `/deals/${fixtures.dealIds.missing}`);
  await expect(
    page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  ).resolves.toBe(true);
  await noPageOverflow(page);
  await screenshot(page, info, 'collaboration-reliability-timing');
  expect(
    browserErrors,
    'Reduced-motion rendering must not fail hydration'
  ).toEqual([]);
});

test('server-rendered exact values and native disclosures survive disabled JavaScript', async ({
  page,
  browser,
}, info) => {
  const context = await browser.newContext({
    ...info.project.use,
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
    reducedMotion: 'reduce',
  });
  try {
    const ssr = await context.newPage();
    await ssr.goto(`/campaigns/${fixtures.populated}`);
    await screenshot(ssr, info, 'no-javascript-initial-render');
    await assertHeadline(ssr);
    await assertComparisons(ssr);
    await openDisclosure(ssr, 'Deal & video efficiency evidence', false);
    await expect(panel(ssr)).toContainText('admin reported');
    await noPageOverflow(ssr);
    await screenshot(ssr, info, 'no-javascript-exact-values');
  } finally {
    await context.close();
  }
});

test('cancelled one-creator campaign is not a ranking and admin cannot read brand insights', async ({
  page,
}, info) => {
  await page.goto(`/campaigns/${fixtures.solo}`);
  const root = panel(page);
  await expect(
    root.getByText('One creator: these are recorded values, not a ranking.', {
      exact: false,
    })
  ).toHaveCount(2);
  await expect(stat(root, 'Settled spend')).toContainText(
    '100.00 ETB refunded separately'
  );
  await expect(stat(root, 'Comparable CPV').locator('dd').first()).toHaveText(
    'Unavailable'
  );
  await noPageOverflow(page);
  await screenshot(page, info, 'cancelled-one-creator');
  await page.context().clearCookies();
  await signIn(page, DEMO.admin);
  await page.goto(`/campaigns/${fixtures.populated}`);
  await expect(panel(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(
    new RegExp(`/campaigns/${fixtures.populated}$`)
  );
});
