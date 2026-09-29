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
3. Open a YouTube Short, click the Scout extension, and run Self-test.
4. Choose Narrated Shorts (credits optional) or Auto (credits first, fallback after 30 misses). Set your thresholds and click Start.
5. Check the Library for matches. Pause if YouTube requires verification. Unknown counts are skipped, so collecting 30 is not guaranteed.

The scout recognizes narration hints in public metadata; it cannot prove a voice is AI generated. Selector diagnostics are provided because YouTube changes its layout. It never likes, subscribes, comments, or posts.

## M2 — Permissions, footage and transcript
1. Add a YouTube link. It should be labeled **Inspiration** and its footage editing locked.
2. Open details. Copy the permission request; save a real permission note when received. Alternatively fetch verified YouTube data using your own API key.
3. Upload a video you own through Add a video → Upload footage.
4. Open it in Studio → Script. Paste text manually or click Transcribe after installing a local model.
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
2. In Studio → Script, paste or transcribe an authorized video's script and Rewrite. Check its original/new word counts and edit the result.
3. In Voice lab, add your own authorized reference recording. Confirm it says model needed until Chatterbox is configured.
4. Set up Piper or Chatterbox via VOICE.md; generate audio, then select Replace or Mix in Studio → Voice.
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
.venv/bin/python -m pytest engine/core/tests -q
.venv/bin/python -m unittest engine.ai.test_writing engine.studio.test_studio -v
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

Live YouTube DOM collection, actual Google/Microsoft/ElevenLabs calls, and installed Whisper/Piper/Chatterbox inference require the user's environment and were not validated with live accounts during development.
