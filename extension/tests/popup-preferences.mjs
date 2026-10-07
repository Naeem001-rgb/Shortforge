// Exercise the popup with the real MV3 worker and Chrome storage in an isolated profile.
// No live social pages, engine requests, owner preferences, or Library data are used.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, cp, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from '../node_modules/esbuild/lib/main.js';
import { chromium } from '../../dashboard/node_modules/playwright/index.mjs';

const extension = resolve(import.meta.dirname, '..');
const fixture = await mkdtemp(resolve(tmpdir(), 'shortforge-popup-preferences-'));
const dist = resolve(fixture, 'extension');
const profile = resolve(fixture, 'profile');
const screenshots = resolve(extension, '../.impeccable/review');
await mkdir(dist);
await mkdir(screenshots, { recursive: true });
await cp(resolve(extension, 'static'), dist, { recursive: true });
await build({
  entryPoints: ['background', 'content', 'popup'].map(name => resolve(extension, `src/${name}.ts`)),
  outdir: dist, bundle: true, target: 'chrome120', format: 'iife',
});
const chromeProcess = spawn(chromium.executablePath(), [
  '--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--disable-component-extensions-with-background-pages', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, '--disable-extensions-except=' + dist,
  '--load-extension=' + dist, 'about:blank',
], { stdio: 'ignore' });
const exited = new Promise(resolve => chromeProcess.once('exit', resolve));
let browser;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await wait(100);
  }
  throw new Error('Timed out: ' + label);
}

