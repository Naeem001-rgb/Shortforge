# Local soundtrack and vocal tools

Studio's **Extract audio** decodes the selected media's full original soundtrack to stereo 44.1 kHz WAV with FFmpeg. It does not use a model. It creates a separate media asset, and Studio mutes the original video when placing the extracted audio on the timeline. **Mute original audio** removes the whole soundtrack from playback/export without changing the source file.

**Isolate voice** and **Remove voice** run the actual local Demucs `htdemucs` model. The first action uses the vocal estimate. The second uses the original soundtrack minus that estimate, retaining background music and ambient sound as far as the model permits. Both stems remain in the project's media bin. This is vocal/music demixing, not perfect speech-only isolation: singing may also be removed, and some voice or music can bleed into the other stem. Preview the result before exporting.

## Setup

On this Linux checkout the CPU runtime and verified model are installed. For a new checkout, run explicitly from the project directory:

```bash
bash scripts/setup-separation.sh
```

The script installs an isolated Python 3.12 runtime under `data/runtime/separation`, pinned CPU-only PyTorch and TorchAudio 2.5.1, Demucs 4.0.1, and the single 84.1 MB `htdemucs` checkpoint under `data/models/demucs`. It verifies the model SHA-256 before loading. Allow about 1 GB of disk for the runtime, dependencies, and model. It uses no CUDA packages and requires no API key or paid service. Files remain local during inference. The regular engine's Python environment is unchanged apart from the setup tool `uv`.

Custom installations can set `SHORTFORGE_SEPARATION_PYTHON` and `SHORTFORGE_SEPARATION_MODEL_DIR`. The model folder must contain `955717e8-8726e21a.th`. Restart the engine after installing or repairing its runtime. Importing the engine, opening Studio, and checking `/api/editor-capabilities` never download models. They inspect only the installed runtime and checksum. Missing dependencies give an actionable setup message.

## Runtime and limits

One audio job runs at a time, using two CPU threads in a subprocess. Four-second windows with 25% overlap are normalized and overlap-added, then written incrementally; the server does not retain the model or the full four-source output in memory. Sources are limited to ten minutes for these tools. Short clips may still take several minutes on a modest laptop. A worker exceeding one hour is stopped with an error. No source files are overwritten, and deleting a timeline item does not delete imported media.

Endpoints follow `docs/editor-contract.md`. Audio ownership, source existence, soundtrack presence, duration, and the existing editable-rights gate are checked before work is queued. The rights gate is checked again before saving finished assets. Errors clean up partial output files and asset rows. Tests use temporary projects, not the user's library.

## Verification

```bash
.venv/bin/python -m pytest engine/studio/test_separation.py -q
SHORTFORGE_TEST_SEPARATION=1 .venv/bin/python -m pytest engine/studio/test_separation.py -q
```

The first command tests extraction with real FFmpeg, isolation/cleanup/gates, and missing-runtime behavior. The opt-in second command additionally runs the real model on a short deterministic mixed-tone fixture and verifies stem duration, nontrivial separation, and reconstruction. That confirms inference and output handling; it does not assert perfect human-speech quality. Ordinary tests never fetch the model.

During implementation, an additional 3.4-second spoken sample from the [official TorchAudio audio tutorial](https://docs.pytorch.org/audio/2.5.0/tutorials/audio_io_tutorial.html) was mixed with a known three-tone accompaniment and processed with this worker. It completed in 10.45 seconds. Least-squares projection against the known inputs measured about 39 dB of speech attenuation in the remaining-music stem and a 1.004 accompaniment coefficient. The two stems reconstructed the mixture within one 16-bit PCM step. This is evidence for that controlled sample only, not a promise for arbitrary shorts; mixed speech, singing, sound effects, and strong compression can separate less cleanly. Local review files are in the ignored `.impeccable/review/audio` folder, and no library clip was modified.

Implementation references: [official Demucs documentation](https://github.com/facebookresearch/demucs), [PyTorch's CPU installation versions](https://pytorch.org/get-started/previous-versions/). Demucs and its model are supplied under the project's MIT license; its upstream repository is archived.
