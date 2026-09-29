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

## September 29, 2026 — Scout 0.1.1 collection fix

Investigated the report of 36 scanned Shorts and no matches in Narrated mode. That mode incorrectly required narration keywords in titles/descriptions, so eligible narrated videos with ordinary titles could be rejected. Removed that requirement: clips with readable counts meeting both limits are now collected for narration review, without credits or keywords. Narration remains unverified because Scout does not analyze audio. Explicit mode selection also overrides a stale saved credit phase, and changing mode or count limits allows previously skipped videos to be checked again.

Improved extraction for newer like buttons and structured statistics, precise accessible counts, hidden elements, and delayed description panels/counts. Description prose cannot substitute for actual view counts; unreadable counts still skip. The popup now shows the last Short's counts and decision, and records skip reasons in Recent activity. Updated guidance in the dashboard and extension and rebuilt `extension/dist` as version 0.1.1.

Validation: **20 Scout tests passed**, including a 30-match run from noncredited, keyword-free candidates at exactly 5,000 likes / 10,000 views; extension type-check/build and dashboard production build passed. Expanded synthetic YouTube browser checks passed for delayed loading, modern markup, hidden counts, precise accessible values, and unknown views. Popup tests passed in light/dark for the paused 36-scanned case, missing-count diagnostics, successful matches, live state updates, and Self-test; dark diagnostics screenshot reviewed. Live YouTube collection still requires verification in the user's Chrome.

To activate: reload Scout at `chrome://extensions`, refresh the YouTube Shorts tab, then Stop and Start scouting for a fresh session. Check Last Short / Recent activity if anything is skipped.

## September 29, 2026 — Scout 0.1.2, verified against live YouTube

The user reported readable views in Description still being missed. Opened real YouTube in a separate Chromium profile and inspected the actual three-dot menu → Description flow. The earlier synthetic tests incorrectly supplied a direct Description button and never tested this menu. YouTube's current menu uses actionable `button[role="menuitem"]` elements within `yt-list-item-view-model`; Scout only searched older menu renderers. Added those controls, the `engagement-panel-structured-description` target, and current `view-count-factoid-renderer` / `factoid-renderer` stat selectors. Delayed menus now get bounded polling, and a failed direct control falls back to the menu. Opening failures pause with the exact failed step. Self-test now checks actual readable counts without clicking; users open Description first to expose its views.

Loaded the real unpacked MV3 extension in the test browser and used the running local engine, without mocked YouTube pages or mocked saving. Initial live collection saved `tleaVXWF3YI` with 25,000 likes / 3,055,379 views. A subsequent session scanned four Shorts: skipped that duplicate, saved three new clips, and stopped at target 3. The engine API confirmed all four new clips persisted:

| Video ID | Likes | Views |
| --- | ---: | ---: |
| tleaVXWF3YI | 25,000 | 3,055,379 |
| ERtnwBo-IKY | 359,000 | 29,960,880 |
| oCtP8HDfYVU | 174,000 | 13,086,193 |
| XO5IukfwGb0 | 791,000 | 41,706,932 |

Reopened the last Short's Description manually and compared its 41,706,932 views with the stored count: exact match. All live Self-test checks passed with the panel open. Live screenshots are in `extension/tests/screenshots/live-youtube-description.png` and `live-scout-complete.png`. This verifies menu opening, stats extraction, navigation, deduplication, target stop, and real Library persistence on the observed layout; it does not verify narration or every YouTube layout.

Validation also passed: 20 extension unit tests, TypeScript/build, and browser regressions for modern/legacy delayed menus, top-level More, inert direct controls, existing open panels, missing Description, readable Self-test counts, and no social clicks. Built `extension/dist` version 0.1.2. Reload Scout and refresh the YouTube tab to activate it in the user's normal Chrome profile.

## September 29, 2026 — Original script extraction and faithful rewriting

Library Shorts now open an editable Original script field. Opening a blank YouTube script automatically attempts free original-language captions, saves the transcript and original script, and enables Rewrite. Extraction removes rolling-caption repeats and nonspoken sound labels without translating. It never substitutes a title or description for speech. If public captions are unavailable, the editor offers explicit Gemini transcription or manual pasting; uploaded/authorized local sources can use an already-installed Whisper model. Cloud extraction uses the configured Gemini key only after the user clicks its button, following Google's [documented YouTube video input](https://ai.google.dev/gemini-api/docs/generate-content/video-understanding). No dependencies or models were installed.

Extraction preserves existing originals on reopening, keeps rewritten drafts, and protects edits made during a job. Extract again explicitly reloads the source, including replacing topic text created by the previous app flow. Text extraction and rewriting are available for Library references as requested; footage download/edit/export permissions remain separate. Existing local transcription now also populates an empty original-script field.

Rewrite instructions preserve language, tone, speaker perspective, context, fact order, names/numbers/qualifiers, and the hook/payoff. The exact original word count is the target. At most two retries are made, retaining the closest draft; the app never pads or truncates to manufacture a match. The editor distinguishes an exact match from the ±5% fallback and an outside-tolerance result. These instructions guide the model; tone and meaning still need review.

Live validation: public captions from `tleaVXWF3YI` produced **97 narration words** after removing sound labels, with no key or model download. The real API saved the transcript and matching original script in the existing Library clip. A browser opened that same project and confirmed 97 words populated with Rewrite enabled. `ERtnwBo-IKY` advertised no captions, exercising the need for the explicit fallback. The running engine was restarted with this feature and health returned OK. No Gemini key or Whisper installation is configured, so actual cloud transcription/rewriting and local neural inference remain untested; provider tests use controlled responses.

Automated validation covers caption parsing and original-language selection, sound-label cleanup, original persistence, explicit replacement, concurrent edits, missing captions/key, no automatic quota use, unchanged footage permissions, exact-word retries and closest-draft selection. Dashboard type-check, production build and formatting checks pass; desktop/mobile extraction screens were inspected with no horizontal overflow.

### Bug found and fixed during review

The first automatic extraction guard also skipped the attempt whenever the project already had a *remembered* extraction job. Because the editor remounts per project, a Short whose extraction had failed opened to a permanently blank Original script with Rewrite disabled, and the guard was already spent so nothing retried. The remembered job is now only trusted when it is still running (already covered by the busy state) or completed (which repopulates the field), so a previous failure earns one free retry per visit. A browser regression covers this and was confirmed to fail against the original code before the fix.

Final counts: **85 backend tests** and **9 browser tests** pass, the latter exercising real project import, persistence and reload while only external transcription and generation are simulated.
