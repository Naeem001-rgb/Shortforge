# How to test ShortForge

Use generated footage and an isolated data directory for automated checks. Do not delete or modify the real Library to test cleanup.

## Setup and automated checks

From the project root, after creating `.venv`:

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
npm ci
npm --prefix dashboard ci
npm --prefix extension ci
SHORTFORGE_DATA_DIR="$(mktemp -d)" .venv/bin/python -m pytest -q -ra
npm --prefix extension test
npm --prefix dashboard run lint
npm --prefix extension run build
npm --prefix dashboard run build
npm --prefix dashboard test
npm run format:check
npm run lint:py
git diff --check
```

Pytest defaults to `engine/`; it does not collect tests from the managed Concat checkout. Development requirements include pytest and Ruff; normal startup installs only runtime requirements. On Windows, use `.venv\Scripts\python.exe` and set `SHORTFORGE_DATA_DIR` to a temporary directory instead of using `mktemp`.

The browser suite starts an isolated engine on port 8788 and Vite on 5174. Set `CHROME_PATH` if Chrome is not at `/usr/bin/google-chrome`. The Playwright configuration currently uses the Unix virtual-environment path; Windows browser automation needs that path adapted. Tests use generated media and simulated provider responses. They do not require paid keys or publish a real video. Optional native-runtime and installed-model checks report skips when their explicit prerequisites are absent.

Run the packaged extension fixtures after building:

```bash
cd extension
node tests/packaged-dashboard.mjs
node tests/browser-fixture.mjs
node tests/instagram-fixture.mjs
```

See [QA harnesses](QA-HARNESS.md) for fixture coverage and [progress](PROGRESS.md) for dated results. Markdown is excluded from bulk formatting.

## Audit regressions and local benchmark

The normal suites include malformed-media network isolation, upload cleanup, concurrent download/transcription/extraction claims, thumbnail worker admission and startup dependency repair. See the [audit report](AUDIT-2026-10-30.md) for coverage and limitations.

Run `.venv/bin/python scripts/benchmark_engine.py` for a bounded comparison of enrichment reads and thumbnail contention. It creates and deletes its own temporary database and never downloads media or contacts providers.

## Start the workspace

1. Run `./start.sh` (Windows: `start.bat`).
2. Open http://127.0.0.1:5173 and check **Engine connected**.
3. If offline, read the terminal error, keep the engine running, and click **Try again**.
4. Open Settings to review optional tool availability.

## Studio — Concat desktop

1. On a supported installation, startup downloads and verifies Concat if missing; see [setup](CONCAT.md#setup).
2. Upload a short video you own, then click its Library picture or title. Confirm launch progress appears in the same tab and Concat opens with the selected video on its timeline.
3. Make a small edit, save, close Concat, and reopen the same Library video. Confirm the edit remains.
4. Export from Concat to a local folder and play the result to check picture and sound.
5. Choose **Back to Library**, then **Studio** in the sidebar. Confirm Concat opens independently.

Native export quality requires a manual check. The browser suite exercises launch status, retries and navigation with a simulated launch; it does not automate Concat's timeline. The removed browser editor, caption-removal and Publish kit checklists are [archived](archive/browser-editor/TESTING.md).

## Install Scout in Chrome the first time

The start script builds the extension for you; run it before loading Scout.

1. Open `chrome://extensions`.
2. Switch **Developer mode** on, top right.
3. Click **Load unpacked** and pick the `extension/dist` folder inside your ShortForge folder.
4. Check the card says **ShortForge Scout** and **0.5.1**, then pin it to the toolbar.
5. Later versions only need **Reload** on that same card — the rest of this page says "reload Scout" to mean exactly that.

## Scout and Library
1. Run ShortForge, reload Scout in `chrome://extensions` (version 0.5.1), and refresh open social tabs.
2. Open a Short or Reel, or paste a YouTube channel/Instagram account URL into Scout. Set a small target and your count limits; use 0 only for a count you want to ignore.
3. Keep **Brief captions only**, **Max. seconds 3** enabled. Start, check that the progress says it is checking captions for candidates meeting your count limits, then try Pause/Resume during a check.
4. Confirm matching videos appear in Library with the correct YouTube/Instagram source and original link. Persistent text and unavailable checks should show an explicit skip reason under **Last video**.
5. With an account URL, verify navigation stays among videos from that account. Stop to switch accounts. Use **Self-test** if likes/views cannot be read; Instagram can hide counts.

**Caption accuracy:** screening samples the full video frame every 0.5 seconds with local OCR. It allows at most the selected total text time, not that amount per caption. Text appearing only in the final seconds must still be checked. Scene signs/title cards can cause false rejections; small or very brief captions may be missed. Test both clean footage and a known captioned video yourself before a long session. Public videos requiring login to download, videos over 180 seconds/80 MB, and incomplete analysis must not pass the filter. With **Any captions**, normal count/credit scouting remains available.

The optional **Look for** choices retain credited-only and credit-first fallback modes. Leave them all unselected to include uncredited videos under your other filters. **Narrated candidates** does not verify narration or identify AI voices. Scout only reads, scrolls, and opens videos/description panels. It never likes, follows, comments, or posts.

## Optional discovery modes

