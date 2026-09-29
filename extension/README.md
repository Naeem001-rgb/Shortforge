# ShortForge Scout

A local Chrome extension for collecting promising YouTube Shorts into ShortForge. **Narrated Shorts** is the default: credits are optional. This uses words in titles and descriptions, so it cannot confirm that narration is AI-generated, detect burned-in subtitles, or guarantee a match to any particular reference video. Review collected clips in the Library.

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
5. Open the ShortForge Library to review the collected clips.

The default limits are **30 clips**, **5,000 likes**, and **10,000 views**. You can change them while a session runs. Unknown counts are skipped. **Credits first, then narrated** switches after 30 scanned Shorts without a new eligible credited match. **Credited sources only** retains the original discovery option.

## Controls and recovery

- **Pause / Resume** keeps your session's progress. **Stop** ends it; a new Start begins a new session.
- The extension reads the current Short and may open its Description panel. It never likes, comments, subscribes, or uploads videos.
- It aims for 4–9 seconds between advances, with additional time if page loading or saving is slow. It stops at your target or 500 scanned Shorts.
- Leaving the active Shorts tab, a visible verification/login/consent prompt, or a stalled page pauses scouting. Resolve the page yourself and resume.
- Matches are stored in extension storage before being sent to the engine. If the engine disconnects, scouting pauses. Restart ShortForge and press **Retry** to save pending clips. A background retry also runs every minute. Do not uninstall the extension while clips are pending.
- **Self-test** checks the current page's selectors without clicking anything. A passing selector check does not prove that counts are available or that live collection succeeds. After a failure, refresh YouTube; if it persists, selectors may need updating in `src/selectors.ts`.

Credit is discovery metadata, not reuse permission. Engine-created external clips begin with unknown rights; the Library controls editing permissions.

## Tested and remaining limits

`npm test` covers count/credit parsing, hidden counts, thresholds, metadata heuristics, valid video IDs, engine-aware duplicate handling, failed-upload persistence and retry, credit fallback, verification pauses, stale reads, and the 500-Short limit. `npm run build` type-checks all extension sources and bundles Manifest V3 output.

Popup light/dark renders and the unsupported-tab self-test error were checked with Chromium using a mocked Chrome API. The browser fixture test exercises description-panel parsing, next-video navigation, and payload construction against synthetic YouTube markup. **A 30-clip run against live YouTube has not been verified.** YouTube frequently changes its page. Current accessible labels and credit/count grammar primarily support English; compact K/M/B counts and common European separators are handled. Localized labels and narration in other languages may be missed. No audio or image model runs in the Scout.

The optional `node tests/browser-fixture.mjs` browser check and `node tests/preview.mjs` visual check uses Playwright from the dashboard installation and writes screenshots in `tests/screenshots/`. Runtime dependencies are bundled locally; no CDN, paid service, or API key is required by Scout.
