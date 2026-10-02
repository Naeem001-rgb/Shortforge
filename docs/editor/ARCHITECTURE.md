# Architecture

## Four layers
1. **Document**: plain JSON in editorModel.ts and validated Pydantic counterparts. Version 1 documents migrate by supplying defaults; extensions use additive optional fields until the v2 migration is introduced. IDs are stable. Time is seconds; transform x/y is percent of canvas from its centre; scale is multiplicative; rotation is degrees.
2. **Engine**: pure timeline/keyframe/caption/transition evaluation and a shared browser canvas compositor. Every canvas export frame calls the same renderer as preview. Tested FFmpeg export remains an explicitly identified compatibility path until parity is proven.
3. **Media**: existing local engine handles acquisition, audio extraction, speech/transcription and safe media URLs. Browser cache/storage, decoding, offline audio, WebCodecs and a permissive muxer are isolated from React. No media is uploaded to external providers except explicit cloud actions.
4. **UI**: React shell, panels, inspector, timeline and preview. Mutations go through one history commit with at least 100 snapshots; autosave debounce under two seconds. Selection/playhead/panel widths are UI state.

## Stable initial contracts
- Preserve existing EditorProject / TimelineItem JSON keys and API response shapes while extending them. Lead owns editorModel.ts; backend owner mirrors changes in editor_models.py. New fields need defaults so old documents load.
- Asset carries id, clip_id, kind, url, path; EditorMedia adds name, duration, dimensions, media_type, has_audio and waveform.
- Library entry is URL-addressable `?studio=<clip-id>`. Source acquisition should start automatically once per opening, recover persisted jobs, and never overwrite existing edits.
- Rights remain recorded metadata. Unknown does not mean owned, and does not block local editing under the new brief.
- Main editable stage uses graphite surfaces, violet action/selection accent, dedicated video/audio/caption track colours. Media/tools left; portrait stage centre; contextual inspector right; timeline bottom.

## Concurrency
Builders use separate git worktrees and branches with exclusive file ownership. Shared contracts are changed by Lead and communicated explicitly. Small commits are integrated sequentially. Reviewers have fresh context, do not fix their own reviewed implementation, and write scored reports. Four simultaneous agents are the available runtime maximum; lanes rotate through the slots.
