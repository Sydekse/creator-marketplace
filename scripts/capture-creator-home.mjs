// One-off marketing capture: signs in as the demo creator and screenshots the
// dashboard's work column (Performance overview ruler through the attention
// list) into public/marketing/creator-home.webp (lossless) at 2x.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { unlink } from 'node:fs/promises';

const BASE = process.env.CAPTURE_BASE ?? 'http://localhost:3000';
const TMP = 'public/marketing/creator-home.capture.png';
const OUT = 'public/marketing/creator-home.webp';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 2600 },
  deviceScaleFactor: 2,
});

await page.goto(`${BASE}/sign-in`);
await page.fill('input[type=email]', 'creator@demo.com');
await page.fill('input[type=password]', 'demo-Passw0rd!');
await page.click('button:has-text("Sign in")');
await page.waitForURL('**/creator', { timeout: 30_000 });

// Let entrance animations finish so bars/rings render at rest.
await page.waitForSelector('.bd-crx-reelsvg');
await page.waitForTimeout(2200);

// The whole workspace: hero (profile + tickets), the work column, and the
// profile rail — both columns of the two-column body.
const clip = await page.evaluate(() => {
  const bd = document.querySelector('.bd.bd-crx');
  const signoff = document.querySelector('.bd-signoff');
  const top = bd.getBoundingClientRect();
  const bottom = (signoff ?? bd).getBoundingClientRect();
  const pad = 12;
  return {
    x: Math.max(top.left - pad, 0) + window.scrollX,
    y: top.top - pad + window.scrollY,
    width: top.width + pad * 2,
    height: bottom.bottom - top.top + pad * 2,
  };
});

await page.screenshot({ path: TMP, clip });
await sharp(TMP).webp({ lossless: true, effort: 6 }).toFile(OUT);
await unlink(TMP);
console.log('captured', OUT, JSON.stringify(clip));
await browser.close();
