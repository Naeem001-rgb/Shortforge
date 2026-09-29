# ShortForge progress

## September 29, 2026 — initial local build

Started from an empty folder. Detected Linux, Node22, Python3.14 and Git. FFmpeg was absent, so the lightweight app requirements include a packaged FFmpeg executable; large speech dependencies and model downloads stay optional. Created the shared API/SQLite contract before delegating Scout, core engine and AI/media backend work to three parallel agents.

### M0 — Workspace foundation
React/TypeScript/Vite dashboard, FastAPI engine, SQLite, shell and Windows launchers, private data storage, masked Settings keys, localhost access rules, health reporting, and shared API contracts are implemented. Launchers check for yt-dlp updates. Test with the M0 checklist in TESTING.md.

### M1 — Scout and Library
Scout supports narrated metadata matching, optional credits, and credit-first fallback after 30 misses. It has editable limits, deduplication, retry queue, pause/stop, verification pauses and selector self-test. Library supports real uploads/imports, grid/table, search, sorting, permission/status filtering, CSV and archive, plus detail and permission flows. Theme follows the system by default. No fabricated content is seeded. Test with M1/M5 checklists.

### M2 — Media and permissions
Uploads and authorized downloads create source assets. YouTube API enrichment can verify Creative Commons; client-supplied license claims cannot bypass the backend. Optional offline Whisper yields word timestamps, and manually supplied text works without Whisper. Direct API requests and asset serving enforce permission rules. Test with M2 checklist.

### M3 — Studio
The three-pane editor supports trim/zoom, approximate OCR caption band detection or an explicit fallback, adjustable blur/cover/crop regions, ten preset JSON definitions, caption layout controls, original/replace/mixed audio, FFmpeg CPU exports and file downloads. Browser preview is a layout guide; cleanup and audio mixing are rendered at export. Timings fall back honestly when word alignment is unavailable. Test with M3 checklist.

### M4 — Words and voices
Gemini model is configurable (default gemini-3.8-flash). Rewriting counts words locally and retries at most twice; original inspiration uses topic metadata. Publish kits include ranked titles, descriptions with required attribution and tags. Piper, Edge and optional ElevenLabs adapters exist. Authorized reference profiles are stored for optional offline Chatterbox/Nano voice cloning. Chatterbox code and model licensing are MIT; Piper voice licenses vary; ElevenLabs free is not commercial. No keys, cloud calls, or neural models were used in tests. Test with M4 checklist after your chosen setup.

### Integration verification
Backend, extension, build and browser results are recorded at the end of this log once integration is complete. Browser tests use a temporary database and synthetic source footage, not a real user channel. Desktop/mobile screenshots are in docs/screenshots.

### Remaining setup and practical limits
- Set your own Gemini key for writing, and optional YouTube key for metadata/license verification.
- Optional local speech dependencies need a compatible Python environment (3.11 recommended), explicit model downloads, and enough memory. This machine's Python3.14 can run the core app but may not support those packages.
- Tesseract OCR is optional. Without it, users position the suggested caption band.
- Real YouTube collection, download availability and changing selectors still need testing in the user's signed-in Chrome. No promise of 30 matching results when criteria are scarce.
- Voice cloning/synthesis integrations are implemented but actual model inference has not been tested on this laptop. Saving a voice reference alone does not enable synthesis.
- Preview is not a live render; rendered output is the final check. Some visual caption effects are ASS approximations.
- Posting is a manual YouTube Studio handoff as specified; no automatic uploads.
- Original-topic script writing is included. Automatic stock-footage search is the spec's later stretch feature and is not included.

### Final integration fixes
Added project-keyed page state so delayed requests cannot overwrite a different project's editor. Voice generation saves the exact narration used for audio before queueing, and job IDs/progress survive page navigation in browser session storage. Added two browser regressions for these cases. Bundled DejaVu Sans with its license for portable captions, and reduced desktop editor overflow while keeping mobile controls accessible. The actual `./start.sh` launcher was exercised successfully, serving the dashboard at 127.0.0.1:5173 and engine at 127.0.0.1:8787.

A preinstalled eSpeak NG voice is now available as an explicitly labeled basic local fallback. Real speech synthesis, file storage and fresh caption-timing output were tested with no model download or provider account. Optional neural voices remain uninstalled.

### Final verification results
- **55 backend tests passed** (`pytest engine -q`), including real H.264/AAC exports, blur/cover/crop treatment, replaced/mixed audio, exact font loading, local eSpeak speech, permission gates, consent, protected files, request races, and rewrite retries.
- **13 Scout tests passed**, extension type-check/build passed, and the synthetic YouTube browser fixture passed during the Scout milestone.
- **4 browser scenarios passed**: workspace/navigation/theme/settings/mobile; real upload→script→caption→MP4 download; edited voice script + job lifecycle; stale project response isolation. The first lifecycle run exposed an ambiguous project label; an explicit accessible label fixed it and both lifecycle tests passed on rerun. No cloud generation is simulated as real functionality.
- Dashboard production build and TypeScript validation passed. Desktop light/dark and mobile captures were reviewed; one combined correction pass fixed mobile navigation and desktop editor overflow. Impeccable's mechanical checks reported no findings.
- Actual launcher checked, main library left empty, and live health returned200. The ready voice list includes installed eSpeak; optional neural models remain uninstalled.

The test suite emits one upstream Starlette/httpx deprecation warning; it does not affect test results. Live YouTube and provider/model limitations listed above still apply.
