# ShortForge progress

## October 27, 2026 — Current product, requirements and architecture documents

Replaced the stale original `AGENT.md` brief with current maintenance guidance, expanded `PRODUCT.md`, and updated `DESIGN.md` for native Concat, 50-entry pages, selection, refresh and partial-failure behaviour. Added root `PRD.md` and `ARCHITECTURE.md` with source/test references, acceptance criteria, runtime/data flows, measured performance and deferred scope. Marked the old browser-editor architecture historical and linked the current documents from README. The documents distinguish retained AI/YouTube APIs from current dashboard features and do not claim native export, live-platform or Windows verification from fixtures.

Pre-commit verification on October 27: 343 backend tests passed with five optional skips, 73 extension tests passed, and 23 browser tests passed. Dashboard app/test type checks and Python lint passed. Corrected one existing CSS formatting issue without changing its style values; the repository-wide formatting check passed afterward. Checked all local links in the updated root documentation.

## October 26, 2026 — Performance and media-quality improvements

Implemented the twelve priority areas in the [audit](PERFORMANCE-AUDIT-2026-10-26.md): bounded Library rendering, cheaper refreshes with HTTP revalidation, sequential Scout sampling, early speech rejection, separate video/audio conversion, shorter database write locks, indexed/throttled job updates, worker-thread uploads, bounded bulk actions, verified build reuse and less extension parsing/storage work. Search and selections span Library pages; compatible media streams avoid unnecessary lossy encoding. Source changes and incomplete video tails are rejected conservatively.

The 1,000-clip Library benchmark improved from 1,293 ms to 378 ms; the 5,000-clip API response from 247 ms to 118 ms; H.264-plus-PCM normalization from 1.758 s to 0.815 s with identical video packet hashes. See [measurements, checks and limits](PERFORMANCE-RESULTS-2026-10-26.md). The full suites passed 342 backend tests (five optional skips), 73 extension tests and 23 browser tests; the additional ten-bit quality case and final mobile checks also passed. All tests used isolated data. No native Concat export, live platform scouting or Windows run was performed.

## October 25, 2026 — Restore native Concat launch

The user chose native desktop Concat instead of the browser streaming integration. Library picture/title clicks and table Edit now show launch progress in the current ShortForge tab and open the selected video's persistent project in Concat's desktop window. Studio can also launch Concat without a selected Library video. The streaming routes, session handoff and automatic browser export forwarding are removed; Concat's own file dialogs and export controls operate on the local computer.

Normal project startup automatically downloads and verifies the pinned native runtime when it is missing on a supported platform, so the user does not install Concat separately. Later starts reuse it. Runtime binaries remain ignored by Git: distributing a source checkout relies on this first-start download, not on silently bundling the installed local runtime. Existing Concat projects, media copies and unrelated Library/Scout/YouTube Settings data remain intact. The October 24 entry below records the previous implementation and its tests, not current browser-editor functionality.

Validation: the core suite passed 218 tests with two opt-in skips before the final platform-discovery tests; the final native handoff suite passed all 18 tests with real interoperability and desktop launch enabled, and 13 installer tests passed. All 18 dashboard navigation/Library/native-launch tests, dashboard type checking, both production builds and the unpacked-extension smoke passed. Linux setup check and cached normal setup passed; checksum failures, interrupted installation and platform installation commands were tested with fixtures. Windows/macOS installers were not executed on this Linux machine.

The user's last streamed project was saved and closed normally, then its actual Library button launched that same project on the local desktop. The dashboard opened no additional tab, requested no streaming route, and the saved project manifest stayed byte-identical. The engine was restarted with the native routes. Retired streaming test processes were stopped; unused streaming runtime and session metadata were archived outside the project at `~/.cache/shortforge/retired-streaming-2026-10-25/`, preserving recovery files. Native projects and media remain in `data/concat/projects/`. Full native editing/export and optional AI tools were not retested in this revert. See [the current Concat setup and workflow](CONCAT.md).

## October 24, 2026 — Resume Concat browser integration

Recovered the interrupted editor replacement from the working tree and local verification artifacts. The previous custom Studio frontend and editor-only backend services had been removed; Concat's source and native runtime were already installed. Library-to-Concat project preparation, saved-edit reuse and a first Xpra browser streaming implementation existed. An earlier real browser capture showed a synthetic video loaded in Concat, but the last recovered file-picker capture was black and the earlier passing test marker predated streaming work.

The resumed integration opens a Library video's Concat session in a separate browser tab while keeping Library available. Concat continues to run on the engine host, with its interface streamed to the tab; end users do not install a separate editor. Saved Concat projects and their copied media remain independent of Library source deletion. The current host setup targets Fedora 44 x86_64/Python 3.14. This is still a local single-user application; public hosting needs authentication, isolated sessions/storage and resource scheduling.

The old Publish to YouTube button and Publish kit disappeared with the previous editor. Channel connection Settings and the YouTube backend remain, but Concat has no publishing handoff. Historical entries below describe the earlier editor and should not be read as current feature coverage. See [Concat setup, recovery and verification limits](CONCAT.md).

