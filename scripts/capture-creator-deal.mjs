// One-off marketing capture: signs in as the demo creator, opens the funded
// deal's detail page, and screenshots its work column into
// public/marketing/creator-deal.webp (lossless) at 2x.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { unlink } from 'node:fs/promises';

const BASE = process.env.CAPTURE_BASE ?? 'http://localhost:3000';
const TMP = 'public/marketing/creator-deal.capture.png';
const OUT = 'public/marketing/creator-deal.webp';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 2400 },
  deviceScaleFactor: 2,
});

await page.goto(`${BASE}/sign-in`);
await page.fill('input[type=email]', 'creator@demo.com');
await page.fill('input[type=password]', 'demo-Passw0rd!');
await page.click('button:has-text("Sign in")');
await page.waitForURL('**/creator', { timeout: 60_000 });

// The funded deal reads best: escrow held, delivery form live.
await page.click('.bd-cr-dashdeal--live');
await page.waitForURL('**/creator/deals/**', { timeout: 60_000 });
await page.waitForSelector('.bd', { timeout: 60_000 });
await page.waitForTimeout(2200);

const clip = await page.evaluate(() => {
  const bd = document.querySelector('.bd');
  const r = bd.getBoundingClientRect();
  const pad = 8;
  return {
    x: Math.max(r.left - pad, 0) + window.scrollX,
    y: r.top - pad + window.scrollY,
    width: r.width + pad * 2,
    height: Math.min(r.height + pad * 2, 2300),
  };
});

await page.screenshot({ path: TMP, clip });
await sharp(TMP).webp({ lossless: true, effort: 6 }).toFile(OUT);
await unlink(TMP);
console.log('captured', OUT, JSON.stringify(clip));
await browser.close();
