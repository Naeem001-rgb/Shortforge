# Studio QA builder evidence — 2026-10-02

This records test building and direct measurements, not independent critic scores or whole-product acceptance. The QA lane changed only the two new test specifications and this evidence file. Feature fixes were made by the implementation lane.

## Environment and fixtures

- Chrome 154.0.0.0, headless Linux, Playwright with the repository's isolated Vite/API servers on `127.0.0.1:5174/8788`.
- Synthetic regression fixture: four seconds of FFmpeg `testsrc2` video and a 440 Hz sine. It is explicitly labeled synthetic and is uploaded only into the isolated test engine.
- Genuine fixture: `/tmp/shortforge-sintel-trailer-480p.mp4`, the Sintel trailer, Blender Foundation, CC BY 3.0, provided by the media investigation lane. The 30-second acceptance uses its first 30 seconds; the 60-second case uses two sequential copies of that real 30-second excerpt.
- Browser export is invoked directly through `src/studio/engine/exportProject.ts`, with actual project/media records retrieved from the API. The fixture includes crop-to-fill, GPU exposure/saturation, animated caption position, timed active words, a caption box/stroke, and audio fades.
- AAC encoding is unsupported in this Chrome build. The tested browser path selected its VP9/Opus WebM fallback. These results do **not** claim a browser H.264/AAC MP4 was produced.
- Independent inspector: `/tmp/shortforge-ffprobe`, version `7.0.2-static`, downloaded from `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz`; archive SHA-256 `abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67`. It is a temporary QA tool, not a redistributed repository dependency.

## Automated coverage

`dashboard/tests/studio-engine.spec.ts` contains nine passing pure-engine checks:

1. One-frame and ordinary splits preserve duration, source continuity, independent IDs and input immutability, forward and reverse.
2. Trim rebases retained linear transform/property keys and caption-word timestamps.
3. Ripple delete unions overlapping removed spans and respects track locks.
4. Group copy preserves relative timing, gives independent IDs/state and respects the 600-second limit.
5. Easing endpoints, linear/ease values, monotonic cubic Bézier, hold and spring overshoot.
6. Numeric property interpolation and replacement of a same-time keyframe.
7. Genuine word timestamp grouping and SRT text/timing round-trip.
8. Caption wrapping, explicit paragraph breaks, spacing widths and persistent word indices.
9. Source speed/reverse/freeze timing and audio mute/hide/voice ducking.

`dashboard/tests/studio-rebuild.spec.ts` verifies actual pointer drag, vertical cross-track drag and undo, edge trim, split, save/reload, track lock/hide/mute persistence and a uniform rendered canvas when the only video track is hidden. It then makes 111 changes, traverses all 111 undo states and all 111 redo states, and verifies one further undo restores the saved baseline. The original version passed in 40.0 seconds; the expanded cross-track/pixel version also passed before the successful short export in the following run. No page errors were reported.

The browser export checks compare decoded export frames against frames produced by the shared compositor. Each reference frame is rendered twice and must be byte-identical. Export decode comparison uses mean absolute RGB error <12/255 and 95th percentile error <35/255. The references are executable compositor references, not independently approved visual-design snapshots.

Audio is decoded independently with FFmpeg to 48 kHz float PCM. Tests require a non-silent RMS, decoded duration within 40 ms of the requested duration, and correlation >0.85 against the actual offline mix in two two-second windows. Lag is searched in 1 ms steps over ±100 ms; reported drift is the difference between those two lags. Invalid correlation produces no claimed drift result. The 60-second case is the full-interval drift check.

## Measured exports after codec fix `6b78f7d`

