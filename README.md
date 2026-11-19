# ShortForge

A local workspace for discovering, editing and publishing videos. Collect videos with a Chrome extension, organize them in Library, edit in native Concat, then publish or schedule on YouTube from ShortForge.

## Start on this Linux machine

```bash
cd ShortForge
./start.sh
```

The launcher opens a privately connected window at **http://127.0.0.1:8787**. The header should say **Engine connected**. Normal startup installs the app dependencies and automatically downloads and verifies Concat when it is missing on a supported platform. You do not need to install Concat separately. Later launches reuse verified runtimes and the reviewed dependency lock. Startup does not download speech models. Without automatic startup, Ctrl+C stops the engine; save your Concat edits before closing its window.

Automatic startup is installed on this machine. ShortForge runs in the background after desktop login, survives closing the terminal or browser, and restarts after a crash. Open **ShortForge** from the application menu or use `./start.sh` to open a fresh private connection to the same engine. It does not open a browser automatically at login.

To install this on another Linux desktop with systemd, run `python3 scripts/install-autostart.py` once. Stop it with `systemctl --user stop shortforge.service`, or disable automatic startup with `systemctl --user disable --now shortforge.service`. After source updates, use `systemctl --user restart shortforge.service` and reopen ShortForge. Logs are available with `journalctl --user -u shortforge.service -n 50`.

Startup checks JavaScript packages against the lockfiles and repairs stale or incomplete installs. It reuses the extension/dashboard build when inputs and output hashes are unchanged. An explicit `npm --prefix extension run build` forces a rebuild. The Library shows 50 videos per page; search covers all videos, and selections survive page/filter changes. See the [performance and quality results](docs/PERFORMANCE-RESULTS-2026-10-26.md).

Windows users start with `start.bat`. See [Concat setup and supported platforms](docs/CONCAT.md#setup). The native runtime is downloaded during setup; it is not included in a Git clone or source archive. No paid service is required. See [security and connection recovery](docs/SECURITY.md).

## Project documents

- [Documentation index](docs/README.md): setup, workflows, API contracts and design research.
- [Testing](docs/TESTING.md): setup, automated checks and manual verification.
- [Security](docs/SECURITY.md): private connections, credentials and runtime boundaries.
- [Codebase audit](docs/AUDIT-2026-10-30.md): security fixes, cleanup, concurrency improvements and validation.
- [Performance results](docs/PERFORMANCE-RESULTS-2026-10-26.md): earlier measured changes and verification limits.

## Your first edit

1. Click **Add a video → Upload footage** and choose a video you own or can use.
2. Click its Library picture or title, or **Edit** in table view. ShortForge shows launch progress in the current tab and opens a Concat desktop window with that video on a 1080×1920 timeline.
3. Edit using Concat's timeline and controls, then save in Concat. Reopening the same Library video preserves its saved edit.
4. Return to ShortForge's **Studio** page. Under **Publish to YouTube**, review the title, description, tags, channel and audience. Choose **Publish now** and visibility, or **Schedule** and a future date/time. ShortForge renders the saved edit locally and uploads the finished file. For a separate local copy, Concat's **Export** remains available.
5. Return to ShortForge and choose **Back to Library** to select another video. **Studio** in the sidebar opens Concat without selecting a Library clip.

Connect your channel once in **Settings → YouTube publishing**; see the [setup and scheduling guide](docs/YOUTUBE-PUBLISHING.md). Scheduled videos upload privately ahead of time, and YouTube makes them public at the chosen time. Keep ShortForge running and the laptop awake until uploading finishes; after YouTube confirms the schedule, the laptop can be off. See [Concat verification](docs/CONCAT.md#verification) for the latest checks.

Scout collects YouTube Shorts and Instagram Reels, optionally from a pasted creator account. Its local caption filter allows brief text (three seconds by default) and skips persistent or unchecked captions. For Scout, load `extension/dist` as an unpacked Chrome extension. See [the extension guide](extension/README.md).

## The Studio editor

Studio launches the real [Concat](https://github.com/jub0t/Concat) desktop application on the same computer as the local engine. ShortForge prepares the selected footage and reopens its saved project. Editing, file picking and saving happen in Concat's own window. Publishing uses Concat's local renderer in the background, one video at a time. The browser streaming integration has been removed.

The previous custom editor and its WebCodecs exporter were removed. Its caption repair and audio separation controls are not features of this integration. Concat's own tools and optional models follow its installed version. Opening, saving and ordinary manual exports never post automatically; publishing starts only from its explicit submit button.

Each Library video has an independent saved Concat project and media copy. Deleting its Library source does not destroy that edit. See [files and recovery](docs/CONCAT.md#files-and-recovery). Rights remain recorded metadata and do not gate editing.

This is a local, single-user workflow and requires a graphical desktop session. It does not provide an editor for remote website visitors.

## Formatting and checks

Formatting is automatic, so you never have to argue with indentation. From the project root:

```bash
npm ci               # once, installs the formatter
.venv/bin/python -m pip install -r requirements-dev.txt # test and lint tools
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

See the [documentation index](docs/README.md), [TESTING.md](docs/TESTING.md), and [change history](docs/PROGRESS.md).

- `dashboard/`: React + TypeScript + Vite, Library, Settings and Concat launch status.
- `engine/core/`: FastAPI, SQLite, jobs, files, Concat project preparation and desktop launch.
- `engine/ai/`: optional publish metadata and legacy provider compatibility.
- `engine/studio/`: shared media helpers and Scout caption/speech checks retained after the editor removal.
- `vendor/concat/`: managed upstream Concat source checkout; installed runtimes live in `data/runtime/`.
- `extension/`: Chrome MV3 Scout.
- `shared/contract/`: API contracts for all components.
- `scripts/`: the small helpers behind the checks above.
- `docs/`: the click-by-click testing checklist, change history and design research.
- `data/`: private local database, source footage, references and exports; ignored by Git.

Keys saved in Settings are encrypted; their key is kept in the system keyring or outside the project. `.env` remains an optional local configuration source (copy `.env.example`). Do not share `data/` or `.env`. No analytics, hosted account, or subscription is built into ShortForge.
