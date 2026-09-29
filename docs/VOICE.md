# Voice and speech setup — free options first

The app runs on this machine's Python 3.14. Optional speech libraries have narrower compatibility. **Use Python 3.11 or 3.12 for the engine environment if you want local transcription or synthesis; upstream Chatterbox recommends 3.11.** Packages and models must be installed into the same environment that starts the engine. A disconnected environment will not make a provider appear ready.

No speech models or large machine-learning dependencies were installed during the build. Saving a reference recording does not mean a model has been installed or trained. Model setup may require gigabytes and CPU generation can be slow; choose this separately when disk space and memory allow.

## Piper: ordinary local voiceover

1. Install `piper-tts` into the engine environment: `.venv/bin/python -m pip install piper-tts`.
2. Choose a voice from the [official Piper voice guide](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md). Read its model card; each voice can have different licensing requirements.
3. Download that voice's `.onnx` and matching `.onnx.json` files into a folder you choose.
4. In Settings, set **Piper voice model path** to the `.onnx` file, and save.
5. In Voice lab, choose the ready Piper voice, a project and a script, then Generate voiceover.

Piper's engine is GPL-3.0. A permissive engine license does not replace checking the individual voice model's terms. Piper voices are generally much lighter than cloning models. The app supports 0.9–1.1× speaking speed.

## Chatterbox: your reusable cloned voice

The [Chatterbox code](https://github.com/resemble-ai/chatterbox) and [model card](https://huggingface.co/ResembleAI/chatterbox) use the MIT license. The lighter [Nano model card](https://huggingface.co/ResembleAI/chatterbox-nano) also states MIT. Native audio watermarking is retained.

1. In Voice lab, choose **Add your voice**. Upload a clear 6–30-second recording under 20 MB. Use your own voice or one the speaker authorized.
2. Name it and confirm consent. The reference is now saved for later use; this does not train a model.
3. When you are ready for the large optional installation, follow the upstream [Chatterbox install instructions](https://github.com/resemble-ai/chatterbox) in the engine's Python 3.11 environment. Download local model files explicitly.
4. Set **Chatterbox model folder** in Settings to the downloaded directory. Required local filenames are documented in [engine/ai/README.md](../engine/ai/README.md).
5. Select your profile in Voice lab and Generate voiceover. The app loads the configured files locally with no automatic model downloads.

This adapter was tested for readiness, consent and file lifecycle, but actual neural synthesis has not been exercised on this machine because the model is not installed. CPU performance depends on available RAM and the selected model. A voice profile that says **model needed** is not ready to generate.

## Transcription and word timing

Install `faster-whisper` into the engine environment if desired. Download a `base` model explicitly before use. For example, after choosing to download it:

```bash
.venv/bin/python -m pip install faster-whisper
.venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"
```

That final command intentionally downloads a model. The app itself always loads Whisper offline and never starts a hidden model download. A local model directory may also be supplied through the `WHISPER_MODEL` environment variable. Base is the lighter default; small uses more resources.

New voiceovers are aligned to their own audio when Whisper is available. Otherwise ShortForge reports **approximate caption timing**, based on the new script and recording length. Review the exported video before posting. Speed can be adjusted by ±10%; shorten the script or trim footage if the durations differ substantially.

## Online alternatives

- **Gemini 3.8 Flash:** optional rewriting and SEO. [Google's model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash/) documents the exact model ID and says audio generation is not supported. Use Piper or Chatterbox for voice.
- **Gemini free quota:** [Google documents project/model-specific limits](https://ai.google.dev/gemini-api/docs/rate-limits). A fixed 1,500-request allowance is not guaranteed. Keep billing disabled on your chosen Google project if you want a free-only setup. Text leaves your machine only when you request an AI operation.
- **Edge TTS:** free unofficial service integration, installed separately with `edge-tts`. Availability can change; no commercial-use assurance is inferred from its Python package license. Uses an online Microsoft endpoint when you generate.
- **ElevenLabs:** optional only. Its [free plan does not grant commercial rights](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform). A suitable paid plan would be needed for monetized output; there is no need to use it.

Licensing sources checked September 29, 2026. You do not need any paid provider to run the local app.
