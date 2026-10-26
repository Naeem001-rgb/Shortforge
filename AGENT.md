# ShortForge — maintainer and agent guide

Updated October 27, 2026. This replaces the original build brief, which mixed retired editor features with current requirements. Historical decisions remain in Git history and [docs/PROGRESS.md](docs/PROGRESS.md).

ShortForge is a local, single-user video discovery and Library workspace that opens the native Concat desktop editor. The user works on a CPU laptop and prefers free software, plain explanations and the smallest complete change.

## 1. Read the current contracts

| Document | Purpose |
|---|---|
| [PRODUCT.md](PRODUCT.md) | Users, product scope, constraints and current capabilities |
| [PRD.md](PRD.md) | Requirements and observable acceptance criteria |
| [DESIGN.md](DESIGN.md) | Current paper-and-gold visual system and interaction rules |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Runtime components, data ownership and execution flows |
| [shared/contract/API.md](shared/contract/API.md) | API shapes and integration contracts |
| [docs/CONCAT.md](docs/CONCAT.md) | Native editor setup, saved projects and verification limits |
| [Performance results](docs/PERFORMANCE-RESULTS-2026-10-26.md) | Measured improvements, checks and deferred work |

Follow the user's requested scope. Verify behaviour in the implementation when a historical document disagrees. Files under `docs/editor/` largely describe the removed browser editor; they are not instructions to restore it.

## 2. Preserve these behaviours

- **Native Studio:** Library pictures/titles and table Edit open a progress page in the current dashboard tab, then launch Concat on the engine's computer. Do not restore the custom timeline, WebCodecs exporter, browser streaming or a separate editor tab.
- **Saved edits:** Concat projects and independent media copies live under `data/concat/projects/`. Reopening must preserve edits. Keep the independent media copy and launch-failure detection; deleting a Library source must not destroy a Concat edit.
- **Library:** render at most 50 cards/rows per page. Search, filters, sorting and overview counts use the complete loaded list. Select page affects only the current page; selections survive pagination and filtering. Archive is bounded to four concurrent requests; deletion uses batches of at most 200 and retains failures for retry.
- **Refresh:** do not overlap Library polls or repeat periodic Library/health requests in hidden tabs. Resume when visible; keep explicit mutation refreshes and honest error states. Identical data must not replace state unnecessarily.
- **API compatibility:** `/api/clips` retains its complete `{clips:Clip[]}` response. ETag revalidation may return a body-free `304`. Do not silently paginate this endpoint: Scout uses the full list for duplicate detection.
- **Media quality:** decide video and audio conversion independently. Preserve compatible streams, validate output and clean up failed conversions. H.264 must use the supported eight-bit `yuv420p` format to qualify for copying. Never trade decoding checks or image/audio quality for an unverified speed claim.
- **Scout:** user-controlled discovery only; no likes, comments, follows, challenge bypass or cookie extraction. Unknown counts remain unknown. Preserve pending clips before submission and the video/session/policy binding of caption results.
- **Screening:** maintain full-duration coverage and the existing OCR sample interval/thresholds. Unreadable frames, incomplete tails and unverifiable speech must not pass. Early speech rejection reports zero OCR frames and unknown caption measurements. Optional models require explicit setup; scouting never downloads them automatically.
- **Rights:** permission and credit are metadata, not an editing/download gate. Never promote an unknown external source to owned. Attribution is not permission.
- **Publishing:** YouTube channel Settings and backend services remain. The old Publish kit UI and Concat-to-publishing handoff are absent. Opening, editing or exporting a video must never automatically publish it.
- **AI interface:** script rewriting, AI voice generation and the former SEO workflow are not dashboard features. Retained backend routes do not imply a current interface or Concat integration.

## 3. Code ownership map

| Area | Start here |
|---|---|
| Browser shell, refresh, navigation | `dashboard/src/shell/App.tsx`, `dashboard/src/api.ts` |
| Library and bulk actions | `dashboard/src/library/Library.tsx` |
| Native launch page | `dashboard/src/studio/Studio.tsx` |
| Theme and components | `dashboard/src/theme/`, `dashboard/src/ui.tsx`, `DESIGN.md` |
| Scout state, page reading and popup | `extension/src/background.ts`, `content.ts`, `instagram.ts`, `popup.ts`, `selectors.ts`, `types.ts` |
| HTTP boundaries and storage | `engine/core/app.py`, `routes.py`, `db.py`, `source_urls.py` |
| Acquisition and normalization | `engine/core/media.py`, `engine/studio/editor_media.py` |
| OCR/speech workers | `engine/core/scout_routes.py`, `engine/studio/scout_captions.py`, `scout_speech.py` |
| Concat preparation and launch | `engine/core/concat.py`, `concat_rpc.py`, `scripts/setup-concat.py` |
| YouTube services | `engine/core/youtube_auth.py`, `youtube_uploads.py` |
| Retained AI services | `engine/ai/routes.py`, `writing.py`, `voice.py` |
| Build and startup | `extension/build.mjs`, `start.sh`, `start.bat` |

