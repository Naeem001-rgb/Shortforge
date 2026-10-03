⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# M01 — Real media import and initial playback — Round 1

**6.0/10 · FIX.** Compliance 8, correctness 8, UX 8, performance 7, code quality 7. Weighted 35/25/20/10/10; raw 7.80, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** Imported actual Sintel MP4, saw correct854 × 480/52.21 s metadata, filmstrip and real exported frames/audio. Backend waveform/audio-upload, container normalization and range rejection tests pass.

**Findings and required changes.**
1. Major: image import and failed-input retry were not independently driven through the UI. Exercise those paths with a still image and an invalid media file, and verify the recovery action preserves the existing edit.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
