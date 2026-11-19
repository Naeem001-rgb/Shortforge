# ShortForge changelog

Dated milestones for the local, single-user application. Linked validation reports describe checks performed on those dates; see [Testing](TESTING.md) for current commands and limits.

## November 10, 2026 — Cleanup and scaling review

Removed redundant styles and Scout halt sequences, batched publishing-history reads, and reused publishing draft initialization, date formatters and saved-manifest bytes. See the [cleanup report](CLEANUP-2026-11-10.md) for measurements, historical test results, optional checks and the limits of public multi-user hosting.

## November 5, 2026 — Publishing, channel confirmation and Linux startup

- Studio gained explicit **Publish now** and **Schedule** actions for saved Concat edits. A serial render/upload queue preserves snapshots, exports and resumable upload identities; scheduling uploads privately and reports success only after YouTube confirms the time. Drafts and activity survive reload.
- OAuth confirmation handles connected, cancelled, expired and provider-error states and returns to the initiating workspace and theme. Saved channel credentials remain intact.
- Added a systemd user service and application-menu shortcut. The engine survives closing its browser or terminal, restarts after crashes and stops at graphical logout. `./start.sh` reuses it and opens a fresh private connection.

See [publishing and scheduling](YOUTUBE-PUBLISHING.md) and [startup and service controls](../README.md). Recorded checks covered isolated OAuth/upload responses and a real Concat fixture; live YouTube publication, scheduled release, reboot/login and non-Linux startup were not exercised.

## November 2, 2026 — Local security hardening

Added authenticated local clients, exact origin checks, one-use browser/Scout pairing, restart revocation and signed media links. The launcher serves the production app on port 8787 using a private-file handoff. Credentials and upload-session details are encrypted; requests, work queues, storage growth and media processes are bounded.

Installed hash-verified media tools and isolated Linux media/voice workers and native Concat. Saved Library data and credentials were preserved. Concat's upstream advisories remain relevant; isolation does not patch them. See [security boundaries and recovery](SECURITY.md).

## October 30, 2026 — Security and concurrency audit

Restricted media demuxers, made voice-reference registration atomic, upgraded vulnerable dependencies and strengthened startup consistency checks. Shared download claims and atomic job admission prevent duplicate work; enrichment reads are batched and thumbnail admission is bounded. The [audit report](AUDIT-2026-10-30.md) retains measurements, package changes and verification limits.

## October 28, 2026 — Smaller builds and maintenance

Consolidated media-tool lookup, removed unused frontend code/styles and enabled unused-variable checks. Minification reduced the three extension scripts by 42.7% in the recorded build comparison. Moved pytest to development requirements and limited discovery to first-party engine code. Optional APIs, saved data and third-party notices were retained.

## October 26, 2026 — Library and media performance

Bounded Library rendering to 50 items per page while retaining search and selection across pages. Added cheaper refreshes, sequential Scout sampling, early speech rejection, shorter database writes, bounded bulk work and verified build reuse. Compatible video avoids unnecessary lossy normalization. See [measured results and limits](PERFORMANCE-RESULTS-2026-10-26.md) and the [original audit](PERFORMANCE-AUDIT-2026-10-26.md).

## October 25, 2026 — Native Concat editing

Replaced the custom browser editor and streamed Concat interface with native desktop Concat. Library actions open the selected video's persistent project; Studio can launch without a selected video. Startup installs and verifies the pinned runtime when needed.

Saved projects and their media copies remain independent of Library source deletion. This requires a local graphical desktop and does not provide editing to remote website visitors. See [setup, saved projects and recovery](CONCAT.md).

## October 15, 2026 — Conservative source cleanup

Removed unused transition construction, constants, helpers and styles while preserving accepted transition IDs, saved-project validation, supported APIs and license assets. Both browser and Python media paths retained the copies of assets they required.

## October 12, 2026 — Direct YouTube upload API

Added OAuth channel connections, user-confirmed direct uploads and durable resumable-upload history. Retry handling checks the existing session before sending more bytes, including after an uncertain final response. The original editor handoff was later replaced by the native publishing workflow. Provider checks used controlled responses; no live upload was performed for this milestone.

## October 9–10, 2026 — Formatting and contract fixes

Added repository formatting and Python lint commands, extended type checks to test/config files and removed unused dependencies. Unified count parsing and corrected non-breaking-space thousands separators. Updated API behavior, voice ranges, optional-service documentation and license attribution to match the implementation.

## October 8, 2026 — Instagram previews

Scout reads Reel payload and account-grid covers in addition to video posters. The engine recovers missing or expired Instagram previews from cached footage or metadata, caches decoded thumbnails and removes preview caches with their clips. Existing clips do not need reimporting.

## October 7, 2026 — Scout accounts, filters and recovery

- Added Instagram Reels and creator/account queues alongside YouTube Shorts, with deduplication and session-safe navigation. Resume recovers closed tabs and disconnected content scripts without losing criteria or saved matches.
- Added bounded local brief-caption screening and optional small-Chinese-text/no-speech screening. Model installation is explicit; unavailable or incomplete analysis does not count as a passing check.
- Exposed editable likes/views limits, four discovery presets and an optional cleared selection. Count, account and caption policies still apply when no preset is selected.
- Redesigned the popup with persistent settings, readable progress, keyboard controls and light/dark themes. See the [Scout guide](../extension/README.md) and [speech screening](../engine/studio/SCOUT_SPEECH.md).

## September 30, 2026 — Scout connection recovery

The Library button checks local availability before navigating and explains how to start ShortForge when the app is stopped.

## September 29, 2026 — Initial workspace and Library

Created the React/TypeScript dashboard, FastAPI/SQLite engine, Chrome Scout extension, local launchers and shared API contracts. Library supports imports/uploads, search, grid/table views, archive and confirmed bulk deletion; selection survives filtering and searching.

Fixed YouTube description-menu and count extraction, with live collection verified on the observed layout. Added original-language caption/script extraction, bounded rewrite retries and optional voice services. Provider/model availability remains explicit; later milestones supersede the original editor and permission behavior.
