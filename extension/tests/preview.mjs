import { chromium } from '../../dashboard/node_modules/playwright/index.mjs';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
await mkdir('tests/screenshots', { recursive: true });
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 392, height: 600 }, colorScheme: scheme });
  await page.addInitScript(() => {
    const initial = { status: 'idle', settings: { target: 30, minLikes: 5000, minViews: 10000, mode: 'narrated' }, activeMode: 'narrated', tabId: null, scanned: 0, matched: 0, saved: 0, creditMisses: 0, reason: 'Open a YouTube Short, then start scouting.', pending: [], knownIds: [], seenIds: [], logs: [] };
    globalThis.chrome = { runtime: { sendMessage: async () => ({ state: initial }) }, storage: { onChanged: { addListener() {} } }, tabs: { query: async () => [] } };
  });
  await page.goto('file://' + resolve('dist/popup.html'));
  await page.screenshot({ path: `tests/screenshots/popup-${scheme}.png`, fullPage: true });
  console.log(scheme, await page.evaluate(() => ({ width: document.body.scrollWidth, height: document.body.scrollHeight, startBottom: document.getElementById('start').getBoundingClientRect().bottom, font: getComputedStyle(document.body).fontSize })));
  await page.getByRole('button', { name: 'Self-test', exact: true }).click();
  await page.getByText('Open a YouTube Short first, then run Self-test.').waitFor();
  await page.close();
}
await browser.close();