Finished the interrupted browser handoff and corrected its runtime seams: Library picture/title clicks open a separate tab, stale job results cannot redirect to an old session, Vite forwards the WebSocket, and extension navigation passes the local-origin boundary only for the session entry page. Browser readiness is checked before downloading footage. Failed starts clean up their processes, existing sessions can reconnect after an engine restart, and the larger virtual display keeps bottom controls reachable. The export watcher now follows Concat's completion record after muxing/atomic rename. Fixed an accidental 2 KB transfer limit and the pinned HTML5 client's incomplete capability negotiation and chunked-transfer handling.

Validation: the core suite passed 220 tests with 2 opt-in skips before the final transfer fixes; the final focused Concat/client suite passed 31 with 2 opt-in skips. The native opt-in interoperability check also passed separately. All 71 extension unit tests, 10 Concat browser tests, 9 existing navigation/layout tests, dashboard type checking, both production builds and the unpacked-extension smoke passed. Python lint passed for changed code. A fresh isolated real-browser run opened Library footage through the Vite WebSocket proxy, split the clip, saved, and reopened its two cuts. The in-tab folder picker worked. A 2.85 MB 1080×1920 MP4 exported and downloaded through Chrome; the download matched the host file byte-for-byte and contained three seconds of video plus audio. Opus streaming reported active; human listening, optional AI tools, large-file limits and multi-user hosting remain unchecked. Test data was separate from the user's 31-video Library.

## October 12, 2026 — Direct YouTube publishing

Added user-confirmed publishing from a saved Studio export to a connected YouTube channel. Settings imports a Google Desktop OAuth client file and manages channel connections. The Publish kit now includes manual title, description and tags, export preview, channel selection, visibility, audience/content disclosure, and a final review before publishing; optional Gemini suggestions remain available. The editor hands over the exact newly exported file, including when an older draft selected a different export. Upload history and resumable transfer state survive navigation and engine restarts. Retries check the existing upload session before sending more bytes, including when a final response was lost and the local export later disappeared. Tokens and session URLs remain in the private local engine storage. The original manual-upload-only brief is superseded by the user's approval of this feature.

Verification: the full backend suite passed 394 tests and 25 subtests, with 2 optional model checks skipped. After the final upload recovery fix, all 62 YouTube backend cases passed, including an integration test through the actual app routes. All 71 extension unit tests passed. Dashboard and bundled extension production builds passed. All 17 browser cases passed across focused runs, covering the existing editor/export/workspace flows, client-file setup, channel selection, metadata review, processing/history, connection return, exact-export handoff and mobile layout. The final phone check verified the corrected radio controls and no horizontal overflow at 390px. No live Google authorization or real upload was performed. This machine still needs the user's OAuth client setup and channel consent; see [the setup and five-step check](YOUTUBE-PUBLISHING.md).

## October 8, 2026 — Studio workspace and reliability

Polished the existing dark timeline editor around the user's CapCut/Premiere/Filmora references, prioritizing core editing and reliability. Added consistent workspace controls, readable project/save status, accessible shortcuts, resettable layout, compact source tools, actual frame-rate settings, a clearer import state, cached media thumbnails and a mobile tool strip. The timeline fills its viewport and initially fits the footage; filmstrips follow each clip's source interval. Fixed batch-upload busy state and typing spaces in project names. Removed 1,714 duplicate stylesheet lines. Existing effects, captions, audio tools, editing and export are preserved; this is not a claim of complete competitor feature parity.

Validation: 338 backend tests plus 25 subtests passed (2 optional cases skipped); 26 browser cases passed (2 optional long-export cases skipped); 5 focused cases passed again after the final functional changes. Actual MP4 output, preview/export frame and audio agreement, persistence, media recovery, trim/split/drag, and 100+ undo operations were checked. Desktop, laptop, 1920px user viewport, and phone screenshots show no document overflow or page errors. Lint and the dashboard/extension builds passed. See [the change and verification notes](editor/STUDIO-POLISH.md) for details and a four-step user check.

## October 8, 2026 — Instagram previews recovered

All 30 saved Instagram Reels had empty thumbnail fields because Scout only read `video.poster`. Scout now also reads the matching Reel's image payload, player cover, and saved account-grid cover. Instagram API responses use a local preview endpoint that reuses downloaded footage or recovers missing/expired covers with a metadata-only lookup, then caches decoded JPEGs. Existing clips do not need to be collected again; YouTube previews retain their existing URLs. Reimports can refresh a supplied cover, and clip deletion removes its preview cache.

All 30 previews in the existing local library now resolve, verified in Chrome: 29 were recovered and cached as Instagram covers, and the remaining Reel already had downloaded footage so its preview is a frame extracted from that video instead. The saved clip records keep their original cover field; previews are produced on request rather than written back. Validation: 123 core backend tests, 68 Scout unit tests, Instagram parser/account browser fixtures, the Library-to-Studio browser regression, TypeScript lint, and the bundled Scout/Studio build. New regressions cover empty posters, account-grid cover persistence, exact payload counts, expired URLs, cache reuse, invalid remote images, and deletion. To check: refresh the Library at `http://127.0.0.1:5173`; reload ShortForge Scout once in `chrome://extensions` before the next collection.

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

## September 29, 2026 — Select all and permanent delete

