import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// Captured YouTube element/attribute structure, including the menu shown in the
// user's screenshots. Synthetic fixtures supplement a separate live-browser test.
export async function checkDescriptionMenus(browser) {
  async function scenario({ moreLabel = 'More actions', menuDelay = 350, panelDelay = 0, latePolling = false, legacy = false, alreadyOpen = false, missingDescription = false, missingMenu = false, inertDirect = false } = {}) {
    const page = await browser.newPage();
    try {
      await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
        <style>
          ytd-reel-video-renderer{display:block;width:350px;height:500px}
          ytd-engagement-panel-section-list-renderer,view-count-factoid-renderer,factoid-renderer,yt-list-item-view-model,ytd-menu-service-item-renderer{display:block}
          .ytwFactoidRendererValue,.ytwFactoidRendererLabel{display:block}
          button{min-width:40px;min-height:40px}
        </style>
        <ytd-reel-video-renderer is-active>
          <yt-shorts-video-title-view-model><h2>The Truth About Military Reloading</h2></yt-shorts-video-title-view-model>
          <a href="/@clipmaker">Clip Maker</a>
          <like-button-view-model><button id="like" aria-label="Like this video along with 193,000 other people">193K</button></like-button-view-model>
          <button id="more" aria-label="${moreLabel}">⋮</button>
          ${inertDirect ? '<button id="inert" aria-label="Description">Description</button>' : ''}
        </ytd-reel-video-renderer>
        <ytd-engagement-panel-section-list-renderer id="panel" target-id="engagement-panel-structured-description" visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN" style="display:none">
          <div id="header"><button id="close" aria-label="Close">×</button></div>
          <view-count-factoid-renderer><factoid-renderer class="ytwFactoidRendererHost"><div class="ytwFactoidRendererFactoid" role="text" aria-label="5,944,195 views"><span class="ytwFactoidRendererValue">5,944,195</span><span class="ytwFactoidRendererLabel">Views</span></div></factoid-renderer></view-count-factoid-renderer>
          <ytd-text-inline-expander id="description-inline-expander">How this was made</ytd-text-inline-expander>
        </ytd-engagement-panel-section-list-renderer>
      </body></html>` }));
      await page.addInitScript(() => {
        globalThis.fixture = { messages: [], listeners: [], clicks: [] };
        globalThis.chrome = { runtime: {
          onMessage: { addListener: fn => fixture.listeners.push(fn) },
          sendMessage: async message => { fixture.messages.push(message); return message.type === 'prepareScan' ? { running: true, skipCaptionCheck: true } : { running: false }; },
        } };
      });
      await page.goto('https://www.youtube.com/shorts/test0000003');
      await page.evaluate(({ menuDelay, panelDelay, latePolling, legacy, alreadyOpen, missingDescription, missingMenu }) => {
        if (latePolling) {
          const originalTimeout = window.setTimeout.bind(window);
          window.setTimeout = (callback, ms, ...args) => originalTimeout(callback, ms === 100 ? 2100 : ms, ...args);
        }
        const panel = document.getElementById('panel');
        const showPanel = () => { panel.style.display = 'block'; panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'); };
        document.addEventListener('click', event => {
          const action = event.target.closest('[data-action], button');
          if (action) fixture.clicks.push(action.id || action.dataset.action);
        });
        document.getElementById('close').onclick = () => { panel.style.display = 'none'; panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN'); };
        document.getElementById('more').onclick = () => {
          if (missingMenu) return;
          setTimeout(() => {
            const menu = document.createElement('div');
            menu.id = 'popup-menu';
            const actions = missingDescription ? ['Share', 'Not interested', 'Report'] : ['Description', 'Share', 'Not interested', 'Report'];
            menu.innerHTML = actions.map(label => legacy
              ? `<ytd-menu-service-item-renderer data-action="${label}"><tp-yt-paper-item>${label}</tp-yt-paper-item></ytd-menu-service-item-renderer>`
              : `<yt-list-item-view-model><button id="${label}" role="menuitem">${label}</button></yt-list-item-view-model>`).join('');
            document.body.append(menu);
            if (!missingDescription) menu.querySelector(legacy ? '[data-action="Description"]' : 'button').onclick = () => {
              if (panelDelay) setTimeout(showPanel, panelDelay); else showPanel();
              menu.remove();
            };
          }, menuDelay);
        };
        if (alreadyOpen) showPanel();
      }, { menuDelay, panelDelay, latePolling, legacy, alreadyOpen, missingDescription, missingMenu });
      await page.addScriptTag({ path: resolve('dist/content.js') });
      const health = await page.evaluate(() => new Promise(resolve => fixture.listeners[0]({ type: 'selftest' }, {}, resolve)));
      assert.equal(health.checks.find(check => check.name.startsWith('Readable view count')).found, alreadyOpen);
      assert.deepEqual(await page.evaluate(() => fixture.clicks), [], 'Self-test must never open menus or close panels');
      await page.evaluate(() => fixture.listeners[0]({ type: 'run' }, {}, () => {}));
      await page.waitForFunction(() => fixture.messages.some(message => message.type === 'scan' || message.type === 'problem'), null, { timeout: 8000 });
      const result = await page.evaluate(() => ({ messages: fixture.messages, clicks: fixture.clicks, panelOpen: document.getElementById('panel').style.display !== 'none' }));
      assert.equal(result.clicks.some(action => ['like', 'Share', 'Not interested', 'Report'].includes(action)), false, 'Only Description and its close control may be used');
      if (missingDescription || missingMenu) {
        assert.equal(result.messages.filter(message => message.type === 'scan').length, 0, 'An inaccessible description must pause before reporting a scan');
        assert.match(result.messages.find(message => message.type === 'problem').reason, /could not find Description.*Open Description manually/i);
        assert.deepEqual(result.clicks, ['more']);
      } else {
        assert.equal(result.messages.filter(message => message.type === 'problem').length, 0);
        const clip = result.messages.find(message => message.type === 'scan').clip;
        assert.equal(clip.title, 'The Truth About Military Reloading');
        assert.equal(clip.likes, 193000);
        assert.equal(clip.views, 5944195);
        assert.equal(result.panelOpen, alreadyOpen, 'Only panels opened by Scout should be closed');
        assert.deepEqual(result.clicks, alreadyOpen ? [] : [...(inertDirect ? ['inert'] : []), 'more', 'Description', 'close']);
      }
    } finally { await page.close(); }
  }
  await scenario();
  await scenario({ moreLabel: 'More' }); // This button is outside any #menu wrapper.
  await scenario({ legacy: true, menuDelay: 500 });
  await scenario({ latePolling: true, panelDelay: 350 });
  await scenario({ alreadyOpen: true });
  await scenario({ inertDirect: true });
  await scenario({ missingDescription: true });
  await scenario({ missingMenu: true });
}
