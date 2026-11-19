# Historical browser-editor attribution (September–October 2026)

The custom browser editor, caption repair and audio separation interfaces were removed in October 2026. This record preserves attribution for previously generated media and any locally retained models or runtimes. See [Concat](../CONCAT.md) for current editing.

## Former browser dependencies

| Package | Historical version | License | Source |
| --- | --- | --- | --- |
| React / react-dom | 19.x | MIT | https://github.com/facebook/react |
| Vite | 6.x | MIT | https://github.com/vitejs/vite |
| TypeScript | 5.x | Apache-2.0 | https://github.com/microsoft/TypeScript |
| esbuild | 0.25.x | MIT | https://github.com/evanw/esbuild |
| Lucide | 0.468.x | ISC | https://github.com/lucide-icons/lucide |
| Inter / @fontsource-variable/inter | 5.x | OFL-1.1 | https://github.com/rsms/inter |
| mp4-muxer | 5.2.2 | MIT | https://github.com/Vanilagy/mp4-muxer |
| webm-muxer | 5.1.4 | MIT | https://github.com/Vanilagy/webm-muxer |

This historical list does not describe the current dashboard manifest. The removed editor used CapCut and Descript pages only as UX references; it did not copy their branding, templates, code, sounds or proprietary artwork.

## Former fonts and original audio

The former caption pack used SIL Open Font License 1.1 fonts from [Google Fonts](https://github.com/google/fonts), with per-font copyright and reserved-name notices: Montserrat, Anton, Bebas Neue, Oswald, Poppins, Roboto Condensed, Lato, Nunito Sans, Space Grotesk, DM Sans, Barlow Condensed, Archivo Black, Playfair Display, Libre Baskerville, DM Serif Display, IBM Plex Mono, Caveat, Permanent Marker, Righteous and Rubik. DejaVu Sans carried the Bitstream/DejaVu license. Retained copies must keep their original notices. Current Scout Inter attribution remains in [OFL.txt](../../extension/static/fonts/OFL.txt).

The original audio pack was supplied under CC0-1.0: three 24-second beds (After hours, Quiet momentum, Small wonders) and six effects (Soft pop, Gentle ding, Whoosh, Tap, Low impact, Rising chime). These were synthesized without sampled recordings or external melodies. NumPy (BSD-3-Clause) and FFmpeg were synthesis tools, not executable code embedded in the MP3 files. Templates, stickers and animation recipes were original ShortForge code.

## Local services and models

FastAPI and Pydantic use MIT; SQLite is public domain; Python uses PSF licensing. yt-dlp uses the Unlicense for its own code, with separately licensed dependencies. The historical FFmpeg build enabled GPL/version3; it was an external local executable, not redistributed in the extension. FFmpeg and PyAV-linked binary distributions retain their upstream obligations.

The former transcription setup used faster-whisper 1.2.1 (MIT), CTranslate2 (MIT), PyAV 15.1.0 (BSD-3-Clause) and OpenAI's tiny.en Whisper model (MIT). The former separation setup used [Demucs](https://github.com/facebookresearch/demucs) 4.0.1 and its MIT-licensed `htdemucs` model, filename `955717e8-8726e21a.th`, with CPU PyTorch and TorchAudio 2.5.1.

The reconstruction model was [MI-GAN](https://github.com/Picsart-AI-Research/MI-GAN) by Picsart AI Research (PAIR), using the [author's ONNX pipeline](https://huggingface.co/andraniksargsyan/migan). Code and weights are MIT; the full copyright notice is retained verbatim in [MI-GAN.txt](MI-GAN.txt).

- Pinned revision: `406830d0fa60666da0071c342ad2fbc8f30c5c64`.
- Model: `migan_pipeline_v2.onnx`.
- SHA-256: `6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b`.

Text detection used RapidOCR (Apache-2.0), PaddleOCR PP-OCRv6 detection/recognition models (Apache-2.0), onnxruntime (MIT), OpenCV (Apache-2.0) and NumPy (BSD-3-Clause). Model files were installed locally rather than committed or redistributed. Retained files keep their license obligations after interface removal.

## QA-only footage and tools

The [Sintel trailer](https://durian.blender.org/) is Blender Foundation content under CC BY 3.0. The official source was https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4. Attribution for a separately shared sample export: “Sintel, © Blender Foundation | www.sintel.org, CC BY 3.0. Excerpt used for ShortForge testing.” No licensed footage was bundled with ShortForge.

Temporary FFmpeg/ffprobe 7.0.2-static came from https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz, archive SHA-256 `abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67`. Those QA tools and generated outputs were not committed or bundled.