The Library gained a **Select all** control beside the search box and a **Delete** action in the selection bar, so collected Shorts can be cleared when the user wants rather than one at a time. Delete always goes through a confirmation dialog that names the count, previews the affected titles, spells out that saved scripts, transcripts, downloads, voiceovers, and exports are removed, and contrasts it with the reversible Archive action. A partially selected view shows a proper mixed tick.

Deleting now returns the disk space. Previously the endpoint removed only database rows and deliberately left files behind, which meant a deleted clip still occupied its MP4 forever. `db.delete_clip` removes the source, voiceover (with its `.timing.json`), and export (with its `.ass`) sidecars, then prunes the folders it emptied. A voice-clone reference recording is owned by its voice profile rather than a clip, so it is never removed here. Every path is re-validated through the existing data-folder guard, so a tampered asset row cannot reach outside `data/`. `POST /api/clips/delete-bulk` applies the same work to a selection and reports which ids were already gone instead of failing the whole batch.

Two design issues were found by testing against the running app rather than the test fixture. First, selection was scoped to the visible list, so a single keystroke in the search box silently shrank a pending delete; selections now survive filtering and searching, and Select all only adds or removes the rows actually on screen. Second, `appearance: none` on checkboxes meant the browser drew nothing for a mixed state, so half-selected looked identical to nothing-selected; an explicit mark is now drawn, matching the existing checkmark. Both were confirmed to fail against the previous behaviour before the fix.

Validation: 89 backend tests cover file removal, sidecars, retained voice references, refusal to delete outside the data folder, honest bulk counts, de-duplication, unknown fields, and continuing past an already-removed id. The browser test covers selecting all, the disabled empty state, surviving a search, per-row toggling of a filtered view, the mixed tick, the dialog copy, cancelling, deleting, and the clips returning 404. Checked in light and dark themes and at 390px with no horizontal overflow. 89 backend and 10 browser tests pass.

## September 30, 2026 — Scout dashboard button explains a stopped app

Clicking the dashboard icon opened `http://localhost:5173` as a bare link, so whenever the local app was not running Chrome showed its "localhost refused to connect" page. The extension never found out, and the message said nothing about how to fix it. The cause was that the dashboard is a separate process from the engine, and it is easy to stop one and leave the other.

The button now probes the engine health endpoint and the dashboard before opening anything. If both answer it opens the app; if either is down it opens nothing and shows one plain instruction to run `start.sh` (or `start.bat` on Windows) and leave that window open. Host permissions for port 5173 were added, and the extension is version 0.1.3.

Verified with the real built extension loaded in Chrome: with both processes up the click opened the dashboard showing "Engine connected" and the library. With the dashboard deliberately stopped, the same click opened no tab and displayed the instruction. A new test loads the built popup and asserts both outcomes; it fails against the previous behaviour, which opened the dead tab. The 20 extension unit tests and the existing content-script browser fixture still pass.

## October 3, 2026 — Reading subtitles that are painted into the video, and unsticking the audio tools

Studio could extract a clip's audio, but the control sat roughly 560 pixels down a
scrolling panel, behind the voice recorder, the script box and the whole narration
generator. Nobody looking for it would find it. The same was true of "Generate
captions" and "Cover existing captions". A real browser probe confirmed it: the
button existed, was enabled, and Playwright reported it "visible" while its box sat
at y=1183 in a 950-pixel viewport. A feature nobody can find is a missing feature.

Three changes fix that. The Audio panel now opens with **Import voiceover** and
**Import music**, followed by **This clip's sound** (Extract audio, Mute original
audio); the narration generator moved below them. The Captions panel now opens with
its own-file actions first. Selecting a clip and opening the inspector's **Audio**
tab now offers **Extract audio to its own track** as the first control, and the
inspector header carries a delete button, so selecting a track and removing it is one
click. "Detach audio" was renamed **Extract audio** to match how people describe the
job.

### Reading burned-in subtitles

Those captions are pixels. Nothing in the project knows what they say, so the only
honest way to get them onto the timeline is to read them off the picture. New
`engine/studio/ocr_captions.py` samples the lower band of the clip with a single
ffmpeg process — cropping and resizing in the filter chain rather than decoding whole
frames — and runs local CPU OCR over each sample. Repeated readings become timed
cues, and `POST /api/editor/{id}/ocr-captions` returns them as a background job with
progress. Each cue becomes an ordinary text clip, so it can be edited, restyled or
deleted like any caption the user made themselves. Runs entirely on the machine; no
frame is uploaded anywhere.

OCR runs through RapidOCR with the PP-OCRv6 models (Apache-2.0, ~214 MB installed,
CPU only, no system packages). It is pinned in `engine/requirements-ocr.txt` and
added explicitly through `engine/studio/setup_ocr.py`; `GET /api/editor-capabilities`
reports honestly when it is absent and the Captions panel says so instead of failing
at the click. The English recognition model matters: the older Chinese-tuned model
returned `YOURORANGEISNOT` with the spaces removed.

Two defects surfaced while testing the grouping and were fixed rather than papered
over. The representative text for a run was chosen by string length, so casing flickered
between cues; it now picks the reading the run agrees on most. And capping a cue at
six seconds silently discarded the rest of a long caption, dropping caption time; runs
are now chunked so consecutive cues meet exactly where the previous one ended.

