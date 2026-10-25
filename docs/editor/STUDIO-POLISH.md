# Studio workspace finish — October 8, 2026

The editor keeps its familiar media / preview / inspector / timeline arrangement, with a consistent dark workspace, clearer type, finer panel boundaries and a readable mobile tool strip. The user selected **core editing and reliability** as the priority. This release improves the existing editor; it does not claim complete CapCut, Premiere Pro or Filmora feature parity.

## What changed

- Clear project identity and save state, visible keyboard shortcuts, and **File → Reset workspace layout**.
- A focused import state, all project media in the bin (including audio), and real cached media thumbnails instead of separate video decoders for each bin item.
- Timing and Transform lead the Basic inspector, with compact source tools below them. Project settings expose the supported frame rates and report actual resolution/duration.
- Current and total playback time use consistent `mm:ss.ss` counters. The playhead accepts timecode or seconds; Up/Down moves one frame.
- A continuous timeline ruler, automatic initial fit to the footage, filmstrips corresponding to each clip's retained source interval, and clear selection/focus states.
- Batch imports stay busy until every upload finishes. Project-name editing retains spaces and supports clearing/replacing the name.
- Phone layouts use a scrollable horizontal tool strip and full-width, dismissible media/inspector panels. Resizable desktop panels retain their controls.
- Removed 1,714 identical duplicated CSS lines; the focused workspace stylesheet is imported after the legacy editor content styles.

Existing trim, move, split, duplicate, group, ripple delete, track controls, keyframes, text/caption presets, audio tools, effects/transitions, save/recovery and export remain available. Optional local model operations retain their existing availability checks.

## Verification

- `pytest engine/core/tests engine/studio engine/ai -q`: **338 passed, 2 skipped; 25 subtests passed**. The complete summary is recorded in `/tmp/shortforge-studio-backend-tests.log`.
- Browser suite covering editor, lifecycle, entry, engine math, renderer, GPU effects, media recovery and the new workspace: **26 passed, 2 skipped**. Real playable MP4 export, decoded frame/audio comparison, saving and 100+ undo operations were exercised. The skipped browser cases require the optional licensed Sintel long-export fixture.
- After the final timeline and project-name changes, **5 focused browser regressions passed**: batch imports, mobile/empty workspace, media/selection/name controls, cross-track dragging/trimming/audio cleanup, and save/split/undo persistence.
- The independent finish review requested inspector ordering and consistent timecodes. After those corrections, **10 browser tests passed**, including precise keyboard seeking, inspector order, caption-removal preview/apply/undo/cancel/error handling, media imports, saving, and actual MP4 export.
- TypeScript lint and dashboard / bundled MV3 Studio production builds passed. The existing large-chunk build advisory remains.
- The real unpacked MV3 extension passed its packaged-assets, strict-CSP, loopback-API, Library-to-Studio, and reload smoke check after the final build.
- Visual inspection at 1920×921, 1440×960, 1280×800 and 390×844: no document overflow or page errors. Empty, populated, mobile inspector and export states are captured under `.impeccable/review/studio-polish/`. The one design detector run returned no findings.

Screenshots use a short excerpt of an existing local source, real extracted audio, and a QA title in a separate temporary database. They do not create projects in the user's Library or ship demo media.

## Check the update

1. Reload ShortForge Scout in `chrome://extensions`, then reopen Studio. For the web dashboard, refresh the Studio tab.
2. Import a video and audio file together. Both should appear in Media and on the timeline; the ruler should fit the footage.
3. Select a clip, trim/split it, change its timing, and undo. Rename the project using spaces, then reload to check the saved edit.
4. Export a short video and play the downloaded file. **File → Reset workspace layout** restores the default panel sizes when needed.