## 4. Make the smallest complete change

Read the touched code and search every caller before editing shared behaviour. Include affected tests, fixtures, exports and contracts. Reuse existing components/helpers before adding dependencies or abstractions. Do not mix unrelated rewrites or formatting into a fix.

Keep request validation, file bounds, asset ownership, error cleanup, accessibility and durable state. Media probing must stay outside SQLite write transactions; revalidate source identity/version before reuse and retain atomic duplicate-job checks. Worker-thread uploads and event-stream database reads must not move back onto the event loop.

Use temporary data directories for tests and generated fixtures for media. Do not test destructive actions against the user's Library. Keep API keys, OAuth tokens, `.env`, user media, runtime binaries and downloaded models out of commits and public logs. Preserve the loopback host/origin protections and MV3 CSP.

Use the existing paper-and-gold tokens and shared controls. Preserve light/dark/system themes, keyboard navigation, focus restoration and reduced motion. The old violet browser-editor brief is historical. Do not infer full accessibility certification from browser smoke tests.

Update relevant contracts and `docs/PROGRESS.md` when behaviour changes. Report measured evidence and remaining limits; do not claim complete CapCut parity, perfect caption/speech detection or a tested native export when only the handoff was exercised.

## 5. Runtime and setup

Python 3.11+ is the engine compatibility target; use the project `.venv`. Node/npm build the TypeScript extension and React/Vite dashboard. FFmpeg may come from `FFMPEG_PATH`, the system installation or bundled `imageio-ffmpeg`. SQLite and media stay under `data/`, overridable by `SHORTFORGE_DATA_DIR` for isolated runs.

Normal startup: `./start.sh` on Linux/macOS, `start.bat` on Windows. Engine: `127.0.0.1:8787`; development dashboard: `127.0.0.1:5173`. The extension also bundles the dashboard and talks directly to the local engine.

Startup installs required dependencies, checks for a yt-dlp update and runs pinned Concat setup. Concat's runtime download is verified against the repository's release manifest. Optional OCR/speech/AI setup remains separate. See [docs/CONCAT.md](docs/CONCAT.md) for platform details.

The launchers use `npm --prefix extension run build -- --if-needed`. Reuse requires matching input/environment/dependency metadata and output hashes; a missing, modified or malformed cache must rebuild. `npm --prefix extension run build` always rebuilds. Do not replace this with a `dist exists` check.

## 6. Validation before shipping

Run checks appropriate to changed behaviour. For a release touching the app, extension and backend, all three suites and the relevant build/type checks must pass. Use an isolated data directory; on Windows substitute `.venv\Scripts\python.exe` for `.venv/bin/python`.

```bash
SHORTFORGE_DATA_DIR="$(mktemp -d)" .venv/bin/python -m pytest engine/core/tests engine/studio engine/ai -q -ra
npm --prefix extension test
npm --prefix dashboard test
npm --prefix dashboard run lint
npm --prefix extension run build
npm run format:check
npm run lint:py
git diff --check
```

The browser suite starts its own isolated engine and Vite server. Its browser path is configurable with `CHROME_PATH`; Windows launchers and native installers need separate platform verification. Markdown is intentionally excluded from bulk Prettier formatting. Format changed source files without rewriting unrelated code.

Use `extension/tests/instagram-fixture.mjs` and `extension/tests/packaged-dashboard.mjs` when changing page parsing, packaging or extension navigation; run them from `extension/` after building. They use isolated browser fixtures, not live platform accounts. Native Concat and installed speech-model tests are optional; report skips explicitly and never download models just to make them pass.

Keep performance comparisons reproducible: same fixture, build mode, machine and measurement boundary. Retain packet/pixel comparisons when changing conversion or frame sampling. Do not call a stage-only gain an end-to-end speedup.

## 7. Current evidence and limits

The October 26 release passed 342 backend tests with five optional skips, 73 extension tests and 23 browser tests; an additional ten-bit normalization case passed afterward. The [results report](docs/PERFORMANCE-RESULTS-2026-10-26.md) records the exact runs. The October 27 pre-commit rerun passed 343 backend tests (five optional skips), 73 extension tests and 23 browser tests. These counts are dated evidence, not a fixed requirement for future suites.

The full Library is still queried/serialized before ETag calculation; changed responses still transfer the full list. Model startup/inference, media download speed and Concat's own rendering remain outside the measured improvements. SQL pagination, persistent model workers, global job scheduling and publishing handoff are deferred, not already shipped.