Verified on a rendered clip carrying four burned-in lines: all four were recovered
with correct timings at 0.95–0.99 confidence, dropped onto the timeline as four text
clips, and one was then selected and deleted from the inspector. At 0.75 s per frame
a 58-second Short takes about 90 seconds, so the scan is a background job with a
progress bar and three speeds rather than a blocking action.

Validation: **178 backend tests** (12 new, covering grouping, band clamping, route
refusals and capability reporting) and **26 browser tests** pass, along with the
dashboard type-check and production build.

### One block for taking the original apart

The three "remove what came with the clip" actions had ended up in three
different places: Extract audio in the inspector's Audio tab, caption reading in
the left Captions panel, and the burned-in caption cover at the bottom of the
Basic tab. That is worse than burying one control, because nothing tells you they
belong together.

They now live in a single block, originally called **Remove what came with this
clip**: Extract audio to its own track, Extract on-screen captions, and Remove
burned-in subtitles with its method and region. The Audio tab keeps genuine audio
properties (mute, volume, fades, role, ducking) and the cover control no longer
appears twice. The duplicate OCR button in the left Captions panel was removed
rather than left as a second identical label to choose between.

The October 8 workspace pass later renamed that block **Source tools** and moved it
below Timing and Transform, so the core clip controls are the first thing shown when
a clip is selected and the source-processing actions sit underneath them.

Verified by driving all three from that one block on a clip with real audio and
four burned-in lines: extraction produced a second timeline track, caption reading
produced four text clips, and the solid cover drew over the subtitle band in the
preview.


## October 7, 2026 — Instagram, account scouting, and brief-caption filtering

Scout 0.3.0 now collects YouTube Shorts and Instagram Reels into the same Library. Paste a channel/account URL to open its video grid and visit only its queued videos; the session returns for more tiles and ends when exhausted instead of continuing into recommendations. Instagram source IDs are namespaced, thumbnails and download URLs remain platform-specific, and YouTube enrichment never runs for Reels. Account queues survive page navigation, known videos remain deduplicated, and stale messages from an earlier session cannot change a newer one. A zero likes/views minimum explicitly ignores that count, including hidden counts; profile tile views are retained for the corresponding Instagram Reel.

**Brief captions only** defaults to three seconds of detected text in total. Only candidates passing the metadata criteria get a temporary public download and a local full-frame OCR scan every 0.5 seconds. Persistent text and unavailable/incomplete checks are skipped. Videos may be up to 180 seconds/80 MB; one job runs at a time, bounded to eight minutes, with temporary files cleaned on every exit. Pause, Stop, tab closure, and navigation cancel outstanding analysis; cancellation waits for its worker slot to become reusable. AV1 downloads are normalized through FFmpeg to a temporary H.264 proxy so OpenCV can actually decode them. No new model download or paid API was needed on this machine.

The extension keeps criteria near the top, a separate action row inside Chrome's 392×600 popup, and progress in view while running. The Library identifies Instagram sources, accepts Reel links, and opens them in Studio. Scout's dashboard guide now explains accounts, caption screening, and both platforms.

Validation: 39 extension unit tests; YouTube description-menu, real MV3 background-tab, Instagram/account-navigation and caption-polling browser fixtures; light/dark popup checks including keyboard focus visibility; dashboard type checks and production builds. The broad backend run passed 257 tests (2 optional skips), and the final dedicated caption suite passed 29 tests, including real OCR, AV1 decoding, cancellation/cleanup, incomplete frames, and exact three-second allowance. The dashboard suite passed 29 tests with 2 skips; its remaining playback test assumed a three-second preview was still running after asynchronous assertions. The test now restarts playback before checking Pause, and passed its isolated rerun. A new Instagram Library/Studio browser regression also passed. Design review's dock-overlap and placeholder-contrast findings were resolved; existing design files were preserved.

Live validation of public YouTube Short `tleaVXWF3YI`: the initial scan exposed unsupported AV1 decoding in OpenCV. After FFmpeg normalization, full-duration local OCR checked 86 frames over 42.7 seconds and estimated 31.0 seconds of visible text (72.6%), correctly rejecting it against the three-second allowance. This is an OCR estimate, not a guarantee of caption absence: brief/small/stylized text may be missed, and scene text can cause rejection. Live Instagram account scrolling and logged-in layouts remain unverified here; their browser fixtures pass. Private/login-required downloads cannot pass caption screening. No social actions or authentication bypasses are performed.

To try it: start ShortForge, reload Scout at `chrome://extensions`, refresh social tabs, paste an account or open a Short/Reel, keep **Brief captions only / 3 seconds**, and press **Start scouting**. Change accounts after Stop; change filters after Pause. Full instructions are in `extension/README.md` and `docs/TESTING.md`.

## October 7, 2026 — Recover a missing Scout tab

Scout 0.3.1 fixes the reported **“No tab with id: 666544235”** error. Resume previously assumed its saved browser tab still existed, and closing a tab while already paused left that stale ID in storage. Resume now reconnects to the selected account's open profile or reopens its Shorts/Reels grid. It keeps the session, scan counts, filters, duplicate history, and saved/pending matches; it never substitutes an arbitrary Reel or a different creator's profile. A feed session can reconnect to the active Short/Reel. Switching accounts still requires Stop and a new Start, with a clear message before any stale-tab lookup.

