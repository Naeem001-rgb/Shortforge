# ShortForge Scout and Studio

A local Chrome extension for collecting YouTube Shorts and Instagram Reels into ShortForge. Scout reads the page in your browser, checks your criteria, and saves matches in the same Library. It can scout the current video feed or a specific creator's account. Narration is still something to review yourself; Scout does not listen to audio or confirm an AI voice.

## Scout an account and avoid persistent captions

1. Start ShortForge with `./start.sh` (Windows: `start.bat`), reload **ShortForge Scout** in `chrome://extensions`, and refresh any open YouTube/Instagram tab.
2. Open Scout and paste a **YouTube channel** or **Instagram account** URL in **Account or channel URL**. Leave it empty to scout an already-open Short/Reel feed.
3. Set your target, likes, and views. A minimum of **0** disables that count requirement, including when it is hidden. Instagram may show views only on profile tiles; Scout uses those when available.
4. Leave **Burned-in captions → Brief captions only** with **Max. seconds → 3** to allow an estimated three seconds of text in total. Choose **Any captions** to disable screening, or **0** seconds for the strictest setting.
5. Press **Start scouting**. Account mode opens that account's Shorts/Reels grid in a new tab, visits its video links, and stops at your target, 500 videos, or the end of that account. Matches appear in Library. Pause before changing filters; Stop before switching accounts.

Caption screening uses the installed local OCR model after a video passes the other criteria. It temporarily downloads the public video and checks the **whole frame throughout the full duration**, every half-second. Clear or brief results pass; persistent text, unavailable downloads, incomplete scans, and unreadable videos do not. It uses no paid service and deletes temporary video files afterwards. Pause/Stop cancels the current analysis.

This is an estimate of visible text, not proof that a video has no burned-in captions. Quick flashes, small/stylized text, and some languages may be missed; signs, title cards, and scene text can count. Screening supports up to **180 seconds / 80 MB**, one video at a time, with an eight-minute timeout. It can take several minutes per match on CPU. Public downloads may fail even when a video plays in a logged-in browser; Scout skips such videos rather than bypassing login. Run `engine/studio/setup_ocr.py` if the local OCR setup is missing, then restart the engine.

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
3. Open a YouTube Short or Instagram Reel. Refresh an already-open tab after loading/reloading the extension.
4. Open Scout, set your criteria, and press **Start scouting**. Keep that tab open; you can switch to other tabs while Scout continues.
5. Choose **Open dashboard** in Scout to open the bundled Library. **Edit** opens a full Studio tab and automatically fetches a saved video’s source. The local engine on `127.0.0.1:8787` must be running; the Vite dashboard server is not required.

The default limits are **30 clips**, **5,000 likes**, and **10,000 views**. Pause to change them. Unknown counts are skipped when their minimum is greater than zero. **Credits first, then narrated** switches after 30 scanned videos without a new eligible credited match. **Credited sources only** retains the original discovery option.

## Controls and recovery

- After updating Scout, click its **Reload** icon at `chrome://extensions`, refresh the YouTube or Instagram tab, then **Stop** and **Start scouting** for a fresh session. Version **0.3.0** adds Instagram, account targeting, and caption screening.
- **Pause / Resume** keeps your session's progress. **Stop** ends it; a new Start begins a new session.
- **Last video** shows the detected likes, views, and match or skip reason. **Recent activity** keeps the last eight events. Missing required counts are shown as unreadable and skipped; open the description and use **Self-test** to investigate.
- The extension reads the current Short and or Reel and may open its Description panel. It never likes, comments, subscribes, or uploads videos.
- It aims for 4–9 seconds between advances, with additional time for page loading, saving, or caption analysis. It stops at your target or 500 scanned videos.
- Switching tabs or closing the Scout popup does not pause scouting. The scouting tab is temporarily protected from automatic memory discard; its previous setting is restored on pause, stop, completion, or error. Chrome may slow background timers, so the pace can vary. Keep the scouting tab, Chrome and the local engine open, and keep your computer awake.
- Closing the scouting tab, navigating that tab away from Shorts/Reels, a verification/login/consent prompt, or a stalled page pauses scouting. Resolve the page yourself and resume.
- Matches are stored in extension storage before being sent to the engine. If the engine disconnects, scouting pauses. Restart ShortForge and press **Retry** to save pending clips. A background retry also runs every minute. Do not uninstall the extension while clips are pending.
- **Self-test** checks page controls and actual readable counts without clicking anything. Open the Short's three-dot menu → **Description** first so its views are visible. Scouting opens the panel automatically, waits for its menu and stats, and closes it only if Scout opened it. If the menu or panel cannot be opened, scouting pauses with the failed step instead of silently skipping every video.

Credit is discovery metadata, not reuse permission. External clips keep unknown rights while local editing is enabled. Record source permissions before publishing reused footage.

The build packages React, fonts, styles, and all executable code locally under `dist/studio`. Manifest V3 uses a strict `script-src 'self'` policy with no remote code or eval. Engine requests use loopback host permissions; content scripts run on YouTube and Instagram. Scout also uses storage, tabs, and alarms permissions. Long media jobs run in the local engine and remain available when the popup closes or a Studio tab reloads.

## Tested and remaining limits

`npm test` covers count/credit parsing, hidden counts, inclusive thresholds, optional narration hints, explicit mode restoration, changed-filter retries, per-Short diagnostics, valid video IDs, engine-aware duplicate handling, failed-upload persistence and retry, credit fallback, verification pauses, stale reads, the 500-video limit, and protection/restoration of background tabs on pause, completion, error, navigation and worker reload. `npm run build` type-checks all extension sources and bundles Manifest V3 output.

The loaded Manifest V3 extension was tested against live YouTube on September 29, 2026 in a separate Chromium profile. One initial Short was collected, then a scrolling session scanned four Shorts, skipped the duplicate, saved three new clips to the running local engine, and stopped at its target. The last saved view count matched the open Description panel exactly. A full 30-clip run and every YouTube layout remain unverified.

Popup light/dark renders and the unsupported-tab self-test error were checked with Chromium using a mocked Chrome API. Browser regressions cover the observed three-dot menu and factoid markup, delayed menus/panels/counts, preserving an already-open panel, opening failures, hidden stats, missing views, navigation, and avoiding social actions. YouTube frequently changes its page. Current accessible labels and credit/count grammar primarily support English; compact K/M/B counts and common European separators are handled. Localized count labels may be missed. Narrated mode has no title or description language requirement. No audio model is used. Optional caption screening runs local OCR in the engine.

The optional `node tests/browser-fixture.mjs` browser check and `node tests/preview.mjs` visual check uses Playwright from the dashboard installation and writes screenshots in `tests/screenshots/`. Runtime dependencies are bundled locally; no CDN, paid service, or API key is required by Scout.

`node tests/background-tabs.mjs` loads the built MV3 extension in an isolated Chromium profile and tests switching away after the first match, closing the popup, reaching exactly three matches, keeping the other tab selected, and restoring the original memory-discard setting. Playwright focus emulation is disabled so the source tab actually becomes hidden. YouTube markup and engine responses are fixtures; this test does not access the owner’s Library or verify every live YouTube layout.

October 2026 additions are tested with representative Instagram DOM fixtures, account queues, worker messages, and actual local OCR on generated videos. Live Instagram account scrolling and its current logged-in layouts have **not** been verified in this environment. Use Self-test if the site changes its layout.
