**ShortForge performance audit — 26 October 2026**

**Result: optimization opportunities identified; no application code changed.** The largest supported opportunities are Scout frame decoding, Library rendering and refresh behavior, and media conversion that unnecessarily re-encodes compatible video. Several smaller database and extension costs are real, but should follow those improvements.

Reviewed revision: `a196cdf` (`fix(dashboard): remove the sidebar device panel`). This report is the only project file added by the audit.

I used the installed [Performance Benchmarker skill](/home/naeem/.codex/plugins/cache/personal/agency-agents/1.0.0/skills/agency-performance-benchmarker/SKILL.md) and [Code Reviewer skill](/home/naeem/.codex/plugins/cache/personal/agency-agents/1.0.0/skills/agency-code-reviewer/SKILL.md).

I inventoried all **178 tracked files**, including approximately **29,125 lines of Python, TypeScript/TSX, JavaScript, CSS and startup scripts**, counting tests. The review covered first-party runtime code, API callers, test coverage, fixtures, build/dependency configuration, startup scripts and the relevant contracts. Large test/stylesheet areas were also scanned by targeted searches; this was not a claim that every documentation sentence received a line-by-line review.

| Area | Coverage |
|---|---|
| Python core | API, SQLite, jobs, uploads/downloads, thumbnails, URL validation, runtime health, script extraction, OAuth and YouTube uploads |
| Media and AI | Scout OCR/speech pipeline, media probing/conversion, optional transcription, voice generation/alignment, writing |
| Dashboard | App polling, Library grid/table/search/bulk actions, API transforms, Settings/OAuth, Studio launch, shared UI, CSS/fonts |
| Extension | Background queue/storage, content scanning, Instagram payload/DOM readers, parsers/selectors, popup, manifest and build |
| Integration and tooling | Concat handoff/setup, both startup scripts, packages, contracts and automated tests |

The current Studio is a **native Concat launcher**. The old browser editor and WebCodecs exporter have been removed. Optimizing those retired features would not improve this application. The separately managed `vendor/concat/` source, installed native runtime, third-party packages and private media/database contents were outside the first-party code audit. Concat's own playback/export speed was not profiled.

**Evidence and baseline**

Measurements used temporary databases, generated media, an isolated Chrome profile and a production dashboard build in `/tmp`. The user's saved Library and media were not used for the benchmarks. No provider credentials, paid AI calls, live uploads or model installations were needed.

Environment: Linux x86-64; 8 logical CPUs reported; Python 3.14.8; Node 22.23.1; Chrome 156.0.8078.47; bundled FFmpeg 7.0.2. Results are local diagnostic samples, not production SLAs or statistically established 95% confidence estimates. Network, disk, video content, browser cache and machine load will change timings.

| Check | Result |
|---|---|
| Python suite | **329 passed, 5 skipped**, 12.29 s; one dependency deprecation warning |
| Extension unit suite | **70 passed, 1 failed**, 2.26 s |
| Dashboard Playwright suite | **20 passed**, 50.9 s |
| Dashboard app + test/config type checks | Passed |
| Vite production bundle | Passed; JS **295.51 kB**, gzip **89.07 kB**; CSS **61.29 kB**, gzip **11.61 kB** |
| Packaged fonts | 25 WOFF2 files, **654,216 bytes** combined; these are package bytes, not all necessarily fetched by a browser |

The existing extension failure is [dashboard-api.test.ts:45](/home/naeem/Documents/ShortForge/extension/tests/dashboard-api.test.ts:45): `assetUrl is not a function`. The test imports a helper no longer exported by the dashboard API module. It is also excluded from extension TypeScript checking. This is a baseline test mismatch, not evidence of a new runtime performance failure; no fix was applied.

The Python skips were two opt-in native Concat checks and three speech-model checks unavailable in the isolated test data directory. The installed local OCR regression tests did run.

