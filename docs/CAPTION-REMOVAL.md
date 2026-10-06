# Remove burned-in captions

Select the video on the Studio timeline. In **Basic**, click **Remove burned-in captions**.

1. Drag a box closely around the captions in the original picture. The percentage fields provide a keyboard alternative. Keep other text outside the box.
2. Move the preview slider to a moment with visible captions.
3. Click **Preview 1 second** and play the cleaned result.
4. If OCR misses stylized lettering, adjust the box or select **Erase the whole area**. Both choices use real AI inpainting; the latter also rebuilds non-text pixels inside the box.
5. Click **Remove from selected clip**. This processes the selected clip's source interval, including its trim, while preserving its soundtrack.
6. Click **Use cleaned clip** to apply it. Undo restores the original, which remains in Media. Changing the clip's timing or source during processing prevents automatic replacement of a different edit.

You can close the dialog during processing and reopen it from the same clip. Job state survives a page reload in the same browser session. **Cancel removal** stops after the current frame. Restarting the engine ends unfinished work, with a retry message.

## What it does and its limits

This uses RapidOCR to find text in each frame and **MI-GAN** to reconstruct the masked pixels. It streams frames in a separate CPU process, with only one removal job at a time. The source file is never overwritten. Completed previews and cleaned clips are separate MP4 assets. Only masked pixels are replaced before encoding; MP4 re-encoding can introduce small differences elsewhere. Source dimensions (rounded down to even numbers if necessary), source frame rate, and selected source timing are retained. Audio is re-encoded as AAC. Variable-frame-rate video is normalized to its average frame rate.

Each frame with detected text gets a separate MI-GAN repair at the original input resolution. Fast mode and motion-based reuse have been removed at the user's request. A saved result from the former Fast mode is marked as such and cannot be applied through this dialog; rerun removal to make a frame-by-frame result.

MI-GAN is a compact image inpainting model, **not ProPainter or a learned temporal video model**. It estimates hidden content. Smudges, distorted details and flickering are possible, especially over faces, motion, and busy backgrounds. It cannot recover the exact original pixels. OCR may miss small/stylized lettering or find unrelated text inside a broad box. Nothing falls back silently to blur, a cover, or pixelation.

CPU processing is slow on the development laptop (Intel i5-10210U, 8 GB RAM, no NVIDIA GPU) and can take hours. The initial LaMa trial was substantially slower, so the installed implementation uses MI-GAN. No footage is uploaded to a service. A cloud GPU would require a separate GPU-enabled setup; the current local worker explicitly uses the CPU.

## Installation on another machine

From the ShortForge folder, using the same Python environment as the engine:

```bash
.venv/bin/python -m pip install -r engine/requirements-inpainting.txt
.venv/bin/python -m engine.studio.setup_inpainting
.venv/bin/python -m engine.studio.setup_inpainting --check
```

The explicit installer downloads a 28 MB model, checks its SHA-256, and atomically installs it in `data/models/inpainting/`. Page visits and removal requests do not download this model. RapidOCR's own models must already be cached (its existing setup downloads these on first scan). Restart ShortForge after installing Python dependencies.

Model: [MI-GAN, official project](https://github.com/Picsart-AI-Research/MI-GAN), [author's ONNX pipeline](https://huggingface.co/andraniksargsyan/migan).
Pinned revision: `406830d0fa60666da0071c342ad2fbc8f30c5c64`.
File: `migan_pipeline_v2.onnx`, SHA-256 `6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b`.
The upstream repository and weights are MIT licensed; see [the local notice](licenses/MI-GAN.txt).

## Verification

```bash
.venv/bin/python -m pytest engine/studio/test_inpainting.py engine/studio/test_ocr_captions.py -q
npm --prefix dashboard test -- caption-removal.spec.ts
npm --prefix dashboard run build
```

Backend tests use real FFmpeg decoding/encoding and deterministic test painters to check boundaries, duration, soundtrack preservation, original-file preservation, no-text errors, cancellation, validation, and job isolation. Tests also verify full-resolution text detection and a separate repair for every masked frame. Browser tests simulate job responses to verify preview, explicit apply, reload recovery, undo, cancellation and rejection of saved Fast-mode results. Actual installed-model inference is benchmarked separately on local source footage; these tests do not claim every clip will cleanly remove.
