// These representative semantic fixtures are not a claim of live Instagram access.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../../dashboard/node_modules/playwright/index.mjs';
const bundle = await readFile(resolve('dist/content.js'), 'utf8');
const style = '<style>article{display:block;width:380px;height:650px}video{display:block;width:280px;height:350px}button,[role=button]{min-width:40px;min-height:40px}span,a{display:inline-block}svg{width:20px;height:20px}</style>';
function reel({ id = 'FIRST_12345', likes = '6.2K likes', views = '56,000 views', caption = 'Credit: @originalcreator', hidden = false, next = true, permalink = false } = {}) {
  return `${style}<main><article><header><a href="/creator/">creator</a></header><video poster="https://cdn.example.test/${id}.jpg"></video><h1>${caption}</h1>
    <button id="like" aria-label="Like"><svg aria-label="Like"></svg></button>
    <span data-testid="like-count" ${hidden ? 'style="display:none"' : ''}>${likes}</span>
    <span data-testid="view-count" ${hidden ? 'style="display:none"' : ''}>${views}</span>
    ${permalink ? `<a href="/reel/${id}/">View Reel</a>` : ''}
    <ul><li><span>999,999 views</span></li></ul>
    </article></main>${next ? '<button id="next" aria-label="Next">Next recommended Reel</button>' : ''}`;
}
async function fixture(browser, { body, url = 'https://www.instagram.com/reel/FIRST_12345/', prepare = 'skip', start = false } = {}) {
  const page = await browser.newPage();
  await page.route('https://www.instagram.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>${body}` }));
  await page.addInitScript(({ prepare }) => {
    globalThis.fixture = { messages: [], listeners: [], clicks: [], polls: 0 };
    document.addEventListener('click', event => fixture.clicks.push(event.target.closest('button')?.id));
    const timeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, ms, ...args) => timeout(callback, Math.min(ms, 25), ...args);
    Math.random = () => 0;
    globalThis.chrome = { runtime: {
      onMessage: { addListener: fn => fixture.listeners.push(fn) },
      sendMessage: async message => {
        fixture.messages.push(message);
        if (message.type === 'hello') return { running: false };
        if (message.type === 'prepareScan') return prepare === 'skip' ? { running: true, skipCaptionCheck: true } : { running: true, captionJobId: 'caption-fixture' };
        if (message.type === 'captionStatus') return { running: true, job: { status: ++fixture.polls < 2 || prepare === 'pending' ? 'running' : prepare === 'failed' ? 'failed' : 'completed' } };
        return { running: false };
      },
    } };
  }, { prepare });
  await page.goto(url);
  await page.addScriptTag({ content: bundle });
  if (start) await page.evaluate(() => fixture.listeners[0]({ type: 'run' }, {}, () => {}));
  return page;
}
async function readScan(page) {
  await page.waitForFunction(() => fixture.messages.some(message => message.type === 'scan' || message.type === 'problem'));
  const result = await page.evaluate(() => fixture);
  assert.equal(result.messages.some(message => message.type === 'problem'), false, JSON.stringify(result.messages));
  return result;
}
const browser = await chromium.launch({ headless: true });
try {
  {
    const page = await fixture(browser, { body: reel(), start: true });
    const { messages, clicks } = await readScan(page);
    const clip = messages.find(message => message.type === 'scan').clip;
    assert.deepEqual({ id: clip.video_id, likes: clip.likes, views: clip.views, handle: clip.channel_handle }, { id: 'ig:FIRST_12345', likes: 6200, views: 56000, handle: '@creator' });
    assert.equal(clip.credit_target, '@originalcreator');
    assert.equal(clip.thumbnail_url, 'https://cdn.example.test/FIRST_12345.jpg');
    assert.deepEqual(clicks, [], 'Reading Instagram must not click social actions');
    await page.close();
  }
  {
    const page = await fixture(browser, { body: reel({ hidden: true, caption: 'My previous post had 700,000 views and 70,000 likes' }), start: true });
    const { messages } = await readScan(page);
    const clip = messages.find(message => message.type === 'scan').clip;
    assert.equal(clip.likes, null); assert.equal(clip.views, null, 'Caption and comments are never video statistics');
    await page.close();
  }
  {
    const page = await fixture(browser, { body: reel({ permalink: true }), url: 'https://www.instagram.com/reels/', start: true });
    const { messages } = await readScan(page);
    assert.equal(messages.find(message => message.type === 'scan').clip.video_id, 'ig:FIRST_12345');
    await page.close();
  }
  for (const prepare of ['completed', 'failed']) {
    const page = await fixture(browser, { body: reel(), prepare, start: true });
    const { messages, polls, clicks } = await readScan(page);
    assert.equal(polls, 2);
    assert.equal(messages.find(message => message.type === 'scan').captionJobId, 'caption-fixture');
    assert.deepEqual(clicks, [], 'Do not advance while caption analysis runs');
    assert.ok(messages.findIndex(m => m.type === 'scan') > messages.findLastIndex(m => m.type === 'captionStatus'));
    await page.close();
  }
  {
    const page = await fixture(browser, { body: reel(), prepare: 'pending', start: true });
    await page.waitForFunction(() => fixture.polls > 0);
    await page.evaluate(() => fixture.listeners[0]({ type: 'halt' }, {}, () => {}));
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => fixture.messages.some(message => message.type === 'scan')), false, 'Pause stays responsive while OCR runs');
    assert.deepEqual(await page.evaluate(() => fixture.clicks), []);
    await page.close();
  }
  {
    const page = await fixture(browser, { body: reel() });
    await page.evaluate(() => {
      const original = chrome.runtime.sendMessage;
      let first = true;
      chrome.runtime.sendMessage = message => {
        if (message.type === 'prepareScan' && first) {
          first = false;
          fixture.messages.push(message);
          return new Promise(resolve => { fixture.oldResponse = resolve; });
        }
        return original(message);
      };
      fixture.listeners[0]({ type: 'run', sessionId: 'old-session' }, {}, () => {});
    });
    await page.waitForFunction(() => Boolean(fixture.oldResponse));
    await page.evaluate(() => fixture.listeners[0]({ type: 'run', sessionId: 'new-session' }, {}, () => {}));
    const { messages } = await readScan(page);
    assert.equal(messages.find(message => message.type === 'scan').sessionId, 'new-session');
    await page.evaluate(() => fixture.oldResponse({ error: 'Old request failed' }));
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => fixture.messages.some(message => message.type === 'problem')), false, 'An old request must not pause a newer run');
    await page.close();
  }
  {
    const page = await fixture(browser, { body: reel() + '<div role="dialog">Log in to continue</div>', start: true });
    await page.waitForFunction(() => fixture.messages.some(message => message.type === 'problem'));
    assert.equal(await page.evaluate(() => fixture.messages.some(message => message.type === 'scan')), false);
    assert.match(await page.evaluate(() => fixture.messages.find(message => message.type === 'problem').reason), /Instagram needs your attention/);
    await page.close();
  }
  // Full document navigations prove that the bounded account allowlist survives
  // reloads and returns for more tiles, without taking the viewer's Next button.
  for (const platform of ['instagram', 'youtube', 'youtube-redirect', 'youtube-no-redirect', 'youtube-unrelated']) {
    const page = await browser.newPage();
    const legacy = platform === 'youtube-redirect' || platform === 'youtube-no-redirect';
    const sourceUrl = platform === 'instagram' ? 'https://www.instagram.com/creator/reels/' : legacy ? 'https://www.youtube.com/c/LegacyCreator/shorts' : 'https://www.youtube.com/@creator/shorts';
    const gridUrl = legacy ? 'https://www.youtube.com/@creator/shorts' : sourceUrl;
    const unrelatedGrid = 'https://www.youtube.com/@unrelated/shorts';
    const ids = platform === 'instagram' ? ['FIRST_12345', 'SECOND_12345', 'THIRD_12345'] : ['test0000001', 'test0000002', 'test0000003'];
    const videoUrl = id => platform === 'instagram' ? `https://www.instagram.com/reel/${id}/` : `https://www.youtube.com/shorts/${id}`;
    const messages = [], visited = [];
    let gridVisits = 0;
    await page.exposeBinding('recordFixtureMessage', (_source, message) => { messages.push(message); });
    await page.addInitScript(({ sourceUrl, gridUrl, redirect }) => {
      globalThis.fixture = { listeners: [] };
      // Playwright only routes the initial request in a synthetic 302 chain.
      // Model the browser's final landing/timing rather than contact live YouTube.
      if (redirect && location.href === gridUrl) {
        const original = performance.getEntriesByType.bind(performance);
        performance.getEntriesByType = type => type === 'navigation'
          ? [{ type: 'navigate', redirectCount: 1, name: location.href }]
          : original(type);
      }
      const timeout = window.setTimeout.bind(window);
      window.setTimeout = (callback, ms, ...args) => timeout(callback, Math.min(ms, 20), ...args);
      Math.random = () => 0;
      document.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (button?.id === 'next' || button?.id === 'like') void recordFixtureMessage({ type: 'forbidden-click', id: button.id });
      });
      globalThis.chrome = { runtime: {
        onMessage: { addListener: fn => fixture.listeners.push(fn) },
        sendMessage: async message => {
          await recordFixtureMessage(message);
          if (message.type === 'hello') return { running: true, sourceUrl, sessionId: 'account-fixture' };
          if (message.type === 'prepareScan') return { running: true, skipCaptionCheck: true };
          return { running: true };
        },
      } };
    }, { sourceUrl, gridUrl, redirect: platform === 'youtube-redirect' });
    await page.route(platform === 'instagram' ? 'https://www.instagram.com/**' : 'https://www.youtube.com/**', route => {
      const current = route.request().url(); visited.push(current);
      if (platform === 'youtube-unrelated' && current === videoUrl(ids[1])) return route.fulfill({
        contentType: 'text/html', body: `<!doctype html>${style}<ytd-rich-grid-renderer style="display:block"><a href="${videoUrl(ids[2])}">Unrelated channel video</a></ytd-rich-grid-renderer><script>history.replaceState({}, '', ${JSON.stringify(unrelatedGrid)});</script><script>${bundle}</script>`,
      });
      let body;
      if (current === gridUrl || current === unrelatedGrid) {
        gridVisits++;
        const available = gridVisits === 1 ? ids.slice(0, 2) : ids;
        const links = available.map((id, index) => `<a href="${videoUrl(id)}"><span>${index + 15},000 views</span></a>`).join('');
        body = platform === 'instagram'
          ? `${style}<main><article>${links}<aside><a href="/reel/UNRELATED_123/">Suggested reel</a></aside><a href="/different/reel/OUTSIDE_123/">Different creator</a></article></main>`
          : `${style}<ytd-rich-grid-renderer style="display:block">${links}</ytd-rich-grid-renderer>`;
      } else if (platform === 'instagram') {
        body = reel({ views: '', id: current.split('/')[4] });
      } else {
        body = `${style}<ytd-reel-video-renderer is-active style="display:block;height:500px"><h2 id="title">Account short</h2><a href="/@creator">Creator</a><div id="like-button"><button id="like" aria-label="Like this video along with 6,200 other people">6.2K</button></div></ytd-reel-video-renderer><button id="next" aria-label="Next video">Next recommended video</button><ytd-engagement-panel-section-list-renderer target-id="engagement-panel-structured-description" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED" style="display:block"><div id="description-inline-expander">Account video</div><div id="view-count">25,000 views</div></ytd-engagement-panel-section-list-renderer>`;
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html>${body}<script>${bundle}</script>` });
    });
    await page.goto(gridUrl);
    const deadline = Date.now() + 15000;
    while (!messages.some(message => message.type === 'exhausted' || message.type === 'problem') && Date.now() < deadline) await page.waitForTimeout(25);
    if (platform === 'youtube-unrelated' || platform === 'youtube-no-redirect') {
      assert.ok(messages.some(message => message.type === 'problem'), 'A later redirect must not replace the selected account');
      assert.equal(messages.filter(message => message.type === 'scan').length, platform === 'youtube-unrelated' ? 1 : 0);
      assert.equal(messages.some(message => message.type === 'exhausted'), false);
      assert.match(messages.find(message => message.type === 'problem').reason, platform === 'youtube-unrelated' ? /left the selected account/ : /Copy its current @handle/);
      await page.close();
      continue;
    }
    assert.equal(messages.some(message => message.type === 'problem'), false, JSON.stringify(messages));
    assert.ok(messages.some(message => message.type === 'exhausted'), `${platform}: account should stop at exhaustion`);
    const scans = messages.filter(message => message.type === 'scan');
    assert.ok(messages.filter(message => message.type !== 'hello').every(message => message.sessionId === 'account-fixture'));
    assert.deepEqual(scans.map(message => message.clip.video_id), ids.map(id => platform === 'instagram' ? `ig:${id}` : id));
    if (platform === 'instagram') assert.deepEqual(scans.map(message => message.clip.views), [15000, 16000, 17000], 'Each video uses only its own visible account tile views');
    assert.equal(messages.some(message => message.type === 'forbidden-click'), false);
    assert.ok(gridVisits >= 3, 'Return to the requested grid for later videos and exhaustion');
    assert.ok(visited.every(url => url === sourceUrl || url === gridUrl || ids.some(id => videoUrl(id) === url)), JSON.stringify(visited));
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('shortforge.account-scout.v1')));
    assert.equal(saved.completed.length, 3); assert.equal(saved.exhausted, true);
    assert.equal(saved.sourceUrl, sourceUrl); assert.equal(saved.resolvedSourceUrl, gridUrl);
    await page.close();
  }
  console.log('Instagram/account fixtures passed: metadata, unknown counts, feed permalink, pause/login, caption polling/failure, both account grids, persisted queue and exhaustion without recommendations.');
} finally { await browser.close(); }
