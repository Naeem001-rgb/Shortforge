# Shared media and Scout workers

Studio now opens the native Concat desktop editor. This package retains local media utilities and Scout caption/speech screening; it does not contain a browser timeline or export renderer.

| File | Responsibility |
| --- | --- |
| `media.py` | Shared FFmpeg lookup, audio probing, word-timing fallback and voice duration notes |
| `editor_media.py` | Validated image/video inspection, browser-compatible normalization and cached thumbnails |
| `scout_captions.py` | Full-duration OCR screening and cancellable worker execution |
| `scout_speech.py` | Optional local speech screening |
| `setup_ocr.py`, `setup_scout_speech.py` | Explicit installation of optional screening dependencies/models |

FFmpeg and FFprobe discovery is shared with `engine/core/media.py`. Optional models are never installed by a page visit or scouting request. See [Scout speech setup](SCOUT_SPEECH.md), [Concat integration](../../docs/CONCAT.md), and [test instructions](../../docs/TESTING.md).

Run `.venv/bin/python -m pytest engine/studio -q` from the project root after installing `requirements-dev.txt`. Tests generate their own media; optional installed-model checks may skip.

The removed renderer's documentation is [archived](../../docs/archive/browser-editor/LEGACY-ENGINE.md).
