# Remove Studio Editor — Implementation Plan

> Historical browser-editor documentation. These interfaces were removed. See [current Studio setup](../../../CONCAT.md).

> **For agentic workers:** REQUIRED SUB-SKILL. Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Completely remove the CapCut-like studio editor (frontend + its backend services) while keeping Library, Scout, Settings, and the Python engine fully functional.

**Architecture:** The studio editor spans `dashboard/src/studio/` (~16K lines React) plus editor-only modules in `engine/studio/` (FastAPI routers, render/caption/separation/inpainting workers). It is wired into the app exclusively via `dashboard/src/shell/App.tsx`. Crucially, `engine/studio/` also hosts modules used by surviving code (Scout, thumbnails, AI routes) — those survive; the rest is deleted.

**Tech Stack:** React + Vite + TypeScript + Playwright (frontend); FastAPI + unittest-style tests (Python engine).

**Spec:** Direct request in conversation 2026-10-24: "remove the studio editor completely without breaking project".

## Global Constraints

- NO git commits, pushes, stashes, or branch operations (user expressly forbade them for now).
- "Don't change anything else": only remove editor code and the minimum rewiring required to keep the remaining product green.
- Post-removal surface: Library, Scout, Settings. The SEO / "Publish kit" page is also deleted (user chose "Remove it too").

## Verified removal inventory

### DELETE — frontend

- ALL of `dashboard/src/studio/` (~30 files incl. `SEO.tsx`, `YouTubePublish.tsx`, all editor `.css`).
- `dashboard/src/theme/studio-workspace.css` (only referenced by `main.tsx:8`, styles `.timeline-studio` only).
- In `dashboard/src/shell/App.tsx`: Remove imports of `SEOPage` and `Studio`; remove `"studio"` and `"seo"` pages; remove all studio-specific logic (verified safe: navigating to the SEO page only happens through the studio publish flow, so its `navigate("seo")` calls can be dropped).
- Dashboard Playwright specs exercising only the editor: `editor.spec.ts`, `editor-lifecycle.spec.ts`, `caption-removal.spec.ts`, `studio-engine.spec.ts`, `studio-entry.spec.ts`, `studio-polish.spec.ts`, `studio-rebuild.spec.ts`, `studio-round2.spec.ts`, `youtube-publish.spec.ts` + shared fixtures file `editor-fixtures.ts` (needs survivor-check for importers among the keeper specs — `instagram-library.spec.ts`, `library-layout.spec.ts`, `workspace.spec.ts`, `dashboard-redesign.spec.ts` remain and must be grepped for editor imports, i.e. `engine.studio` or `src/studio`).

### KEEP (survivors with proven downstream users)

- `engine/studio/scout_captions.py` ← used by `core/scout_routes.py`
- `engine/studio/scout_speech.py` ← used by `core/scout_routes.py`
- `engine/studio/editor_media.py` ← used by `core/thumbnails.py`, `core/media.py`, `core/routes.py`
- `engine/studio/media.py` ← used by `scout_captions`, `scout_speech`, `editor_media`, `ai/voice.py`, `ai/routes.py`
- `engine/studio/ocr_captions.py` ← used by `scout_captions.py` via ocr capability object
- Engine tests covering survivors: `test_scout_captions.py`, `test_scout_speech.py`, and any other test verifying survivor modules (checked: keep all tests directly covering survivor modules).

### DELETE — backend (`engine/studio/`)

- `routes.py`, `editor_routes.py`, `editor_models.py`, `editor_render.py`, `editor_transitions.py`, `captions.py`, `transcription.py`, `transcription_worker.py`, `separation.py`, `separation_routes.py`, `separation_worker.py`, `inpainting.py`, `inpainting_worker.py`
- `setup_transcription.py`, `setup_inpainting.py`, `setup_ocr.py`
- Tests for deleted code: `test_editor.py`, `test_studio.py`, `test_transitions.py`, `test_separation.py`, `test_transcription.py`, `test_inpainting.py`
- `fonts/` and `presets/` directories (styled ONLY `editor_render.py` via `prepare_fonts` in `captions.py`; both deleted with the editor)

Additionally:

- In `engine/core/app.py` remove `engine.studio.routes`, `engine.studio.editor_routes`, `engine.studio.separation_routes`, `engine.studio.inpainting` from the router registration tuple (lines ~145–148).
- Delete `engine/requirements-inpainting.txt`, `engine/requirements-ocr.txt`, `engine/requirements-separation.txt` (they install only editor capabilities: audio separation, inpainting, OCR — check for references before removing).

## Task sequence

### Task 1 — Dashboard App.tsx unwiring

Modify `dashboard/src/shell/App.tsx`:

- Remove `import { SEOPage } from "../studio/SEO";`
- Remove `import { Studio } from "../studio/Studio";`
- Remove the `"studio"` and `"seo"` entries from the `pages` array
- Remove all studio/SEO state logic (in care to keep `selected`, `navigate`, but drop `publishingExportId`, `open()`-callers pointing to studio creation, the `page === "studio"` render branch, `onPublish`, `onImport={createProject}` for studio-only flow)

Test: `cd dashboard && npx tsc --noEmit -p tsconfig.json` must pass.

### Task 2 — Frontend cleanup sweep

- Delete `dashboard/src/studio/` entirely
- Delete `dashboard/src/theme/studio-workspace.css`
- Remove its import from `dashboard/src/main.tsx`
- Survivor-spec grep-check for `engine.studio` / `src/studio` imports; prune any found
- Delete editor-only Playwright specs and `editor-fixtures.ts` (if keeper specs import it, trim or inline the needed bits)

Tests to run: `cd dashboard && npm run lint && npx playwright test instagram-library.spec.ts library-layout.spec.ts workspace.spec.ts dashboard-redesign.spec.ts` (engines willing; acceptance at minimum: typecheck + lint pass; runtime test pass if environment provides Playwright browsers).

### Task 3 — Backend route detachment

- Remove the four deleted-module registrations from `engine/core/app.py` router list
- Update engine unit tests importing removed modules

Test: `python -m pytest engine/` equivalent discovery — check for pytest/unittest config; actual discovery command is `python -m unittest discover engine` from repo root (fallback: import all modules of `engine` and assert no ImportError).

### Task 4 — Backend file deletion

- Delete all backend modules, tests, setup scripts, fonts/presets dirs listed above
- Delete the three editor-only requirements files after grep-verifying no reference in `start.sh`, `README.md`, `pyproject.toml`, `scripts/`

Tests: same discovery run as Task 3, plus `bash -c 'cd engine && python -c "import engine.core.app"'` smoke test.

### Task 5 — Docs truce (informational-only documentation for now)

Do not rewrite docs yet (user hasn't asked for it now); leave `docs/` untouched. Note that `docs/EDITOR.md`, `docs/CAPTION-REMOVAL.md`, `docs/AUDIO-SEPARATION.md`, `docs/TESTING.md`, `docs/PROGRESS.md`, `docs/VOICE.md` reference the editor and may be outdated by this removal — flag to the user at completion; do not touch them unprompted (constraint: "don't change anything else").

## Safety rails

- Every test-run step re-verified: do not claim a removal is safe until grep for residual imports returns nothing (repo-wide `rg 'engine\.studio\.(routes|editor_routes|editor_render|editor_models|editor_transitions|captions|transcription|separation|inpainting)'` excluding `docs/`).
- Failure means: stop and report, do not improvise restoration strategies.
