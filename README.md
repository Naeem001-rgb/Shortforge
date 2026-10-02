# ShortForge

A local creative workspace for video editing. Discover videos with a Chrome extension, organize references, edit footage on a multitrack timeline, import your own voiceovers and music, animate with keyframes, and export an MP4. Scripts and voiceovers are made with your external tools.

## Start on this Linux machine

```bash
cd ShortForge
./start.sh
```

Open **http://127.0.0.1:5173**. The header should say **Engine connected**. The first launch installs the small app dependencies and a packaged FFmpeg binary; it does not download speech models. Later launches check for a yt-dlp update. Press Ctrl+C to stop.

Windows: install Node.js LTS and Python (3.11 recommended for optional speech tools), then double-click `start.bat`. Close its engine window when finished. All required dependencies are free; no paid service is required.

## Your first edit

1. Click **Add a video → Upload footage** and choose a video you own or can use.
2. Open it in **Studio**. The source appears on the timeline. Select a clip to reveal its timing, transform, audio, animation, and keyframe controls.
3. Open **Audio** to import your own voiceover/music, extract the original soundtrack, mute all original audio, or separate vocals from music.
4. Drag clips to move them, drag their edges to trim, and use **Split at playhead**, **Delete**, **Undo**, and **Redo**. Add timed text or import SRT captions from **Text**.
5. Use **Export → Export MP4**, select a resolution, and download the completed video. Edits autosave locally; **Save project** saves immediately.
6. Optional: generate a **Publish kit** from your finished external script or video summary, then upload manually in YouTube Studio.

For Scout, load `extension/dist` as an unpacked Chrome extension. See [the extension guide](extension/README.md).

## The Studio editor

- Separate media bin, player, inspector, and zoomable multitrack timeline.
- Trim, split, move, duplicate, delete, speed, volume, audio fades, and undo/redo.
- Position, scale, rotation, opacity, and volume keyframes with interpolation/easing.
- Fade, slide, and zoom entrance/exit animations; timed text and imported SRT captions.
- Local voiceover/music uploads and non-destructive original-audio extraction.
- Optional local Demucs vocal/instrumental separation. It is installed on this development machine; see [audio separation setup](docs/AUDIO-SEPARATION.md) for another machine. Separation can leave artifacts and is not guaranteed to perfectly remove speech from every mix.
- Portrait, landscape, or square canvas; CPU H.264/AAC MP4 exports at 480p, 720p, or 1080p.
- Server-side project saving, restored project selection, light/dark/system themes.

The editor implements these tools directly; it is not the full CapCut product. Stock effects/templates, cloud collaboration, tracking, and advanced masking are not implemented. Timelines currently allow eight tracks, 100 items, and ten minutes. Removing a timeline clip leaves its original file in the media bin. Deleting a Library project permanently deletes its project-owned media.

Studio does not write scripts or synthesize voices. Editing and rendering need no API key. Existing local records and legacy backend API compatibility are preserved. Gemini is optional for publish metadata and YouTube Data API is optional for discovery verification. Unknown external clips retain their existing footage-permission gate; importing your own footage starts an editable project.

## Verification and project map

See [TESTING.md](docs/TESTING.md), [PROGRESS.md](docs/PROGRESS.md), and [design research](docs/design-notes.md).

- `dashboard/`: React + TypeScript + Vite + Tailwind, local Inter font.
- `engine/core/`: FastAPI, SQLite, jobs, files and permissions.
- `engine/ai/`: optional publish metadata and legacy provider compatibility.
- `engine/studio/`: timeline persistence, media/audio processing, and FFmpeg rendering.
- `extension/`: Chrome MV3 Scout.
- `shared/contract/`: API contracts for all components.
- `data/`: private local database, source footage, references and exports; ignored by Git.

Keys can be saved in Settings or `.env` (copy `.env.example`). Do not share `data/` or `.env`. No analytics, hosted account, or subscription is built into ShortForge.