Browser measurements used synthetic clips with no thumbnail downloads, a 1440×1000 viewport and three independent contexts per size. “Ready” is Playwright wall time from navigation through rendering all cards and two animation frames; it is not LCP. Selection is browser-side click-to-two-animation-frames time.

| Synthetic Library size | Median ready time | DOM elements | Median “Select all” repaint |
|---|---:|---:|---:|
| 100 clips | 451 ms | 4,014 | 74 ms |
| 500 clips | 928 ms | 19,214 | 220 ms |
| 1,000 clips | 1,293 ms | 38,214 | 434 ms |

For API measurements, each synthetic description was 990 characters. Twenty TestClient requests were sampled per size; this includes the in-process HTTP test harness, not a real network.

| Library size | Entire response size | Median GET /api/clips | Median list function alone |
|---|---:|---:|---:|
| 100 | 147,491 bytes | 7.1 ms | 2.2 ms |
| 1,000 | 1,476,791 bytes | 50.4 ms | 9.9 ms |
| 5,000 | 7,392,791 bytes | 246.9 ms | 47.7 ms |

**Prioritized findings**

**1. High — Reuse number formatters in the Library. Effort: small. Evidence: measured.**

[dashboard/src/api.ts:83](/home/naeem/Documents/ShortForge/dashboard/src/api.ts:83) constructs a new `Intl.NumberFormat` every time `count()` runs. The grid calls it for both visible values and tooltips: four constructions per card when likes and views are present.

At 1,000 cards, an unchanged five-second refresh triggered **4,000 additional constructions**. An isolated browser benchmark of 4,000 calls took a median **76.5 ms** with repeated construction versus **2.2 ms** with one reused formatter. That is approximately 35× faster for formatting alone, not for the whole page.

Smallest proposal: create one formatter beside the existing shared helper and reuse it. Retain the current null display, locale, compact notation and rounding.

Change reach: `api.ts`, its Library/detail callers, and a small formatting assertion. This does not require a dependency, redesign or new API.

**2. High — Limit Library rendering and stop rebuilding unchanged derived data. Effort: medium. Evidence: measured.**

[Library.tsx:118](/home/naeem/Documents/ShortForge/dashboard/src/library/Library.tsx:118) filters and sorts on every render. Both the grid at [line 529](/home/naeem/Documents/ShortForge/dashboard/src/library/Library.tsx:529) and table at [line 605](/home/naeem/Documents/ShortForge/dashboard/src/library/Library.tsx:605) render every matching clip. Image lazy loading already exists, but does not avoid constructing off-screen card DOM.

Selection repeatedly uses array `includes()` for each card and select-all checks. That becomes quadratic when many clips are selected. `visibleIds` is memoized against `visible`, but `visible` itself is a new array every render, so that memo does not avoid recalculation.

The 1,000-card fixture produced **38,214 DOM elements**, **434 ms median selection repaint**, and initial long tasks as large as **495 ms**.

Smallest proposal: first memoize filtering/sorting with actual input dependencies and derive a Set for membership checks. Then render a bounded page or batch of cards. Start with ordinary pagination; a virtualization library is not the first requirement.

Change reach: Library grid/table, selection across filters/pages, totals, CSV/archive/delete actions, search, and dashboard layout/workspace tests. If server pagination follows, coordinate with finding 3. Preserve keyboard navigation, focus and the existing promise that selections survive filtering.

**3. High — Avoid full-Library polling and payloads when nothing changed. Effort: medium. Evidence: measured + confirmed code path.**

[App.tsx:74](/home/naeem/Documents/ShortForge/dashboard/src/shell/App.tsx:74) fetches `/clips`, replaces the entire clips array, and [line 98](/home/naeem/Documents/ShortForge/dashboard/src/shell/App.tsx:98) repeats every five seconds regardless of the selected app page. There is no application-level visibility pause or in-flight guard. Slow requests can overlap and older responses can overwrite newer data.

