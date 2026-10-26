# Performance and quality improvements — October 26, 2026

Implemented the twelve priority areas from the [performance audit](PERFORMANCE-AUDIT-2026-10-26.md). Changes are in the working tree, with production extension assets rebuilt. No dependencies or paid services were added. Tests and benchmarks used temporary data, generated media and intercepted browser fixtures; they did not modify the user's Library.

## Measured results

Same machine and synthetic workloads as the audit: Python 3.14.8, Chrome 156, bundled FFmpeg 7.0.2. These are local measurements, not promises for every library, codec or computer.

| Measurement | Before | After | Meaning |
|---|---:|---:|---|
| Library ready, 1,000 clips | 1,293 ms | 378 ms | About 71% less time to show a usable first page |
| Page elements, 1,000 clips | 38,214 | 2,118 | About 94% fewer elements; 50 cards rendered per page |
| Select visible clips, 1,000-clip library | 434 ms | 34.5 ms | Before selected 1,000; after selects the current 50. This includes the intentional interaction change |
| API response, 1,000 clips | 50.4 ms | 28.7 ms | About 43% less server response time in TestClient |
| API response, 5,000 clips | 246.9 ms | 117.7 ms | About 52% less server response time in TestClient |
| Unchanged Library response body, 1,000 clips | 1,476,791 bytes | 0 bytes with `304` | Chrome reuses its cached body; headers still travel |
| Download-job lookup, 30,001 job records | 1.135 ms | 0.008 ms | The query now uses an index |
| Unrelated DB write during a simulated 250 ms media probe | 330.0 ms | 0.8 ms | Probing no longer holds the SQLite writer lock |
| H.264 video + PCM audio normalization, 12 seconds | 1.758 s | 0.815 s | About 54% less time; the original H.264 packets are preserved |
| Scout sample decoding, 12-second proxy | 1.940 s | 0.290 s | About 6.7× faster for this decoding stage; download, proxy creation and OCR inference are excluded |
| Extension/dashboard build stage | 9.46 s forced build | 3.00 s unchanged startup build | About 68% less time in this stage; dependency updates and Concat setup are excluded |

Browser results use three independent contexts per library size and production bundles, without thumbnail downloads. “Ready” measures navigation through card rendering and two animation frames; it is not LCP. The earlier view rendered all clips; the new view renders the first 50. At 100 and 500 clips, median ready times changed from 451/928 ms to 399/357 ms. The API results use twenty requests per size. Media results use three runs. The build comparison uses one forced build and three unchanged builds.

The baseline isolated Scout comparison verified all 24 sample pixel hashes. New regression tests additionally compare the old seek method with the implemented forward decoder at 10, 30 and 29.97 fps, including short final bins. The complete scan's end-of-video check remains enabled. These results do not imply that a complete Scout job is 6.7× faster: OCR inference and download time still matter.

Raw local evidence is under `/tmp/shortforge-performance-20261026-AYbEqX/`, including `browser-after.json`, `python-after.json`, `media-after.json`, `build-after.json` and `http-cache.json`. Temporary evidence may disappear when the machine cleans `/tmp`; the measurements and methodology are recorded here.

## Changes delivered

