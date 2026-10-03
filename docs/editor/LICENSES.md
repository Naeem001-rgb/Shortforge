# Licenses and attribution

No third-party editor branding, templates, code, sounds or proprietary visual assets were copied. Official CapCut and Descript pages in RECON-UI.md are UX references only.

## Bundled browser dependencies

| Package | Version / scope | License | Source |
|---|---|---|---|
| React / react-dom | installed lockfile,19.x | MIT | https://github.com/facebook/react |
| Vite | installed lockfile,6.x build tool | MIT | https://github.com/vitejs/vite |
| TypeScript | installed lockfile,5.7 build tool | Apache-2.0 | https://github.com/microsoft/TypeScript |
| Tailwind CSS | installed lockfile,4.x build tool | MIT | https://github.com/tailwindlabs/tailwindcss |
| Lucide | installed lockfile,0.468.x | ISC | https://github.com/lucide-icons/lucide |
| Inter / @fontsource-variable/inter | installed lockfile,5.2.x font | OFL-1.1 | https://github.com/rsms/inter |
| mp4-muxer | **5.2.2**, exact pin | MIT | https://github.com/Vanilagy/mp4-muxer |
| webm-muxer | **5.1.4**, exact pin | MIT | https://github.com/Vanilagy/webm-muxer |
| mp4box | **2.4.1**, exact pin | BSD-3-Clause | https://github.com/gpac/mp4box.js |

The two muxers are deprecated in favor of Mediabunny. Mediabunny currently uses MPL-2.0 and was excluded under the owner's permissive-only adoption rule. The pinned MIT implementations are contained behind `engine/exportProject.ts` and tested using independently decoded video/audio. This maintenance trade-off is explicit, not a claim that they are currently maintained. MP4Box handles container parsing only; no GPAC GPL executable is bundled.

## Fonts bundled locally

Every font file and full license is under both `dashboard/public/fonts/` and `engine/studio/fonts/caption-pack/`, so browser and local export use the same font assets. Exact downloaded binary source URLs, byte sizes and selected weights are recorded in each `manifest.json`. Sources are Google Fonts' official distribution and https://github.com/google/fonts . These 20 fonts use **SIL Open Font License 1.1**; each `.LICENSE.txt` retains its copyright/reserved-name notice.

Montserrat; Anton; Bebas Neue; Oswald; Poppins; Roboto Condensed; Lato; Nunito Sans; Space Grotesk; DM Sans; Barlow Condensed; Archivo Black; Playfair Display; Libre Baskerville; DM Serif Display; IBM Plex Mono; Caveat; Permanent Marker; Righteous; Rubik.

Inherited DejaVu Sans remains bundled under its permissive Bitstream/DejaVu license in `engine/studio/fonts/LICENSE`. Inter's font package retains its OFL license in node_modules and the package lock.

## Original templates, stickers and audio

- Ten starter templates, caption recipes and clip animation/transition shaders are original ShortForge code. No template was imported from another editor.
- Text callout stickers and geometric sticker images are generated from original code in EditorAssetPanels.tsx. They contain no third-party image assets.
- **Original audio pack, CC0-1.0:** three 24-second beds (After hours, Quiet momentum, Small wonders) and six effects (Soft pop, Gentle ding, Whoosh, Tap, Low impact, Rising chime). `dashboard/public/audio/LICENSE.txt` contains the notice; `scripts/generate-studio-audio.py` contains the reproducible synthesis source. No sampled recording or external melody is used.
- NumPy (BSD-3-Clause) and a local FFmpeg binary are development-time synthesis tools; their executable code is not embedded in the MP3 files.

## Local services and optional runtimes

FastAPI and Pydantic are MIT; SQLite is public domain; Python runtime uses PSF licensing. yt-dlp uses the Unlicense for its own code with separately licensed dependencies. Existing installed FFmpeg reports `--enable-gpl --enable-version3`; it is an externally installed executable, **not redistributed inside the extension**. Do not advertise an all-permissive FFmpeg binary. See engine requirement files and installed package metadata for the exact local environment.

Local transcription uses faster-whisper1.2.1 (MIT), CTranslate2 (MIT), PyAV15.1.0 (BSD-3-Clause) and a tiny.en Whisper model (OpenAI Whisper MIT). `setup_transcription.py` creates a separate Python3.12 environment/model cache locally. The model is not remotely executed and is not extension-hosted code. PyAV/FFmpeg-linked binary distribution retains upstream license obligations. Optional Demucs separation (MIT code/model terms in existing separation module) remains in its separate existing runtime.

## QA-only licensed footage / tools (not shipped)

The **Sintel trailer** is Blender Foundation content under CC BY3.0: https://durian.blender.org/ and https://www.sintel.org/ . Downloaded official source: https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4 . Temporary acceptance clips/exports remain under `/tmp` or ignored Playwright test-results. Attribution for any separately shared sample export: “Sintel, © Blender Foundation | www.sintel.org, CC BY3.0. Excerpt used for ShortForge testing.” No test footage was added to the owner's real Library or bundled app.

QA used temporary FFmpeg/ffprobe7.0.2-static from https://johnvansickle.com/ffmpeg/; it is not committed or bundled. QA-EVIDENCE.md records its archive checksum. Synthetic regression fixtures are visibly named synthetic and generated only in isolated test data.
