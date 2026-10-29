# How to test ShortForge

> Historical browser-editor documentation. These interfaces were removed. See [current Studio setup](../../CONCAT.md).

## Current Studio — Concat desktop (October 25)

1. Start ShortForge normally. On a fresh supported installation, setup downloads and verifies Concat automatically; see [supported platforms](../../CONCAT.md#setup).
2. Upload a short video you own, then click its Library picture or title. Confirm ShortForge shows launch progress in the same tab and Concat opens a desktop window with the selected video on its timeline.
3. Make a small edit, save in Concat, close its window, and reopen the same Library video. Confirm the saved edit remains.
4. Export from Concat to a local folder and open the resulting video to check its picture and sound.
5. Return to ShortForge, choose **Back to Library**, then select **Studio** in the sidebar. Confirm Concat can also open independently.

The older custom-editor, caption-removal and Publish kit checklists below are historical. Those interfaces were removed; current setup and verification results are in [CONCAT.md](../../CONCAT.md) and [PROGRESS.md](../../PROGRESS.md). YouTube channel Settings remain, but there is no publishing handoff from Concat.

## M0 — Start the workspace
1. From the project folder, run `./start.sh` (Windows: double-click `start.bat`).
2. Open http://127.0.0.1:5173.
3. Check the header says **Engine connected**.
4. If it stays offline, read the terminal error, keep the engine running, and click Try again.
5. Open Settings to see which optional tools need setup.

## Install Scout in Chrome the first time

The start script builds the extension for you, so do this after step 1 above.

1. Open `chrome://extensions`.
2. Switch **Developer mode** on, top right.
3. Click **Load unpacked** and pick the `extension/dist` folder inside your ShortForge folder.
4. Check the card says **ShortForge Scout** and **0.5.1**, then pin it to the toolbar.
5. Later versions only need **Reload** on that same card — the rest of this page says "reload Scout" to mean exactly that.

## M1 — Scout and Library
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

The free speech model is installed on the current machine. On a fresh installation, run `.venv/bin/python -m engine.studio.setup_scout_speech` (Windows: `.venv\Scripts\python -m engine.studio.setup_scout_speech`) from the project root. This explicitly downloads a pinned 2.33 MB model. No model downloads or paid calls happen during scouting.

## Recover a missing Scout tab

1. Reload **ShortForge Scout** at `chrome://extensions` and check it says **0.5.1**.
2. For an existing account session, open that account's Reels/Shorts page and press **Resume**. Scout reconnects without resetting its counters. If the account isn't open, Resume opens it again.
3. Pause, close the scouting tab, reopen Scout on another tab, then Resume. The account should reopen, and the unrelated page should stay unchanged. Earlier videos may be revisited but must not be saved twice.
4. To begin scouting `https://www.instagram.com/qianxiang_guyue/reels/` from a different account or feed session, press **Stop**, paste that URL, and **Start scouting**. Existing Library clips stay saved. A video with 242 likes is correctly skipped when the minimum is 5,000.

The old **“No tab with id…”** error referred to an unavailable browser tab. It did not mean the Instagram account was invalid. Feed sessions without an account URL need an open Short or Reel before Resume.

## Select all and delete
1. In Library, tick **Select all** next to the search box. The bar should read the full count and every visible card should be checked.
2. Untick one card. **Select all** should show a dash, and the count should drop by one.
3. Type in the search box. The selection must stay the same; narrowing the list is for looking, not for changing what will be deleted.
4. Filter to a smaller list and click **Select all** again. Only the rows on screen are added or removed, and the bar shows the real total.
5. Click **Delete**. The dialog names the count, previews the titles, and says the script, transcript, download, voiceover, and export are removed for good.
6. Click **Cancel** first. Nothing should be deleted.
7. Click **Delete**, then **Delete permanently**. The videos should leave the Library and disappear from disk in `data/`.
8. To confirm files are really gone, close the app, open `data/downloads`, `data/voiceovers`, and `data/exports`, and check the removed video's files are no longer there.
9. Deleting a timeline item must leave its source in the media bin; only deleting the Library project removes project-owned files.

## Studio — manual timeline editing

1. Upload a video you own, then open it in Studio. Select its timeline clip. Change its start, duration, source-in, speed, scale, rotation, and volume; confirm the player follows the changes.
2. Seek within the clip and split. Delete one part, then Undo and Redo. Move clips by dragging; trim their edges. Check source ranges are preserved.
3. Open Audio and choose Extract audio. The video becomes muted and a separate aligned audio track appears. Deleting it must not delete the source or extracted media file.
4. Import an external voiceover and music. Change volume and fades, offset a recording, and preview the mixed audio. Delete a playing audio item and ensure it stops immediately.
5. With the local separation runtime installed, choose Isolate voice or Remove voice, keep music. Wait for real processing; check both stems in the media bin and listen to the chosen track. Some artifacts may remain.
6. Add keyframes at two different times for position/scale/opacity or volume. Scrub between them; confirm interpolation. Try entrance/exit animations.
7. Add text or import an SRT subtitle file. Confirm timing, appearance, and layering.
8. Save, leave Studio, reopen, and reload the browser. The selected project and saved timeline must persist.
9. Export at 720p or 1080p. Leave **Export method** on **On this device**: that is the normal path and it renders in your browser. Download and play the actual file. Confirm timing, transforms, visible text, and the correct soundtrack.
10. Open **Export method** again and pick **Local compatibility export**. Use this only when the ordinary export fails; it re-renders the same edit on the engine with FFmpeg, follows the project's frame rate, and ignores the frame-rate and quality menus. Some effects need the ordinary export, so compare the two files.
11. Open the **Audio** tab and scroll to **Script and voice**. Type a line, pick a voice, and Generate. With no voice installed and no ElevenLabs key saved, it must say so plainly instead of failing silently. A generated take lands on a voice track as ordinary editable audio. Voice setup is explained in [VOICE.md](VOICE.md).

The browser test suite uses generated motion footage and tone recordings in an isolated database. These are labelled test fixtures, not production examples. Backend tests inspect decoded rendered pixels and PCM audio. Real model inference is tested separately when the installed separation runtime is available.

## Clean up burned-in captions

Only try this with the inpainting model installed — see [CAPTION-REMOVAL.md](CAPTION-REMOVAL.md) for the one-off setup and for what the model can and cannot do.

1. Select a video clip on the timeline. In **Basic**, click **Remove burned-in captions**.
2. Drag a box around the captions, keeping other on-screen text outside it. Move the preview slider to a moment where captions are visible.
3. Click **Preview 1 second** and watch the result. If the lettering survives, widen the box or choose **Erase the whole area**, then preview again.
4. Click **Remove from selected clip**. Close the dialog, keep working, and reopen it from the same clip: the job must still be there. Reload the browser and check it is still there.
5. Click **Cancel removal** on a second run and confirm it stops.
6. Click **Use cleaned clip**, play it, then press Undo. The original must come back and both versions must remain in Media.

Be patient and be sceptical. On a laptop with no NVIDIA graphics this runs on the processor and can take hours, and the model is guessing what was behind the text, so faces, motion and busy backgrounds can smudge or flicker. Watch the whole clip before you publish it.

## Publish kit

Paste your externally finished script or video summary into Publish kit, optionally connect Gemini in Settings, and generate titles/description/tags. Publish kit itself only writes those three things: it does not write a narration script and does not generate speech. Narration lives in Studio's **Script and voice** panel. Upload the finished MP4 manually in YouTube Studio.

## M5 — Interface checks
1. Switch Light / Dark / System; reload and confirm the choice stays.
2. Use Ctrl+K (Command+K on macOS) to navigate or find a clip.
3. Try empty search results, the grid/table view buttons, and the **Filter by rights** menu.
4. Select clips, export their CSV links, archive, and restore from Archived.
5. Resize to a phone-width window. Use the menu and ensure there is no sideways scrolling.

## Automated checks

From the project root:

```bash
.venv/bin/python -m pytest engine -q
npm --prefix extension test
npm --prefix extension run build
npm --prefix dashboard run build
npm --prefix dashboard test
```

The current suites contain 402 backend tests (400 regular tests, 2 optional model checks, and 25 subtests), 71 extension tests, and 46 browser tests (44 regular tests and 2 optional licensed long-export checks).

The Web Audio preview cleanup test can fail intermittently under load. If it fails in the full run, rerun it with `npm --prefix dashboard test -- --grep 'cross-track dragging'` and record both results; a passing retry does not erase the original failure.

Tidying and style checks, also from the project root:

```bash
npm run format:check
npm run lint:py
```

`format:check` changes nothing; it lists any JavaScript, TypeScript, CSS or JSON file Prettier would reformat. `npm run format` is the version that writes the changes. `npm run format:py` and `npm run lint:py` do the same two jobs for the Python. Hand-written Markdown — this file and everything else in `docs/` — is deliberately left out, so these commands never reflow your notes.

The dashboard browser tests use the locally installed Google Chrome, create an isolated temporary database, start separate test servers on ports 5174/8788, and render an actual short MP4. They do not use keys or download speech models. On another machine, set `CHROME_PATH` to Chrome's executable. The included test config starts `.venv/bin/python`; Windows users can run the click-through checklist or adapt that interpreter path to `.venv\\Scripts\\python.exe`.

Optional Scout browser fixture:

```bash
cd extension
node tests/browser-fixture.mjs
```

Legacy API regression tests remain to preserve existing local data/API compatibility. No browser test calls a paid provider.

Audio separation setup and independent real-inference evidence are documented in [AUDIO-SEPARATION.md](AUDIO-SEPARATION.md). Full workflow and limitations are documented in [EDITOR.md](EDITOR.md).

## Direct YouTube publishing

1. Follow [Google setup](YOUTUBE-PUBLISHING.md), then open Settings → YouTube publishing and connect your channel. Confirm its displayed name.
2. Export a finished edit in Studio and choose Publish to YouTube. Verify that the selected export preview includes the latest edits.
3. Enter a title, description and tags, select the destination channel, and choose Private plus the appropriate audience and synthetic-content answers. Review the upload. Nothing should upload until you press Publish on that review.
4. Publish a private test video you own. Watch upload/processing progress, then open the video link and check its title, description, tags and channel in YouTube Studio.
5. Reload the Publish kit: the upload history should remain and the same export/channel should not create a duplicate. Disconnect in Settings when desired; this leaves the uploaded video intact.

Automated checks: `cd dashboard && npx playwright test youtube-publish.spec.ts youtube-settings.spec.ts`; backend: `.venv/bin/python -m pytest engine/core/tests/test_youtube_*.py -q`. These use temporary data and simulated Google responses; they do not upload to a real account.
