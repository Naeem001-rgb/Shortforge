# Studio task ledger

Acceptance criteria are written before feature code. Status: planned, building, review, PASS, closed-known-issue. Round scores are independent critic scores, not builder estimates. P2 is deferred until P0/P1 reviews finish. Review may batch related tasks but must score each row.

| ID | Task | Priority | Phase | Owner | Dependencies | Testable acceptance criteria | Status | R1 | R2 |
|---|---|---|---|---|---|---|---|---|---|
| R00 | Recon, architecture, web references, license evaluation | P0 | 0 | Lead + recon lanes | — | Existing stack and blockers documented; official UX references fetched; contracts and decisions recorded | review | — | — |
| S01 | Graphite design tokens and replacement shell | P0 | 1 | UI | R00 | Full viewport; nine labeled tool categories, top project bar, central portrait stage, inspector, bottom timeline; no clipped tabs at 1440/1833px; keyboard focus/reduced-motion | review | — | — |
| I01 | Library-to-Studio automatic acquisition | P0 | 1 | Integration | R00 | Edit opens URL-addressable full tab; source starts loading automatically; actual media lands once on timeline; reload preserves edits; unknown source preserved as metadata | review | — | — |
| E01 | Shared project validation and migration | P0 | 1 | Lead + Media | R00 | Existing projects/presets save; additive defaults round-trip; invalid timing rejected; 100-step history possible | review | — | — |
| M01 | Real media import and initial playback | P0 | 1 | Media | E01 | Local video/image/audio import, thumbnail, metadata, real playback and audio; failed input gives retryable message | review | — | — |
| X01 | Walking-skeleton export | P0 | 1 | Media | E01 M01 | Real 30–60s clip exports 1080x1920 MP4, audio present, duration within frame; ffprobe evidence | review | — | — |
| P01 | Phase 1 integration review | P0 | 1 | Critic | S01 I01 X01 | Library clip reaches timeline and exported file; build/tests run; blockers scored honestly | planned | — | — |
| T01 | Timeline manipulation and history | P0 | 2 | Timeline | E01 | Move, trim, split, duplicate, delete, ripple-delete, copy/paste, multi-select, group, cross-track drag undo/redo; >=100 history steps | review | — | — |
| T02 | Track controls, waveforms, filmstrip, markers, zoom | P0 | 2 | Timeline | T01 M01 | Dynamic track add, lock/hide/mute, real thumbnails/waveforms, snap, fit zoom, scrubbing and following playhead | review | — | — |
| T03 | Transform and direct preview handles | P0 | 2 | Preview | E01 | Click selection; drag position/scale/rotate; centre/edge/safe snapping; safe-zone toggle; inspector edits match preview | review | — | — |
| T04 | Speed, reverse, freeze, fit/fill, flip | P0 | 2 | Media + Lead | M01 | .1–10x with source bounds; reverse/freeze/flip render and export; 9:16 crop; opacity and rotation verified | review | — | — |
| D01 | Autosave, recovery and project management | P0 | 2 | Lead | E01 | <=2s autosave, recover unsaved changes, recent project thumbnails, rename/duplicate/delete, JSON import/export, missing-media relink and quota errors | review | — | — |
| U01 | Resizable/collapsible panes and shortcuts | P1 | 2 | UI + Timeline | S01 T01 | Resize panes; collapse; Space, arrows, S, Del, ShiftDel, CtrlZ/ShiftZ/C/V/D/S/E, M/K/+/- and ? operate without stealing input keys | review | — | — |
| P02 | Phase 2 integration review | P0 | 2 | Critic | T01 T02 T03 T04 D01 | Edit/save/reload/undo real media; build/tests run; score each task | planned | — | — |
| A01 | Detach, mute/delete and audio mixer | P0 | 3 | Audio | M01 | Detach aligns extracted audio; no doubled soundtrack; volume/fades per clip and track match exported mix | review | — | — |
| A02 | Voice recording | P0 | 3 | Audio | A01 | Device picker, actual meter, countdown, record from playhead during playback, retake, waveform on voice track | review | — | — |
| A03 | Script + ElevenLabs voice generation | P0 | 3 | Integration | A01 | Editable segmented script; markers; voice picker, speed/stability; generate paragraph/single-line and import result; key never in project | review | — | — |
| A04 | Ducking, normalization, pause removal | P1 | 3 | Audio | A01 | Voice duck envelope audible and exported, normalize measured, pause removal preserves timing or clearly previews changes | planned | — | — |
| A05 | Licensed music and SFX starter pack | P1 | 3 | Assets | M01 | Small usable bundled pack; source and permissive license for every item | planned | — | — |
| P03 | Audio integration critique | P0 | 3 | Critic | A01 A02 A03 A04 | Record/import/generate, detach original and export audibly correct mix; tests/build | planned | — | — |
| C01 | Word-level captions and transcription | P0 | 4 | Captions | A01 | Real local recognition yields word timestamps; provider adapters; optional cloud explicit; edited captions align voice | review | — | — |
| C02 | Caption editor, find/replace, merge/split | P0 | 4 | Captions | C01 | Change words/timing; merge/split; find/replace and timeline edits persist/undo | review | — | — |
| C03 | JSON style engine and >=20 presets | P0 | 4 | Captions + Render | C01 E01 | >=20 distinct styles with real active-word timing, font/stroke/shadow/box/layout/entry/exit; shared preview/export layout | review | — | — |
| C04 | Bundle ~20 open-license fonts | P0 | 4 | Assets | C03 | Fonts load offline; explicit per-font license and deterministic export; selectable in inspector | review | — | — |
| C05 | Keyword/emoji, saved styles and teleprompter | P1 | 4 | Captions | C02 | Save/reuse user style, apply all, keyword highlight/emoji suggestion, record teleprompter | planned | — | — |
| P04 | Caption integration critique | P0 | 4 | Critic | C01 C02 C03 C04 | Real voice generates/edit captions; golden-frame comparisons; tests/build | planned | — | — |
| K01 | Unified keyframes, easing, inspector diamonds | P0 | 5 | Engine | E01 | Numeric properties interpolate; keyframes add/move/copy/delete; linear/ease/hold/spring/bezier controls tested | review | — | — |
| K02 | >=25 in/out/loop animations + Ken Burns | P0 | 5 | Engine | K01 | Presets produce editable keyframes with duration/easing; loop and Ken Burns preview/export deterministic | review | — | — |
| F01 | >=20 real transitions | P0 | 5 | Render | K01 | Adjacent clip transition apply/duration/all; >=20 distinct implemented GPU effects; preview/export frames agree | review | — | — |
| F02 | Adjustments + >=12 filter looks | P0 | 5 | Render | K01 | Brightness/contrast/saturation/exposure/temp/tint/highlights/shadows/vignette/sharpen/grain/blur and 12 looks, intensity/keyframes, export | review | — | — |
| F03 | Blend/masks/chroma/region conceal and effects | P1 | 5 | Render | F02 | Real mask/feather/chroma/blur/mosaic/blend and listed video effects; honest burned-caption cover flow | review | — | — |
| K03 | Curves, auto-keyframe, ramps and magnetic track | P1 | 5 | Timeline + Engine | K01 T02 | Editable graph; auto-record keyframe, punch-at-marker, speed ramps render correctly and magnetic reorder preserves edits | planned | — | — |
| P05 | Motion/effects integration critique | P0 | 5 | Critic | K01 K02 F01 F02 | Evaluated golden frames; real export with captions/transitions; tests/build | planned | — | — |
| B01 | Project templates and placeholders | P0 | 6 | Assets | E01 C03 | Apply template reflows user's media into slots; save/import custom template; undo one step | review | — | — |
| B02 | Ten starter templates + stickers | P1 | 6 | Assets | B01 | Ten functioning distinct short formats and licensed emoji/shapes/overlays, no third-party editor assets | review | — | — |
| P06 | Assets/templates critique | P0 | 6 | Critic | B01 B02 | Templates render real user footage and export; no missing fonts/assets/licenses | planned | — | — |
| I02 | Full extension tab and minimal MV3 permissions | P0 | 7 | Integration | I01 | Bundled extension Studio opens; strict CSP, no remote code/eval; API connection explicit; long jobs survive background | review | — | — |
| X02 | Shared renderer + deterministic WebCodecs export | P0 | 7 | Render | C03 F01 F02 | Same render function preview/export; H264/AAC or runtime fallback; offline audio; <40ms drift over 60s | review | — | — |
| X03 | Export controls, progress/cancel/history | P0 | 7 | UI + Export | X02 | 720/1080, 24/30/60fps, quality, duration limit warning, progress/ETA/cancel; background tab continues and saved history | review | — | — |
| X04 | SRT and thumbnail frame export | P1 | 7 | Export | C02 X03 | Valid SRT download and current-frame thumbnail works with real project | review | — | — |
| I03 | Publish metadata, credits and manual handoff | P1 | 7 | Integration | X01 | SEO metadata editable; attribution opt-in; unknown source review; download/copy/open YouTube Studio works | review | — | — |
| I04 | YouTube resumable OAuth upload | P1 | 7 | Integration | I02 I03 | Owner OAuth configured; privacy/audit/quota stated accurately; progress, schedule, kids, playlist, result URL | planned | — | — |
| P07 | Integration/publish critique | P0 | 7 | Critic | I02 X02 X03 I03 | Export and publish fallback work; API-only credentials/quotas not falsely claimed tested | planned | — | — |
| Q01 | Performance, browser/accessibility and regression suite | P0 | 8 | QA | P01 P02 P03 P04 P05 P06 P07 | Measured response/scrub/fps/export; latest Chrome; keyboard/accessibility basics; existing tests preserved or updated for changed intent | planned | — | — |
| Q02 | Real 30–60s end-to-end acceptance + whole-product critique | P0 | 8 | Independent critic | Q01 | Section 3 full story passes; ffprobe duration/resolution/audio and drift evidence; whole product >=7 | planned | — | — |
| Q03 | Owner guide, phase summaries, decisions/licenses/known issues | P0 | 8 | Lead + documenter | Q02 | Plain-English accurate guide, task scores/evidence and known issues; no unverified completion claims | planned | — | — |
| Z01 | P2 enhancements | P2 | after 8 | unassigned | all P0/P1 | Light theme, on-device ML/RTL/stabilization/tracking/beat/1440/audio export considered only after reviews | planned | — | — |
