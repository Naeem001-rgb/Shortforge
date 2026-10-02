# Integration reconnaissance

Inspected 2026-10-02. Recon only: no feature code changed. `docs/editor/TODO.md`, `PROGRESS.md`, and `DECISIONS.md` did not yet exist when this task began.

## What actually exists

| Area | Existing implementation | Gap against requested story |
| --- | --- | --- |
| Scout | `extension/src/background.ts` batches matching URLs into `POST /api/clips`; defaults are 5,000 likes and 10,000 views. | Stores metadata, not source media. Narration classification is a discovery heuristic, not verified speech analysis. |
| Library | `dashboard/src/library/Library.tsx` contains a detail modal with Open in Studio. | Grid action opens unknown-license videos as “View inspiration”; table has only Details. |
| Studio opening | `dashboard/src/shell/App.tsx` stores selected clip in localStorage and switches the current dashboard page. | No URL deep link and no new editor tab. |
| Source download | `engine/core/routes.py` and `engine/core/media.py` run yt-dlp with ffmpeg in a background job; accepts YouTube URLs only, has progress/errors. | Download is permission-gated and requires a separate Prepare source video click. Downloader output does not go through the browser normalization used for imported media. |
| Project seed | `engine/studio/editor_routes.py:editor_response` seeds a source clip when an unsaved project has a local video source. | Ignores unknown-license source; existing saved empty projects are not reseeded. Studio download callback seeds only if timeline is completely empty. |
| Full extension page | Manifest V3 Scout bundles popup/background/content scripts. Popup checks both local servers then opens `http://localhost:5173/`. | No packaged editor/dashboard page; `/api` relies on Vite proxy. No OAuth identity permission/configuration. |
| Original soundtrack | `/editor/{id}/extract-audio` produces PCM audio; Studio aligns detached result to selected video and mutes original. | Backend already usable; verify source-in/speed trim alignment in new editor. |
| Vocal isolation | Optional isolated Demucs CPU runtime, model integrity check, capability endpoint, stems with surfaced artifact warning. | Requires separately installed runtime/model. Not instant or a guaranteed clean narration remover. |
| Script | `/scripts/{id}`, `/rewrite`, `/clips/{id}/extract-script` already exist. YouTube public captions, optional local Whisper, explicitly triggered Gemini transcription. | Current Studio does not expose script/rewriter tools. Gemini returns text without word times. |
| Voice | `/voices` and `/tts` support ElevenLabs, Piper, eSpeak, Edge, local Chatterbox. Voice job returns asset and timings. | Current Studio only imports voice/music files. Settings UI does not expose ElevenLabs key, although settings schema accepts it. ElevenLabs voice list is one hardcoded example; stability fixed at 0.5, speed constrained to 0.9–1.1. |
| Caption timing | Local faster-whisper returns real word timestamps. Voice alignment falls back to explicitly labeled equal-duration approximate words. | No bundled default on-device/browser model; word timing cannot be called automatic recognition when fallback is used. |
| SEO/publish | Existing Gemini `/seo` API and dashboard Publish kit with export download, copy controls, YouTube Studio link. | Metadata generated only in component memory; no persistent publish draft, credits editor, schedule, OAuth or direct upload. `Studio` accepts `onPublish` but current ProjectEditor ignores it. |
| Secrets | Backend settings accepts keys, returns only `*_key_set`; DB mode 0600; environment keys supported. | Keys currently live in SQLite/environment, not extension storage as new brief requires. Do not expose existing key values to migrate silently. |

## Exact cause of the owner's empty Studio

Scout creates `license_status: unknown`; the Library grid withholds its editor action; opening through Details loads an empty project. The engine's `db.require_editable()` rejects download, media serving, transcription, audio processing and export for that status. The editor also disables importing into this project. No automatic source fetch is attempted. An empty project then autosaves, so the server's initial source-seeding logic will no longer run on subsequent opens.

The owner's latest request explicitly authorizes automatic Library-to-editor fetch and makes source/rights review optional metadata (brief 4.10). It supersedes the earlier product's rights lock. Remove the edit/download lock while retaining the original `unknown` status, creator, URL and notes; never mark an unknown clip as owned or invent permission. Source validation and per-project asset ownership checks remain required technical boundaries.

One additional existing defect: Studio's permission dropdown offers `owned`, but `engine/core/models.py:ClipPatch.license_status` accepts only `permission` or `unknown`, so that UI option currently produces validation failure. Removing this forced editing workflow resolves the friction; a future optional credits editor must use a matching API contract.

Gate change map:

