// Regression fixtures captured from the live Instagram Reel page (Oct 2026).
// Instagram renders each rail action as [icon control][count span] inside a
// <section>, exposes no aria-label or data-testid on the counts, and keeps
// comments outside any <ul>. The earlier fixtures used invented
// data-testid="like-count" markup, so they could never catch this breakage.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../../dashboard/node_modules/playwright/index.mjs';

const bundle = await readFile(resolve('dist/content.js'), 'utf8');
const style = `<style>
  main{display:block;width:400px;height:700px} article{display:block;width:400px;height:700px}
  video{display:block;width:200px;height:300px} section{display:block;width:60px;height:300px}
  span,div[role=button],button{display:inline-block} span[role=button]{min-width:30px;min-height:30px}
  svg{width:24px;height:24px} div{display:block} header a{display:inline-block}
</style>`;

/** Mirrors the observed live DOM: no <ul>, no aria-labels on counts, no view count. */
function liveReel({ id = 'REAL_12345', likes = '6,204', comments = '12', caption = 'Copper enamel explained. Credit: @originalcreator', railCommentCount = true } = {}) {
  return `${style}<main role="main"><div class="x1yvgwvq">
  <header><a href="/creator/">creator</a></header>
  <div><video poster="https://cdn.example.test/${id}.jpg"></video></div>
  <div class="x78zum5"><span class="x1lliihq" dir="auto"><div class="html-div"><span dir="auto"><span class="x193iq5w">${caption}</span></span></div></span></div>
  <section class="x6s0dn4">
    <div><div class="x6s0dn4">
      <span class="x1qfufaz"><div class="x1ypdohk"><div role="button" tabindex="0"><div class="x6s0dn4"><span><svg aria-label="Like"></svg></span></div></div></div></span>
      ${likes ? `<span role="button" tabindex="0">${likes}</span>` : ''}
      <span></span>
      ${railCommentCount ? `<span role="button" tabindex="0">${comments}</span>` : ''}
      <div role="button" tabindex="0"><span><svg aria-label="Comment"></svg></span></div>
      <div role="button" tabindex="0"><span><svg aria-label="Share"></svg></span></div>
    </div></div>
    <div><div role="button" tabindex="0"><span><svg aria-label="Save"></svg></span></div></div>
  </section>
  <div class="x9f619">
    <div role="button" tabindex="0"><span dir="auto"><span>57 likes</span></span></div>
    <div role="button" tabindex="0"><span dir="auto"><span>Reply</span></span></div>
    <div role="button" tabindex="0"><span dir="auto"><span>999,999 views</span></span></div>
  </div>
  <a href="/creator/reel/${id}/">View Reel</a>
  </div></main>`;
}

/** Mirrors the payload Instagram inlines for every Reel, wrapped in the
 * ScheduledServerJS/Relay envelope it actually ships. */
function payloadReel({ shortcode, likes, play, disabled = false, rail = '6,204' }) {
  const media = { code: shortcode, product_type: 'clips', like_count: likes, like_and_view_counts_disabled: disabled, comment_count: 4 };
  if (play !== null && play !== undefined) media.play_count = play;
  const relay = ['RelayPrefetchedStreamCache', [], { stream_cache: { data: { data: { xdt_shortcode_media: media } } } }];
  const preloader = ['cr:9686', ['PolarisPostRootQueryRelayPreloader', [], { args: { shortcode } }]];
  const bbox = { define: [preloader], require: [[null, relay]] };
  const envelope = { require: [['ScheduledServerJS', 'handle', null, [{ __bbox: bbox }]]] };
  return `${liveReel({ id: shortcode, likes: rail })}<script type="application/json">${JSON.stringify(envelope)}</script>`;
}

async function open(browser, { body, url = 'https://www.instagram.com/reel/REAL_12345/' } = {}) {
  const page = await browser.newPage();
  await page.route('https://www.instagram.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>${body}` }));
  await page.addInitScript(() => {
    globalThis.fixture = { listeners: [], messages: [], clicks: [] };
    document.addEventListener('click', event => fixture.clicks.push(event.target.closest('button,[role=button]')?.getAttribute('aria-label') || event.target.closest('button,[role=button]')?.textContent?.trim() || ''));
    const timeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, ms, ...args) => timeout(callback, Math.min(ms, 20), ...args);
    Math.random = () => 0;
    globalThis.chrome = { runtime: {
      onMessage: { addListener: fn => fixture.listeners.push(fn) },
      sendMessage: async message => {
        fixture.messages.push(message);
        if (message.type === 'hello') return { running: false };
        if (message.type === 'prepareScan') return { running: true, skipCaptionCheck: true };
        return { running: true };
      },
    } };
  });
  await page.goto(url);
  await page.addScriptTag({ content: bundle });
  return page;
}

