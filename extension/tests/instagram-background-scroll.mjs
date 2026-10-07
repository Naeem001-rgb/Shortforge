// Regression: the Instagram Reels feed must keep advancing while its tab is in
// the background. Chrome does not animate a smooth scroll in a hidden tab, so
// advance() stalled at 0px and the loop reread one Reel until it gave up with
// "The video did not advance". Playwright focus emulation is disabled so the
// tab is genuinely hidden; Instagram markup and engine replies are fixtures.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '../../dashboard/node_modules/playwright/index.mjs';

const dist = resolve(import.meta.dirname, '../dist');
const profile = await mkdtemp(resolve(tmpdir(), 'shortforge-scout-ig-scroll-'));
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
async function until(read, label, timeout = 150000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await wait(200);
  }
  throw new Error('Timed out: ' + label);
}

// A Reels feed: one full-viewport <article> per Reel inside a scroll container,
// sized in vh so exactly one Reel is on screen at whatever the real viewport is.
const style = `<style>
  body{margin:0}#feed{height:100vh;overflow-y:auto}
  article{height:100vh;display:block;position:relative}
  video{display:block;width:220px;height:380px}
  header a{display:inline-block}section{display:block;width:60px;height:300px}
  span[role=button]{display:inline-block;min-width:30px;min-height:30px}
  svg{width:24px;height:24px}a{display:inline-block}
</style>`;
function reel(code, likes) {
  return `<article>
    <header><a href="/creator/">creator</a></header>
    <div><video poster="https://cdn.example.test/${code}.jpg"></video></div>
    <div class="x78zum5"><span dir="auto"><div class="html-div"><span dir="auto"><span>Reel ${code}</span></span></div></span></div>
    <section>
      <span><div><div role="button" tabindex="0"><div><span><svg aria-label="Like"></svg></span></div></div></div></span>
      <span role="button" tabindex="0">${likes}</span>
      <span></span>
      <div role="button" tabindex="0"><span><svg aria-label="Comment"></svg></span></div>
      <div role="button" tabindex="0"><span><svg aria-label="Share"></svg></span></div>
    </section>
    <a href="/reel/${code}/">View Reel</a>
  </article>`;
}
const codes = ['AAAAAA01', 'BBBBBB02', 'CCCCCC03', 'DDDDDD04', 'EEEEEE05', 'FFFFFF06'];

try {
  const portFile = await until(async () => {
    try { return await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8'); }
    catch { return null; }
  }, 'isolated Chrome startup', 15000);
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + portFile.split('\n')[0], { noDefaults: true });
  context = browser.contexts()[0];
  await context.route('https://www.instagram.com/**', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><body>${style}<div id="feed">${codes.map((code, i) => reel(code, `${(i + 1) * 12000}`)).join('')}</div></body></html>`,
  }));
  await context.route('https://scout-elsewhere.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Other work</h1>' }));

  const worker = await until(async () => {
    for (const candidate of context.serviceWorkers()) {
      if (!candidate.url().startsWith('chrome-extension://')) continue;
      try {
        if (await candidate.evaluate(() => chrome.runtime.getManifest().name === 'ShortForge Scout')) return candidate;
      } catch { /* A worker can stop while Chrome is starting. */ }
    }
    return null;
  }, 'Scout service worker', 15000);
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

  const feed = await context.newPage();
  await feed.goto('https://www.instagram.com/reels/');
  const feedTab = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.instagram.com/reels/*' }))[0]);
  const controller = await context.newPage();
  await controller.goto('chrome-extension://' + new URL(worker.url()).hostname + '/popup.html');
  await until(() => worker.evaluate(async id => {
    try { return !!(await chrome.tabs.sendMessage(id, { type: 'selftest' })).checks; }
    catch { return false; }
  }, feedTab.id), 'content script ready', 30000);

  const state = () => worker.evaluate(async () => (await chrome.storage.local.get('scout')).scout);
  const scrollTop = () => feed.evaluate(() => document.getElementById('feed').scrollTop);

  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), feedTab.id);
  const response = await controller.evaluate(tabId => chrome.runtime.sendMessage({
    type: 'start', tabId, settings: { target: 3, minLikes: 0, minViews: 0, mode: 'any', captionFilter: 'off' },
  }), feedTab.id);
  assert.equal(response.error, undefined);

  // Foreground first, to prove the fixture and advance() path work at all.
  await until(async () => (await state()).scanned >= 1, 'first foreground scan');
  assert.equal((await state()).status, 'running');

  // Now background the Reels tab for real and never bring it back.
  const scrollBefore = await scrollTop();
  const other = await worker.evaluate(windowId => chrome.tabs.create({ windowId, url: 'https://scout-elsewhere.test/', active: true }), feedTab.windowId);
  await controller.close();
  await until(() => feed.evaluate(() => document.visibilityState === 'hidden'), 'actually hidden Reels tab', 10000);
  assert.equal(await feed.evaluate(() => document.visibilityState), 'hidden');

  // Reaching the target is the whole requirement: no pause, no user rescue.
  await until(async () => {
    const current = await state();
    assert.notEqual(current.status, 'paused', 'paused while backgrounded: ' + current.reason);
    return current.status === 'complete';
  }, 'target reached while the Reels tab is in the background');

  const done = await state();
  assert.equal(done.matched, 3);
  assert.equal(done.scanned, 3);
  assert.equal(new Set(done.seenIds).size, 3, 'three different Reels, not one reel reread');
  assert.ok(await scrollTop() > scrollBefore, 'the feed scrolled while the tab was hidden');
  assert.equal(await feed.evaluate(() => document.visibilityState), 'hidden');
  assert.equal((await worker.evaluate(id => chrome.tabs.get(id), other.id)).active, true);
  console.log('Passed: the Instagram Reels feed keeps scrolling and collecting to the target while its tab is in the background, with the popup closed and focus untouched. Instagram markup and engine replies are fixtures.');
} finally {
  await browser?.close();
  chromeProcess.kill('SIGTERM');
  await exited;
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
