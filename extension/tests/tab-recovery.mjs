// Actual MV3 messaging/tab lifecycle with representative Instagram DOM and a
// mocked local Library. No owner browser, account, or Library data is changed.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '../../dashboard/node_modules/playwright/index.mjs';

const dist = resolve(import.meta.dirname, '../dist');
const profile = await mkdtemp(resolve(tmpdir(), 'shortforge-tab-recovery-'));
const sourceUrl = 'https://www.instagram.com/qianxiang_guyue/reels/';
const settings = { target: 30, minLikes: 5000, minViews: 10000, mode: 'narrated', sourceUrl, captionFilter: 'off', maxCaptionSeconds: 3 };
const reels = [
  { id: 'KNOWN_12345', likes: 9000, views: 56000 },
  { id: 'LOW_12345', likes: 242, views: 15381 },
  { id: 'MATCH_12345', likes: 8000, views: 20000 },
];
const reelUrl = id => `https://www.instagram.com/reel/${id}/`;
const visited = [];
const clicks = [];
const style = '<style>body{margin:0}article{display:block;width:380px;min-height:500px}video{display:block;width:280px;height:350px}button{min-width:40px;min-height:40px}span,a{display:inline-block}svg{width:20px;height:20px}</style>';
const chromeProcess = spawn(chromium.executablePath(), [
  '--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--disable-component-extensions-with-background-pages',
  '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--disable-extensions-except=' + dist, '--load-extension=' + dist, 'about:blank',
], { stdio: 'ignore' });
const exited = new Promise(resolve => chromeProcess.once('exit', resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
async function until(read, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await wait(100);
  }
  throw new Error('Timed out: ' + label);
}
try {
  const portFile = await until(async () => {
    try { return await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8'); }
    catch { return null; }
  }, 'isolated Chrome startup', 15000);
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + portFile.split('\n')[0], { noDefaults: true });
  const context = browser.contexts()[0];
  await context.exposeBinding('recordScoutRecoveryClick', (_source, id) => clicks.push(id));
  await context.addInitScript(() => {
    document.addEventListener('click', event => {
      const id = event.target.closest('button')?.id;
      if (id) void window.recordScoutRecoveryClick(id);
    });
  });
  await context.route('https://www.instagram.com/**', route => {
    const url = route.request().url();
    if (route.request().isNavigationRequest()) visited.push(url);
    if (url === sourceUrl) {
      const links = reels.map(reel => `<a href="${reelUrl(reel.id)}"><span>${reel.views.toLocaleString('en-US')} views</span></a>`).join('');
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html>${style}<main><h1>qianxiang_guyue</h1><article>${links}<aside><a href="/reel/SUGGESTED_123/">Suggested Reel</a></aside><a href="/different/reel/OUTSIDE_123/">Different account</a></article></main>` });
    }
    const reel = reels.find(item => url === reelUrl(item.id));
    if (!reel) return route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Unexpected navigation</h1>' });
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html>${style}<main><article><header><a href="/qianxiang_guyue/">qianxiang_guyue</a></header><video></video><h1>Account Reel ${reel.id}</h1><button id="like" aria-label="Like"><svg aria-label="Like"></svg></button><span data-testid="like-count">${reel.likes.toLocaleString('en-US')} likes</span></article></main><button id="next" aria-label="Next">Next recommended Reel</button>` });
  });
  await context.route('https://scout-recovery.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Other work</h1>' }));
  const worker = await until(async () => {
    for (const candidate of context.serviceWorkers()) {
      if (!candidate.url().startsWith('chrome-extension://')) continue;
      try { if (await candidate.evaluate(() => chrome.runtime.getManifest().name === 'ShortForge Scout')) return candidate; }
      catch { /* Chrome may replace a worker during startup. */ }
    }
    return null;
  }, 'Scout service worker', 15000);
  const extensionId = new URL(worker.url()).hostname;
  await worker.evaluate(async settings => chrome.storage.local.set({ scout: {
    sessionId: 'persisted-account-session', sessionSourceUrl: settings.sourceUrl, captionCheck: null,
    status: 'paused', settings, activeMode: 'narrated', tabId: 666544235, tabProtection: null,
    scanned: 21, matched: 0, saved: 0, creditMisses: 0, reason: 'Paused. Resume when you are ready.',
    pending: [], knownIds: [], seenIds: Array.from({ length: 21 }, (_, i) => `ig:PAST_${i}`), logs: [], lastScan: null,
  } }), settings);
  // Seed storage before any extension message or page navigation initializes
  // its state. This is a fresh isolated extension/profile, never the owner’s.
  const controller = await context.newPage();
  await controller.goto('chrome-extension://' + extensionId + '/popup.html');
  await worker.evaluate(() => {
    globalThis.recoveryFixture = { known: new Set(['ig:KNOWN_12345']), posts: [] };
    globalThis.fetch = async (url, options = {}) => {
      if (String(url) === 'http://127.0.0.1:8787/api/health') return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (String(url) !== 'http://127.0.0.1:8787/api/clips') throw new Error('Unexpected test request: ' + url);
      let added = 0;
      if (options.body) for (const clip of JSON.parse(options.body).clips) {
        recoveryFixture.posts.push(clip);
        if (!recoveryFixture.known.has(clip.video_id)) { recoveryFixture.known.add(clip.video_id); added++; }
      }
      return new Response(JSON.stringify({ clips: [...recoveryFixture.known].map(video_id => ({ video_id })), added }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  });
  const state = () => worker.evaluate(async () => (await chrome.storage.local.get('scout')).scout);
  const account = await context.newPage();
  await account.goto(sourceUrl);
  const accountTab = await worker.evaluate(async sourceUrl => (await chrome.tabs.query({ url: sourceUrl }))[0], sourceUrl);
  const command = payload => controller.evaluate(payload => chrome.runtime.sendMessage(payload), payload);
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), accountTab.id);
  const resumed = await command({ type: 'resume', tabId: accountTab.id, settings });
  assert.equal(resumed.error, undefined, resumed.error);
  assert.equal(resumed.state.tabId, accountTab.id, 'Reconnect to the selected account tab');
  assert.equal(resumed.state.sessionId, 'persisted-account-session');
  assert.equal(resumed.state.scanned, 21, 'Resuming must preserve existing progress');
  await until(async () => {
    const current = await state();
    assert.notEqual(current.status, 'paused', current.reason);
    return current.status === 'complete';
  }, 'account exhaustion after stale-ID recovery');
  const completed = await state();
  assert.equal(completed.scanned, 24);
  assert.equal(completed.matched, 1);
  assert.equal(completed.saved, 1);
  assert.equal(completed.sessionSourceUrl, sourceUrl);
  assert.match(completed.reason, /Finished this account/);
  assert.ok(completed.logs.some(entry => /likes 242 < 5,000/.test(entry.text)), 'Reject the below-threshold Reel from the screenshot');
  assert.deepEqual(await worker.evaluate(() => recoveryFixture.posts.map(clip => clip.video_id)), ['ig:MATCH_12345'], 'Existing Library records must not be posted again');
  assert.deepEqual(clicks, [], 'No recommendation or social action may be clicked');
  console.log('Passed: stale persisted tab reconnects to the existing account, keeps 21 prior scans, and completes the account with one new Library match.');

  // Closing a paused account tab must reconnect on the next Resume without
  // overwriting the unrelated active tab or resetting matches/scan progress.
  await command({ type: 'pause' });
  await account.close();
  await until(async () => (await state()).tabId === null, 'paused closed-tab invalidation');
  reels.push({ id: 'NEW_MATCH_12345', likes: 12000, views: 32000 });
  const other = await context.newPage();
  await other.goto('https://scout-recovery.test/');
  const otherTab = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://scout-recovery.test/*' }))[0]);
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), otherTab.id);
  const reopened = await command({ type: 'resume', tabId: otherTab.id, settings });
  assert.equal(reopened.error, undefined, reopened.error);
  assert.notEqual(reopened.state.tabId, otherTab.id);
  assert.notEqual(reopened.state.tabId, accountTab.id);
  assert.equal(reopened.state.scanned, 24);
  assert.equal(reopened.state.matched, 1);
  assert.equal(reopened.state.saved, 1);
  assert.equal(reopened.state.sessionId, 'persisted-account-session');
  assert.equal(other.url(), 'https://scout-recovery.test/', 'Leave unrelated browsing intact');
  await until(async () => {
    const current = await state();
    if (current.status === 'paused') {
      const tab = await worker.evaluate(id => chrome.tabs.get(id), current.tabId);
      assert.fail(`${current.reason} Tab: ${JSON.stringify({ url: tab.url, pendingUrl: tab.pendingUrl })}`);
    }
    return current.status === 'complete';
  }, 'replacement account tab traverses remaining Reels');
  const recovered = await state();
  assert.equal(recovered.scanned, 25, 'Previously scanned account Reels remain deduplicated');
  assert.equal(recovered.matched, 2);
  assert.equal(recovered.saved, 2);
  assert.equal(recovered.pending.length, 0);
  assert.equal(recovered.tabProtection, null);
  assert.deepEqual(await worker.evaluate(() => recoveryFixture.posts.map(clip => clip.video_id)), ['ig:MATCH_12345', 'ig:NEW_MATCH_12345']);
  assert.deepEqual(clicks, []);
  assert.ok(visited.every(url => url === sourceUrl || reels.some(reel => url === reelUrl(reel.id))), JSON.stringify(visited));
  console.log('Passed: actual MV3 stale-tab resume reattaches to qianxiang_guyue, preserves 21 scans, dedupes the Library, rejects low likes, saves matching Reels, exhausts only that account, and recreates a closed paused tab without changing unrelated browsing. Instagram DOM and Library responses are fixtures.');
} finally {
  await browser?.close();
  chromeProcess.kill('SIGTERM');
  await exited;
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