| Area | Change and quality protection |
|---|---|
| Number formatting | Reuses one compact-number formatter. A 1,000-clip page previously constructed 4,000 formatters per render; the new bundle constructs one. |
| Library rendering | Memoizes filtering/sorting, uses sets for selection checks, and renders 50 cards or rows per page. Search and sorting still cover the entire loaded Library. Selection survives pagination and filtering. Pagination wraps on phones and has accessible controls/status. |
| Refresh and network traffic | Stops overlapping Library polls, pauses periodic Library/health checks in hidden tabs, resumes on visibility/focus, bounds request time, and avoids replacing unchanged state. `/api/clips` supports private ETag revalidation and serializes directly to JSON. Ordinary web responses skip unnecessary asset-URL rewriting. |
| Scout decoding | Decodes forward through the normalized proxy once and retrieves the same midpoint samples. Sampling frequency and OCR thresholds remain unchanged. Failure to decode the remaining video tail now rejects the clip. |
| Speech screening | Under the optional no-speech policy, detected or unverifiable speech can reject the clip before proxy creation and OCR. Unscanned caption duration/coverage remain unknown, with zero frames scanned. Absence of speech still requires the complete text check. |
| Media quality | Decides video and audio conversion separately. Copies compatible H.264 video when only audio needs conversion, and copies compatible AAC when video needs conversion. Retains faststart, output probing and failure cleanup. Ten-bit H.264 is correctly recognized as requiring conversion to the supported eight-bit format. |
| Source reuse | Probes cached media outside the write transaction, then verifies source identity, size and modification time inside the transaction before reuse. Concurrent source changes return a retryable conflict. The atomic duplicate-job guard remains. |
| Progress/database work | Caps download progress writes by elapsed time and whole-percent change; Scout emits database updates only on changed whole percentages. Completion/failure updates still persist. Adds a composite index for clip/type/status job lookup. |
| Server responsiveness | Moves entire upload and voice-reference handlers into FastAPI's worker pool; job event-stream DB reads also run outside the event loop. File validation, limits and cleanup remain. |
| Bulk actions | Archives at most four clips concurrently. Deletes multi-page selections in batches of at most 200; successfully handled IDs leave the selection and failed batches remain available to retry. |
| Startup | Linux and Windows launchers request build reuse when source/configuration/dependency metadata/environment and output content hashes match. Missing, changed or corrupt outputs rebuild. Explicit `npm --prefix extension run build` always rebuilds. The extension type check still runs on warm startup. |
| Extension work | Avoids repeated storage writes for identical caption progress and repeated badge calls for unchanged badge values. Parses matching Instagram payloads once per clip read, stops after sufficient data, and avoids DOM count scanning when exact counts are available. Subsequent reads see fresh page data. Pending clips still persist before submission. |

## Verification

- Full backend suite: **342 passed, 5 skipped**. Real local OCR fixtures ran. A subsequently added ten-bit media case passed with both stream-preservation cases: **3 media-quality tests passed**.
- Extension unit suite: **73 passed**, including the corrected stale API test, progress persistence checks and build fingerprint invalidation checks.
- Full dashboard browser suite: **23 passed**. The three performance/selection cases also passed again after the final mobile layout check.
- Real FFmpeg checks verified unchanged packet hashes for copied H.264 and AAC streams, readable output, and eight-bit conversion for ten-bit input.
- Instagram/account browser fixtures passed, including exact-count/cover reuse, fresh subsequent payloads, unknown counts, pause/login behaviour, queues and exhaustion.
- The real unpacked MV3 extension smoke passed for strict CSP, relative assets, loopback API access and the native Concat handoff fixture.
- A real Chrome session against an isolated engine observed two network `304` responses while `fetch` received complete cached clip lists. Editing a clip invalidated the ETag and returned the updated body.
- Startup checks verified warm reuse, rebuild after output tampering, recovery from a malformed cache record, and unconditional explicit builds.
- Dashboard app/test type checks, extension type checking/build, Python lint, shell syntax and diff whitespace checks passed.

The five backend skips were two opt-in native Concat runtime/window tests and three local speech-model cases. No live Instagram/YouTube scouting, cloud-provider calls, real publishing, Windows execution or visual/listening review of a Concat export was performed. Existing synthetic Concat handoff tests do not certify the native editor's output quality.

## Remaining limits

The API still reads and serializes the complete matching Library before calculating its ETag, and a changed response still transfers the complete list. Browser revalidation saves network payload but still parses cached JSON and compares the snapshot. SQL pagination or a durable revision mechanism would be a separate follow-up if libraries grow enough to justify it.

OCR model startup/inference, proxy creation, external download speed and Concat's own rendering are unchanged. Persistent model workers, a global media-job scheduler, font/bundle restructuring, health-hash caching and thumbnail/enrichment work remain deferred as described in the audit. No native Concat code or export settings were altered.

## Try the changes

1. Restart ShortForge normally. Reload the unpacked ShortForge extension in Chrome if it was already loaded.
2. Open a Library with more than 50 clips. Move between pages and confirm search still finds clips on later pages.
3. Select clips on two pages, change the search, and confirm the selection count remains accurate. Use Archive to try a reversible bulk action.
4. Import a video you can use, open it and check playback. Compatible streams should retain their source quality.
5. Start ShortForge again with no source changes. The build stage should report that it is reusing verified output.
