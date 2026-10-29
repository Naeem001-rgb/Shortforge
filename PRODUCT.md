# ShortForge
<!-- impeccable:product-schema 1 -->

Updated October 27, 2026. Product scope reflects the native Concat workflow and the October 26 performance/quality improvements.

## Platform
web

The local web dashboard and Chrome Manifest V3 extension work with a Python engine. Video editing takes place in Concat's native desktop window on the engine's computer.

## Stack
React, TypeScript and Vite with hand-written CSS; Python FastAPI and SQLite; Chrome MV3; yt-dlp and FFmpeg for acquisition/media preparation; local OCR and optional speech analysis for Scout. The pinned Concat runtime supplies the editor. No paid service is required for the core workflow.

## Users and purpose
A student creator working on a CPU laptop needs to find useful Shorts/Reels, organize source footage and open saved projects quickly without losing quality or edits. ShortForge provides discovery, a local Library and a reliable handoff to Concat. Scripts and voiceovers may be prepared externally; the dashboard does not expose the former script-rewriting, AI voice-generation or SEO workflows.

## Current experience

1. **Collect:** run Scout on a YouTube Shorts/Instagram Reels feed or an account's collected grid links, paste a supported source URL, or upload footage.
2. **Organize:** search, filter, sort and switch between grid/table views. Render 50 videos per page; search and overview counts cover the complete loaded Library. Selection survives page and filter changes. Export selected links as CSV, archive clips or confirm permanent deletion.
3. **Edit:** click a Library picture/title or table Edit. The current tab shows preparation and launch progress; Concat opens natively. Existing Concat projects reopen without resetting saved edits. Studio navigation can launch Concat without a selected Library video.
4. **Export:** save and export using Concat's own controls. YouTube channel Settings and backend services remain, but there is no Concat export-to-publishing handoff. Export alone never posts.

Scout defaults are 5,000 likes, 10,000 views, 30 results, `any` discovery mode and `brief-only` caption screening with a three-second allowance. Counts of zero disable their respective engagement requirement. The optional `small-text-no-speech` policy requires a usable local speech setup. These are configurable screening rules, not proof of ownership, narration or caption/speech absence.

## Speed and quality commitments

- Keep interaction responsive as the Library grows: bounded rendering, reused number formatting and unchanged-data checks.
- Keep periodic Library/health checks quiet in hidden tabs and avoid overlapping requests. HTTP revalidation reduces repeated response payloads.
- Preserve compatible media streams instead of re-encoding both video and audio unnecessarily. Validate converted output and reject incomplete video decoding.
- Sample the same Scout frames while decoding forward once. Retain full-duration checks and reject uncertain results. Skip unnecessary OCR after speech already disqualifies an optional-policy candidate, without inventing caption measurements.
- Bound bulk work and retain failed selections for retry. Keep duplicate acquisition guards, source-change checks and durable pending Scout clips.
- Reuse verified builds during unchanged startup. Required dependency/runtime checks remain; optional model downloads are separate.

On the audit fixtures, the 1,000-video Library ready time fell from 1,293 ms to 378 ms, a 5,000-video API response from 247 ms to 118 ms, and H.264-plus-PCM conversion from 1.758 s to 0.815 s with identical video packets. These are measured local examples, not universal latency promises. See the [results and limitations](docs/PERFORMANCE-RESULTS-2026-10-26.md).

## Constraints

Free software first, local storage, CPU-compatible core operation and server-side keys. Linux is the verified development environment; Windows/macOS startup/runtime paths exist but require their own execution checks. The app is a single-user local workflow, not a hosted editor for remote visitors.

Credits and reuse permissions are recorded honestly; unknown rights do not block local editing or downloads. Scout never likes, comments, subscribes or bypasses platform challenges. User media, keys, tokens, models and native binaries stay out of Git. Concat maintains an independent project media copy, so deleting a Library source does not delete a saved Concat edit or reclaim its separate disk space.

Do not advertise the removed custom browser editor, browser streaming, WebCodecs export, automatic publishing, integrated audio separation/inpainting, AI script/voice UI or complete CapCut parity. Historical implementations and retained backend routes are not current dashboard capabilities.

## Brand commitments

Preserve the paper visual system established October 25, with the user-selected lime accent updated October 30: warm paper `#FAF7EE`, white content surfaces, ink `#1A1A17`, and lime `#b5e550` actions and selection/navigation markers with ink labels. Pair light/dark/system themes. Bundle Source Serif 4 for display/numerals, Inter for controls and Geist Mono for data; retain Lucide icons and factual source/permission labels.

Keep the 212px desktop rail, 64px utility bar, four Library overview controls and at most five compact cards per row. Pagination must wrap on narrow screens. Empty, loading, stale/unavailable and partial-failure states must remain distinguishable. Scout uses the same palette through its own popup tokens; Concat keeps its native interface. [DESIGN.md](DESIGN.md) is the detailed contract.

## Open decisions

Deferred work includes server-side Library pagination/revisions, persistent model workers, global media-job scheduling and a Concat publishing handoff. These are not approved release commitments. Channel niche/language remain user settings; do not invent them or seed example videos into the user's Library.

## Evidence

See [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [AGENT.md](AGENT.md), the [performance audit](docs/PERFORMANCE-AUDIT-2026-10-26.md), [measured results](docs/PERFORMANCE-RESULTS-2026-10-26.md) and [progress log](docs/PROGRESS.md). The source code and executable tests establish what is implemented; older editor documents are historical.