try {
  const port = await until(async () => {
    try { return await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8'); }
    catch { return null; }
  }, 'isolated Chrome startup');
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port.split('\n')[0]);
  const context = browser.contexts()[0];
  const worker = await until(async () => {
    for (const candidate of context.serviceWorkers()) {
      if (!candidate.url().startsWith('chrome-extension://')) continue;
      if (await candidate.evaluate(() => chrome.runtime.getManifest().name === 'ShortForge Scout')) return candidate;
    }
    return null;
  }, 'Scout worker');
  await worker.evaluate(() => {
    globalThis.fetch = async () => { throw new Error('Preferences must not request live data'); };
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 392, height: 600 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);
  await until(() => page.locator('#minLikes').inputValue().then(value => value === '5000'), 'initial defaults');
  const state = () => worker.evaluate(async () => (await chrome.storage.local.get('scout')).scout);
  const preferences = async () => (await state())?.settings;
  const input = async (id, value) => {
    await page.locator('#' + id).fill(String(value));
    await page.locator('#' + id).dispatchEvent('change');
    await until(async () => (await preferences())?.[id] === value, `saved ${id}=${value}`);
  };
  const policy = async value => {
    await page.locator('#captionFilter').selectOption(value);
    await until(async () => (await preferences())?.captionFilter === value, `saved ${value}`);
  };

  // Bounds, not isVisible(), prove the primary controls need no scrolling.
  const dock = await page.locator('.actions').boundingBox();
  for (const id of ['minLikes', 'minViews', 'captionFilter']) {
    const box = await page.locator('#' + id).boundingBox();
    assert.ok(box.y >= 65 && box.y + box.height < dock.y, `${id} is above the action dock`);
  }
  assert.match(await page.locator('#count-help').textContent(), /0 = no minimum/);
  await input('minLikes', 125);
  await input('minViews', 2500);
  await input('target', 12);
  await policy('small-text-no-speech');
  await input('maxCaptionSeconds', 2);
  await input('sourceUrl', 'https://www.instagram.com/qianxiang_guyue/reels/');
  assert.match(await page.locator('#caption-help').textContent(), /Small Chinese annotations allowed\. Requires no detected speech/);
  assert.match(await page.locator('#caption-help').textContent(), /Other text: up to 2 seconds/);
  assert.equal(await page.locator('#caption-allowance-label').textContent(), 'Other text (sec.)');
  await page.reload();
  await until(() => page.locator('#minLikes').inputValue().then(value => value === '125'), 'custom values restored');
  for (const [id, expected] of Object.entries({ minLikes: '125', minViews: '2500', target: '12', maxCaptionSeconds: '2', captionFilter: 'small-text-no-speech' })) {
    assert.equal(await page.locator('#' + id).inputValue(), expected, `${id} survives reopening`);
  }
  await policy('brief-only');
  assert.equal(await page.locator('#caption-allowance').isHidden(), false);
  assert.match(await page.locator('#caption-help').textContent(), /2 seconds of visible text/);
  await policy('off');
  assert.equal(await page.locator('#caption-allowance').isHidden(), true);
  assert.match(await page.locator('#caption-help').textContent(), /without checking.*speech/);
  await policy('small-text-no-speech');
  assert.equal(await page.locator('#caption-allowance').isHidden(), false);

  // Large legitimate counts fit the two-column fields. Invalid values never save.
  await input('minLikes', 0);
  await input('minViews', 1000000000000);
  assert.ok(await page.locator('#minViews').evaluate(element => {
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    context.font = style.font;
    return context.measureText(element.value).width <= element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  }), 'maximum count fits without clipping');
  for (const invalid of ['', '-1', '1.5', '1000000000001']) {
    await page.locator('#minViews').fill(invalid);
    await page.locator('#minViews').dispatchEvent('change');
    await until(() => page.locator('#minViews').getAttribute('aria-invalid').then(value => value === 'true'), `validation for ${JSON.stringify(invalid)}`);
    assert.equal((await preferences()).minViews, 1000000000000, 'invalid value cannot replace stored minimum');
    assert.match(await page.locator('#error').textContent(), /Minimum views: enter a whole number/);
  }
  await input('minViews', 2500);
  await page.reload();
  await until(() => page.locator('#minLikes').inputValue().then(value => value === '0'), 'zero minimum restored');
  assert.equal(await page.locator('#minViews').inputValue(), '2500');
  assert.equal(await page.locator('#captionFilter').inputValue(), 'small-text-no-speech');
  assert.equal(await page.locator('#error').isHidden(), true);

  // A disabled caption check must not validate an unfinished hidden allowance.
  await context.route('https://www.instagram.com/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><main><h1>Fixture account</h1></main>',
  }));
  await worker.evaluate(() => {
    globalThis.preferenceRequests = [];
    globalThis.fetch = async url => {
      globalThis.preferenceRequests.push(String(url));
      if (String(url) !== 'http://127.0.0.1:8787/api/clips') throw new Error('Unexpected fixture request: ' + url);
      return new Response(JSON.stringify({ clips: [] }), { headers: { 'Content-Type': 'application/json' } });
    };
  });
  for (const invalid of ['', '-1', '11']) {
    await policy('brief-only');
    await page.locator('#maxCaptionSeconds').fill(invalid);
    await page.locator('#maxCaptionSeconds').dispatchEvent('change');
    await until(() => page.locator('#maxCaptionSeconds').getAttribute('aria-invalid').then(value => value === 'true'), `allowance rejects ${JSON.stringify(invalid)}`);
    await policy('off');
    assert.equal((await preferences()).maxCaptionSeconds, 2, 'off keeps the last valid allowance');
    assert.equal(await page.locator('#caption-allowance').isHidden(), true);
    assert.equal(await page.locator('#maxCaptionSeconds').getAttribute('aria-invalid'), null);
    assert.equal(await page.locator('#error').isHidden(), true);
    const previousSession = (await state()).sessionId;
    await page.locator('#start').click();
    await until(async () => (await state()).sessionId !== previousSession, 'Any captions starts despite prior invalid allowance');
    assert.equal((await preferences()).captionFilter, 'off');
    assert.equal((await preferences()).maxCaptionSeconds, 2);
    assert.equal(await page.locator('#error').isHidden(), true);
    await page.locator('#stop').click();
    await until(async () => (await state()).status === 'stopped', 'fixture session stops');
  }
  assert.ok((await worker.evaluate(() => globalThis.preferenceRequests)).every(url => url.endsWith('/clips')), 'Any captions starts without requesting a caption analysis');
  // A valid value being typed when the check is disabled remains useful later.
  await policy('brief-only');
  await page.locator('#maxCaptionSeconds').fill('4.5');
  await policy('off');
  assert.equal((await preferences()).maxCaptionSeconds, 4.5);
  await policy('small-text-no-speech');
  assert.equal(await page.locator('#maxCaptionSeconds').inputValue(), '4.5');
  await input('maxCaptionSeconds', 2);

  // One batched visual pass at the actual Chrome popup size in both themes.
  for (const colorScheme of process.argv.includes('--no-screenshots') ? [] : ['light', 'dark']) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.locator('main').evaluate(element => { element.scrollTop = 0; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const box = await page.locator('.actions').boundingBox();
    assert.equal(box.y + box.height, 600, 'action dock stays in the popup');
    await page.screenshot({ path: resolve(screenshots, `scout-preferences-${colorScheme}.png`) });
  }
  assert.deepEqual(pageErrors, [], 'no unhandled page errors');
  console.log('Passed: real MV3 preferences persist custom/zero count limits and optional caption policy; invalid counts cannot save; disabling captions with an unfinished allowance saves and starts; controls fit at 392×600.');
} finally {
  await browser?.close();
  chromeProcess.kill('SIGTERM');
  await exited;
  await rm(fixture, { recursive: true, force: true, maxRetries: 3 });
}
