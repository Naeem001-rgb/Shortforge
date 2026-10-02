# Media, audio and rendering recon

Inspected 2026-10-02. This is an evidence-based Phase 0 inventory, not a claim that the master brief is complete. `docs/editor/TODO.md`, `PROGRESS.md` and `DECISIONS.md` did not exist when this lane started. This task changes only this report.

## Existing architecture

- React 19 + TypeScript + Vite dashboard; extension is a small Manifest V3 Scout with its own esbuild build. The extension currently opens the dashboard at `http://localhost:5173/`; the dashboard is not bundled inside an extension page.
- Local FastAPI engine on port 8787, SQLite projects/jobs/settings, media in the local `data` folder. Editor API: `/api/editor/{clip_id}` load/save, `/media`, `/extract-audio`, `/separate-audio`, `/export`. An editor project belongs to one Library clip ID.
- `dashboard/src/studio/editorModel.ts` and `engine/studio/editor_models.py` duplicate the JSON contract. Version is fixed at 1; there is no migration system. Project limits: 100 items, 8 numbered tracks, 600 seconds; speed 0.25–4x. Three ratios; fps 24/25/30/50/60. Kinds are only video/audio/text.
- Browser preview in `EditorPreview.tsx` uses separate HTML video/audio elements, DOM/CSS text and transforms, with a Web Audio `MediaElementAudioSourceNode` and gain node per playing item. The clock corrects video drift above 120 ms during playback, or 15 ms during scrubbing. No WebGL renderer, browser media worker or frame-accurate WebCodecs decoder exists.
- Export in `editor_render.py` builds a CPU FFmpeg filter graph and uses libx264/AAC. Frames, text, audio and animation are implemented separately from preview, despite comments calling formulas shared. Text burns in with ASS/libass and bundled DejaVu Sans. Output uses a local subprocess, so background browser throttling does not halt export. Jobs are serialized by a render lock.
- FFmpeg input paths and generated filter expressions are constrained and validated. Project media ownership, source duration bounds and local data paths are checked. Uploads stream in 1 MB chunks with a 500 MB cap and verify headers. Maintain these boundaries in the redesign.

## What exists and what does not