- `dashboard/src/library/Library.tsx`: make Edit/Open in Studio available consistently for every non-archived clip; direct detail action remains.
- `dashboard/src/studio/Studio.tsx`: replace permission-gated empty screen with automatic source readiness flow, explicit loading/error/retry, and local media import. Do not overwrite existing edits when fetching finishes.
- `engine/core/db.py:require_editable`: remove license lock, preserve existence lookup; preferably rename semantic helper later to avoid misleading code.
- `engine/core/routes.py`: existing calls then become available without metadata mutation; preserve file, host, size and source ownership validation.
- `engine/studio/editor_routes.py:editor_response`: remove license predicate; seed source once when appropriate even for saved-empty projects, and persist atomically to avoid duplicate seed on reload.
- `engine/studio/editor_media.py`: no rights predicate exists here; preserve `get_editor_asset` cross-project asset checks, source bounds, and file existence validation. `project_media` currently suppresses unreadable/missing files, so new relink UI will need explicit missing-asset records instead of silent omission.
- `engine/core/script_extraction.py`: allow local transcript fallback for existing sources regardless of unknown rights status.
- Existing regression tests that assert 403 on unknown rights represent superseded product behavior. Replace them with assertions that editing succeeds without changing rights metadata; retain invalid ownership and forged status tests.

## Honest original narration / subtitle removal

- Muting/deleting the original audio removes its narration **and all other mixed sound**. Detaching makes that operation reversible and visible.
- Demucs can produce a music stem while removing much of the voice; residual voice and damage to music are possible. Keep it capability-based and accurately labeled.
- A text caption track added in Studio can be deleted or hidden cleanly.
- Burned-in source subtitles are pixels in the video. They cannot be recovered as removable layers. Offer a clearly named crop, cover region or blur region, with preview/export parity; do not advertise those as restoring original footage or removing text without damage.
- Downloaded YouTube sidecar subtitles are distinct from burned-in video text. Transcription does not erase the source video's pixels.

## Official web checks

Fetched directly over HTTPS on 2026-10-02 (not inferred from old docs):

1. [YouTube: Understand three-minute Shorts](https://support.google.com/youtube/answer/15424877?hl=en): square/vertical uploads up to **three minutes** are Shorts; standard-channel eligibility starts 2024-10-15. Export warning should use 180 seconds, not the historical 60-second limit.
2. [YouTube videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert): unverified API projects created after 2020-07-28 restrict uploads to private until audit. Current page states **100 calls/day; 1 unit in the Video Uploads quota bucket per call**. Do not hardcode the historical 1,600-unit figure. Account quota should be linked and described as subject to project allocation.
3. [YouTube resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol): initiate session via `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=...`; use session URI for data/resume. Requires OAuth authorization and owner setup; no credentials are present in manifest.
4. [ElevenLabs Create speech with timing](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps): `POST /v1/text-to-speech/{voice_id}/with-timestamps` returns audio_base64 and alignment / normalized_alignment containing characters plus start/end seconds. Prefer these real provider timings; group characters into words, preserve normalized text. Existing code uses the non-timestamp endpoint.

## Recommended bounded tasks and acceptance tests

| ID suggestion | Files / owner scope | Acceptance criteria written before build |
| --- | --- | --- |
| INT-01 | Library, App, API, extension packaging | Grid, table and Details each open selected clip by stable URL in a full editor tab; refresh retains selection; extension build packages JS/CSS locally and uses explicit localhost API base. |
| INT-02 | Core DB/routes/media + editor_routes | Unknown-license Scout clip opens/fetches without rights mutation; cached source creates timeline exactly once; repeated loads do not redownload; source errors show retry/import; existing edits remain. Verify with stub downloader plus one real available source. |
| INT-03 | Small Studio script/voice panel + voice API | Existing script loads/saves; generation uses chosen ready provider; successful audio lands at intended timeline position once; returned word timestamps preserved; provider failure preserves script and prior audio. |
| INT-04 | Voice provider adapter | ElevenLabs timestamp response decoded into audio and ordered word timings; dynamic voice picker/stability/speed; cloud action labeled; keys stored only via approved settings architecture. Real paid call requires owner key but parsing/HTTP failures can be fixture-tested. |
| INT-05 | Publish panel + draft persistence | Export opens publish metadata prefilled from saved script/SEO; user may copy all metadata/open upload page; unknown sources visible, optional credit lines do not duplicate. No cloud key needed for fallback. |
| INT-06 | Extension identity/upload adapter | OAuth account selected explicitly; resumable progress/retry/cancel; private audit caveat visible. Genuine upload cannot be accepted without owner's configured OAuth project/account; fallback remains available. |
| INT-07 | Source removal controls | Original audio can be detached and deleted/muted with aligned result; burned-caption cover/crop is labeled accurately; deleting Studio caption layers does not remove visual media. |

Recon limitation: API/browser flows were inspected in source, not runtime-accepted here. Current findings are not a claim that their end-to-end paths pass.
