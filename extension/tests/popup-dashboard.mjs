// The dashboard link used to be a bare <a href>, so a stopped dev server
// produced Chrome's "localhost refused to connect" page. These checks load
// the real built popup and confirm it explains the problem instead.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../../dashboard/node_modules/playwright/index.mjs';

const dist = resolve(import.meta.dirname, '../dist');
const types = ['text/html', 'text/javascript', 'text/css', 'application/json'];

async function openPopup(browser, { engineUp, dashboardUp }) {
  const page = await browser.newPage();
  await page.route('https://scout.test/**', async route => {
    const file = route.request().url().replace('https://scout.test/', '');
    const body = await readFile(resolve(dist, file || 'popup.html'));
    const type = types[file.split('.').pop().replace('html', 0)] ?? 'text/html';
    await route.fulfill({ contentType: type, body });
  });
  await page.addInitScript(
    ({ engineUp, dashboardUp }) => {
      globalThis.fixture = { opened: [] };
      globalThis.chrome = {
        runtime: { getURL: path => `chrome-extension://${'a'.repeat(32)}/${path}`, sendMessage: async () => ({ state: undefined }), onMessage: { addListener() {} } },
        tabs: { create: async ({ url }) => { globalThis.fixture.opened.push(url); } },
        storage: {
          local: { get: async () => ({}), set: async () => {} },
          onChanged: { addListener() {} },
        },
      };
      // Only the two endpoints the button probes; anything else fails closed.
      globalThis.fetch = async url => {
        if (url.includes('8787')) {
          if (!engineUp) throw new TypeError('Failed to fetch');
          return { ok: true, json: async () => ({ status: 'ok' }) };
        }
        if (url.includes('5173')) {
          if (!dashboardUp) throw new TypeError('Failed to fetch');
          return { ok: true };
        }
        throw new TypeError('unexpected fetch');
      };
    },
    { engineUp, dashboardUp },
  );
  await page.goto('https://scout.test/popup.html');
  await page.getByLabel('Open ShortForge dashboard').click();
  await page.waitForTimeout(400);
  return page;
}

const browser = await chromium.launch({ headless: true });
try {
  const working = await openPopup(browser, { engineUp: true, dashboardUp: true });
  assert.deepEqual(await working.evaluate(() => globalThis.fixture.opened), [
    `chrome-extension://${'a'.repeat(32)}/studio/index.html`,
  ]);
  assert.equal(await working.locator('#error').isHidden(), true, 'no error when healthy');
  await working.close();

  const dashboardDown = await openPopup(browser, { engineUp: true, dashboardUp: false });
  assert.deepEqual(
    await dashboardDown.evaluate(() => globalThis.fixture.opened),
    [`chrome-extension://${'a'.repeat(32)}/studio/index.html`],
    'packaged Studio must open without Vite',
  );
  assert.equal(await dashboardDown.locator('#error').isHidden(), true);
  await dashboardDown.close();

  const engineDown = await openPopup(browser, { engineUp: false, dashboardUp: true });
  assert.deepEqual(await engineDown.evaluate(() => globalThis.fixture.opened), []);
  assert.match(await engineDown.locator('#error').textContent(), /start\.sh/);
  await engineDown.close();

  console.log(
    'Popup check passed: the dashboard button opens bundled Studio with only the engine running and explains how to restart a stopped engine.',
  );
} finally {
  await browser.close();
}