| Requirement | Evidence in current code | Gap / immediate recommendation |
|---|---|---|
| Library clip -> source on timeline | `editor_response()` initializes a latest local source when no saved project exists. Source download is a separate yt-dlp job. | A Scout entry is metadata, not downloaded media. Opening it alone currently yields an empty editor. Integration must queue fetch, poll the job and insert the downloaded source; failure needs a usable import fallback. Saved edits must not be overwritten by a late fetch. |
| Local video/audio import | API supports MP4/MOV/M4V/WebM/MKV/AVI/WAV/MP3/M4A/AAC/FLAC/Ogg/Opus. Video normalizes to browser-playable H.264/AAC, audio to stereo PCM WAV. Real peaks are generated. | Image import does not exist: `probe_media` rejects still images lacking duration, API suffix/role validation excludes images. Preview's image branch is unreachable through import. |
| Multi-track editing | Source offsets, trim, split, reposition, speed, text, keyframes; browser end-to-end tests cover several actions. | Eight tracks and 100 clips are hard limits, not unlimited. Track lock/hide/mute is not modeled. No magnetic track, group schema, masks, reverse, freeze frame or speed ramp. |
| Autosave and undo | `Studio.tsx` saves after 900 ms; 80 past project snapshots retained. API persists project JSON in SQLite. Lifecycle test protects against late project responses. | Need at least 100 undo steps, project migration, recoverable local draft, recent projects, copy/import/export/relink and quota handling. Not OPFS/IndexedDB. |
| Detach soundtrack | `/extract-audio` uses real FFmpeg extraction to WAV; editor inserts aligned audio and mutes source. | Preserve this tested path; show clear delete/mute actions. |
| Remove speech but keep music | Optional real Demucs stem split in an isolated Python 3.12 runtime, with SHA256-validated local model. | Approximate separation can leave artifacts; expose capability and progress, never imply perfect cleanup. Basic mute/remove entire soundtrack always works. |
| Preview audio | Web Audio gain nodes; volume up to 2x; speed uses `preservesPitch`; source trim and fade formulas exist. | Preview has no export-equivalent limiter, offline mix or ducking; no sample-accurate sync guarantee. |
| Export audio | FFmpeg 48 kHz mix, pitch-preserving atempo chain, sample-positioned delay, fades/keyframe volume, silence padding and limiter. | Independent from preview graph. No measured 60-second drift test yet. |
| Voiceover generation | Existing `/voices`, `/tts`; ElevenLabs, optional local Piper/eSpeak/clone and Edge adapters. `/scripts/{clip_id}`, rewrite and SEO APIs exist. | Current manual editor intentionally disconnected script/TTS/recognition in the older contract. Reconnect these established APIs. ElevenLabs uses one hardcoded voice and `/text-to-speech/{id}` audio response, not timestamp endpoint; stability is hardcoded 0.5. |
| Microphone recording | No editor recording implementation located. | Build with MediaRecorder, then existing media upload endpoint; add countdown, device choice, meter, playback start and retake. |
| Local transcription | `engine/core/media.py` uses faster-whisper with word timestamps and `local_files_only=True`. No automatic model downloads. | This is optional local server inference, not browser inference. Existing endpoint operates on the Library source, not arbitrary chosen timeline audio. Provider capability/configuration must be visible. |
| Caption import | SRT import becomes editable text items. Legacy Studio also has timing sidecars for generated audio. | Current timeline text has no actual word timestamp field; active words are distributed equally across item duration. That is not real word alignment. |
| Modern captions | 30 frontend preset objects in `textPresets.ts`; old engine JSON preset folder has 10. ASS styling has outlines, shadows, uppercase, karaoke and typewriter. | **Baseline defect:** frontend's non-default `ModernTextStyle` fields (e.g. emphasis/glow) are rejected by strict Python `TextStyle`, which defines only old fields. These presets fail save/export. Fix schema before adding styles. The preview/export share neither text shaping nor layout engine. |
| Caption font assets | Inter bundled through npm for UI; DejaVu Sans TTF bundled for export with license. | Only one deterministic subtitle family. Need ~20 properly licensed local caption fonts and a shared layout/render strategy. |
| Keyframes / animations | Transform+volume keyframes with four easing choices, 120 keyframes per item; 24 non-none animation names, matched formula implementations/tests. | No numeric effects/crop keyframes, graph editor, loop animations or preset-to-keyframe compilation. `blur-in` explicitly substitutes opacity/scale rather than blur. Rename or implement honestly. |
| Transitions | 20 allow-listed IDs, overlap validation, real FFmpeg render tests. | The renderer uses per-layer alpha formulas and blur gates, **not** the catalog's xfade mapping. Some names are simplified substitutes. CSS preview also adds motion/masks/brightness absent from export. Therefore count alone cannot establish 20 accurate WYSIWYG transitions. |
| Caption removal | Legacy render supports blur band, solid cover or crop around existing burned-in captions; optional OCR suggests region. | Not available in current timeline pipeline and not lossless text removal. Reuse crop/cover/blur with accurate labels. Existing burned-in pixels cannot be turned into editable caption tracks. |
| Filters, templates, sticker assets | No actual project-template model, image/sticker import or clip adjustment/filter schema located. | New contract/UI/render work required. A text style card is not a project template. |
| Export | MP4 H.264/AAC; 480/720/1080 short-edge outputs; real progress, validated snapshot and export assets/history. | Default currently 720, not 1080. No cancel, quality tier, ETA, browser codec selection, automatic fallback or Shorts limit warning. Does not use same render function as preview. |
| Publish | SEO API and dashboard SEO component exist; metadata can be generated with Gemini. | No YouTube OAuth/upload flow located; reliable download+copy+open Studio fallback is feasible. Keys currently live in local SQLite settings, not extension storage. |

## Verification and runtime

- Existing test fixtures generate small real H.264/AAC videos via FFmpeg; no user's library media is needed. Python tests patch `db.DATA_DIR` to temporary folders. Playwright starts isolated engine on 8788 and dashboard on 5174 with a temporary data directory.
- Browser coverage files: `dashboard/tests/editor.spec.ts` (4 tests), `editor-lifecycle.spec.ts` (1 race-safety test), reusable `editor-fixtures.ts`. Existing checks do not satisfy the master brief's real 30–60 second full-story test, golden-frame comparison or <40 ms drift criterion.
- Tools available: `.venv/bin/python` is Python 3.14.7, bundled imageio FFmpeg 7.0.2, Chrome executable at `/usr/bin/google-chrome`, installed dashboard Playwright. No system ffprobe, tesseract, eSpeak; `faster_whisper`, `torch`, `demucs`, `piper` are absent in the **main** engine environment. Separate Demucs runtime is checked independently below.
- Existing production-like development servers are running at 5173 and 8787. Do not use them for destructive fixtures; use test-isolated data.
- Baseline validation commands run in this lane: `.venv/bin/python -m pytest engine/studio/test_editor.py engine/studio/test_studio.py engine/studio/test_transitions.py engine/studio/test_separation.py -q`; `npm run build` in dashboard. Results appended below when complete.