| Fixture | Video / frames | Container duration | Decoded audio | Audio lag early / late | Correlation early / late | Frame MAE / p95 | Export wall time |
|---|---|---|---|---|---|---|---|
| Synthetic 4 s | 720×1280, 30 fps, 120 | 4.000000 s | 4.0135 s | 0 / 0 ms | 0.99997 / 0.99997 | 1.459–1.512 / 5 | 5.7305 s |
| Sintel 30 s | 1080×1920, 30 fps, 900 | 30.000000 s | 30.0135 s | 0 / 0 ms | 0.99831 / 0.99590 | 0.0178–0.6130 / 0–2 | 115.1364 s |
| Sintel 60 s | 1080×1920, 30 fps, 1,800 | 60.000000 s | 60.0135 s | 0 / 0 ms | 0.99831 / 0.99590 | 0.3416–0.6053 / 1–2 | 228.8046 s |

All exports above contain VP9 video and stereo 48 kHz Opus audio. Repeated reference renders were exact at every sampled time. The four-second test completed successfully. The 30-second artifact's saved assertions and independent ffprobe results were revalidated successfully after the runner process was interrupted before reaching the 60-second test; no aggregate exit status is claimed for that interrupted run. The separate 60-second run completed **1 passed (4.3m)**, including all frame-count, duration, decoded-audio, correlation and image assertions. Its output is 58,725,884 bytes; decoded audio RMS is 0.22240, and no page errors occurred.

Preserved artifacts:

- `/tmp/shortforge-qa-fixed30/studio-rebuild-browser-sha-0d8bf-ng-decoded-frames-and-audio/`: four-second WebM, metrics, frame PNGs, independent `ffprobe.json`.
- `/tmp/shortforge-qa-fixed30/studio-rebuild-licensed-Si-4c16f-io-timing-and-golden-frames/`: fixed 30-second WebM, metrics, references/decoded PNGs at 6/18/27 seconds, independent `ffprobe.json`.
- `/tmp/shortforge-qa-fixed60/studio-rebuild-licensed-Si-60d3e-io-timing-and-golden-frames/`: passing 60-second WebM, metrics with full ffprobe stream/frame counts, references/decoded PNGs at 12/36/54 seconds. The preserved run's `.last-run.json` records success.
- `/tmp/shortforge-qa-first-run/studio-rebuild-licensed-Si-4c16f-io-timing-and-golden-frames/`: the initial failing 30-second output, preserved for regression comparison.

## Defects found and disposition

- **One-frame split expanded duration:** `trimItem` enforced a 0.1-second minimum although splitting accepted `1/fps`. The implementation lane corrected it; the boundary test now passes in both directions and at both clip ends.
- **Accumulating Opus padding:** the initial 30-second export reported 30 seconds in its container but decoded to 30.5735 seconds. A wider independent source comparison found approximate lags of 37/187/392/523 ms at 1/10/20/27 seconds; poor later correlation means that output did not meet the drift criterion. ffprobe counted 1,529 decoded audio frames before the fix and 1,501 afterward. Commit `6b78f7d` replaced midstream encoder flushes with queue backpressure and a single final flush. The fixed 30-second result above passes.
- **Harness corrections:** a save after undo returned to an already-saved baseline and legitimately sent no PUT; the test now checks persisted state. Concurrent Vite hot reload interrupted one export, so these test pages isolate the Vite websocket while retaining the loaded module graph. Neither interruption is counted as an encoder failure.

## Reproduction and limits

```bash
cd dashboard
SHORTFORGE_REAL_MEDIA=/tmp/shortforge-sintel-trailer-480p.mp4 \
SHORTFORGE_FFPROBE=/tmp/shortforge-ffprobe \
npx playwright test tests/studio-engine.spec.ts tests/studio-rebuild.spec.ts --reporter=line
```

Without `SHORTFORGE_REAL_MEDIA`, both genuine-media acceptance checks are explicitly skipped. Without `SHORTFORGE_FFPROBE`, FFmpeg-backed probing and decoded PCM/frame comparison still run, but the optional full stream/frame count assertion is absent. No licensed media, generated output, or downloaded QA binary is committed.

This lane has not verified microphone permission/device hardware, external voice/transcription providers, OAuth publishing, all transition/filter/animation presets, full accessibility, mobile behavior, or the entire inherited browser suite. It has not assigned phase/task scores. Those claims belong to separate integration and independent review evidence.
