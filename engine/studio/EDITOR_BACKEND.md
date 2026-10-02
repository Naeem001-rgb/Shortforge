# Studio media contract and compatibility renderer

The local API preserves version 1 JSON and supplies additive defaults. A project
supports 5,000 timeline items, 4,096 named tracks, track IDs through 65,535, speed
0.1–10, and a ten-minute timeline. Media source limits remain 24 hours and 8K.
Unknown license status remains metadata; it does not block local processing.

`GET /api/editor/{clip_id}` persists an available source onto an untouched empty
timeline. The `source_seeded` marker also records any nonempty edit, so clearing
the last item cannot reinsert the source. Reads seed inside a write transaction;
an existing nonempty edit is never replaced. Saving from older clients preserves
the persisted marker. A saved empty project waiting for acquisition can seed once.

## Media

`POST /api/editor/{clip_id}/media` is multipart with `file` and `role`:
`video`, `image`, `audio`, `voiceover`, `music`, or `sfx`. Audio-only WebM from a
browser microphone works with role `voiceover`. Audio converts to stereo PCM WAV;
video converts to browser-playable H.264/AAC MP4 when necessary. Original source
files are never modified by editor treatments.

PNG, JPEG, and still WebP are decoded and verified with Pillow, reject animated
images, normalize EXIF orientation, and save as PNG. Their media record has
`kind: image`, `media_type: image`, `duration: 5`, and `has_audio: false`; timeline
items use `kind: video`. Five seconds is the insertion default, not a source-bound
limit. Export loops image input for the entire chosen timeline duration.

Visual media records include `thumbnail_url`, pointing to
`GET /api/editor/{clip_id}/media/{asset_id}/thumbnail`. The route validates project
ownership, decodes a genuine frame, and returns a cached JPEG. Cached thumbnails
are regenerable files under `data/editor-thumbnails`; audio uses actual peaks.

## Local word transcription

`POST /api/editor/{clip_id}/transcribe` accepts `{asset_id, model?}` and returns the
ordinary job record. It recognizes that selected asset, including imported audio
or microphone recordings. The completed job result contains:

```json
{
  "asset_id": "selected-media-id",
  "text": "Recognized words",
  "words": [{"word": "Recognized", "start": 0.24, "end": 0.68}],
  "language": "en",
  "source": "local-whisper",
  "timing": "word",
  "estimated": false
}
```

These are source-relative seconds. The caller maps source trim, speed, reverse,
and timeline position before creating caption items. `caption_words` in a saved
timeline item are instead relative to that item's beginning. Existing Library
transcripts are not overwritten when a selected asset is transcribed. If a
recognizer returns text without words, the operation fails rather than estimating
word timestamps. Empty speech returns an empty transcript.

`GET /api/editor-capabilities` includes `transcription` alongside `separation`.
The runtime is optional and isolated from the API's Python version. Install with
Python 3.11–3.13:

```sh
python3.12 engine/studio/setup_transcription.py --download-model
```

That explicit installer obtains MIT-licensed faster-whisper and tiny.en weights
into local data. It pins PyAV 15.1 because newer PyAV 19 removed a decoder argument
used by faster-whisper 1.2. No transcription request downloads models. Override
locations with `SHORTFORGE_TRANSCRIPTION_PYTHON` and `SHORTFORGE_WHISPER_MODEL`.
The existing in-process faster-whisper adapter is used if no isolated interpreter
is installed. Test genuine CPU recognition with `SHORTFORGE_TEST_TRANSCRIPTION=1`
and the two location variables. The test creates labeled synthetic speech; it is
not a claim of accuracy on arbitrary real recordings.

## FFmpeg compatibility export

This renderer is a retained local path, not the shared browser compositor. It
supports timed image layers, .1–10x audio/video, reverse video and sound, a selected
freeze frame (silent), flips, source crop, layer transforms, track hide/mute,
keyframe easing (including exact Bezier inversion), supported entrance/exit/loop
motion, timed caption highlights, font-family selection through libass, audio
volume/fades, and voice-window ducking. Static color adjustments, sharpness,
grain, blur, vignette, circle/rectangle masks and feather, chroma key, and rectangular
cover/blur/mosaic are applied to pixels. Brightness, contrast, saturation and
exposure accept animated numeric values. Track lock is editor interaction state.

The JSON contract also preserves effects this path cannot render faithfully.
`compatibility_issues` in editor responses lists these, and this export route
rejects them with an actionable error: non-normal blend modes, word chips, custom
caption line height, animation-loop IDs outside its implemented loop subset,
and animated temperature/tint/highlights/shadows/vignette/sharpen/grain/blur.
Use the browser exporter for those treatments. This compatibility renderer's
color math, text layout, mask softness, and CPU transition approximations are not
pixel-identical to browser output. The existing `blur-in` preset is an opacity and
scale entrance, not a variable blur filter. Only bundled/installed fonts can be
resolved by libass; an absent family falls back. No default placeholder footage
or estimated recognition timestamps are inserted.

The separately installed FFmpeg executable may include GPL components; this code
does not bundle or redistribute that binary. Runtime installer dependencies keep
their own licenses. Tests generate their own synthetic fixtures in temporary
directories and do not alter Library media.
