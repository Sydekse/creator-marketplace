import { expect, test } from '@playwright/test';
import { DEMO, signIn } from './helpers';

/**
 * KAN-60 flow 7 — RBAC negatives (NFR-005). A creator cannot reach brand or
 * admin surfaces, and vice versa — both the page-level gates (role layouts
 * redirect) and the API-level gates (a wrong-role session gets 403).
 */
test('flow 7: a creator cannot reach brand or admin surfaces', async ({
  browser,
}) => {
  const creator = await browser.newPage();
  await signIn(creator, DEMO.creator);

  // Page-level: the admin console redirects a creator away.
  await creator.goto('/admin');
  await expect(creator).not.toHaveURL(/\/admin/);

  // Page-level: the brand's campaign list is not the creator's.
  await creator.goto('/campaigns');
  await expect(creator).not.toHaveURL(/\/campaigns/);

  // API-level: admin endpoints refuse the creator's session with 403.
  // `/api/admin/campaigns` exists as a real admin list (there is no
  // `/api/admin/creators` list route — only the per-creator verify and
  // assign-tier mutations).
  const adminList = await creator.request.get('/api/admin/campaigns');
  expect(adminList.status()).toBe(403);

  // API-level: brand-only mutation (fund) is refused for a creator too.
  const fund = await creator.request.post('/api/campaigns/some-id/fund');
  expect(fund.status()).toBe(403);
  await creator.close();
});

test('flow 7b: a brand cannot reach creator or admin surfaces', async ({
  browser,
}) => {
  const brand = await browser.newPage();
  await signIn(brand, DEMO.brand);

  await brand.goto('/creator/deals');
  await expect(brand).not.toHaveURL(/\/creator\/deals/);

  await brand.goto('/admin');
  await expect(brand).not.toHaveURL(/\/admin/);

  const adminList = await brand.request.get('/api/admin/campaigns');
  expect(adminList.status()).toBe(403);
  await brand.close();
});