[engine/core/routes.py:134](/home/naeem/Documents/ShortForge/engine/core/routes.py:134) returns every matching row and all clip fields. [api.ts:69](/home/naeem/Documents/ShortForge/dashboard/src/api.ts:69) recursively rebuilds the response objects to resolve URLs, including in ordinary web mode where the origin is empty.

At 1,000 synthetic clips the response was **1.48 MB**. Twelve unchanged requests per minute represent approximately **17.7 MB/minute per continuously polling tab**, plus JSON processing and rerendering. At 5,000 clips, the measured in-process request median was approximately **247 ms**.

Smallest proposal: pause periodic work when hidden, prevent overlapping refreshes, refresh on focus/actions, and preserve state when the result is unchanged. A conditional response/revision can eliminate unchanged payloads; a smaller paged list response is the next step for large Libraries.

Change reach: App, API helper, list/detail API, API contract and Library tests. **Scout start/resume at [background.ts:447](/home/naeem/Documents/ShortForge/extension/src/background.ts:447) also consumes the full list to obtain known video IDs.** Do not silently change the existing endpoint to return only one page: Scout would stop recognizing some duplicates. Detail fields and complete totals also need explicit callers when list responses shrink.

**4. High — Decode Scout samples sequentially instead of seeking repeatedly. Effort: medium. Evidence: measured.**

[scout_captions.py:408](/home/naeem/Documents/ShortForge/engine/studio/scout_captions.py:408) first converts the complete video into a 30 fps H.264 proxy. [scan_video():469](/home/naeem/Documents/ShortForge/engine/studio/scout_captions.py:469) then seeks separately for each half-second sample. Seeking a compressed video can repeatedly decode frames from earlier keyframes.

On a generated **12-second, 540×960, 30 fps** proxy:

| Isolated frame-reading method | Median of 3 runs |
|---|---:|
| Current repeated seek approach | **1.940 s** |
| Sequential decode, retrieving the same samples | **0.284 s** |

The comparison verified **identical pixel hashes for all 24 sampled frames**, and the sequential pass reached all 360 frames. This is about **6.8× faster for frame reading on this fixture**. It excludes download, proxy creation and OCR inference, so it does not imply a 6.8× faster complete Scout job.

Smallest proposal: keep the normalized proxy initially and read it forward, retrieving only the required sample frames. Removing the proxy entirely is a separate, larger experiment after this simpler improvement.

Change reach: `scan_video()`, caption tests and real media fixtures. Preserve full-duration verification, midpoint/final-bin sampling, malformed/truncated-input rejection and cancellation. Test odd frame rates, short final bins and variable-rate sources after normalization. Do not reduce OCR coverage just to improve the benchmark.

**5. High for no-speech filtering — Stop unnecessary OCR after a definitive speech rejection. Effort: small to medium. Evidence: confirmed code path; full-job saving unmeasured.**

[check_in_worker():557](/home/naeem/Documents/ShortForge/engine/studio/scout_captions.py:557) checks speech first for `small-text-no-speech`, but still normalizes the video and scans all OCR samples even when speech is present. Only afterward does `combine_speech()` reject the candidate. An unknown speech result also cannot qualify for acceptance.

Smallest proposal: once the complete speech check conclusively rejects the candidate, return that rejection before proxy generation and OCR. Handle unknown evidence explicitly without claiming it passed text checks.

Change reach: worker result construction, `combine_speech()`, extension `captionDecision()`, caption/speech tests and background policy fixtures. Keep identity, policy and error evidence; never invent caption-duration measurements for unscanned frames.

Expected benefit: saves the entire remaining video/OCR stage for those rejected candidates. Frequency and real-session savings were not measured. This does not affect the default brief-only policy.

**6. High for affected imports/downloads — Convert audio without re-encoding already compatible video. Effort: small to medium. Evidence: measured.**