1. Reload Scout at `chrome://extensions` and confirm **0.5.1**. Pause an active session before changing its filters.
2. Click your selected **Look for** choice again, or press **Clear**. Confirm none is selected and the helper says credits and narration are not required. Space toggles the focused choice; arrow keys still choose another mode.
3. Set your count limits, account and caption/speech filter, then close/reopen Scout. The cleared mode and your other settings must remain saved. Clearing **Credited, any captions/voiceover** unlocks the caption selector and keeps **Any captions** until changed.
4. Start or Resume on uncredited Shorts/Reels. Videos meeting your other filters should save; below-limit videos or failed caption/speech checks should still be skipped. Existing Library clips must not be duplicated.
5. Pause and select **Credited only** again. Attribution should be required again, and that selection should survive reopening.

## Scout popup design

1. Reload Scout at `chrome://extensions` and confirm **0.5.1**. Check the redesigned popup in both your system's light and dark themes.
2. Confirm all four **Look for** modes and both editable count limits are visible above Start without scrolling. Use Tab and the arrow keys to change the selected mode.
3. Scroll to the account and caption controls. Change a value, close/reopen Scout, and check it is retained. The small Chinese text/no-speech and credited-any options must still work.
4. Start a short session, then Pause/Resume and Stop. Counts, last-video decisions and Recent activity must remain readable, with session buttons always reachable.
5. Enter an invalid minimum or run Self-test on an unsupported page. The error must appear immediately above the action buttons. Correct it and confirm you can continue.

## Credited videos with captions and voiceover

1. Reload Scout and confirm **0.5.1**. All four **Look for** modes should be visible without expanding a section.
2. Choose **Credited, any captions/voiceover**, then set your likes/views minimums and an account URL or current feed.
3. Confirm **Captions and speech** shows **Any captions** and is disabled for this mode. Start or Resume: credited clips meeting your count limits should save without a caption download or speech check, including captioned or narrated videos.
4. Confirm clips without attribution and clips below your limits are still skipped. This mode must remain credit-only after 30 misses.
5. Pause and choose **Credited only** to apply caption/speech filters again, **Narrated candidates** for candidates without a credit requirement, or **Credits first, then narrated** for automatic fallback. Close/reopen Scout to check your selected mode and custom limits are retained.

## Custom limits and small Chinese text

1. Open Scout and enter your own **Minimum likes** and **Minimum views** at the top. Try 100 and 1,000, close/reopen Scout, and confirm both remain saved. Set either to **0** to disable that minimum.
2. Choose a mode other than **Credited, any captions/voiceover**, then select **Captions and speech → Small Chinese text + no speech**. Keep **Other text (sec.)** at 3, or set 0 to reject all detected text outside the small-Chinese-text exception.
3. Start with a small target. Scout should check full-video text and speech after the video passes your count limits. Small Chinese annotations with no detected speech can pass; larger/longer captions, detected speech, and incomplete checks must be skipped.
4. Pause and switch to **Brief captions only** to restore the ordinary total-text-time rule, or **Any captions** to turn off both text and speech checks. Resume and verify the changed filter is used.
5. Review the saved video yourself. This estimates text and speech; it does not reliably classify caption fashion, detect every quiet voice, or distinguish narration from other speech. Music may trigger a conservative rejection.

To install the optional speech model, run `.venv/bin/python -m engine.studio.setup_scout_speech` (Windows: `.venv\Scripts\python -m engine.studio.setup_scout_speech`) from the project root. This explicitly downloads a pinned 2.33 MB model. No model downloads or paid calls happen during scouting.

## Recover a missing Scout tab

1. Reload **ShortForge Scout** at `chrome://extensions` and check it says **0.5.1**.
2. For an existing account session, open that account's Reels/Shorts page and press **Resume**. Scout reconnects without resetting its counters. If the account isn't open, Resume opens it again.
3. Pause, close the scouting tab, reopen Scout on another tab, then Resume. The account should reopen, and the unrelated page should stay unchanged. Earlier videos may be revisited but must not be saved twice.
4. To begin scouting `https://www.instagram.com/qianxiang_guyue/reels/` from a different account or feed session, press **Stop**, paste that URL, and **Start scouting**. Existing Library clips stay saved. A video with 242 likes is correctly skipped when the minimum is 5,000.

The old **“No tab with id…”** error referred to an unavailable browser tab. It did not mean the Instagram account was invalid. Feed sessions without an account URL need an open Short or Reel before Resume.

## Library selection and deletion

Use disposable test clips for these steps.

1. With more than 50 clips, confirm the Library renders at most 50 per page while search and counts cover the complete collection.
2. **Select all** selects the current page. Unticking one card shows an indeterminate checkbox. Selected clips remain selected across search, filters and pagination.
3. Archive and restore clips, and confirm the displayed selection and counts update.
4. Click **Delete** and verify the count and titles. Cancel first and confirm nothing changes; then permanently delete only the test clips.
5. Confirm Library-owned files are removed. An existing Concat project and its independent media copy must remain; see [files and recovery](CONCAT.md#files-and-recovery).

## Interface and YouTube Settings

1. Switch Light / Dark / System; reload and confirm the choice remains.
2. Use Ctrl+K (Command+K on macOS) to navigate or find a clip. Check keyboard focus and dialog dismissal.
3. Try empty search results, grid/table views, sorting and rights filters.
4. Resize to phone width; use the menu and confirm there is no sideways scrolling.
5. Review [YouTube setup](YOUTUBE-PUBLISHING.md), connect a test channel, verify its name, and disconnect when finished. Real Google authorization is a separate manual check.

YouTube channel Settings and backend services remain available. Concat exports have no automatic publishing handoff; use YouTube Studio to upload a finished file yourself.
