# Concat Studio

ShortForge opens the real [Concat editor](https://github.com/jub0t/Concat) in its own desktop window on the computer running the local engine. Selecting a Library video prepares its Concat project and opens it for editing. The browser streaming integration was removed on October 25 at the user's request.

## Use it

1. Start ShortForge normally and reload the Scout extension after updating its build.
2. Click a saved video's picture or title in Library, or use **Edit** in table view. ShortForge shows launch progress in the current browser tab, downloads the source if needed, and opens Concat with that video on a 1080×1920 timeline.
3. Save your changes in Concat. Clicking the same Library video again reopens that project without resetting its edits.
4. Use Concat's **Export** controls to save the finished video to a folder on your computer.
5. Return to ShortForge and choose **Back to Library** to select another video. The sidebar's **Studio** button opens Concat independently; **More about** and **Details** still open Library information and permission notes.

Save in Concat before closing its window. Closing the browser tab does not close the native editor. Opening Studio does not download Concat's optional AI models.

## Setup

Run `./start.sh` on Linux/macOS or `start.bat` on Windows. Normal setup automatically downloads the pinned official Concat 0.2.8 release, checks its SHA-256 checksum, and installs a project-managed runtime when no working installation is found. You do not install Concat separately. The first download requires internet access; later starts reuse the installed runtime and cached archive under `data/runtime/concat/`.

Supported download paths:

| Platform | Runtime setup |
| --- | --- |
| Linux x86_64 or aarch64 | Extract the official AppImage under `data/runtime/concat/v0.2.8/`. |
| Windows x86_64 | Run the official installer silently for the current user under `data/runtime/concat/v0.2.8/windows/`. Windows ARM64 uses the same x64 build through Windows emulation. |
| macOS Apple silicon or Intel | Mount the matching official DMG read-only and copy `Concat.app` under `data/runtime/concat/v0.2.8/`. |

A working existing Concat installation is reused. `CONCAT_PATH` in `.env` can select another executable or AppImage; an invalid explicit path produces a configuration error instead of silently choosing another installation. If setup fails, Library and Scout can still start, and the next normal startup retries. Concat requires a graphical desktop session on the engine's computer.

To check or retry setup manually from the project root:

```sh
.venv/bin/python scripts/setup-concat.py --check
.venv/bin/python scripts/setup-concat.py
```

On Windows, use `.venv\Scripts\python.exe` in place of `.venv/bin/python`.

The upstream source checkout is already at `vendor/concat/` on this machine and keeps its Git metadata and AGPL license. `scripts/setup-concat.py --source` recreates the pinned source checkout when needed for development. Editing uses the downloaded native runtime; cloning the source is not a required installation step.

The managed source checkout and runtime binaries are ignored by ShortForge's Git and formatters. They are not included just by sharing a Git clone or source archive. A fresh copy gets its runtime through the normal setup download. `vendor/concat-release.json` records the pinned source revision, official release URLs and checksums.

## Files and recovery

Each Library clip gets an independent project under `data/concat/projects/<clip-id>/edit/`. Its media copy is kept beside that folder. Deleting the Library source does not destroy an existing Concat edit or its media, and does not reclaim that separate edit's disk space. Existing Concat projects created during the browser-streaming implementation remain usable. Timelines from the removed custom editor are not automatically converted to Concat.

Source acquisition or launch failures appear in Studio with a retry action. Preparing a new project uses a temporary folder and publishes it only after Concat imports, places, saves, and closes the video successfully. Existing project files are reopened without reimporting their source or resetting saved edits.

File picking, editing and export use Concat's native controls on the local computer. ShortForge no longer forwards exports through a browser download. The old ShortForge Publish to YouTube/Publish kit interface was removed with the previous editor; YouTube channel Settings and backend services remain, but there is no Concat-to-publishing handoff.

This is a local, single-user desktop workflow. It does not provide an editor for remote website visitors.

## Verification

The native interoperability check imports real video, checks the vertical timeline, saves an edit, reopens it without resetting it, and checks that its media survives deletion of the Library source:

```sh
SHORTFORGE_TEST_CONCAT=1 .venv/bin/python -m pytest engine/core/tests/test_concat.py -q
```

On October 25, the real Library button opened the previously selected video in desktop Concat with no new browser tab or streaming request; the saved project manifest was unchanged. The native tests passed real import/save/reopen and desktop launch checks. Linux setup checks, installer failure/retry tests, dashboard tests and both builds passed; counts are recorded in [PROGRESS.md](PROGRESS.md). The October 24 browser tests are historical evidence for the removed streaming approach. Windows/macOS installers were tested with fixtures but not executed on those systems. Full native editing/export and optional AI tools were not retested during this revert.