[normalize_browser_video():166](/home/naeem/Documents/ShortForge/engine/studio/editor_media.py:166) combines video and audio compatibility into one boolean. A compatible H.264/yuv420p video with incompatible audio therefore goes through `libx264` again, even though only its audio needs conversion.

A generated 12-second H.264 + PCM MKV fixture, tested again after the browser suite finished, gave:

| Conversion | Median of 3 runs |
|---|---:|
| Current video + audio re-encode | **1.758 s** |
| Copy the same video stream, encode audio to AAC | **0.784 s** |

That is about **55% less conversion time on this fixture**, and avoids another lossy video encode. It does not apply when the video codec/pixel format itself needs conversion.

Smallest proposal: decide stream compatibility separately, preserving video with `-c:v copy` where valid while converting incompatible audio.

Change reach: shared media normalization, upload/download callers, codec fixtures and core media tests. Preserve stream mapping, required transforms, playable-output validation, faststart and cleanup on errors. Do not remove conversion for genuinely incompatible video.

**7. Medium — Keep media probing outside SQLite write transactions. Effort: small to medium. Evidence: deterministic contention demonstration.**

[download():452](/home/naeem/Documents/ShortForge/engine/core/routes.py:452) starts `BEGIN IMMEDIATE` and then calls `probe_media()` while holding the transaction. Probing is cached, but a cache miss can launch FFprobe/FFmpeg. Other writes, such as saving clips, settings or job progress, must wait for that writer.

With a deliberately injected **250 ms probe**, an unrelated write to a temporary database waited approximately **330 ms**. This is proof of lock scope, not a measured duration for a real user's video.

Smallest proposal: perform slow validation outside the write transaction, then use a brief atomic transaction to recheck the relevant state and claim/reuse the job.

Change reach: download/idempotency flow and its concurrency/corrupt-source tests. Preserve duplicate-job protection and handle a file/asset changing between validation and the claim. `probe_media()` already has a cache; adding another generic cache is not the fix.

**8. Medium — Reduce redundant database work and progress writes; index growing job history. Effort: small to medium. Evidence: measured queries + code inspection.**

Every [db.connect():95](/home/naeem/Documents/ShortForge/engine/core/db.py:95) performs directory/file permission operations, WAL setup and the complete `CREATE ... IF NOT EXISTS` schema script. OAuth/upload storage initialization adds further schema setup. [media.py:152](/home/naeem/Documents/ShortForge/engine/core/media.py:152) also writes job progress on each download hook; Scout can persist each new sampled progress value while clients poll much less frequently.

The connection overhead is **not a leading bottleneck on this machine**: settings reads took a median **0.360 ms** with the current helper versus **0.294 ms** through a temporary comparison helper without repeated schema/chmod work. This modest isolated result is why this finding ranks below UI/media changes.

The `jobs` table has no index matching its clip/type/status lookup. With **30,001 synthetic jobs**, query planning showed `SCAN jobs`; the query median was **1.135 ms**, versus **0.008 ms** with a temporary `(clip_id, type, status)` index.

Smallest proposal: throttle intermediate progress updates by elapsed time/meaningful progress, always committing terminal states; add an index matching the active job queries. Only then consider moving schema setup to controlled initialization.

Change reach: DB helper, app startup, tests that swap `DATA_DIR`, media progress hooks, duplicate-job queries and related tests. If initialization changes, preserve standalone-helper usage, WAL, foreign keys, private permissions and rollback behavior. Do not weaken write durability, remove upload recovery records, or delete job history as an unsolicited shortcut.

**9. Medium — Keep blocking file/probe/database work off async request handling. Effort: small to medium. Evidence: confirmed code paths; concurrent latency unmeasured.**

[upload():342](/home/naeem/Documents/ShortForge/engine/core/routes.py:342) offloads its media probes correctly, but still writes file chunks synchronously and performs SQLite work directly inside an async endpoint. [clone_voice():116](/home/naeem/Documents/ShortForge/engine/ai/routes.py:116) also invokes a synchronous media probe directly. The [job-events stream:593](/home/naeem/Documents/ShortForge/engine/core/routes.py:593) polls SQLite synchronously inside its async generator.

