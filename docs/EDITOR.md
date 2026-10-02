# Editing in Studio

Studio uses a familiar desktop video-editor arrangement: import and audio tools on the left, a synchronized player in the center, properties on the right, and a timeline below. The interaction references were CapCut's official [editing guide](https://www.capcut.com/resource/how-to-use-capcut) and [audio extraction guide](https://www.capcut.com/resource/extract-audio-from-video-online). ShortForge implements its own local editor and does not claim complete CapCut parity.

## Clips and tracks

Open an uploaded video from the Library. Its source starts on the Video track. Import more video from Media, or recordings from Audio. Imported audio/video is added to the timeline; the media-bin entry can add another instance of the same file. Move instances independently without changing the source file.

Select a timeline block to edit it. Drag its body to move it in time or between tracks. Drag an edge to trim. Split divides the selected clip at the playhead and keeps source timing. Delete removes the selected instance. Undo/redo restore editing operations. Higher visual tracks draw above lower tracks; audible tracks mix together. Timeline zoom and snapping make placement easier.

The inspector exposes exact start, source-in, duration, speed, and track controls. Changing speed changes the duration while preserving the source range. Audio speed changes preserve pitch. Original file length bounds trimming; the editor validates ranges before saving/exporting.

## Original sound and imported recordings

Select the source video, then open Audio.

- **Remove all original audio** mutes that instance's soundtrack. Restore it with the same control.
- **Extract audio** creates a separate WAV media file and aligned audio item. It mutes the video to avoid playing the same sound twice. Delete or trim the extracted item independently.
- **Isolate voice** separates the soundtrack into vocal and instrumental media, then adds the vocal stem aligned to the selected source.
- **Remove voice, keep music** adds the instrumental stem instead. The original video is muted; the untouched source and both separated stems remain available.
- **Import voiceover / Import music** add external recordings. Set their start, source-in, duration, volume, and fades in the inspector.

Vocal separation runs locally and can leave speech or music artifacts. It is distinct from full-soundtrack extraction; it does not synthesize speech. See [setup and verification](AUDIO-SEPARATION.md).

## Animation

Set a clip's position, scale, rotation, and opacity under Transform. Choose an entrance or exit preset for fade, slide, zoom, pop, bounce or spin, or open the Motion panel to browse them with a live sample. Set its duration explicitly.

For custom motion, position the playhead within the selected clip and add a keyframe. Move the playhead and change a property; the editor adds or updates a keyframe there. Each keyframe stores transform and volume. Choose linear, ease-in, ease-out, or ease-in/out interpolation for the following segment. Click a keyframe's time to revisit it, or delete that point. Preview and export use the same interpolation and preset formulas.

## Text and captions

Text adds timed overlays. Imported SRT files become editable text clips at their subtitle times. This is subtitle editing, not a script-writing or narration-generation workflow.

The Text panel holds twelve starting points in three groups: Essential (classic subtitle, clean minimal, boxed label, lower third), Social (bold pop, highlight yellow, outline comic, lavender note) and Animated (karaoke highlight, typewriter, soft rise, neon outline). Applying a template sets size, colour, background, vertical position, optional entrance animation and text styling in one step. "Apply to all captions" retimes every text clip on the timeline to the same look, which is the quickest way to style an imported SRT file.

Format controls add bold, italic, uppercase, alignment, outline width and colour, shadow, letter spacing and a background colour. Word animation offers typewriter, which reveals the line progressively, and karaoke, which walks a highlight colour across the words as they play. Preview and MP4 export use the same reveal timing, so what you watch is what you get. Captions render in the bundled ShortForge Captions face, matching the font the renderer uses.

## Motion presets

The Motion panel previews each entrance and exit animation before you apply it: none, fade, slide in from the left, right, top or bottom, zoom out, pop, bounce, spin left and spin right. The cards animate on hover so you can see the movement without scrubbing the timeline. Set the animation length in the inspector; a shorter duration reads as snappier.

## Saving and export

Edits autosave to the local engine, and Save project saves immediately. Undo history belongs to the current editor session. Projects and source media remain after reload. Export renders a validated snapshot of the timeline through FFmpeg into MP4; you can choose portrait, landscape, or square canvas and 480p, 720p, or 1080p output. The progress indicator belongs to the project and resumes when reopened.

Current limits are eight tracks, 100 timeline items, 120 keyframes per item, and a ten-minute timeline. Stock templates, cloud collaboration, motion tracking, and advanced masks are outside this editor's implemented feature set. Preview is browser playback; font rasterization and compressed video can differ slightly from the rendered file. Inspect the downloaded MP4 before publishing.
