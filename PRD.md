# ShortForge product requirements

**Snapshot:** October 27, 2026. **Status:** implemented product baseline, including the October 26 speed and media-quality release. This document describes the supported workflow and acceptance criteria; deferred items are not delivery commitments.

Related: [product scope](PRODUCT.md), [design contract](DESIGN.md), [architecture](ARCHITECTURE.md), [API contract](shared/contract/API.md), [verification and measurements](docs/PERFORMANCE-RESULTS-2026-10-26.md).

## Problem and intended user

A student creator on a CPU laptop needs to collect Shorts/Reels and personal footage, find saved videos quickly and continue editing without losing source quality or saved work. Large Libraries previously created excessive browser work, frequent refreshes resent unchanged data, Scout repeatedly decoded earlier frames, and conversions could re-encode video unnecessarily.

The core experience must remain usable locally without paid services. Discovery, organization and native editing are the primary workflow. Keys, media and saved edits belong on the user's machine; external services run only through the relevant configured or user-requested operation.

## Goals

- Make Library loading, selection and repeated refreshes responsive as the collection grows.
- Reduce avoidable decoding, encoding, database and startup work while retaining validation and recovery.
- Preserve compatible video/audio streams and existing Concat edits.
- Keep failures and uncertainty visible, with usable retry paths and no false claims of successful screening, editing or publishing.
- Keep documentation aligned with the shipped interface and distinguish retained backend capabilities from visible product features.

## Supported journeys

| Journey | Expected result |
|---|---|
| Upload footage or paste a supported YouTube/Instagram URL | A real Library record; uploads are validated before registration; an external URL can be saved before source acquisition. |
| Scout a feed or account | Matching candidates are collected, duplicate IDs are excluded, pending clips survive a submission failure, and the user can pause. An account queue stops when exhausted. |
| Find and organize saved videos | Search/filter/sort the complete loaded Library, navigate 50-entry pages, preserve selections across views and filters, export links, archive or confirm deletion. |
| Open a saved video in Studio | Show the current preparation job in the same dashboard tab; launch its persistent native Concat project on the engine's computer. |
| Reopen an existing edit | Keep saved Concat content and its independent source copy. |
| Export | Use Concat's native export controls to save locally. No automatic post or publishing handoff occurs. |
| Configure services | Show engine/setup state and YouTube channel Settings without exposing stored credentials. |

## Functional requirements and acceptance

All requirements below describe current behaviour unless explicitly marked deferred.

| ID | Requirement | Acceptance evidence |
|---|---|---|
| LIB-01 | Render at most 50 cards or table rows per page. Apply search, filters and sorting to the complete loaded list; keep factual overview counts. | A 55-entry fixture renders 50 then 5. Search can find an item on another page; grid/table reflect the same results. |
| LIB-02 | Preserve selection across pages, search, filters and view changes. Select page affects only visible page IDs; the bulk bar reflects the total selection. | Select both pages, revisit the first, filter to one clip and retain the full selected count. |
| LIB-03 | Archive at most four clips concurrently and retain failed selections. Batch permanent deletion at no more than 200 IDs per request after confirmation. | Partial archive failure keeps only failed IDs selected. A 205-ID deletion handles 200, retains the failed five, and retries those five. |
| LIB-04 | Distinguish loading, empty, filtered-empty, unavailable and stale results. Preserve the grid when refreshed data is unchanged. | Initial offline state does not report an empty Library; unchanged polling causes no grid mutations. |
| NET-01 | Prevent overlapping Library polls, bound request waits, and pause periodic Library/health checks in hidden tabs. Resume when visible and preserve explicit refreshes after actions. | Browser tests hold a request, advance timers, hide/show the document and verify request counts. |
| API-01 | Keep complete `/api/clips` responses compatible with existing clients. Support private ETag revalidation without stale data after mutations or filter changes. | A matching validator returns an empty `304`; changed data/filter results return `200`. Real Chrome receives complete cached JSON and observes mutation invalidation. |
| MEDIA-01 | Validate incoming media and converted output; choose video and audio copy/encode decisions independently. Do not treat ten-bit H.264 as supported eight-bit video. | Real FFmpeg fixtures verify copied H.264/AAC packet hashes, playable output, retained input files at the shared-normalizer boundary and eight-bit conversion where required. |
| MEDIA-02 | Keep slow probing outside the SQLite write transaction while retaining atomic duplicate acquisition and source-change protection. | An unrelated write completes while probing is blocked; changing a cached source during probing returns a retryable conflict. |
| SCOUT-01 | Retain existing OCR intervals, thresholds, complete-duration checks and conservative rejection. Decode forward without changing sampled pixels. | New samples match the previous seek method at 10, 30 and 29.97 fps; short final bins, unreadable frames and a truncated tail are covered. |
| SCOUT-02 | For the optional no-speech policy, speech or unverifiable audio may reject before OCR. Do not fabricate caption coverage. | Early rejection reports zero scanned frames and null caption measurements; verified speech absence still proceeds through text screening. |
| SCOUT-03 | Preserve pending-before-submit storage and result identity checks while removing redundant progress/badge writes and repeated Instagram JSON parsing. | Background tests verify persistence/completion; browser fixtures verify one parse for counts/cover, lazy payload reading and fresh subsequent data. |
| JOB-01 | Throttle intermediate progress writes, persist completion/failure, index job lookup and keep upload/voice-reference/file work off the event loop. | Progress tests retain completion with bounded writes; a blocked upload probe permits unrelated requests; job lookup uses the composite index. |
| EDIT-01 | Open native Concat through the current launch job; preserve saved project/media state and expose launch failures with retry. | Browser handoff fixtures reject stale/unconfirmed job success. Opt-in native tests cover import/save/reopen and a real desktop launch separately. |
| START-01 | Reuse a build only when its input/environment/dependency metadata and output hashes match. Preserve explicit forced builds and runtime integrity checks. | Input/output fingerprint tests pass; changed output and malformed cache records trigger rebuilds; `--if-needed` reuses unchanged output. |