Slow disk writes, a slow probe or lock contention can delay unrelated async work. The voice and SSE paths are retained API functionality and are not prominent in today's dashboard, so their practical impact depends on use.

Smallest proposal: use the already installed `run_in_threadpool` pattern for the blocking operations, preferably around a bounded operation rather than adding a new asynchronous storage framework.

Change reach: core upload/events, voice-reference upload, their file-size/cleanup tests and a small concurrent responsiveness check. Keep body limits, file validation, cancellation and partial-file cleanup intact.

**10. Medium for bulk operations — Bound or batch Library archive writes. Effort: small to medium. Evidence: confirmed code path.**

[Library.tsx:174](/home/naeem/Documents/ShortForge/dashboard/src/library/Library.tsx:174) launches one PATCH request per selected clip with unbounded `Promise.allSettled()`. A large selection creates many requests and transactions, while SQLite serializes writes.

Smallest proposal: first bound the number of outstanding requests. If bulk archive is commonly used on large selections, one validated bulk endpoint/transaction can remove most request overhead.

Change reach: Library archive handling, core routes/models if a bulk endpoint is added, contract, and partial-failure/selection tests. Keep the existing honest success/failure counts and retry only failed items. Bulk delete already has an endpoint, although its implementation still deletes one clip per transaction; any future batching must preserve owned-file cleanup and missing-ID reporting.

**11. Medium for daily startup — Avoid rebuilding/rechecking unchanged installations before the app can open. Effort: medium. Evidence: confirmed startup sequence; total startup unmeasured.**

[start.sh:5](/home/naeem/Documents/ShortForge/start.sh:5) and [start.bat:4](/home/naeem/Documents/ShortForge/start.bat:4) resolve Python requirements, check for a yt-dlp upgrade and rebuild the extension/dashboard before launching the engine. [extension/build.mjs:6](/home/naeem/Documents/ShortForge/extension/build.mjs:6) deletes and rebuilds the extension output every time, and runs a dashboard type check plus Vite build.

The Vite portion alone took **4.22 s** in this audit. That is not the full startup time; network-dependent pip work and other build steps were not timed.

Smallest proposal: reuse a successful build when its actual inputs and tool/dependency versions are unchanged, and rerun dependency installation when its inputs/environment require it. Keep the documented yt-dlp update behavior, first-run Concat setup and verified downloads; optimize unchanged work without silently disabling required checks.

Change reach: both startup scripts, extension build, package/lock/config inputs, setup docs and fresh/changed/offline startup checks. A marker based only on “dist exists” would serve stale code and is insufficient.

**12. Lower priority — Reduce extension storage and duplicate Instagram parsing. Effort: small to medium. Evidence: confirmed code paths; wall-time saving unmeasured.**

[background.ts:643](/home/naeem/Documents/ShortForge/extension/src/background.ts:643) handles caption status by persisting the whole Scout state and updating both badge properties every poll. State includes the complete Library `knownIds` list. At the normal two-second caption poll interval, a long check repeatedly writes unchanged IDs/settings along with a small progress change.

[instagram.ts:364](/home/naeem/Documents/ShortForge/extension/src/instagram.ts:364) reads counts from the matching JSON payload, still performs DOM count scans even if those counts are complete, and can parse/traverse the same JSON again for a thumbnail when no video poster is available.

Smallest proposal: avoid unchanged progress/badge writes and preserve durable session checkpoints; reuse matching payload data within one clip read and fall back to DOM only for missing values. Prefer a per-read reuse over a long-lived page cache that could become stale after navigation.

Change reach: background save/status flow, popup storage updates, Instagram readers, background/tab recovery tests and Instagram browser fixtures. Pending matches must still be persisted before network submission. These costs occur less often than Library renders or OCR inference and should not be optimized first.