Disconnected content scripts after an extension reload refresh automatically on Resume. The account's new tab is registered before navigation so its content script can rejoin the correct session. A real Chrome regression also exposed a loading race: Chrome can report a committed `about:blank` while the account is in `pendingUrl`. Scout now checks the pending destination before deciding that a tab left Shorts/Reels. Closing a paused tab clears its ID and gives a useful Resume instruction instead of requiring a fresh session.

To use the fix: reload Scout in `chrome://extensions`, check version **0.3.1**, and press **Resume** for the existing account. To switch from an old feed/account to `https://www.instagram.com/qianxiang_guyue/reels/`, press **Stop**, paste that URL, and **Start scouting**. The screenshot's **242 likes < 5,000** is an expected filter rejection, separate from the missing-tab defect. Earlier tiles may be revisited after tab recovery, but existing matches are not saved twice.

Validation: **51 extension tests**, **265 backend tests** (2 optional skips), and **31 dashboard browser tests** (2 optional skips) passed. Extension/dashboard type checks and production builds passed. The isolated real MV3 recovery fixture uses the reported stale ID, 21 prior scans, and exact Instagram account URL: it reattaches, visits account Reels, skips an existing Library item and a 242-like clip, saves a match, and exhausts the account; after closing while paused, it recreates the account tab and saves only a new eligible Reel without changing unrelated browsing. The existing real MV3 background-tab fixture also passed. These use representative Instagram/YouTube markup and a mocked Library, not the user's logged-in Instagram session; live account layout remains unverified. The local engine health check passed and no restart was needed.

## October 7, 2026 — Custom limits and small Chinese annotations without speech

Scout 0.4.0 puts **Minimum likes** and **Minimum views** first in the popup. Both remain fully editable and persist between openings; **0** means no minimum, including hidden counts. The 5,000/10,000 defaults are starting values only. Empty, negative, fractional, and excessive counts give an actionable error rather than silently disabling a filter.

The optional **Captions and speech → Small Chinese text + no speech** setting allows short Chinese annotations even when they remain longer than the ordinary three-second text allowance. The rule is explicit: at most 12 alphanumeric characters per sampled frame, at least 80% Han characters, at most two text boxes, each at most 40% frame width and 6% frame height, with at most 3% combined area. Larger, longer, mixed, or uncertain text still counts against the user's **Other text (sec.)** allowance. This measures size, amount, and script; it does not promise to recognize every “modern” caption style or identify language perfectly.

This option also checks the entire original audio track with a pinned, free 2.33 MB Silero VAD model on CPU. Scout verifies that audio was downloaded, decodes the full timeline, and skips detected speech, incomplete audio, model failures, and unknown source silence. It never treats a video-only download as proof of no narration. Existing OCR and ONNX dependencies are reused, and the model was explicitly installed locally; no model download or paid call happens while scouting. Jobs and extension checks are bound to the chosen policy, allowance, video, and session so a relaxed result cannot pass a different filter. Ordinary **Brief captions only** and **Any captions** remain available, with defaults unchanged.

Real checks include generated Chinese captions (small annotations exempted, larger captions counted), synthesized narration after a silent intro (rejected), silence and music-like tones (no speech detected), and the public YouTube Short `tleaVXWF3YI`. Its complete combined A/V download produced 86 OCR samples over 42.7 seconds, about 31 seconds of visible captions, and 31.104 seconds of detected speech over 42.73 seconds of verified audio; the new policy correctly rejected it. No Library records were created for these checks. Music can trigger conservative rejections, and quiet or very brief speech can be missed; saved videos still need review.

To use it: reload Scout in `chrome://extensions`, confirm **0.4.0**, enter your own likes/views minimums, choose **Small Chinese text + no speech**, and Start or Resume. The local engine has already been restarted with the updated code and reports healthy; the small speech model is installed. Fresh installations have an explicit setup command in `extension/README.md`. Popup controls were checked in light/dark at 392×600 and tested for real MV3 persistence, switching filters, invalid inputs, and starting with caption checks turned off. Independent review found and resolved a hidden allowance validation issue; the existing visual style was retained.

Final validation: **332 backend tests** (2 optional skips), **57 extension unit tests**, and **31 dashboard browser tests** (2 optional skips) passed, along with extension/dashboard type checks, production builds, and the real MV3 preferences browser regression. The running engine's loaded/disk revisions agree, its OpenAPI schema exposes the new policy, and the installed speech model readiness check passes. Live logged-in Instagram layout remains unverified in this environment.

## October 7, 2026 — Visible discovery modes and credited videos with any captions or voiceover

Scout **0.4.1** puts all four **Look for** modes directly above the editable count limits. The earlier modes had remained available inside a closed Discovery preferences section; they are now visible without expanding it. **Narrated candidates**, **Credited only**, and **Credits first, then narrated** retain their behavior. Narrated candidates are explicitly described as unverified, since that mode does not listen for narration.

