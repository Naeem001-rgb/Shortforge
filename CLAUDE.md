ShortForge (Spec Sheet for AI Coding Agents)

  > **AI agent: read this entire file before doing anything.** Follow the order in section 4 (Execution Model). If something here conflicts with a quick shortcut, this
  file wins. If something is unclear, ask the user once, in plain English, with a suggested default.

  ---

  ## 1. Project in one paragraph

  **ShortForge** is a personal toolkit for one user (a student) who runs a YouTube Shorts channel. It has three parts that work together:

  1. **Scout** — a Chrome extension that scrolls YouTube Shorts in the user's own browser and collects Shorts that (a) are already performing well and (b) credit
  another creator in their description.
  2. **Dashboard** — a sleek, Apple-style web app (light + dark mode) where collected Shorts are listed and managed.
  3. **Studio** — inside the dashboard: download (when allowed), transcribe, rewrite the script, generate a voiceover, apply one-click captions, produce SEO titles and
  a description, and export a finished vertical video ready to upload.

  **Everything must run on a normal student laptop with no GPU, using free tools wherever possible.**

  ---

  ## 2. The user (read carefully)

  - **Not a coder.** First serious coding project. Explain in plain English. No unexplained jargon.
  - **Very limited money.** Default to free and open-source tools. Never add a paid dependency without asking first. Paid services (e.g., ElevenLabs) must be *optional*
  plug-ins, never required.
  - **Goal:** earn money from a Shorts channel to pay fees and keep learning AI. So the output must be safe for the channel (see the License Gate, section 3).
  - Likely on Windows. **Detect the OS first** and give matching commands (PowerShell for Windows).

  ### How to talk to the user
  - One step at a time. Give exact commands in a code block, say what output to expect, and what to do if it fails.
  - After each milestone, give a **"How to test this (5 steps or fewer)"** checklist.
  - Never dump huge diffs or walls of code in chat. Summarize what changed and why.
  - Ask before installing anything big, deleting files, or spending money.
  - Commit to Git often with clear messages. Keep a `docs/PROGRESS.md` log the user can read.

  ---

  ## 3. Non-negotiable rules

  ### 3.1 License Gate (the most important rule)
  Naming the original creator in a description ("credit") is **not** permission to reuse their video. YouTube's reused-content and copyright rules can demonetize or
  terminate a channel regardless of credit. So every collected Short gets a **license status**, and the app enforces it:

  | Status | How it is set | What the app allows |
  |---|---|---|
  | `cc_by` | YouTube Data API says `status.license = creativeCommon` | Download, edit, export. Attribution auto-added to the description. |
  | `permission` | User marks that the creator gave permission and pastes proof (link/note) | Download, edit, export. Proof stored with the clip. |
  | `unknown` (default) | Everything else | **Inspiration only**: metadata, stats, credit info. Download and Editor buttons are locked with a clear tooltip. |

  Also required:
  - Show a warning that a CC label only covers what the uploader actually owns (music or clips inside the video may still belong to others).
  - On locked clips, show a **"Ask for permission"** button that generates a short, polite message the user can copy and send to the creator.
  - **Inspiration mode** for `unknown` clips: the user can start a **"New original Short"** from the clip's topic. The AI writes a fresh original script (from title/
  description/topic only — not from the creator's footage), then the user adds voiceover + captions + stock footage.
  - **Do not build** features meant to evade copyright detection or bot detection (no pitch-shifting to dodge Content ID, no watermark removal from clips that fail the
  gate, no anti-bot stealth in the scout).

  ### 3.2 Safety and privacy
  - Secrets (API keys) live only in `.env` / the Settings page. Never hard-code, never commit, never put in extension source.
  - The scout is **read-only**: it never likes, comments, subscribes, or posts. It runs only in the user's normal logged-in browser at human-like pace.
  - **No auto-upload** to YouTube. The user downloads the final MP4 and copies the title/description themselves.
  - Everything runs locally on `localhost`. No user data is sent anywhere except to the AI/TTS provider the user chose, when they press a button.

  ---

  ## 4. Execution Model — parallel subagents (REQUIRED)

  **Use 3–5 subagents working in parallel.** Never more than 5. Do not parallelize tasks that depend on each other.

  ### Phase 0 — Main agent alone (short)
  1. Ask the user the **First-run questions** (section 10) in a single message.
  2. Check installed tools yourself (Node, Python, Git, ffmpeg) by running version commands. Install/guide only what is missing.
  3. Create the repo skeleton (section 5), `.gitignore`, `.env.example`, `start.bat` / `start.sh` (one command starts everything).
  4. Write the **shared contract** in `shared/contract/` — API routes, request/response shapes, and the database schema (section 7). This is what lets subagents work at
  the same time without colliding.
  5. Write `docs/design-notes.md` (section 8.1) and the design tokens file.

  ### Phase 1 — Launch these subagents **in parallel** (same step)

  | Agent | Owns (only edits these paths) | Job |
  |---|---|---|
  | **A · Scout** | `extension/` | Chrome MV3 extension: scrolling, parsing, credit detection, sending clips to the engine (F1) |
  | **B · Dashboard** | `dashboard/src/shell/`, `dashboard/src/library/`, `dashboard/src/theme/` | App shell, theme toggle, Library page, Settings page, design system
  components (F2) |
  | **C · Engine** | `engine/core/` | FastAPI server, SQLite, License Gate logic, YouTube Data API enrichment, download jobs, transcription (F3, F4-transcribe) |
  | **D · Studio** | `dashboard/src/studio/`, `engine/studio/` | Editor UI, caption presets, caption-cover/removal, ffmpeg export (F5) |
  | **E · Words & Voice** | `engine/ai/` | Script rewrite with length control, SEO titles/description, TTS providers (F6, F7, F8) |

  Rules for every subagent:
  - **Only edit your own paths.** If you need a contract change, stop and report it to the main agent.
  - Read `shared/contract/` and this file first. Build to the contract exactly.
  - Write tests for your parsing/logic (see section 11).
  - Finish by reporting: files created, how to run/test, known issues, anything you need from another agent.
  - Keep code simple and commented in plain English — the user will read it to learn.

  ### Phase 2 — Main agent integrates
  Merge, wire the pieces, run the end-to-end test, fix seams, update docs, then hand the user the milestone checklist. If the task is small, use fewer subagents; if the
  user later adds features, re-plan the split before launching.

  ---

  ## 5. Architecture and stack

  ```
  shortforge/
  ├─ CLAUDE.md               ← this file
  ├─ start.bat / start.sh    ← one command runs engine + dashboard
  ├─ .env.example
  ├─ shared/contract/        ← API + DB contract (single source of truth)
  ├─ extension/              ← Chrome MV3 (TypeScript)      [Agent A]
  ├─ dashboard/              ← Vite + React + TypeScript + Tailwind   [Agents B, D]
  ├─ engine/                 ← Python 3.11+, FastAPI          [Agents C, D, E]
  │   ├─ core/  studio/  ai/
  ├─ data/                   ← SQLite DB, downloads, exports (git-ignored)
  └─ docs/                   ← PROGRESS.md, TESTING.md, design-notes.md
  ```

  - **Why a local engine:** a Chrome extension cannot run `yt-dlp`, `ffmpeg`, or speech models. The extension sends data to the engine at `http://localhost:8787`; the
  dashboard also talks to it.
  - **Engine tools:** `yt-dlp` (download), `ffmpeg` (video/caption rendering), `faster-whisper` (free local transcription, word-level timestamps; default model `small`,
  option `base` for speed), SQLite (storage).
  - `start` script must also update `yt-dlp` on launch (it breaks often when YouTube changes).
  - **Extension setup for the user:** `chrome://extensions` → Developer mode → Load unpacked → pick `extension/dist`. Write these steps into `docs/TESTING.md`.

  ---

  ## 6. Feature specs

  ### F1 — Scout (Chrome extension)
  **Popup UI:** Start / Pause / Stop, target count (default **30**), min likes (default **5,000**), min views (default **10,000**), live progress ("Scanned 84 · Matched
  12 / 30"), short log. Thresholds are editable.

  **Loop, on `youtube.com/shorts/*`:**
  1. Read the current Short: video ID (from URL), channel name/handle, title, description, likes, views. Open the description panel if needed to read views/description.
  2. Parse counts like `5.2K`, `1.3M`, `12,400` (and handle hidden like counts → treat as unknown and skip).
  3. **Credit detection** on the description: patterns such as `credit`, `credits`, `cr:`, `via`, `source`, `original`, `all rights`, `@handle`, `youtube.com/@…`, or
  another YouTube URL. Store the matched text snippet and the extracted credit target (handle/URL/name).
  4. A Short **matches** if likes ≥ min, views ≥ min, and a credit is detected. Skip duplicates (by video ID) and anything already in the database.
  5. Advance to the next Short with human-like random delays (about 4–9 seconds). Stop when the target count is reached, when 500 Shorts have been scanned, or if a
  consent/captcha/login prompt appears (then pause and tell the user).
  6. Send matches in batches to `POST /api/clips`. Show a badge count on the extension icon.

  **Engineering rules:**
  - Put every DOM selector in one file, `selectors.ts`, with a **"Self-test" button** in the popup that reports which selectors still work (YouTube changes its page
  often).
  - The scout must not click like/subscribe/comment or do anything except read and scroll.
  - **Acceptance:** with the engine running, pressing Start collects 30 matching Shorts and they appear in the dashboard Library within 5 seconds of each batch.

  ### F2 — Dashboard: Library
  - Grid view (9:16 thumbnail cards) and table view toggle. Search, sort (views, likes, date collected), filters (license status, workflow status).
  - Each card: thumbnail, title, credited creator, likes/views chips, **license badge**, primary action (Open in Studio / Ask permission).
  - Clip detail drawer: full description, matched credit snippet, link to original, permission notes, delete/archive.
  - Bulk actions: export links as CSV, archive selected.
  - Empty, loading (skeleton), and error states all designed.

  ### F3 — Enrichment + License Gate (engine)
  - If the user has added a free **YouTube Data API v3** key, call `videos.list` (`part=snippet,statistics,status`) in batches of up to 50 IDs to confirm views/likes
  and set `license_status` (`creativeCommon` → `cc_by`; otherwise `unknown`). This costs ~1 quota unit per call, well inside the free daily quota.
  - With no key: keep DOM values, leave status `unknown`, and show a Settings prompt explaining the free key (with click-by-click steps).

  ### F4 — Download + Transcript
  - "Download" button (enabled only for `cc_by` / `permission`) → `yt-dlp` job, best MP4 up to 1080×1920, live progress bar via Server-Sent Events, saved in `data/
  downloads/`. Also allow **"Add my own video"** (drag-and-drop file) so the Studio works on the user's own footage.
  - "Transcribe" → `faster-whisper` with word-level timestamps; saved to the database; shown as editable text with timestamps.

  ### F5 — Studio (built-in editor)
  Three-pane layout: tools (left) · phone-shaped 9:16 preview (center) · properties (right).

  - **Trim** start/end. **Crop/zoom** to 9:16.
  - **Caption removal** (honest, best-effort): detect where burned-in captions sit by sampling ~8 frames with a lightweight CPU OCR and taking the union box; the user
  can drag to adjust. Then apply one of: *blur band*, *solid cover*, or *crop-zoom out of the band*. Label it clearly as "approximate — new captions are placed on top."
  Do not promise perfect AI inpainting.
  - **Captions, one click:** generate word-timed captions from the transcript (or from the new voiceover) and apply a preset instantly. Ship **10 presets** with generic
  names: *Bold Pop*, *Karaoke Highlight*, *Clean Minimal*, *Neon Glow*, *Typewriter*, *Boxed Label*, *Outline Comic*, *Gradient Pop*, *Lower Third*, *Classic Subtitle*.
  Each preset is a JSON file (font, size, weight, fill, stroke, shadow, highlight color, box, position, animation) so more can be added easily. Bundle only fonts with
  open licenses (e.g., Montserrat, Poppins, Anton, Bebas Neue, Inter).
  - User can tweak: font size, position, colors, words-per-line, and highlight color.
  - **Audio:** keep original, replace with voiceover (F8), or mix; volume sliders.
  - **Export:** ffmpeg renders captions (ASS subtitles) into a 1080×1920 MP4 (H.264/AAC) at `data/exports/`. Progress bar + "Download MP4" button. Must work on CPU in
  reasonable time for a 60-second Short.

  ### F6 — Script rewrite
  - Input: transcript. Output: rewritten script that keeps the **same tone of voice, same facts and context, same language**, with word count within **±5%** of the
  original.
  - The engine **counts the words itself**; if outside ±5%, auto-retry up to 2 times with a corrective instruction. Show "Original 142 words → New 139 words ✓".
  - No invented facts, no new claims. Show original vs. rewritten side by side with editable text.
  - Provider is pluggable: user pastes their own key in Settings (a free-tier option such as Google's Gemini API, or any other). Verify current free limits at build
  time and tell the user honestly.

  ### F7 — SEO pack
  For each finished Short generate:
  - **3 title options, ranked "Top Pick 1–3"**, each with a one-line reason and character count. Aim for ≤ 70 characters (hard cap 100), keyword near the front,
  curiosity without clickbait lies.
  - **One short description** (~250–350 characters): hook line with primary keyword → 1–2 supporting lines → **credit block** (`Credit: {creator} — original: {URL}`;
  add `Licensed CC BY` when status is `cc_by`) → 3–5 relevant hashtags including `#Shorts`.
  - A suggested tag list. One-click **Copy** buttons for each item. No keyword stuffing.

  ### F8 — Text-to-voice (ElevenLabs-style, built in)
  - Provider interface with these options: **(1) local free model** (e.g., Kokoro or Piper — runs on CPU) as the default, **(2) Edge TTS** (free, unofficial library —
  warn it may break), **(3) ElevenLabs** (optional, user's own API key). **Before shipping, check that each option's license/plan allows monetized use and tell the
  user.**
  - UI: voice list with preview, speed, and pitch controls; "Generate voiceover" from the rewritten script; waveform preview; regenerate button.
  - After generating, re-run word alignment on the new audio so captions match the voice. If the voice length differs from the video, offer speed adjust (±10%) or trim.

  ### F9 (Phase 2, stretch) — Original Short mode
  Topic → original script → voiceover → free stock footage (Pexels/Pixabay APIs with the user's free keys) → captions → export. This is the safest long-term path for
  the channel.

  ---

  ## 7. Data model (SQLite) and API (summary — full detail in `shared/contract/`)

  **Tables:** `clips` (id, video_id, url, channel_name, channel_handle, title, description, likes, views, published_at, credit_target, credit_snippet, license_status,
  permission_note, thumbnail_url, workflow_status, created_at) · `jobs` (id, type, clip_id, status, progress, error) · `scripts` (clip_id, original_text,
  rewritten_text, words_original, words_rewritten) · `assets` (id, clip_id, kind, path) · `settings` (key, value).

  **Routes:** `GET /api/health` · `POST /api/clips` (bulk from extension) · `GET /api/clips` · `PATCH /api/clips/{id}` · `POST /api/clips/{id}/download` · `POST /api/
  clips/{id}/transcribe` · `GET /api/jobs/{id}/events` (SSE) · `POST /api/rewrite` · `POST /api/seo` · `POST /api/tts` · `POST /api/export` · `GET|PUT /api/settings`.

  ---

  ## 8. Design system — Apple-like, sleek, not generic

  ### 8.1 Research step (bounded)
  Before writing UI code, if a browsing tool is available (Claude in Chrome, a web-fetch tool, or Playwright), spend **at most ~20 minutes / 12 references** looking at
  **Dribbble, 21st.dev, Mobbin, Pinterest, and Apple's Human Interface Guidelines** for dashboards, media libraries, and video editors. Write `docs/design-notes.md`: 8–
  10 principles + 3 component patterns you will use. Take *principles*, not pixel copies. If no browsing tool is available, say so and use the tokens below.

  ### 8.2 Tokens
  - **Font:** Inter (variable). Fallback stack: `-apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif`. Use tabular numbers for stats.
- **Type scale (px):** 12 (badges only) · 14 (secondary) · **16 (body, default)** · 20 · 28 · 40. Body line-height 1.5. **Nothing smaller than 12px; no body text
  under 14px.** Weights 400/500/600. This floor is enforced strictly across every stylesheet (`theme/*.css` and `studio/*.css`) — 9/10/11px is a regression, not a density choice.
  - **Spacing:** 4-pt grid (4, 8, 12, 16, 24, 32, 48). Click targets ≥ 40px.
  - **Radius:** 10 (controls) · 16 (cards) · 24 (sheets/modals).
  - **Dark:** bg `#0B0B0D`, surface `#141416`, elevated `#1C1C1F`, border `rgba(255,255,255,0.08)`, text `#F5F5F7`, muted `#A1A1A6`.
  - **Light:** bg `#F5F5F7`, surface `#FFFFFF`, border `rgba(0,0,0,0.08)`, text `#1D1D1F`, muted `#6E6E73`.
  - **Accent:** one accent only — a violet ramp, used for primary buttons, focus rings, active states. Dark `#b7a1ff` (button `#7953df`, soft `#332b49`); light `#b5adff` (button `#5347ce`). Defined once as `--accent` in `dashboard/src/theme/editor.css` and `tokens.css`; never hard-code a hex in a component. Semantic colors for success/warn/error, used sparingly.
  - **Motion:** 150–250 ms ease-out; subtle springs on drawers/toggles; respect `prefers-reduced-motion`.
  - **Glass:** translucent sidebar with `backdrop-filter: blur(20px)`; elsewhere prefer 1px borders over heavy shadows.
  - **Icons:** Lucide (SVG, 1.5px stroke, 20px). **No emoji as icons.**

  ### 8.3 Theme toggle
  Header switch with **Light / Dark / System**. Follows the OS by default, remembers the choice, switches smoothly (no flash on load). Contrast must meet WCAG AA in
  both themes.

  ### 8.4 Layout
  Left sidebar (Library · Studio · Voice · SEO · Settings) → content area with a large page title, a segmented control for views, a command palette on `Ctrl/⌘+K`. Cards
  and tables have generous whitespace. Phone-frame preview in the Studio.

  ### 8.5 Banned ("AI slop") list
  Purple-to-blue gradient blobs · glowing neon on everything · identical gray card grids with no hierarchy · emoji icons · lorem ipsum or fake data left in · tiny low-
  contrast text · inconsistent radii · default browser form controls · no empty/loading/error states · walls of centered text. Every screen needs a clear primary action
  and a designed empty state.

  ---

  ## 9. Milestones (each ends with a user test checklist)

  | # | Deliverable | User can… |
  |---|---|---|
  | M0 | Skeleton, contract, `start` script, health page | Run one command and see "Engine OK" |
  | M1 | Scout + Library + theme toggle | Press Start and watch 30 Shorts appear in the dashboard |
  | M2 | Enrichment, License Gate, download, transcript | See license badges; download an allowed clip; read its transcript |
  | M3 | Studio: trim, caption removal, 10 caption presets, export | Export a captioned 9:16 MP4 |
  | M4 | Rewrite, SEO pack, voiceover | Get a same-length script, a voice, 3 titles + description |
  | M5 | Polish, docs, tests, optional Original Short mode | Do the whole flow start to finish |

  Phase 1 subagents may build their parts of M1–M4 at the same time; the main agent integrates and ships milestones in order.

  ---

  ## 10. First-run questions (ask ALL in one message, with defaults)

  1. Which OS are you on? *(default: Windows 11)*
  2. What is your channel's topic/niche and main language? *(default: English)*
  3. Do you have a free YouTube Data API key? *(default: no — walk me through creating one)*
  4. Which AI provider do you want for rewriting/SEO? *(default: a free-tier option; explain choices simply)*
  5. Are the default limits OK — min 5,000 likes, min 10,000 views, target 30 Shorts?
  6. Any folder where you want the project saved? *(default: `Documents/shortforge`)*

  If the user replies "defaults", proceed with the defaults.

  ---

  ## 11. Quality bar and testing

  - Unit tests for: count parsing (`5.2K`, `1.3M`), credit detection (with positive and negative examples), word-count validation (±5%), license-gate rules (a locked
  clip can never be downloaded or exported — test the API too, not just the button).
  - Dashboard smoke test (Playwright or similar) for Library, theme toggle, and the Studio export path.
  - `docs/TESTING.md`: plain-English, click-by-click checklist the user can run.
  - Lint/format on commit. No TODOs left in shipped code without an entry in `docs/PROGRESS.md`.
  - Definition of done for any feature: works on the user's machine, has a test, has a designed empty/loading/error state, and is explained in one paragraph in `docs/
  PROGRESS.md`.

  ---

  ## 12. Out of scope

  Auto-uploading to YouTube · bulk-downloading `unknown`-license clips · evasion of bot or copyright detection · removing watermarks or logos from clips that fail the
  License Gate · liking/commenting/subscribing automation · mobile apps · cloud hosting.
