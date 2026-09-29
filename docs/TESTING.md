# How to test ShortForge

## M0 — Start the workspace
1. From the project folder, run `./start.sh` (Windows: double-click `start.bat`).
2. Open http://127.0.0.1:5173.
3. Check the header says **Engine connected**.
4. If it stays offline, read the terminal error, keep the engine running, and click Try again.
5. Open Settings to see which optional tools need setup.

## M1 — Scout and Library
1. Open `chrome://extensions` in Chrome; enable Developer mode.
2. Click Load unpacked; select ShortForge's `extension/dist` folder.
3. Open a YouTube Short. Use its three-dot menu → Description, then run Scout's Self-test to check readable likes and views. During scouting this panel opens automatically.
4. Choose Narrated Shorts (credits optional) or Auto (credits first, fallback after 30 misses). Set your thresholds and click Start.
5. Check the Library for matches. Pause if YouTube requires verification. Unknown counts are skipped, so collecting 30 is not guaranteed.

Narrated mode collects clips meeting both count limits without requiring credits or narration keywords. It cannot verify narration or prove a voice is AI generated. Check **Last Short** and **Recent activity** for the extracted counts and any skip reason. Selector diagnostics are provided because YouTube changes its layout. It never likes, subscribes, comments, or posts.

## Select all and delete
1. In Library, tick **Select all** next to the search box. The bar should read the full count and every visible card should be checked.
2. Untick one card. **Select all** should show a dash, and the count should drop by one.
3. Type in the search box. The selection must stay the same; narrowing the list is for looking, not for changing what will be deleted.
4. Filter to a smaller list and click **Select all** again. Only the rows on screen are added or removed, and the bar shows the real total.
5. Click **Delete**. The dialog names the count, previews the titles, and says the script, transcript, download, voiceover, and export are removed for good.
6. Click **Cancel** first. Nothing should be deleted.
7. Click **Delete**, then **Delete permanently**. The videos should leave the Library and disappear from disk in `data/`.
8. To confirm files are really gone, close the app, open `data/downloads`, `data/voiceovers`, and `data/exports`, and check the removed video's files are no longer there.
9. A **Voice lab** reference recording must survive deleting the clip that used it.

## M2 — Permissions, footage and transcript
1. Add a YouTube link. It should be labeled **Inspiration** and its footage editing locked.
2. Open details. Copy the permission request; save a real permission note when received. Alternatively fetch verified YouTube data using your own API key.
3. Upload a video you own through Add a video → Upload footage.
4. Open it in Studio → Script. Paste text manually or click Extract original script after installing a local Whisper model.
5. Confirm missing models show a useful explanation, without downloading anything automatically.

## M3 — Edit and export
1. Upload a short clip you own; open it in Studio.
2. Set trim/zoom. Try Find caption area, then Blur band, Solid cover or Crop outside caption band. Drag the band or adjust the sliders.
3. Paste a script in Script, save it, and choose one of the ten caption presets.
4. Open Export → Export Short. Wait for the completed job and download the MP4.
5. Play it. Check vertical framing, captions, timing and audio. Approximate timing and any duration mismatch are reported with the result.

OCR detection needs Tesseract installed separately. Without it, a suggested band is returned and clearly labeled. Preview shows layout, not a live FFmpeg render. Cleanup cannot reconstruct perfectly clean footage behind burned-in words.

## M4 — AI, voices and publish kit
1. Add a Gemini API key in Settings, using a free project, and save.
2. Open a Library Short → Open script. Available original-language captions automatically fill and save Original script. If unavailable, paste the narration or click Transcribe with Gemini. Then Rewrite script and compare the original/new counts, tone and facts.
3. In Voice lab, add your own authorized reference recording. Confirm it says model needed until Chatterbox is configured.
4. Choose the already available basic eSpeak voice, or set up Piper/Chatterbox via VOICE.md. Generate audio, then select Replace or Mix in Studio → Voice.
5. Export, generate the Publish kit, copy a title/description, and manually upload in YouTube Studio.

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

Live YouTube Scout collection was verified separately (see PROGRESS.md). Actual Google/Microsoft/ElevenLabs calls and installed Whisper/Piper/Chatterbox inference need the user's configured providers and remain unverified without them. Script extraction browser tests mock external transcription/generation while exercising real project saving. Gemini transcription is always an explicit action; opening Script uses free captions first.

## Original script extraction and faithful rewriting
1. Open a collected Short's details and choose **Open script**. Wait for captions to load into **Original script**, or review the actionable extraction error.
2. If captions are unavailable, set your Gemini key in Settings and click **Transcribe with Gemini**. It requests verbatim speech from the public YouTube URL; review for transcription errors. No API request is made without a key.
3. Click **Rewrite script**. Confirm it uses the narration you see, preserves the meaning/tone/language, and shows both word counts. It aims for exact equality and returns the closest draft after at most three requests.
4. Edit and Save. Leave/reopen the project: saved originals and rewrites must persist without automatic replacement. **Extract again** explicitly reloads the original narration and keeps the rewritten draft.
5. Open a Short whose extraction failed, switch to another project, then come back. The free caption attempt should run again by itself rather than leaving the field blank.
6. Existing footage permissions still apply to downloading/editing/exporting video; working on a script does not change those settings.
