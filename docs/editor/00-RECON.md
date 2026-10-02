# Studio recon — 2026-10-02

The owner's October 2 master brief is the current authority. Earlier CLAUDE.md and PRODUCT.md describe an older product and conflict with this brief on AI voice, optional rights review, and publishing. Preserve real data and existing features, but follow the new brief.

## What exists
- React 19 / strict TypeScript / Vite dashboard, FastAPI / SQLite local engine, Chrome MV3 scouting extension.
- Studio lives in dashboard/src/studio, with a DOM preview and separate FFmpeg export. Timeline, saved projects, imported voice/music, text presets, audio extraction, local vocal separation and transitions exist.
- Local engine has script, TTS, transcription, SEO, download and media APIs. Several are disconnected from the editor UI.
- Scout stores metadata, not footage. Unknown-rights clips are locked; even unlocked clips need a separate source download. This explains the empty editor in the supplied screenshot.
- Eight-track / 100-item / 80-history limits, incomplete image support, mismatched preset validation and separate preview/export paths prevent the requested workflow.
- Existing Python, extension and Playwright tests are available. Chrome, node_modules and the Python environment exist locally.

Detailed independent findings: RECON-UI.md, RECON-MEDIA.md, RECON-INTEGRATION.md.

## Direction
Replace the Studio composition and styling. Retain proven local services while adding a shared browser renderer/export path. Use original presets and open-license fonts; no third-party editor branding/assets. Present limitations truthfully. The complete brief is larger than a cosmetic rewrite; nothing receives a passing score without evidence.
