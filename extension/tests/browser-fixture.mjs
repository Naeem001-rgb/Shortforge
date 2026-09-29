import assert from 'node:assert/strict';
import { chromium } from '../../dashboard/node_modules/playwright/index.mjs';
import { resolve } from 'node:path';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
    <style>ytd-reel-video-renderer{display:block;width:350px;height:500px}ytd-engagement-panel-section-list-renderer{display:block}button{min-width:40px;min-height:40px}</style>
    <ytd-reel-video-renderer is-active><h2 id="title">An unusual story explained</h2><a href="/@storylab">Story Lab</a><div id="like-button"><button aria-label="Like this video along with 6,200 other people">6.2K</button></div><button id="open" aria-label="Description">Description</button></ytd-reel-video-renderer>
    <button id="next" aria-label="Next video">Next</button>
    <ytd-engagement-panel-section-list-renderer id="panel" target-id="engagement-panel-searchable-description" visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN" style="display:none"><div id="description-inline-expander">This narrated story is explained with captions.\nCredit: @originalcreator</div><div id="view-count">56,000 Views</div><button id="close" aria-label="Close">Close</button></ytd-engagement-panel-section-list-renderer>
    </body></html>` }));
  await page.addInitScript(() => {
    globalThis.fixture = { messages: [], listeners: [] };
    Math.random = () => 0;
    globalThis.chrome = { runtime: {
      onMessage: { addListener: fn => fixture.listeners.push(fn) },
      sendMessage: async message => {
        fixture.messages.push(message);
        if (message.type === 'hello') return { running: false };
        if (message.type === 'scan') return { running: fixture.messages.filter(m => m.type === 'scan').length < 2 };
        return { ok: true };
      }
    } };
  });
  await page.goto('https://www.youtube.com/shorts/test0000000');
  await page.evaluate(() => {
    const panel = document.getElementById('panel');
    document.getElementById('open').onclick = () => { panel.style.display = 'block'; panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'); };
    document.getElementById('close').onclick = () => { panel.style.display = 'none'; panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'); };
    document.getElementById('next').onclick = () => history.pushState({}, '', '/shorts/test0000001');
  });
  await page.addScriptTag({ path: resolve('dist/content.js') });
  const checks = await page.evaluate(() => new Promise(resolve => fixture.listeners[0]({ type: 'selftest' }, {}, resolve)));
  assert.ok(checks.checks.filter(check => check.required).every(check => check.found));
  await page.evaluate(() => fixture.listeners[0]({ type: 'run' }, {}, () => {}));
  await page.waitForFunction(() => fixture.messages.filter(message => message.type === 'scan').length === 2, { timeout: 10000 });
  const scans = await page.evaluate(() => fixture.messages.filter(message => message.type === 'scan'));
  assert.equal(scans[0].clip.likes, 6200);
  assert.equal(scans[0].clip.views, 56000);
  assert.equal(scans[0].clip.credit_target, '@originalcreator');
  assert.equal(scans[0].clip.channel_handle, '@storylab');
  assert.equal(scans[0].clip.video_id, 'test0000000');
  assert.equal(scans[1].clip.video_id, 'test0000001');
  assert.equal(await page.evaluate(() => document.getElementById('panel').style.display), 'none');
  await page.evaluate(() => {
    const dialog = document.createElement('tp-yt-paper-dialog'); dialog.setAttribute('opened', ''); dialog.textContent = 'Sign in to confirm you are not a bot'; dialog.style.cssText = 'display:block;width:300px;height:100px'; document.body.append(dialog);
    fixture.listeners[0]({ type: 'run' }, {}, () => {});
  });
  await page.waitForFunction(() => fixture.messages.some(message => message.type === 'problem'));
  assert.match(await page.evaluate(() => fixture.messages.find(message => message.type === 'problem').reason), /verification prompt/);
  console.log('Browser fixture passed: description, counts, credits, navigation, selector health, verification pause. This is not a live YouTube test.');
} finally { await browser.close(); }
