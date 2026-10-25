# ShortForge

A local workspace for discovering and editing videos. Collect videos with a Chrome extension, organize them in Library, and open them in the Concat desktop editor from ShortForge.

## Start on this Linux machine

```bash
cd ShortForge
./start.sh
```

Open **http://127.0.0.1:5173**. The header should say **Engine connected**. Normal startup installs the app dependencies and automatically downloads and verifies Concat when it is missing on a supported platform. You do not need to install Concat separately. Later launches reuse the downloaded runtime and check for a yt-dlp update. Startup does not download speech models. Press Ctrl+C to stop the dashboard and engine; save your Concat edits before closing its window.

Windows users start with `start.bat`. See [Concat setup and supported platforms](docs/CONCAT.md#setup). The native runtime is downloaded during setup; it is not included in a Git clone or source archive. No paid service is required.

## Your first edit

1. Click **Add a video → Upload footage** and choose a video you own or can use.
2. Click its Library picture or title, or **Edit** in table view. ShortForge shows launch progress in the current tab and opens a Concat desktop window with that video on a 1080×1920 timeline.
3. Edit using Concat's timeline and controls, then save in Concat. Reopening the same Library video preserves its saved edit.
4. Use **Export** in Concat to save the finished video to a folder on your computer.
5. Return to ShortForge and choose **Back to Library** to select another video. **Studio** in the sidebar opens Concat without selecting a Library clip.

See [Concat verification](docs/CONCAT.md#verification) for the latest checks. **Settings → YouTube publishing** still manages channel connections, but the previous editor's Publish to YouTube button and Publish kit were removed. Concat exports are not currently handed to that publishing interface.

Scout collects YouTube Shorts and Instagram Reels, optionally from a pasted creator account. Its local caption filter allows brief text (three seconds by default) and skips persistent or unchecked captions. For Scout, load `extension/dist` as an unpacked Chrome extension. See [the extension guide](extension/README.md).

## The Studio editor

Studio launches the real [Concat](https://github.com/jub0t/Concat) desktop application on the same computer as the local engine. ShortForge prepares the selected footage and reopens its saved project. Editing, file picking and export happen in Concat's own window. The browser streaming integration has been removed.

The previous custom editor and its WebCodecs exporter were removed. Its caption repair, audio separation and publishing controls are not features of this integration. Concat's own tools and optional models follow its installed version.

Each Library video has an independent saved Concat project and media copy. Deleting its Library source does not destroy that edit. See [files and recovery](docs/CONCAT.md#files-and-recovery). Rights remain recorded metadata and do not gate editing.

This is a local, single-user workflow and requires a graphical desktop session. It does not provide an editor for remote website visitors.

## Formatting and checks

Formatting is automatic, so you never have to argue with indentation. From the project root:

```bash
npm install          # once, installs the formatter
npm run format       # tidy every JavaScript, TypeScript, CSS and JSON file
npm run format:py    # tidy every Python file
npm run lint:py      # look for Python mistakes without changing anything
```

Use `npm run format:check` instead of `format` to see what would change without changing it. Hand-written Markdown is deliberately left alone, so your notes keep the line breaks you gave them.

Each part also has its own checks, which all have to pass before you push. Start in the project root and the three lines follow on from each other:

```bash
cd dashboard && npm run lint && npm run build && npx playwright test
cd ../extension && npm test && npm run build
cd .. && .venv/bin/python -m pytest engine/core/tests engine/studio engine/ai -q
```

## Verification and project map

See [TESTING.md](docs/TESTING.md), [PROGRESS.md](docs/PROGRESS.md), and [design research](docs/design-notes.md).

- `dashboard/`: React + TypeScript + Vite, Library, Settings and Concat launch status.
- `engine/core/`: FastAPI, SQLite, jobs, files, Concat project preparation and desktop launch.
- `engine/ai/`: optional publish metadata and legacy provider compatibility.
- `engine/studio/`: shared media helpers and Scout caption/speech checks retained after the editor removal.
- `vendor/concat/`: managed upstream Concat source checkout; installed runtimes live in `data/runtime/`.
- `extension/`: Chrome MV3 Scout.
- `shared/contract/`: API contracts for all components.
- `scripts/`: the small helpers behind the checks above.
- `docs/`: the click-by-click testing checklist, the progress log and the design records.
- `data/`: private local database, source footage, references and exports; ignored by Git.

Keys can be saved in Settings or `.env` (copy `.env.example`). Do not share `data/` or `.env`. No analytics, hosted account, or subscription is built into ShortForge.