The new **Credited, any captions/voiceover** mode requires attribution and the user's likes/views minimums, while allowing burned-in captions and voiceover. It forces caption/speech checks off, including when restoring saved settings, avoids analysis downloads, and never falls back to uncredited videos after misses. Existing duplicate checks and account/feed targeting remain in place. Switching back to another mode unlocks caption/speech settings, including the small Chinese text/no-speech option. Invalid unfinished caption allowances cannot block the permissive mode, and changing modes keeps custom count limits.

To use it: reload Scout at `chrome://extensions`, confirm **0.4.1**, choose **Credited, any captions/voiceover**, set your count limits and account URL, and Start or Resume. Captions and voiceover are allowed, not required. Other modes remain visible beside it.

Validation: **61 extension unit tests**, **332 backend tests** (2 optional skips), and the real MV3 popup preferences regression passed. Dashboard browser checks passed **30 tests** with 2 optional skips on the first run; the remaining editor audio-cleanup test failed a timing-sensitive assertion and passed unchanged when rerun separately. Type checks and extension/dashboard production builds passed. A bounded light/dark review at 392×600 confirmed all four mode rows and both count fields fit above the fixed action dock; independent review found no blocking defects. The local engine remains healthy with matching loaded/disk revisions. Live logged-in Instagram browsing was not exercised for this extension-only change.

## October 7, 2026 — Pinterest-inspired Scout redesign

Scout **0.5.0** replaces the long, basic popup form with a compact violet control panel. Research compared public Pinterest previews of recording-extension controls, Dark Reader's settings, and a dark analytics dashboard; the references and applied principles are in `docs/design/scout-pinterest-research.md`. Scout now uses a compact brand header with a named **Library** action, four visible mode choices in a two-column layout, paired editable count fields, and grouped account and caption settings. The locally bundled Inter font includes its open license. Light and dark versions follow the system preference, and reduced motion disables transitions.

Every scouting option remains available: narrated candidates, credited only, credit-first fallback, credited with any captions/voiceover, custom count limits, account/channel targeting, and the small Chinese text/no-speech filter. The running session has clearer scanned/matched figures and last-video feedback. Validation and connection errors appear above the fixed Start/Pause/Stop buttons instead of disappearing lower in the scrolling panel. Library opens the same bundled workspace and explains how to start a stopped local engine.

Validation: **61 extension unit tests**, **332 backend tests** (2 optional skips), and **31 dashboard browser tests** (2 optional skips) passed. Extension/dashboard type checks and production builds passed. Real MV3 tests cover saved preferences, all mode choices, native arrow-key selection, maximum/zero/custom counts, invalid fields, and starting the credited-any mode without analysis. Popup browser checks cover keyboard focus, the action dock, Library access with/without the engine, and light/dark idle, criteria, paused, running and error views at 392×600. The bounded visual pass corrected a long-label wrap before its final capture. Independent finish review returned **ship**, with no material fixes across all ten valid captures; the detector only flagged the already-pinned Inter font. The engine remains healthy and needs no restart for this UI release. Live logged-in social browsing was not exercised for this visual change.

To try it: reload Scout at `chrome://extensions`, confirm **0.5.0**, open the popup, and choose a mode. Your saved settings remain intact; scroll for the account and caption controls, then Start or Resume.

## October 7, 2026 — Optional Look for choices

Scout **0.5.1** lets every **Look for** choice be unselected. Click the selected card again, press Space on its focused radio, or use **Clear**. With none selected, Scout accepts credited or uncredited Shorts/Reels without requiring narration or keywords. Likes/views limits, account targeting, duplicate protection, and the chosen caption/speech policy still apply. This allows videos from an original creator without requiring self-credit. New settings start unselected; existing saved presets stay selected until changed.

The cleared selection persists across popup and worker reloads. Clearing while paused makes previous skips eligible for reconsideration without resaving existing Library clips. Clearing **Credited, any captions/voiceover** unlocks the caption controls and retains **Any captions** until the user chooses another policy. All four existing presets remain available. Unrestricted discovery reuses the engine's existing count-qualified metadata for compatibility, while visible start and match messages make no claim that narration is required or verified.

Validation: **68 extension unit tests**, **332 backend tests** (2 optional skips), and **31 dashboard browser tests** (2 optional skips) passed. Extension/dashboard type checks and production builds passed. The real MV3 popup regression covers card/radio click deselection, keyboard Clear and Space, native arrow keys, persistence, starting without a preset, retained count/account/caption settings, and all existing modes. The light/dark captures at 392×600 keep every mode, Clear, and both count fields above the fixed action dock. This change uses isolated browser fixtures; live logged-in Instagram was not exercised.

To try it: reload Scout in `chrome://extensions`, confirm **0.5.1**, pause if needed, then click your selected **Look for** choice again or press **Clear**. Leave all four unselected, set your other filters, and Start or Resume.

## October 9, 2026 — A tidy-up pass over the whole project

Every file in the project now goes through an automatic formatter, so indentation and quote marks
stop being something you have to think about. Python is formatted by **ruff** and everything else by
**Prettier**. Fifty-nine Python files were reformatted and the 200 complaints ruff had about them are
now zero; forty-three JavaScript, TypeScript and CSS files were reformatted. From the project root,
`npm run format` tidies the front end, `npm run format:py` tidies Python, and `npm run lint:py`
reports Python mistakes without changing anything. A small helper, `scripts/ruff.mjs`, finds ruff
inside `.venv` on both Windows and Linux so the command works the same on either. Hand-written
Markdown is deliberately left unformatted, so your notes keep the line breaks you gave them.

