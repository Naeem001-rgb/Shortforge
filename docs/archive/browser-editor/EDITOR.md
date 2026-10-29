# Editing in Studio

> Historical browser-editor documentation. These interfaces were removed. See [current Studio setup](../../CONCAT.md).

**Historical guide:** the custom editor described below was removed. Since October 25, Studio opens the selected Library video in Concat's native desktop window. Use [the current Concat guide](../../CONCAT.md) for setup, saving and export.

Studio uses a familiar desktop video-editor arrangement: import and audio tools on the left, a synchronized player in the center, properties on the right, and a timeline below. The interaction references were CapCut's official [editing guide](https://www.capcut.com/resource/how-to-use-capcut) and [audio extraction guide](https://www.capcut.com/resource/extract-audio-from-video-online). ShortForge implements its own local editor and does not claim complete CapCut parity.

## Clips and tracks

Open an uploaded video from the Library. Its source starts on the Video track. Import more video from Media, or recordings from Audio. Imported audio/video is added to the timeline; the media-bin entry can add another instance of the same file. Move instances independently without changing the source file.

Select a timeline block to edit it. Drag its body to move it in time or between tracks. Drag an edge to trim. Split divides the selected clip at the playhead and keeps source timing. Delete removes the selected instance. Undo/redo restore editing operations. Higher visual tracks draw above lower tracks; audible tracks mix together. Timeline zoom and snapping make placement easier.

The inspector exposes exact start, source-in, duration, speed, and track controls. Changing speed changes the duration while preserving the source range. Original file length bounds trimming; the editor validates ranges before saving/exporting.

One honest warning about speed and sound. The player keeps a sped-up clip at its normal pitch, and so does the Local compatibility export, but the ordinary browser export resamples the audio instead, so voices rise or fall with the speed. If a clip's speed is not 1× and its sound matters, listen to the downloaded file, and use the compatibility export if the pitch has moved.

## Original sound and imported recordings

Select the source video, then open Audio.

- **Remove all original audio** mutes that instance's soundtrack. Restore it with the same control.
- **Extract audio** creates a separate WAV media file and aligned audio item. It mutes the video to avoid playing the same sound twice. Delete or trim the extracted item independently.
- **Isolate voice** separates the soundtrack into vocal and instrumental media, then adds the vocal stem aligned to the selected source.
- **Remove voice, keep music** adds the instrumental stem instead. The original video is muted; the untouched source and both separated stems remain available.
- **Import voiceover / Import music** add external recordings. Set their start, source-in, duration, volume, and fades in the inspector.
- **Script and voice**, lower down the same Audio tab, holds the narration script, a microphone recorder, and voice generation through whichever provider is installed or configured. A generated or recorded take arrives as an ordinary editable audio item on a voice track. Setting up a voice is covered in [VOICE.md](VOICE.md).

Vocal separation runs locally and can leave speech or music artifacts. It is distinct from full-soundtrack extraction; it does not synthesize speech. See [setup and verification](AUDIO-SEPARATION.md).

## Animation

Set a clip's position, scale, rotation, and opacity under Transform. Choose an entrance or exit preset for fade, slide, zoom, pop, bounce or spin, or open the Motion panel to browse them with a live sample. Set its duration explicitly.

For custom motion, position the playhead within the selected clip and add a keyframe. Move the playhead and change a property; the editor adds or updates a keyframe there. Each keyframe stores transform and volume. Choose how it travels to the next one: linear, ease in, ease out, ease in/out, hold, spring, bounce, or cubic bezier. Click a keyframe's time to revisit it, or delete that point. Preview and export use the same interpolation and preset formulas.

## Text and captions

Text adds timed overlays. Imported SRT files become editable text clips at their subtitle times. The Text panel is for subtitles and on-screen words only; narration scripts and spoken audio live in the Audio tab's Script and voice panel.

The Text panel holds thirty starting points in six categories — Essential, Kinetic, Popular, Neon & Glow, Editorial and Clean — with a search box and category buttons to narrow them down. Applying a template sets size, colour, background, vertical position, optional entrance animation and text styling in one step. "Apply to all captions" retimes every text clip on the timeline to the same look, which is the quickest way to style an imported SRT file.

Format controls add bold, italic, uppercase, alignment, outline width and colour, shadow, letter spacing and a background colour. Word animation offers typewriter, which reveals the line progressively, and karaoke, which walks a highlight colour across the words as they play. Preview and MP4 export use the same reveal timing, so what you watch is what you get. Captions render in the bundled ShortForge Captions face, matching the font the renderer uses. The exact preview-to-export mapping for every styling field is written down in [CAPTIONS-SPEC.md](CAPTIONS-SPEC.md).

Captions already burned into someone else's footage are a different job: they are pixels, not text, so no text control can touch them. [CAPTION-REMOVAL.md](CAPTION-REMOVAL.md) covers the separate clean-up tool, what it can estimate and where it falls short.

## Motion presets

The Motion panel previews each animation before you apply it. There are twenty-six entrance and exit presets besides None, from the plain ones — fade, the four slide directions, zoom in, zoom out, pop, bounce, spin left and spin right — through to drop, float, drift, rise + fade, punch, blur in, glitch, swing, tilt, push in, whip, fade + zoom, pulse, wobble and shake. A third **loop** slot repeats a gentler subset (pulse, wobble, shake, float, the two spins, fade, bounce, zoom in and swing) for as long as the clip runs. The cards animate on hover so you can see the movement without scrubbing the timeline. Set the animation length in the inspector; a shorter duration reads as snappier.

## Saving and export

Edits autosave to the local engine, and Save project saves immediately. Undo history belongs to the current editor session. Projects and source media remain after reload. Export renders a validated snapshot of the timeline in your browser using WebCodecs, producing MP4 (H.264/AAC) with a WebM fallback; choose the portrait, landscape or square canvas in the project settings, then 720p or 1080p, 24/30/60 fps and one of three quality levels in the export panel. Under **Export method**, **On this device** is that default browser path; **Local compatibility export** re-renders the same snapshot through FFmpeg on the local engine for the rare timeline the browser exporter cannot handle, follows the project's frame rate, and does not use the frame-rate or quality menus. The progress indicator belongs to the project and resumes when reopened.

Current limits are 4,096 named tracks, 5,000 timeline items, 5,000 keyframes per item, clip speed between 0.1× and 10×, and a ten-minute timeline. Stock templates, cloud collaboration, motion tracking, and advanced masks are outside this editor's implemented feature set. Preview is browser playback; font rasterization and compressed video can differ slightly from the rendered file. Inspect the downloaded MP4 before publishing.
