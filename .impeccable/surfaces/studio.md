# Studio

## Direction contract — October 8, 2026 editor finish

THESIS: A dependable editing desk where footage, time, and the current selection lead. Replace loose, equally weighted panels with a coherent professional workspace.

OWN-WORLD: Preserve ShortForge's dark editor and violet identity. Graphite canvas, subtly lighter panels, fine neutral rules, restrained violet selections, bundled Inter, 14px controls and 12px minimum metadata. Tool geometry follows CapCut, Premiere, and Filmora conventions explicitly requested by the user.

STORY: Import media, arrange and trim real clips, adjust the selection, save, then export. Blank projects have one clear starting point; loaded projects expose real thumbnails and waveforms. Saving, missing files, failures, and unsupported operations remain honest.

FIRST VIEWPORT: A 60px project bar, readable left tool rail and 288px media bin, dominant central player, 304px inspector, and a continuous full-width timeline below. Export anchors the top right. The ruler fills the available width even before media arrives. Phone layouts use a horizontal tool strip and dismissible panels.

FORM: Established Operate composition, code-led refinement. The user pinned the competitor-like direction and named all three references; no concept roll or replacement identity is needed. Signature interaction: selecting a timeline clip exposes its inspector and manipulation handles, with clear selection and quiet 160ms control feedback.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Mode: Operate. The user explicitly replaces the prior Script/Voice/Captions step editor with a CapCut-style timeline editor. Retain the current dashboard tokens and real library; the layout is pinned, not a visual-direction exercise.

First viewport: compact app navigation, project/action strip, left media bin with import/extraction/separation tools, central playable canvas, right selected-item inspector, bottom multitrack timeline with ruler/playhead, selectable blocks, trim/split and undo/redo.

Required: trim/move/split/delete, import video/voice/music, mute/remove full original soundtrack, real extraction, isolate vocals or remove vocals preserving instrumental background, transform/keyframe animations, animation presets, timeline save/reload, and rendered MP4. No script-writing, automatic script extraction or AI voice-generation controls or calls. Source files remain intact when timeline items are deleted.

The user explicitly chose both vocal-only separation and full-soundtrack removal. Vocal separation is local Demucs, with an honest processing state and imperfect-separation note. No model inference or download on ordinary page visit.

Light/dark/system modes; responsive stacked controls on mobile. Every visible button must be functional. Timeline represents actual media duration and waveform data. Real renders, browser workflows, persistence/race cases and screenshot review prove functionality. Critic threshold7/10 with one revision if below threshold, per user's standing review contract.

References: https://www.capcut.com/resource/how-to-use-capcut and https://www.capcut.com/resource/extract-audio-from-video-online reviewed2026-09-30. Implementation contract docs/editor-contract.md is authoritative for API/math; latest user request overrides older script/voice guidance.

## Caption removal extension (2026-10-03)

THESIS: A focused removal workflow replaces the misleading concealment dropdown. The user judges actual AI-generated pixels before changing the timeline.
OWN-WORLD: Preserve the compact dark Studio, inherited type, violet actions, and existing modal conventions.
STORY: Select a clip, mark caption bounds on the source, preview one second, process the selected source interval, and explicitly apply the cleaned asset. Errors, cancellation, and original preservation remain visible.
FIRST VIEWPORT: The inspector's Basic tab has one removal action. Its focused dialog pairs original and cleaned video, with a scrubber and numeric alternatives to drawing the area.
FORM: Established Operate surface extension; no visual identity or concept lottery. Test fixtures are synthetic, and actual inference is checked separately on the user's source.
FINISH: Review desktop and mobile screenshots, verify apply/undo/persistence and real inference, retain DESIGN.md tokens, and document the installed model and limitations.

### Finished implementation contract

The Basic inspector opens the shared wide modal through **Remove burned-in captions**. Original and cleaned footage stay paired, with a source-time slider and labeled percentage fields as the keyboard alternative to drawing. Removal uses the original frame-by-frame method. The Fast selector and tracking reuse were reverted at the user's request. Saved Fast results are identified and cannot be applied without rerunning removal. Changes to the area or erase setting mark the previous result out of date and prevent applying it with mismatched settings. A completed one-second preview is for inspection; only a completed full-clip result exposes **Use cleaned clip**. Changed preview time is disclosed beside the previous result. Processing shows progress, an estimated remaining time when available, cancellation, and explicit errors. The original remains available in Media.

The extension inherits the existing Studio typography, editor fields, shared buttons, native dialog behavior, focus treatment, and semantic surface/text/accent/error colors. Its local layout uses the established 8/12/16px spacing rhythm. At 560px and below the footage remains paired at a reduced height, coordinate fields become two columns, and actions fill the available width. It adds no global tokens or shipping raster assets; preserve `DESIGN.md` and `.impeccable/design.json`.

Implementation references: `dashboard/src/studio/CaptionRemoval.tsx`, `caption-removal.css`, and `EditorInspector.tsx`. Installation, the installed MI-GAN model, CPU processing limits, imperfect reconstruction, original preservation, and verification procedures are recorded in `docs/CAPTION-REMOVAL.md`.
