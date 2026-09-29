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
  async function checkCounts({ markup, setup, expected }) {
    const countPage = await browser.newPage();
    try {
      await countPage.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
        <style>ytd-reel-video-renderer{display:block;width:350px;height:500px}ytd-engagement-panel-section-list-renderer,yt-like-button-view-model,yt-factoid-view-model,yt-factoid-renderer{display:block}button{min-width:40px;min-height:40px}.value,.label{display:block}</style>
        <ytd-reel-video-renderer is-active><h2 id="title">A surprising moment</h2><a href="/@clipmaker">Clip Maker</a>${markup}<button id="open" aria-label="Description">Description</button></ytd-reel-video-renderer>
        <ytd-engagement-panel-section-list-renderer id="panel" target-id="engagement-panel-searchable-description" visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN" style="display:none"><div id="description-inline-expander">This earlier video got 1,000,000 views.</div><div id="stats"></div><button id="close" aria-label="Close">Close</button></ytd-engagement-panel-section-list-renderer>
        </body></html>` }));
      await countPage.addInitScript(() => {
        globalThis.fixture = { messages: [], listeners: [] };
        globalThis.chrome = { runtime: {
          onMessage: { addListener: fn => fixture.listeners.push(fn) },
          sendMessage: async message => { fixture.messages.push(message); return { running: false }; },
        } };
      });
      await countPage.goto('https://www.youtube.com/shorts/test0000002');
      await countPage.evaluate(() => {
        const panel = document.getElementById('panel');
        document.getElementById('open').onclick = () => { panel.style.display = 'block'; panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'); };
        document.getElementById('close').onclick = () => { panel.style.display = 'none'; panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'); };
      });
      if (setup) await countPage.evaluate(setup);
      await countPage.addScriptTag({ path: resolve('dist/content.js') });
      await countPage.evaluate(() => fixture.listeners[0]({ type: 'run' }, {}, () => {}));
      await countPage.waitForFunction(() => fixture.messages.some(message => message.type === 'scan'), null, { timeout: 8000 });
      const clip = await countPage.evaluate(() => fixture.messages.find(message => message.type === 'scan').clip);
      assert.deepEqual({ likes: clip.likes, views: clip.views }, expected);
      assert.equal(await countPage.evaluate(() => document.getElementById('panel').style.display), 'none');
    } finally { await countPage.close(); }
  }
  await checkCounts({
    markup: '<yt-like-button-view-model><button aria-label="Like this video">Like</button><span>8.5K</span></yt-like-button-view-model>',
    setup: () => {
      document.getElementById('stats').innerHTML = '<yt-factoid-view-model style="display:none"><span class="value">999M</span><span class="label">Views</span></yt-factoid-view-model><yt-factoid-view-model><span class="label">Views</span><span class="value">24.3K</span></yt-factoid-view-model>';
    },
    expected: { likes: 8500, views: 24300 },
  });
  await checkCounts({
    markup: '<div id="like-button"><button aria-label="Like this video">Like</button></div>',
    setup: () => {
      document.getElementById('open').onclick = () => {
        setTimeout(() => {
          const panel = document.getElementById('panel');
          panel.style.display = 'block'; panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
          setTimeout(() => {
            document.getElementById('stats').innerHTML = '<yt-factoid-renderer><span class="value">6.2K</span><span class="label">Likes</span></yt-factoid-renderer><yt-factoid-renderer><span class="value">56,000</span><span class="label">Views</span></yt-factoid-renderer>';
          }, 600);
        }, 800);
      };
    },
    expected: { likes: 6200, views: 56000 },
  });
  await checkCounts({
    markup: '<div id="like-button"><button aria-label="Like this video along with 7,250 other people">7.2K</button></div>',
    setup: () => { document.getElementById('stats').innerHTML = '<div class="view-count" aria-label="53,125 views">53K</div>'; },
    expected: { likes: 7250, views: 53125 },
  });
  await checkCounts({
    markup: '<div id="like-button"><button aria-label="Like this video along with 7,250 other people">7.2K</button></div>',
    expected: { likes: 7250, views: null },
  });
  console.log('Browser fixture passed: description, counts, credits, navigation, selector health, verification pause, modern viewmodels, delayed counts, hidden stats, precise accessible counts, and unavailable views. This is not a live YouTube test.');
} finally { await browser.close(); }