**A real counting bug was found and fixed.** Scout reads the like and view counts off the page, and
three different pieces of code were each doing that job slightly differently. They have been merged
into one. While merging, one of them turned out to be broken: when a localized page separates
thousands with a non-breaking space — `Views: 12 400` — the old pattern stopped at the space and read
the number as **12** instead of **12,400**. Any Short shown that way was being judged on a count a
thousand times too small, and could have been skipped for being below your minimum. Three new tests
now cover the three invisible space characters that real pages use.

**The checks now cover more than they claimed to.** `npm run lint` in the dashboard was only
type-checking the app, silently skipping all fourteen browser tests and both config files; it now
checks them too. The same hole in the extension's build check is closed. The dashboard's build step
was also running `tsc -b`, which does nothing useful on a project set up this way, and now runs a real
type check.

**Things removed.** Tailwind was installed and wired into the build but produced no CSS at all — the
styling is hand-written — so it and the unused `mp4box` package are gone, which takes about 8 MB out
of `node_modules` and a pointless step out of every build. One abandoned source file,
`dashboard/src/studio/engine/videoDecoder.ts`, had no references anywhere. Sixty-two files went in
total, fifty-eight of them documentation: a frozen 2026-10-03 review ledger of forty-five files that
nothing linked to, nine superseded planning notes whose contents are contradicted by this project's
own spec sheet, and three dashboard design reviews that their own successors describe as replaced.
The two links pointing into that set were repointed first, and a scan afterwards found no broken
links anywhere.

**Three documents were saying untrue things.** `docs/EDITOR.md` claimed export runs through FFmpeg
(it runs in the browser; FFmpeg is only the fallback) and quoted limits of "eight tracks, 100 timeline
items, 120 keyframes" when the real figures are 4,096 tracks, 5,000 items and 5,000 keyframes.
`README.md` repeated the same stale limits and still advertised Tailwind. `docs/AUDIO-SEPARATION.md`
said a rights gate is checked before audio work, which has not been true since the gate was removed on
2 October. All are corrected against the code rather than against each other.

Finally, `DESIGN.md` pointed at four files it called the "active dashboard contract" and "direction
contract" that were excluded from Git — so they existed only on this one laptop and would be missing
for anyone else. Those four, plus three review records and two measurement files, are now kept in Git
(56 KB of text). The screenshots stay out, because the test suites rewrite them on every run, and the
Pinterest reference images stay out because `DESIGN.md` promises no reference raster ships.

Validation: **338 backend tests** (2 optional skips, 25 subtests), **69 extension unit tests**, and
**34 dashboard browser tests** (2 optional skips) passed. Backend results are identical to the
measurements taken before any file was touched. `ruff check`, `ruff format --check` and
`prettier --check` are all clean across the repository, and type checks and production builds pass for
both the dashboard and the extension. One browser test — the Web Audio preview cleanup check — failed
its timing-sensitive assertion inside the full parallel run and passed on its own, which is the same
behaviour recorded for it on 7 October. Live logged-in social browsing was not exercised; this pass
changed no scouting behaviour other than the counting fix above.

To pick it up: run `npm install` once in the project root to get the formatter, then `npm run format`
whenever you like. Your `extension/dist` and `dashboard/dist` folders were rebuilt and left in place,
so the extension you already loaded in Chrome keeps working without reloading.

## October 10, 2026 — Making the written record match the code

Yesterday's tidy-up changed enough that several documents were left describing a project that no
longer exists. This pass fixed the documents rather than the code, with one exception noted below.

**The spec sheet was telling future helpers that a working feature did not exist.** `AGENT.md` said
in three places that AI removal of burned-in captions was unimplemented and out of scope. It is
implemented: a 263-line module, a 318-line worker, a registered route, a 450-line panel in the
editor, thirteen tests and a user guide. Anyone following the old text would have refused to touch a
working feature, or built it a second time. The out-of-scope note is kept as history, and crop-zoom
is still correctly recorded as never built.

**A colour mistake that would have failed contrast.** `AGENT.md` listed the accent colours with the
Studio palette labelled "Dark" and the dashboard's dark accent labelled "light". Following it would
have put a pale violet meant for a dark workspace onto a white page. All three scopes are now named
explicitly, with a note not to carry a value across them. No colour in any stylesheet changed.

**Other things the documents got wrong**, each checked against the code rather than against another
document: the shared API contract gave the voice speed range as 0.9–1.1 when the engine accepts
0.7–1.2, and did not mention that a pitch other than zero is refused outright for every provider
except Edge; `engine/studio/README.md` still described a rights gate that was removed on 2 October;
the voice guide repeated the wrong speed range; an optional-dependency file pointed at the wrong
speech model; the font notes documented one typeface while twenty more ship beside it; and the
licence record still listed Tailwind, which was removed yesterday, while omitting the inpainting
model that actually does ship. The last one mattered most, so the model, its licence, where the full
notice lives and the fact that no weights are committed are now all written down.

