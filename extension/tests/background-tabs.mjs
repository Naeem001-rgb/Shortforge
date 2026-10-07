// Exercise actual MV3 messaging and tab visibility against a synthetic Shorts page.
// Engine requests are intercepted inside this isolated worker; owner data is untouched.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '../../dashboard/node_modules/playwright/index.mjs';

const dist = resolve(import.meta.dirname, '../dist');
const profile = await mkdtemp(resolve(tmpdir(), 'shortforge-scout-background-'));
// Connecting with noDefaults avoids Playwright's per-page focus emulation,
// which makes inactive tabs appear visible and would hide this regression.
const chromeProcess = spawn(chromium.executablePath(), [
  '--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--disable-component-extensions-with-background-pages',
  '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--disable-extensions-except=' + dist, '--load-extension=' + dist, 'about:blank',
], { stdio: 'ignore' });
const exited = new Promise(resolve => chromeProcess.once('exit', resolve));
let browser;
let context;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await wait(200);
  }
  throw new Error('Timed out: ' + label);
}
try {
  const portFile = await until(async () => {
    try { return await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8'); }
    catch { return null; }
  }, 'isolated Chrome startup', 15000);
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + portFile.split('\n')[0], { noDefaults: true });
  context = browser.contexts()[0];
  await context.route('https://www.youtube.com/**', route => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><html><body>
      <style>ytd-reel-video-renderer{display:block;width:350px;height:500px}ytd-engagement-panel-section-list-renderer{display:block}button{min-width:40px;min-height:40px}</style>
      <ytd-reel-video-renderer is-active><h2 id="title">Background Scout test</h2><a href="/@test">Test channel</a><div id="like-button"><button aria-label="Like this video along with 6,200 other people">6.2K</button></div><button id="open" aria-label="Description">Description</button></ytd-reel-video-renderer>
      <button id="next" aria-label="Next video">Next</button>
      <ytd-engagement-panel-section-list-renderer id="panel" target-id="engagement-panel-searchable-description" visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN" style="display:none"><div id="description-inline-expander">Test footage</div><div id="view-count">56,000 Views</div><button id="close" aria-label="Close">Close</button></ytd-engagement-panel-section-list-renderer>
      <script>
        window.advances = 0;
        const panel = document.getElementById('panel');
        document.getElementById('open').onclick = () => { panel.style.display = 'block'; panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'); };
        document.getElementById('close').onclick = () => { panel.style.display = 'none'; panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'); };
        document.getElementById('next').onclick = () => { window.advances++; history.pushState({}, '', '/shorts/test' + String(window.advances).padStart(7, '0')); };
      </script></body></html>`,
  }));
  await context.route('https://scout-background.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Other work</h1>' }));
  const worker = await until(async () => {
    for (const candidate of context.serviceWorkers()) {
      if (!candidate.url().startsWith('chrome-extension://')) continue;
      try {
        if (await candidate.evaluate(() => chrome.runtime.getManifest().name === 'ShortForge Scout')) return candidate;
      } catch { /* A worker can stop while Chrome is starting. */ }
    }
    return null;
  }, 'Scout service worker', 15000);
  const extensionId = new URL(worker.url()).hostname;
  await worker.evaluate(() => {
    const known = new Set();
    globalThis.fetch = async (url, options = {}) => {
      if (String(url) !== 'http://127.0.0.1:8787/api/clips') throw new Error('Unexpected test request: ' + url);
      let added = 0;
      if (options.body) for (const clip of JSON.parse(options.body).clips) {
        if (!known.has(clip.video_id)) { known.add(clip.video_id); added++; }
      }
      return new Response(JSON.stringify({ clips: [...known].map(video_id => ({ video_id })), added }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });
  const source = await context.newPage();
  await source.goto('https://www.youtube.com/shorts/test0000000');
  const sourceTab = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.youtube.com/shorts/*' }))[0]);
  const controller = await context.newPage();
  await controller.goto('chrome-extension://' + extensionId + '/popup.html');
  await until(() => worker.evaluate(async id => {
    try { return !!(await chrome.tabs.sendMessage(id, { type: 'selftest' })).checks; }
    catch { return false; }
  }, sourceTab.id), 'content script ready');
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), sourceTab.id);
  const response = await controller.evaluate(tabId => chrome.runtime.sendMessage({
    type: 'start', tabId, settings: { target: 3, minLikes: 5000, minViews: 10000, mode: 'narrated', captionFilter: 'off' },
  }), sourceTab.id);
  assert.equal(response.error, undefined);
  const state = () => worker.evaluate(async () => (await chrome.storage.local.get('scout')).scout);
  await until(async () => (await state()).matched === 1, 'first foreground match');
  assert.equal((await worker.evaluate(id => chrome.tabs.get(id), sourceTab.id)).autoDiscardable, false);
  const other = await worker.evaluate(windowId => chrome.tabs.create({ windowId, url: 'https://scout-background.test/', active: true }), sourceTab.windowId);
  await controller.close(); // The popup must not be needed to keep the session alive.
  await until(() => source.evaluate(() => document.visibilityState === 'hidden'), 'actual hidden Shorts tab', 5000);
  await until(async () => {
    const current = await state();
    assert.notEqual(current.status, 'paused', current.reason);
    return current.status === 'complete';
  }, 'target reached while another tab is active');
  const completed = await state();
  assert.equal(completed.matched, 3);
  assert.equal(completed.saved, 3);
  assert.equal(completed.scanned, 3);
  assert.equal(completed.tabProtection, null);
  assert.equal(await source.evaluate(() => document.visibilityState), 'hidden');
  assert.equal((await worker.evaluate(id => chrome.tabs.get(id), other.id)).active, true);
  assert.equal((await worker.evaluate(id => chrome.tabs.get(id), sourceTab.id)).autoDiscardable, sourceTab.autoDiscardable);
  await wait(10000);
  assert.equal(await source.evaluate(() => window.advances), 2, 'No further navigation after target');
  assert.equal((await state()).scanned, 3);
  console.log('Passed: real MV3 background-tab collection reaches exactly 3 matches with the popup closed, preserves focus, and restores memory-discard settings. YouTube markup and engine responses are fixtures.');
} finally {
  await browser?.close();
  chromeProcess.kill('SIGTERM');
  await exited;
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
