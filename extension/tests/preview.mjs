import assert from 'node:assert/strict';
import { chromium } from '../../dashboard/node_modules/playwright/index.mjs';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true });
const screenshots = resolve('../.impeccable/review/scout-redesign');
await mkdir(screenshots, { recursive: true });
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 392, height: 600 }, colorScheme: scheme, reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const initial = { status: 'idle', settings: { target: 30, minLikes: 5000, minViews: 10000, mode: 'narrated' }, activeMode: 'narrated', tabId: null, scanned: 0, matched: 0, saved: 0, creditMisses: 0, reason: 'Open a Short or Reel, or paste an account above.', pending: [], knownIds: [], seenIds: [], logs: [], lastScan: null };
    globalThis.fixture = { state: initial, storageListeners: [] };
    globalThis.chrome = { runtime: { sendMessage: async () => ({ state: fixture.state }) }, storage: { onChanged: { addListener(listener) { fixture.storageListeners.push(listener); } } }, tabs: { query: async () => [] } };
  });
  await page.goto('file://' + resolve('dist/popup.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.getByText('Idle', { exact: true }).waitFor();
  assert.ok((await page.locator('#start').boundingBox()).y + (await page.locator('#start').boundingBox()).height <= 600, 'primary controls stay inside Chrome popup viewport');
  const dock = await page.locator('.actions').boundingBox();
  for (const control of [...await page.locator('.mode-choice').all(), page.locator('#minLikes'), page.locator('#minViews')]) {
    const box = await control.boundingBox();
    assert.ok(box.y >= 60 && box.y + box.height <= dock.y, 'all modes and count controls appear before scrolling');
    assert.ok(box.height >= 40, 'primary targets remain comfortably sized');
  }
  assert.equal(await page.locator('#last-scan').isVisible(), false);
  assert.match(await page.locator('#mode-help').textContent(), /No credits or keywords required/);
  // Keyboard traversal must scroll focused controls above the separate action row.
  for (let index = 0; index < 14; index++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const node = document.activeElement;
      const r = node.getBoundingClientRect();
      const main = document.querySelector('main').getBoundingClientRect();
      return { tag: node.tagName, top: r.top, bottom: r.bottom, inMain: document.querySelector('main').contains(node), mainTop: main.top, mainBottom: main.bottom };
    });
    if (focused.tag !== 'BODY') {
      assert.ok(focused.top >= 0 && focused.bottom <= 600, 'focused control fits popup viewport');
      if (focused.inMain) assert.ok(focused.top >= focused.mainTop && focused.bottom <= focused.mainBottom, 'focused control is not under the dock');
    }
  }
  await page.evaluate(() => { document.querySelector('main').scrollTop = 0; document.activeElement.blur(); });
  await page.screenshot({ path: resolve(screenshots, `idle-${scheme}.png`), fullPage: true });
  await page.locator('.account-group').evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: resolve(screenshots, `criteria-${scheme}.png`), fullPage: true });
  console.log(scheme, await page.evaluate(() => ({ width: document.body.scrollWidth, height: document.body.scrollHeight, startBottom: document.getElementById('start').getBoundingClientRect().bottom, font: getComputedStyle(document.body).fontSize })));
  await page.evaluate(() => {
    fixture.state = {
      ...fixture.state, status: 'paused', scanned: 36, reason: 'Paused. Resume when you are ready.',
      lastScan: { video_id: 'test0000000', title: 'A surprising moment', likes: 6200, views: null, mode: 'narrated', matched: false, reason: 'Could not read views. Open the description and run Self-test.' },
      logs: [{ at: Date.now(), text: 'Skipped: A surprising moment — 6,200 likes · unreadable views. Could not read views. Open the description and run Self-test.' }],
    };
    for (const listener of fixture.storageListeners) listener({ scout: { newValue: fixture.state } }, 'local');
  });
  assert.equal(await page.locator('#status').innerText(), 'Paused');
  assert.equal(await page.locator('#scanned').innerText(), '36');
  assert.equal(await page.locator('#matched').innerText(), '0 / 30');
  assert.equal(await page.getByRole('button', { name: 'Resume', exact: true }).isEnabled(), true);
  assert.equal(await page.locator('#last-scan').isVisible(), true);
  assert.equal(await page.locator('#last-scan').innerText(), 'Last video: 6,200 likes · unreadable views. Skipped — Could not read views. Open the description and run Self-test.');
  assert.match(await page.locator('#mode-help').textContent(), /No credits or keywords required/);
  await page.locator('#activity summary').click();
  assert.equal(await page.locator('#logs').isVisible(), true);
  assert.match(await page.locator('#logs').innerText(), /6,200 likes · unreadable views/);
  await page.locator('.session').evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: resolve(screenshots, `paused-${scheme}.png`), fullPage: true });
  await page.evaluate(() => {
    fixture.state = {
      ...fixture.state, status: 'running', scanned: 37, matched: 1, saved: 1, reason: 'Scouting…',
      lastScan: { video_id: 'test0000001', title: 'Another surprising moment', likes: 8500, views: 24300, mode: 'narrated', matched: true, reason: 'Meets your limits; review narration in Library' },
      logs: [{ at: Date.now(), text: 'Matched: Another surprising moment — 8,500 likes · 24,300 views. Meets your limits; review narration in Library' }, ...fixture.state.logs],
    };
    for (const listener of fixture.storageListeners) listener({ scout: { newValue: fixture.state } }, 'local');
  });
  assert.equal(await page.locator('#settings').isHidden(), true, 'running session exposes progress above the fold');
  assert.equal(await page.locator('#scanned').innerText(), '37');
  assert.equal(await page.locator('#matched').innerText(), '1 / 30');
  assert.equal(await page.locator('#progress').evaluate(element => element.value), 1);
  assert.equal(await page.locator('#saved-count').innerText(), '1 saved');
  assert.equal(await page.locator('#last-scan').isVisible(), true);
  assert.equal(await page.locator('#last-scan').innerText(), 'Last video: 8,500 likes · 24,300 views. Matched — Meets your limits; review narration in Library');
  assert.equal(await page.locator('#logs li').count(), 2);
  assert.equal(await page.evaluate(() => document.body.scrollWidth <= innerWidth), true);
  await page.locator('main').evaluate(element => { element.scrollTop = 0; });
  assert.equal(await page.locator('body').getAttribute('data-status'), 'running');
  await page.screenshot({ path: resolve(screenshots, `running-${scheme}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Self-test', exact: true }).click();
  await page.getByText('Open a YouTube Short, Instagram Reel, or account page first, then run Self-test.').waitFor();
  await page.evaluate(() => {
    fixture.state = { ...fixture.state, status: 'paused', reason: 'Paused. Resume when you are ready.' };
    for (const listener of fixture.storageListeners) listener({ scout: { newValue: fixture.state } }, 'local');
  });
  await page.locator('#minViews').fill('-1');
  await page.locator('#minViews').dispatchEvent('change');
  await page.getByRole('alert').waitFor();
  const alert = await page.locator('#error').boundingBox();
  const actions = await page.locator('.actions').boundingBox();
  assert.ok(alert.y >= 0 && alert.y + alert.height <= actions.y, 'error stays visible above the action dock');
  await page.screenshot({ path: resolve(screenshots, `error-${scheme}.png`), fullPage: true });
  await page.close();
}
await browser.close();
console.log('Popup regression passed in light and dark: live scanned/matched updates, unreadable-count diagnostics, narrated-mode guidance, successful matches, and Self-test.');