**A claim we got wrong ourselves.** Yesterday's notes said the old `tsc -b` build step "did nothing
useful". That was not true. Both forms were run against a deliberate type error and both caught it
identically; the switch was for tidiness, because build mode writes a cache file nothing reads. The
two places that repeated the wrong claim have been corrected.

**The API contract was checked route by route**, not spot-checked: all 48 routes in the engine
appear in `shared/contract/API.md`, and all 48 documented routes exist in the engine, with every
apparent difference explained by a router prefix. Beyond the speed and pitch fixes, it needed
nothing.

**Nothing was deleted this time.** Three findings are written down and left alone for you to decide:
about 105 lines in `engine/studio/editor_transitions.py` implement an FFmpeg-native transition
design that has never had a caller in the repository's history, and now carry a comment saying so;
the legacy server-side export route is unreachable from the interface but is the only end-to-end
test of the font and subtitle pipeline, so removing it would remove that coverage; and voice cloning
is complete and tested on the engine side with no way to reach it from the interface.

Validation: **338 backend tests** (2 optional skips, 25 subtests), **71 extension unit tests**, and
**34 browser tests** (2 optional skips) passed, the last with no flake this run. `ruff check`,
`ruff format --check` and `prettier --check` are clean across the repository, and type checks and
production builds pass for both the dashboard and the extension. No source behaviour was changed in
this pass apart from the contract corrections, which document existing behaviour rather than alter
it.

## October 15, 2026 — Conservative codebase cleanup

Scanned all 352 existing project files, including 168 source files, using import/reference checks,
Python and TypeScript syntax analysis, CSS selector checks, file hashes and local documentation-link
checks. The workspace already contained substantial uncommitted work; the cleanup was compared
against a separate snapshot of that working tree. Installed dependencies, model environments, local
media and the database were preserved.

| Area | Change or finding | Compatibility evidence |
| --- | --- | --- |
| Backend transitions | Removed the unused `XfadeSpec`, `xfade_filter`, `xfade_chain`, literal-code generator and their unused catalogue metadata. Kept the 20 accepted transition IDs in a frozen set. | All seven active transition functions retain the same operations; transition IDs, defaults and saved-project validation are unchanged. |
| Captions | Removed two unused Python constants and corrected the comments/documentation that implied they controlled rendering. | The browser's used constants and the actual ASS animation tags are unchanged. |
| Library | Removed the always-true `editable()` helper and its unnecessary filtering pass. | Every active clip remains ready to edit; rights remain recorded metadata. |
| Styles | Removed 46 unused CSS rules for 11 retired class names, including the old caption controls, transport and footer. | No remaining markup or dynamic class construction uses those classes; the browser suite passed. |
| Build and stray files | Matched the extension's dashboard type check to `tsc --noEmit -p tsconfig.json`. Archived the obsolete `dashboard/tsconfig.tsbuildinfo` cache and the unreferenced 51-byte `:memory:.ses` session artifact outside the project. | Both builds passed; the cache was not recreated. The unpacked extension's loading, assets, API connection, Library Edit and Studio reload checks passed. |
| Duplicate assets | Found 42 identical pairs: 20 fonts, 20 matching font licences, a font manifest and the Inter licence. No identical source files were found. | Both browser/extension packaging and the Python renderer need their own asset paths, so these copies remain. Their purpose is now documented in `engine/studio/fonts/README.md`. |
| Folder structure and older APIs | Kept the separate dashboard, extension, engine, shared contract, scripts and documentation folders, along with worker entry points and compatibility APIs. | The complete OpenAPI document is unchanged: 57 HTTP routes and 45 schemas. |
| Documentation | Updated current suite counts, removed stale references to deleted helpers, explained the known browser-test timing issue and removed a trailing blank line flagged by Git. | Local document links resolve and `git diff --check` passes. |

The source and build files are 429 lines shorter overall. No dependencies or lockfiles changed in
this cleanup. All font and licence asset bytes remain unchanged. The original working-tree snapshot,
cleanup-only diff, archived artifacts and test logs are in `/tmp/shortforge-cleanup-ubkdfv19/`;
`source-backup.tar.gz` contains the pre-cleanup project files. This is a temporary local backup.

| Verification after cleanup | Result |
| --- | --- |
| Backend: `.venv/bin/python -m pytest engine/core/tests engine/studio engine/ai -q` | 400 passed, 2 optional model checks skipped, 25 subtests passed. |
| Extension: `npm --prefix extension test` | 71 passed. |
| Browser: `npm --prefix dashboard test` | 44 passed, 2 optional licensed-media checks skipped. |
| Packaged extension: `cd extension && node tests/packaged-studio.mjs` | Passed with the real unpacked MV3 build. |
| Dashboard type checks; both production builds; Python lint and formatting; Prettier | Passed. |
| API schema comparison, local documentation links and final file-scope review | Passed; no unintended file changes. |

The browser baseline, taken before any edits, had one failure in the Web Audio preview cleanup test
(43 passed, 2 skipped). That test passed in isolation before cleanup and again in the full suite after
cleanup. It remains an existing timing-sensitive test, not evidence of a cleanup regression. The
existing Starlette/httpx deprecation and Vite bundle-size advisories were also present before cleanup.
