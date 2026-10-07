# How to test ShortForge

## M0 — Start the workspace
1. From the project folder, run `./start.sh` (Windows: double-click `start.bat`).
2. Open http://127.0.0.1:5173.
3. Check the header says **Engine connected**.
4. If it stays offline, read the terminal error, keep the engine running, and click Try again.
5. Open Settings to see which optional tools need setup.

## M1 — Scout and Library
1. Run ShortForge, reload Scout in `chrome://extensions` (version 0.3.0), and refresh open social tabs.
2. Open a Short or Reel, or paste a YouTube channel/Instagram account URL into Scout. Set a small target and your count limits; use 0 only for a count you want to ignore.
3. Keep **Brief captions only**, **Max. seconds 3** enabled. Start, check that the progress says it is checking captions for candidates meeting your count limits, then try Pause/Resume during a check.
4. Confirm matching videos appear in Library with the correct YouTube/Instagram source and original link. Persistent text and unavailable checks should show an explicit skip reason under **Last video**.
5. With an account URL, verify navigation stays among videos from that account. Stop to switch accounts. Use **Self-test** if likes/views cannot be read; Instagram can hide counts.

**Caption accuracy:** screening samples the full video frame every 0.5 seconds with local OCR. It allows at most the selected total text time, not that amount per caption. Text appearing only in the final seconds must still be checked. Scene signs/title cards can cause false rejections; small or very brief captions may be missed. Test both clean footage and a known captioned video yourself before a long session. Public videos requiring login to download, videos over 180 seconds/80 MB, and incomplete analysis must not pass the filter. With **Any captions**, normal count/credit scouting remains available.

Discovery preferences retain optional credits and credit-first fallback. Count-qualified mode does not verify narration or AI speech. Scout only reads, scrolls, and opens videos/description panels. It never likes, follows, comments, or posts.

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
