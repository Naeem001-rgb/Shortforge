# Optional voice and speech services

The dashboard no longer includes script rewriting, voice generation or the browser editor's **Script and voice** panel. Retained backend routes remain documented in the [API contract](../shared/contract/API.md) and [AI service guide](../engine/ai/README.md). They do not add narration to a Concat project automatically.

## Local providers

- Existing `espeak-ng` or `espeak` installations provide basic local narration without a model download.
- Piper needs its optional package, an explicitly downloaded voice `.onnx` and matching `.onnx.json`, and the `piper_model` setting.
- Chatterbox needs its optional dependencies and local model folder configured with `clone_model_path`. Voice references require explicit speaker consent. Saving a reference does not install or train a model.
- Local transcription and voice alignment use `faster-whisper` installed in the engine environment and an existing model. Configure `whisper_model` through `PUT /api/settings`; the engine loads models with `local_files_only=True`. Missing models produce an error or explicitly approximate voice timings, depending on the operation.

Use an environment supported by the optional package; the engine itself targets Python 3.11+. Install only the providers you need from `engine/requirements-optional.txt`. No page visit, capability check or generation request downloads models automatically. Model installation is a separate explicit step.

The old `engine/studio/setup_transcription.py` installer was removed with the browser editor. Its former UI and setup instructions are [historical](archive/browser-editor/VOICE.md).

## Scout screening

Scout has its own OCR/speech workers. See the [extension guide](../extension/README.md) and [speech setup](../engine/studio/SCOUT_SPEECH.md). These checks do not generate narration or identify a speaker.

## Provider and verification details

[engine/ai/README.md](../engine/ai/README.md) describes the retained providers, API limits, consent checks and licensing references. Cloud providers are optional and are called only for an explicit request. The automated provider tests use simulated responses; they do not establish current service pricing, live availability or model synthesis quality.
