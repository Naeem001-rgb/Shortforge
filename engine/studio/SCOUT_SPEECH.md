# Scout speech screening

Run `.venv/bin/python -m engine.studio.setup_scout_speech` from the project root
(Windows: `.venv\Scripts\python -m engine.studio.setup_scout_speech`). This explicit
setup downloads only a 2,327,524-byte ONNX model into
`data/models/scout-speech/`; `--check` only checks local readiness. Scout itself
never downloads a model. NumPy, ONNX Runtime and FFmpeg must already be
installed. It uses CPU inference without PyTorch, accounts, keys or paid tools.
It uses FFprobe when present, or the bundled FFmpeg's input metadata and full
video decode when FFprobe is unavailable. Audio timestamps and sample counts
are verified in both cases.

The model is [Silero VAD v6.2](https://github.com/snakers4/silero-vad/releases/tag/v6.2),
pinned to commit `be95df9152c0d7618fa1edfeb296fc3dae32376f`, from the
[official model path](https://github.com/snakers4/silero-vad/blob/be95df9152c0d7618fa1edfeb296fc3dae32376f/src/silero_vad/data/silero_vad.onnx).
SHA-256: `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`.
The source Git blob was independently checked as
`80c5592ef1f4c9ede3e357bbd02eb863358a6a9d` when pinning the download.
The recurrent input/state/context convention follows the
[upstream ONNX wrapper](https://github.com/snakers4/silero-vad/blob/be95df9152c0d7618fa1edfeb296fc3dae32376f/src/silero_vad/utils_vad.py).

Scout checks the original combined video/audio, verifies frame and audio coverage,
and decodes the entire audio to mono 16 kHz. Model windows span the full track.
The conservative speech rule uses probabilities 0.5/0.35, speech segments of at
least 128 ms, and a 96 ms silence boundary. It estimates speech rather than
identifying narration: music/singing can cause rejections; quiet, masked, very
brief or stereo-cancelled speech can be missed. It cannot prove that speech is
absent. Files with unverifiable duration, multiple audio tracks, decode failures
or missing coverage are skipped. The downloader must separately establish a
genuinely silent source before a verified video with no audio track can pass;
a video-only rendition of an audible clip is not evidence of silence.

The model and upstream wrapper use the MIT license below. This allows local and
commercial use, subject to retaining the notice.

```text
MIT License

Copyright (c) 2020-present Silero Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