const readClip = async (page, start = true) => {
  if (start) await page.evaluate(() => fixture.listeners[0]({ type: 'run' }, {}, () => {}));
  await page.waitForFunction(() => fixture.messages.some(m => m.type === 'scan' || m.type === 'problem'));
  const messages = await page.evaluate(() => fixture.messages);
  return { clip: messages.find(m => m.type === 'scan')?.clip, reason: messages.find(m => m.type === 'problem')?.reason, messages };
};

const browser = await chromium.launch({ headless: true });
try {
  // The Reel page shows likes as a bare number beside the Like icon.
  {
    const page = await open(browser, { body: liveReel() });
    const { clip } = await readClip(page);
    assert.ok(clip, 'the Reel must be scanned');
    assert.equal(clip.likes, 6204, 'reads the bare like count beside the Like icon');
    assert.equal(clip.views, null, 'Instagram exposes no view count on a Reel page');
    assert.equal(clip.title, 'Copper enamel explained. Credit: @originalcreator', 'title is the caption, not a comment');
    assert.equal(clip.description, 'Copper enamel explained. Credit: @originalcreator');
    assert.equal(clip.credit_target, '@originalcreator', 'credits come from the caption');
    assert.deepEqual(await page.evaluate(() => fixture.clicks), [], 'reading must not click');
    await page.close();
  }
  // A comment's own like count must never be mistaken for the Reel's.
  {
    const page = await open(browser, { body: liveReel({ likes: '1.2M', comments: '3,400' }) });
    const { clip } = await readClip(page);
    assert.equal(clip.likes, 1200000, 'takes the rail count, not a comment count');
    await page.close();
  }
  // Comment rows carry "N likes" and "N views" text and live outside any <ul>.
  {
    const page = await open(browser, { body: liveReel() });
    const { clip } = await readClip(page);
    assert.notEqual(clip.likes, 57, 'a comment like count is not the Reel like count');
    assert.equal(clip.views, null, "a comment's views are not the Reel views");
    await page.close();
  }
  // Hidden like count must stay unknown rather than fall back to the comment count.
  {
    const page = await open(browser, { body: liveReel({ likes: '' }) });
    const { clip } = await readClip(page);
    assert.equal(clip.likes, null, 'an absent like count stays unread');
    await page.close();
  }
  // Instagram ships the Reel's own Relay payload. It is the only source of an
  // exact like count and the only source of views at all.
  {
    const page = await open(browser, { body: payloadReel({ shortcode: 'REAL_12345', likes: 45230, play: 1240000 }) });
    const { clip } = await readClip(page);
    assert.equal(clip.likes, 45230, 'payload like count is exact, not the rounded rail value');
    assert.equal(clip.views, 1240000, 'payload play count supplies views the DOM never shows');
    await page.close();
  }
  // Logged-out viewers get likes but no plays; the rail still fills likes in.
  {
    const page = await open(browser, { body: payloadReel({ shortcode: 'REAL_12345', likes: 971, play: null }) });
    const { clip } = await readClip(page);
    assert.equal(clip.likes, 971);
    assert.equal(clip.views, null, 'an absent play count stays unknown rather than zero');
    await page.close();
  }
  // A creator can disable counts: that is unknown, never a believable zero.
  {
    const page = await open(browser, { body: payloadReel({ shortcode: 'REAL_12345', likes: 0, play: 0, disabled: true, rail: '' }) });
    const { clip } = await readClip(page);
    assert.equal(clip.likes, null, 'disabled counts are unknown, not zero');
    assert.equal(clip.views, null);
    await page.close();
  }
  // A payload for a different Reel must never be attributed to this one.
  {
    const page = await open(browser, { body: payloadReel({ shortcode: 'SOMEONE_ELSE', likes: 999999, play: 888888 }) });
    const { clip } = await readClip(page);
    assert.equal(clip.likes, 6204, 'falls back to the rail when the payload names another Reel');
    await page.close();
  }
  console.log('Live Instagram Reel fixtures passed: rail like counts, Relay payload counts and views, comment-count isolation, caption title/credit.');
} finally { await browser.close(); }