## Bounded building-block review

Live npm package metadata was fetched on 2026-10-02, rather than trusting old package recommendations:

| Candidate | Current version / license from registry | Decision |
|---|---|---|
| [Mediabunny](https://registry.npmjs.org/mediabunny/latest) | 1.61.0 / **MPL-2.0** | Not the permissive MIT choice sometimes assumed; file-level copyleft means it does not satisfy the brief's no-copyleft preference. Evaluate explicitly before adopting. |
| [mp4-muxer](https://registry.npmjs.org/mp4-muxer/latest) | 5.2.2 / MIT; deprecated in favor of Mediabunny | Permissive but no longer the maintained recommendation. Avoid a hurried new dependency without maintenance plan. |
| [Transformers.js](https://registry.npmjs.org/@huggingface/transformers/latest) | 4.3.0 / Apache-2.0 | Plausible browser Whisper building block; bundling local WASM/model assets and MV3 CSP needs a separate verified spike. Model license/download size still need checking. |
| [gl-transitions](https://registry.npmjs.org/gl-transitions/latest) | 1.71.0 / MIT | Plausible shader source catalog. Inspect each included shader's attribution and evaluate extension bundling; does not solve decode, layout or export. |
| [Remotion](https://registry.npmjs.org/remotion/latest) | 4.0.532 / SEE LICENSE IN LICENSE.md | Do not adopt on the assumption of unrestricted MIT licensing; commercial terms need evaluation. A full editor SDK is not required for this upgrade. |

## Recommended architecture and module lanes

1. Preserve the existing local render/media/job implementation for the walking skeleton; a total UI restart does not justify discarding tested decoding, validation, waveform, audio extraction and export code.
2. Lead owns stable JSON schema changes on both sides, API TS declarations and migration policy. Repair modern text-style validation first. Extend style, timestamp, clip treatment and image contract together, never ship preview-only buttons.
3. UI shell/timeline lane owns `Studio.tsx`, `EditorTimeline.tsx`, `EditorInspector.tsx`, `theme/editor.css`; frontend rendering lane owns `EditorPreview.tsx`, `EditorTemplates.tsx`, `textPresets.ts`. Concurrent edits to the large current Studio file must be prohibited; split new panels into their own files before delegating.
4. Media/audio backend lane owns `editor_media.py`, audio routes/recorded upload compatibility, image probing, caption/transcription endpoints; render lane owns `editor_render.py`, `captions.py`, `editor_transitions.py` and matching pure evaluation helpers. API route edits should be owned by one lane or separated into new routers.
5. Integration lane owns Library/editor entry, source download polling, voice/script/SEO/publish panels as separate modules. Keep legitimate media-use metadata; the user action to open a saved source must not silently replace previous editing data.
6. Independent QA lane owns isolated fixtures, long-duration AV export measurement, screenshot/interaction checks and critique reports. All changes need tests that cover actual styles selected by UI, not just legacy schema fixtures.
7. For the strict target architecture, first prove a single frame renderer in an isolated benchmark/export spike. There is currently **no** credible basis for claiming the DOM/ASS renderer is pixel-identical, GPU-based, or within the export/performance target. A Canvas2D/WebGL/WebCodecs rewrite is a separate substantial phase, not a safe incidental refactor.
8. If the existing local-engine architecture is retained for this delivery, explicitly log deviations from full extension page, browser-local storage, browser-default recognition and same-function WYSIWYG. Do not mark those P0 criteria passed on appearance alone.

## Completed baseline results

- Python editor/studio/transition/separation suite: **65 passed, 1 skipped; 25 subtests passed**, 375 seconds. One upstream Starlette/httpx deprecation warning. Passing existing tests does not verify new style fields or long real-clip parity.
- Dashboard production build: **passed**, TypeScript and Vite 6.4.3; ~364 kB application JS before compression.
- Direct Pydantic reproduction: `TextStyle.model_validate({'emphasis':'pop'})` raises a validation error, confirming the modern preset schema mismatch.
- Independent Demucs capability check: **available=true, model_ready=true** in its separate runtime. Main engine package absence does not mean this feature is unavailable.
- Installed FFmpeg reports `--enable-gpl --enable-version3 --enable-libx264`. Existing optional Piper/eSpeak are GPL as documented upstream. The repository already depends on a GPL-enabled executable build; do not describe the present stack as wholly permissively licensed. Do not bundle this binary into a distributable extension without a deliberate license decision.
- No browser interaction or new 30–60 second export was run in this Phase 0 lane; those remain integration/QA acceptance work.