Executable checks live in [Library browser tests](dashboard/tests/library-performance.spec.ts), [core tests](engine/core/tests/test_core.py), [media quality tests](engine/studio/test_media_normalization.py), [Scout tests](engine/studio/test_scout_captions.py), [extension tests](extension/tests/background.test.ts), [Instagram fixtures](extension/tests/instagram-fixture.mjs), [build-cache tests](extension/tests/build-cache.test.mjs) and [Concat tests](engine/core/tests/test_concat.py).

## Quality and operating constraints

- **Data integrity:** keep source validation, path/ownership checks, upload limits, cleanup on failure, duplicate-job protection and independent Concat media. Archive and permanent deletion remain distinct actions.
- **Honest rights:** record source, attribution, license status and permission notes. Unknown rights never become owned by inference, and are not an editing/download gate.
- **Privacy and boundary controls:** bind the engine to loopback, retain host/origin checks and extension CSP, and keep secrets out of frontend payloads and Git. No social-action automation or challenge bypass.
- **Accessibility and usability:** preserve keyboard operation, focus handling, page/status labels, responsive controls and reduced motion. The new pagination fits a 390px viewport without horizontal page overflow. This is not full screen-reader certification.
- **Resource use:** core work is CPU-compatible. No paid dependency is required. Optional models require explicit setup; the Scout worker remains bounded and cancellable.
- **Recovery:** show interrupted in-process jobs as failed after restart; keep user data intact and permit retries. Preserve YouTube's distinct upload recovery rather than treating every job as resumable.
- **Quality wording:** stream copying avoids an additional lossy encode; it does not improve the original footage. OCR and speech checks are estimates with known limits. Native exports have their own verification scope.

## Performance evidence

| Audit workload | Before | After |
|---|---:|---:|
| Library ready with 1,000 synthetic clips | 1,293 ms | 378 ms |
| DOM elements for that Library | 38,214 | 2,118 |
| API response with 5,000 clips | 246.9 ms | 117.7 ms |
| Unchanged 1,000-clip response body | 1,476,791 bytes | 0 bytes with `304` |
| Twelve-second H.264 + PCM conversion | 1.758 s | 0.815 s |
| Scout decoding stage on the twelve-second proxy | 1.940 s | 0.290 s |
| Build stage, forced versus unchanged startup | 9.46 s | 3.00 s |

These are baseline observations on the audit machine, not universal service-level guarantees. The Library now displays its first 50 items rather than all 1,000. The Scout number excludes download, proxy creation and OCR inference; the build number excludes dependency updates and Concat setup. Preserve those boundaries in future comparisons. Full methodology is in the [results report](docs/PERFORMANCE-RESULTS-2026-10-26.md).

## Release acceptance

Required checks are the backend suite, extension unit suite, dashboard browser suite, app/test type checks, extension production build and relevant lint/format checks. Added media/sample paths require real generated-fixture comparisons; test data must be isolated from the user's Library.

The October 26 runs passed 342 backend tests with five optional skips, 73 extension tests and 23 browser tests. An additional ten-bit normalization case and final mobile checks passed afterward. The five skips covered two opt-in native Concat checks and three speech-model cases. The October 27 pre-commit rerun passed 343 backend tests (five optional skips), 73 extension tests and 23 browser tests. Record newer results in [docs/PROGRESS.md](docs/PROGRESS.md); do not present fixture-based handoff tests as native editing/export certification.

## Outside this release

The removed browser editor/streaming/WebCodecs export, former script/voice/SEO interface, integrated separation/inpainting and automatic publishing are absent from the current dashboard. Retained AI and YouTube backend APIs do not add them back to the interface.

Server-side Library pagination/revision tracking, persistent OCR/speech workers, global job scheduling, font/bundle restructuring, health-hash caching, enrichment/thumbnail improvements and a Concat publishing handoff remain deferred. The current API still queries and serializes all matching clips before ETag calculation. Live platform scouting/publishing, Windows execution and native export visual/audio quality were not verified by the performance release.
