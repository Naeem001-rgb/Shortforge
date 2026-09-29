# ShortForge

A local creative workspace for narrated YouTube Shorts. Discover videos with a Chrome extension, organize references, edit authorized footage, rewrite scripts, save voices, caption, and export an MP4.

## Start on this Linux machine

```bash
cd /home/naeem/Documents/ShortForge
./start.sh
```

Open **http://127.0.0.1:5173**. The header should say **Engine connected**. The first launch installs the small app dependencies and a packaged FFmpeg binary; it does not download speech models. Later launches check for a yt-dlp update. Press Ctrl+C to stop.

Windows: install Node.js LTS and Python (3.11 recommended for optional speech tools), then double-click `start.bat`. Close its engine window when finished. All required dependencies are free; no paid service is required.

## Your first Short

1. Click **Add a video → Upload footage**, and choose a video you own or can use.
2. Open it in **Studio**. Paste the script under **Script**, or configure local transcription first.
3. Choose caption cleanup and a caption preset. Add a voiceover after configuring a voice provider.
4. Choose **Export → Export Short**. Download the MP4 when it finishes.
5. Generate a **Publish kit** with your Gemini key, then upload manually in YouTube Studio.

For Scout: start the app, open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select `extension/dist`. See [the extension guide](extension/README.md).

## What works without keys or large models

- Library, uploads, manual script editing, light/dark/system themes, search and filters.
- Scout credit/narration metadata discovery, permission notes, CSV links, archive.
- CPU video rendering, trim/zoom, approximate blur/cover/crop caption cleanup, ten caption presets, audio mixing, exports.
- Saved voice-reference profiles and consent records.

Optional setup enables Gemini rewrite/SEO, verified YouTube metadata, local transcription, and synthesized or cloned voices. All missing dependencies produce instructions instead of fabricated results. See [VOICE.md](docs/VOICE.md).

Creator credits are optional in discovery. Permission or a verified Creative Commons license is required before editing someone else's footage. Credits and a changed voice do not grant reuse rights. Unknown clips can inspire a new original script. No automatic uploads or stealth browsing are implemented.

## Verification and project map

See [TESTING.md](docs/TESTING.md), [PROGRESS.md](docs/PROGRESS.md), and [design research](docs/design-notes.md).

- `dashboard/`: React + TypeScript + Vite + Tailwind, local Inter font.
- `engine/core/`: FastAPI, SQLite, jobs, files and permissions.
- `engine/ai/`: writing, voices and optional provider adapters.
- `engine/studio/`: caption presets, detection and FFmpeg rendering.
- `extension/`: Chrome MV3 Scout.
- `shared/contract/`: API contracts for all components.
- `data/`: private local database, source footage, references and exports; ignored by Git.

Keys can be saved in Settings or `.env` (copy `.env.example`). Do not share `data/` or `.env`. No analytics, hosted account, or subscription is built into ShortForge.
