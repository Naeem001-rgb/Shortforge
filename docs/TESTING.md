# How to test ShortForge

## M0 — Start the workspace
1. From the project folder, run `./start.sh` (Windows: double-click `start.bat`).
2. Open http://127.0.0.1:5173.
3. Check the header says **Engine connected**.
4. If it stays offline, read the terminal error, keep the engine running, and click Try again.
5. Open Settings to see which optional tools need setup.

## M1 — Scout and Library
1. Run ShortForge, reload Scout in `chrome://extensions` (version 0.4.1), and refresh open social tabs.
2. Open a Short or Reel, or paste a YouTube channel/Instagram account URL into Scout. Set a small target and your count limits; use 0 only for a count you want to ignore.
3. Keep **Brief captions only**, **Max. seconds 3** enabled. Start, check that the progress says it is checking captions for candidates meeting your count limits, then try Pause/Resume during a check.
4. Confirm matching videos appear in Library with the correct YouTube/Instagram source and original link. Persistent text and unavailable checks should show an explicit skip reason under **Last video**.
5. With an account URL, verify navigation stays among videos from that account. Stop to switch accounts. Use **Self-test** if likes/views cannot be read; Instagram can hide counts.

**Caption accuracy:** screening samples the full video frame every 0.5 seconds with local OCR. It allows at most the selected total text time, not that amount per caption. Text appearing only in the final seconds must still be checked. Scene signs/title cards can cause false rejections; small or very brief captions may be missed. Test both clean footage and a known captioned video yourself before a long session. Public videos requiring login to download, videos over 180 seconds/80 MB, and incomplete analysis must not pass the filter. With **Any captions**, normal count/credit scouting remains available.

The visible **Look for** choices retain credited-only and credit-first fallback modes. **Narrated candidates** does not verify narration or identify AI voices. Scout only reads, scrolls, and opens videos/description panels. It never likes, follows, comments, or posts.

## Credited videos with captions and voiceover

1. Reload Scout and confirm **0.4.1**. All four **Look for** modes should be visible without expanding a section.
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

1. Reload **ShortForge Scout** at `chrome://extensions` and check it says **0.4.1**.
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
9. Export MP4 at a selected resolution. Download and play the actual file. Confirm timing, transforms, visible text, and the correct soundtrack.
10. Confirm there are no Script, Rewrite script, Generate voiceover, or Voice lab controls, and Studio makes no /rewrite, /tts, or /extract-script calls.

The browser test suite uses generated motion footage and tone recordings in an isolated database. These are labelled test fixtures, not production examples. Backend tests inspect decoded rendered pixels and PCM audio. Real model inference is tested separately when the installed separation runtime is available.

## Publish kit

Paste your externally finished script or video summary into Publish kit, optionally connect Gemini in Settings, and generate titles/description/tags. This does not write a narration script or generate speech. Upload the finished MP4 manually in YouTube Studio.

## M5 — Interface checks
1. Switch Light / Dark / System; reload and confirm the choice stays.
2. Use Ctrl+K (Command+K on macOS) to navigate or find a clip.
3. Try empty search results, table/grid view, and permissions filters.
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

The dashboard browser tests use the locally installed Google Chrome, create an isolated temporary database, start separate test servers on ports 5174/8788, and render an actual short MP4. They do not use keys or download speech models. On another machine, set `CHROME_PATH` to Chrome's executable. The included test config starts `.venv/bin/python`; Windows users can run the click-through checklist or adapt that interpreter path to `.venv\\Scripts\\python.exe`.

Optional Scout browser fixture:

```bash
cd extension
node tests/browser-fixture.mjs
```

The current Studio replaces the former script-extraction and AI voice-generation browser workflows. Legacy API regression tests remain to preserve existing local data/API compatibility. No browser test calls a paid provider.

Audio separation setup and independent real-inference evidence are documented in [AUDIO-SEPARATION.md](AUDIO-SEPARATION.md). Full workflow and limitations are documented in [EDITOR.md](EDITOR.md).
