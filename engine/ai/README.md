# Writing and voice integrations

Nothing here downloads a speech model, installs a library, or calls a paid provider on startup. Provider requests run only when the user presses the relevant action. Script text is sent to the selected cloud provider; local audio references stay on the computer.

## Gemini

Set `gemini_api_key` and `gemini_model` in Settings. The default model is `gemini-3.8-flash`; available models and free quota depend on the user's Google project. No promise of 1,500 requests per day is made. The adapter uses Google's [generateContent REST API](https://ai.google.dev/api/generate-content) with the key in a request header, and requests JSON output for SEO. Rewrite counts are checked locally, with at most two corrective retries. An unsuccessful third result is returned with `within_tolerance: false`, never a false success. Original mode uses the topic/title/description only and has no same-length requirement.

## Piper: default CPU narration

The [Piper engine](https://github.com/OHF-Voice/piper1-gpl) is GPL-3.0. Install `piper-tts` into the engine's Python environment separately, then obtain a voice `.onnx` file and matching `.onnx.json` file. Select the `.onnx` path in Settings. The app invokes the [documented CLI](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/CLI.md) locally and supports speed from 0.9–1.1. Read that voice's `MODEL_CARD` before choosing it for monetized videos: the [official voice documentation](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md) explains that each voice can have different restrictions. No speech-model files are bundled. Studio separately bundles an openly licensed subtitle font.

## eSpeak: basic voice without a model download

If `espeak-ng` or `espeak` is already installed, **eSpeak · basic local voice** is immediately available for English narration. It runs on CPU, needs no API key, and has a clearly synthetic sound. It is not a neural model or a cloned voice. Piper remains the default option for users who install a neural voice model.

The app passes text over stdin to the existing executable and saves a WAV file. Speed is 175 words per minute multiplied by the selected 0.9–1.1 speed setting. Pitch remains at 0 in this adapter. Captions use the new audio's duration and are labeled approximate when a local Whisper model is unavailable.

[eSpeak NG](https://github.com/espeak-ng/espeak-ng) is maintained by the eSpeak NG developers and derives from Jonathan Duddington's eSpeak. Its engine is distributed under [GPL version 3 or later](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING). ShortForge invokes the separately installed program; it does not bundle the engine, install a subscription, or require a paid voice plan. The source script remains the user's responsibility.

## Your own voice: optional local Chatterbox

Uploading a reference saves a reusable voice profile and speaker-consent record; it does not train a new model. Use a clear recording, 6–30 seconds and under 20 MB, of your own or an authorized voice. The transcript is optional. WAV, MP3, M4A, OGG, FLAC and WebM are accepted after checking the media duration. Deleting a profile also deletes its stored reference asset and audio file.

The adapter supports the English [Chatterbox](https://huggingface.co/ResembleAI/chatterbox) or smaller [Chatterbox Nano](https://huggingface.co/ResembleAI/chatterbox-nano) local model folders. Both official model cards list MIT licensing; the [code repository](https://github.com/resemble-ai/chatterbox) is also MIT. This allows commercial use subject to the license and the user's rights to the reference voice. Chatterbox's native audio watermark is retained. This integration does not support the multilingual or Turbo model variants.

Install Chatterbox's optional dependencies into the same Python environment that starts ShortForge. The upstream project's tested version is Python 3.11; a machine using Python 3.14 may need to run the engine in a separate Python 3.11 environment. These libraries and weights can be large, so setup does not install them. No cloning inference has been run in this checkout because the optional weights are not installed.

Set `clone_model_path` to an existing directory containing the complete upstream model snapshot:

| Model | Required local files checked by the app |
|---|---|
| Chatterbox English | `ve.safetensors`, `t3_cfg.safetensors`, `s3gen.safetensors`, `tokenizer.json` |
| Chatterbox Nano | `ve.safetensors`, `t3_nano_v1.safetensors`, `s3gen_meanflow.safetensors`, `tokenizer.json`, `tokenizer_config.json` |

Keep any additional tokenizer/configuration files from the official snapshot alongside those files. The app calls the official `from_local` API on CPU in an isolated subprocess, disables Hugging Face/Transformers online access, and blocks network connections from that worker. Missing files/dependencies produce an actionable error. Model presence is a readiness check, not proof that inference succeeds on every laptop. Narration is split into short chunks to avoid model context truncation, then paced with FFmpeg when requested.

## Optional online voices

- [Edge TTS](https://github.com/rany2/edge-tts) uses an unofficial Microsoft online endpoint. Its library license does not establish commercial rights to the service's voices; monetized use is not verified here. It may break. Installing `edge-tts` enables the adapter; English and Urdu sample voice IDs are included. Pitch is supported only on Edge.
- [ElevenLabs](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) uses the user's key and account credits. Its [free plan excludes commercial use](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform); a paid plan is required for monetized generated audio. No subscription is created by ShortForge.

Generated voiceovers are aligned against the newly generated audio using the installed local Whisper model. If Whisper is unavailable, a sidecar stores clearly labeled proportional timings for that new recording. The source video's old timings are never applied to a new voice. No provider key or live cloud request was used in the automated tests.

## Tests

From the project root, run `.venv/bin/python -m unittest engine.ai.test_writing engine.studio.test_studio -v` on Linux/macOS, or `.venv\Scripts\python.exe -m unittest engine.ai.test_writing engine.studio.test_studio -v` on Windows.
