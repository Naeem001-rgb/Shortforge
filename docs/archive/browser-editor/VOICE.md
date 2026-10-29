# Voice and speech setup — free options first

> Historical browser-editor documentation. These interfaces were removed. See [current Studio setup](../../CONCAT.md).

The app runs on this machine's Python 3.14. Optional speech libraries have narrower compatibility. Transcription no longer needs you to downgrade anything: its installer builds a small separate environment of its own and accepts Python 3.11, 3.12 or 3.13. Chatterbox still wants its own Python 3.11 environment, as upstream recommends. Anything you install by hand must go into the same environment that starts the engine, or the provider will not appear ready.

Models are never fetched behind your back: no page visit, generation request or capability check downloads one. Every model on this machine arrived because somebody ran its installer on purpose. Saving a reference recording does not mean a model has been installed or trained. Model setup may require gigabytes and CPU generation can be slow; choose each one separately when disk space and memory allow.

On this laptop, that has already happened for several of them. `data/models` currently holds the `tiny.en` Whisper model for transcription, the Demucs checkpoint for voice separation, the MI-GAN model for caption clean-up and the small Scout speech model, with their isolated runtimes under `data/runtime`. Together they are a few hundred megabytes, and none of them is committed to the repository — a fresh checkout starts with none of them.

## Where the controls are

Narration lives in Studio. Open a project, open the **Audio** tab in the left-hand bin, and scroll to **Script and voice**. That one panel holds the script box, the microphone recorder, the voice list, the speed slider and the Generate button. There is no separate "Voice lab" page.

Two settings on this page have no box in the Settings screen yet: the Piper model path and the Chatterbox model folder. They are stored by the engine, so for now you set them with a request to the local engine rather than a click — the exact call is given in each section below. Voice cloning is in the same position: the engine accepts a reference recording, but the dashboard has no **Add your voice** button to send one yet.

## Available now: basic local voice

This laptop already has eSpeak NG installed. In **Script and voice**, choose **eSpeak · basic local voice**, paste your script and Generate. It works without an API key or model download. Its sound is noticeably synthetic; use it to try the full workflow at no cost. Piper and Chatterbox offer the optional neural-voice paths below. A real eSpeak generation was tested during development.

## Piper: ordinary local voiceover

1. Install `piper-tts` into the engine environment: `.venv/bin/python -m pip install piper-tts`.
2. Choose a voice from the [official Piper voice guide](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md). Read its model card; each voice can have different licensing requirements.
3. Download that voice's `.onnx` and matching `.onnx.json` files into a folder you choose.
4. Point the engine at the `.onnx` file. With ShortForge running, in a terminal:

   ```bash
   curl -X PUT http://127.0.0.1:8787/api/settings \
     -H 'Content-Type: application/json' \
     -d '{"piper_model": "/full/path/to/your-voice.onnx"}'
   ```

5. In **Script and voice**, press the refresh button beside the voice list, choose **My local Piper voice**, and Generate.

Piper's engine is GPL-3.0. A permissive engine license does not replace checking the individual voice model's terms. Piper voices are generally much lighter than cloning models. Speaking speed is adjustable from 0.70× to 1.20×.

## Chatterbox: your reusable cloned voice

The [Chatterbox code](https://github.com/resemble-ai/chatterbox) and [model card](https://huggingface.co/ResembleAI/chatterbox) use the MIT license. The lighter [Nano model card](https://huggingface.co/ResembleAI/chatterbox-nano) also states MIT. Native audio watermarking is retained.

**This path is not finished.** The engine will accept and store a reference recording and will generate from it, but the dashboard has no screen for either step yet, so there is nothing to click. What follows describes the engine side so the record is accurate; treat it as unfinished rather than as instructions for today.

1. The engine accepts a reference recording at `POST /api/voices/clone` — one clear 6–30-second recording under 20 MB, with a name and an explicit consent flag. Use your own voice or one the speaker authorized. Saving a reference does not train a model.
2. For the large optional installation, follow the upstream [Chatterbox install instructions](https://github.com/resemble-ai/chatterbox) in the engine's Python 3.11 environment. Download local model files explicitly.
3. Point `clone_model_path` at the downloaded directory with the same `PUT /api/settings` call shown for Piper above. Required local filenames are documented in [engine/ai/README.md](../../../engine/ai/README.md).
4. Generation then loads the configured files locally, with no automatic model downloads.

This adapter was tested for readiness, consent and file lifecycle, but actual neural synthesis has not been exercised on this machine because the model is not installed. CPU performance depends on available RAM and the selected model. A voice profile that says **model needed** is not ready to generate.

## Transcription and word timing

The supported way to install local transcription is the explicit installer, which builds its own small Python environment under `data/runtime/transcription` and leaves the engine's `.venv` alone:

```bash
python3.12 engine/studio/setup_transcription.py --download-model
```

Run it with Python 3.11, 3.12 or 3.13. It installs `faster-whisper` 1.2.1 and PyAV 15.1.0 and, because of the `--download-model` flag, deliberately downloads one model — `tiny.en` unless you pass `--model base` or `--model small`. Restart the engine afterwards.

A plain `faster-whisper` in the engine's own environment also still works as a fallback:

```bash
.venv/bin/python -m pip install faster-whisper
.venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"
```

That final command intentionally downloads a model. The app itself always loads Whisper offline and never starts a hidden model download. A local model directory may also be supplied through the `SHORTFORGE_WHISPER_MODEL` environment variable. The stored default is `base`; a separately installed `tiny.en` is used in its place while the default is untouched, and `small` uses more resources than either.

New voiceovers are aligned to their own audio when Whisper is available. Otherwise ShortForge reports **approximate caption timing**, based on the new script and recording length. Review the exported video before posting. Speaking speed can be moved between 0.70× and 1.20×; shorten the script or trim footage if the durations differ substantially.

## Online alternatives

- **Gemini 3.8 Flash:** optional rewriting and SEO. [Google's model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash/) documents the exact model ID and says audio generation is not supported. Use Piper or Chatterbox for voice.
- **Gemini free quota:** [Google documents project/model-specific limits](https://ai.google.dev/gemini-api/docs/rate-limits). A fixed 1,500-request allowance is not guaranteed. Keep billing disabled on your chosen Google project if you want a free-only setup. Text leaves your machine only when you request an AI operation.
- **Edge TTS:** free unofficial service integration, installed separately with `edge-tts`. Availability can change; no commercial-use assurance is inferred from its Python package license. Uses an online Microsoft endpoint when you generate.
- **ElevenLabs:** optional only. Its [free plan does not grant commercial rights](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform). A suitable paid plan would be needed for monetized output; there is no need to use it.

Licensing sources checked September 29, 2026. You do not need any paid provider to run the local app.