**Additional candidates to revisit only after the findings above**

| Candidate | Evidence and reason to defer |
|---|---|
| Warm OCR/Whisper workers and media-job admission limits | OCR starts a fresh process/model per candidate; one model construction took about 0.98 s in a diagnostic run. `transcribe_file()` also constructs Whisper per call, and transcription/download work has no shared application-specific concurrency limit. But the OCR process boundary deliberately bounds time and releases memory, transcription is not installed here, and these AI routes have limited current UI exposure. Profile repeated real use and memory before keeping models resident. Preserve the existing single Scout slot. |
| Smaller initial dashboard bundle | App eagerly imports all pages and global font packages. The measured JS is only 89.07 kB gzip; limiting Library rendering offers a much stronger measured benefit. Lazy-load secondary pages only if load profiling justifies it. Font subsets are Unicode-ranged and not all fetched; do not remove language coverage just to reduce package bytes. |
| Lower-cost health checks | `runtime.source_revision()` reads/hashes first-party Python source each health request. Median source scan was 2.0 ms, whole health function 2.3 ms. Cache by file changes or slow that advisory scan only if many tabs/slow disks make it material. Preserve restart-required detection. |
| Enrichment database reads | `enrich_clips()` calls `get_clip()` once per supplied ID before its already-batched YouTube requests. Fetch those rows together if imports become large. Current batches are bounded at 100 and remote latency may dominate. Do not add a connection-pool framework for this alone. |
| Cold/unavailable Instagram thumbnails | Successful thumbnails are already cached and remote lookups are limited to three. Failed remote recovery can consume a request thread for a long time and retry across reloads; short-lived failure caching/nonblocking admission is worth considering if real sessions show it. No remote recovery latency was benchmarked. |
| Native Concat launch acknowledgment | The launcher waits up to two seconds for early process exit. This is partly a failure-detection choice, not simply wasted work. Keep independent project media copies and saved-project reuse. No recommendation to remove them or shorten the wait without a reliable readiness signal and native testing. |
| Provider retries/auth/upload verification | Writing retries, channel verification, export hashing and resumable upload checkpoints add work, but enforce current correctness and recovery behavior. No live provider performance baseline was collected. Do not remove them for a speculative speedup. |

**Recommended order if optimization is approved**

1. Reuse the shared number formatter; stabilize Library filtering/selection calculations.
2. Stop unchanged/overlapping/background Library refresh work, then bound rendered cards.
3. Change Scout's repeated seeks to sequential sampling and verify the same frames/verdicts.
4. Short-circuit definitively rejected no-speech candidates.
5. Separate audio/video conversion decisions.
6. Shorten database write-lock scope, throttle progress writes and add the job lookup index.
7. Address bulk operations, startup and smaller extension costs according to actual usage.

The larger list/API changes require coordinated callers and contract updates. The formatter and frame-reading findings have small, isolated proof cases; their measured ratios must not be presented as whole-application speedups.

For any later implementation, reuse the existing functional suites and add only focused regression/performance checks: unchanged polls should not rebuild the Library; pagination must retain duplicate detection and selection semantics; Scout samples/verdicts must remain correct for incomplete and unusual media; audio-only conversion must retain compatible video; a slow probe must not hold a database writer lock.

Raw temporary evidence and assert-based benchmark harnesses are in `/tmp/shortforge-performance-20261026-AYbEqX/`: `python-bench.json`, `browser-bench.json`, `frame-bench.json`, `audio-conversion-bench.json`, `media-bench.json` and the test/build logs. The comparison alternatives ran only in temporary harnesses/databases, never in application source. The audit's temporary HTTP server was stopped.

Skipped: live Scout/provider/network benchmarks, native Concat playback/export profiling, Windows/macOS runs and endurance testing. No application optimization was applied.
Risk: isolated fixture timings are not guaranteed real-workload gains; future changes must preserve data durability, full media verification, duplicate protection and existing API callers.
