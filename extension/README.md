# ShortForge Scout and Studio

A local Chrome extension for collecting promising YouTube Shorts into ShortForge. **Narrated Shorts** is the default: it collects candidates meeting your likes and views limits, without requiring credits or keywords. Review narration in the Library. Scout does not listen to audio, confirm an AI voice, or detect burned-in subtitles.

## Build and load

Start the ShortForge engine first. In a terminal inside this folder:

```sh
npm install
npm run build
npm test
```

Then:

1. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
2. Choose **Load unpacked** and select this project's `extension/dist` folder.
3. Open a video on `https://www.youtube.com/shorts/`. Refresh an already-open tab after loading/reloading the extension.
4. Open Scout, choose a discovery mode, and press **Start scouting**. Leave that tab in front.
5. Choose **Open dashboard** in Scout to open the bundled Library. **Edit** opens a full Studio tab and automatically fetches a saved Short’s source. The local engine on `127.0.0.1:8787` must be running; the Vite dashboard server is not required.

The default limits are **30 clips**, **5,000 likes**, and **10,000 views**. You can change them while a session runs. Unknown counts are skipped. **Credits first, then narrated** switches after 30 scanned Shorts without a new eligible credited match. **Credited sources only** retains the original discovery option.

## Controls and recovery

- After updating Scout, click its **Reload** icon at `chrome://extensions`, refresh the YouTube tab, then **Stop** and **Start scouting** for a fresh session. Version **0.1.2** fixes the current three-dot menu → Description → view-count path.
- **Pause / Resume** keeps your session's progress. **Stop** ends it; a new Start begins a new session.
- **Last Short** shows the detected likes, views, and match or skip reason. **Recent activity** keeps the last eight events. Missing counts are shown as unreadable and still skipped; open the description and use **Self-test** to investigate.
- The extension reads the current Short and may open its Description panel. It never likes, comments, subscribes, or uploads videos.
- It aims for 4–9 seconds between advances, with additional time if page loading or saving is slow. It stops at your target or 500 scanned Shorts.
- Leaving the active Shorts tab, a visible verification/login/consent prompt, or a stalled page pauses scouting. Resolve the page yourself and resume.
- Matches are stored in extension storage before being sent to the engine. If the engine disconnects, scouting pauses. Restart ShortForge and press **Retry** to save pending clips. A background retry also runs every minute. Do not uninstall the extension while clips are pending.
- **Self-test** checks page controls and actual readable counts without clicking anything. Open the Short's three-dot menu → **Description** first so its views are visible. Scouting opens the panel automatically, waits for its menu and stats, and closes it only if Scout opened it. If the menu or panel cannot be opened, scouting pauses with the failed step instead of silently skipping every video.

Credit is discovery metadata, not reuse permission. External clips keep unknown rights while local editing is enabled. Record source permissions before publishing reused footage.

The build packages React, fonts, styles, and all executable code locally under `dist/studio`. Manifest V3 uses a strict `script-src 'self'` policy with no remote code or eval. Only loopback engine host permissions are requested alongside Scout’s storage, tabs, and alarms permissions. Long media jobs run in the local engine and remain available when the popup closes or a Studio tab reloads.

## Tested and remaining limits

`npm test` covers count/credit parsing, hidden counts, inclusive thresholds, optional narration hints, explicit mode restoration, changed-filter retries, per-Short diagnostics, valid video IDs, engine-aware duplicate handling, failed-upload persistence and retry, credit fallback, verification pauses, stale reads, and the 500-Short limit. `npm run build` type-checks all extension sources and bundles Manifest V3 output.

The loaded Manifest V3 extension was tested against live YouTube on September 29, 2026 in a separate Chromium profile. One initial Short was collected, then a scrolling session scanned four Shorts, skipped the duplicate, saved three new clips to the running local engine, and stopped at its target. The last saved view count matched the open Description panel exactly. A full 30-clip run and every YouTube layout remain unverified.

Popup light/dark renders and the unsupported-tab self-test error were checked with Chromium using a mocked Chrome API. Browser regressions cover the observed three-dot menu and factoid markup, delayed menus/panels/counts, preserving an already-open panel, opening failures, hidden stats, missing views, navigation, and avoiding social actions. YouTube frequently changes its page. Current accessible labels and credit/count grammar primarily support English; compact K/M/B counts and common European separators are handled. Localized count labels may be missed. Narrated mode has no title or description language requirement. No audio or image model runs in Scout.

The optional `node tests/browser-fixture.mjs` browser check and `node tests/preview.mjs` visual check uses Playwright from the dashboard installation and writes screenshots in `tests/screenshots/`. Runtime dependencies are bundled locally; no CDN, paid service, or API key is required by Scout.
