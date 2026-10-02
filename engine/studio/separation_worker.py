"""Isolated Demucs worker. Only this process imports the model dependencies."""

import argparse
import hashlib
import json
from pathlib import Path


def report(value):
    print(json.dumps({"progress": round(value, 2)}), flush=True)


def run(source: Path, output: Path, model_dir: Path):
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    checkpoint = model_dir / "955717e8-8726e21a.th"
    with checkpoint.open("rb") as file:
        if hashlib.file_digest(file, "sha256").hexdigest() != "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4":
            raise ValueError("Model checksum mismatch")
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    torch.manual_seed(0)
    report(2)
    # A LocalRepo is deliberate: get_model must never fetch a remote model.
    model = get_model("955717e8", repo=model_dir).eval()
    segment_seconds = 4
    for child in getattr(model, "models", [model]):
        child.segment = segment_seconds
    samplerate = model.samplerate
    segment = segment_seconds * samplerate
    stride = segment * 3 // 4
    with sf.SoundFile(source) as original:
        if original.samplerate != samplerate or original.channels != 2:
            raise ValueError("Expected a 44.1 kHz stereo extraction")
        length = len(original)
        if not 0 < length <= samplerate * 600:
            raise ValueError("Audio must be ten minutes or less")
        # A first streaming pass measures normalization. Avoid holding a long
        # recording and all four Demucs estimates in memory at once.
        total = total_squared = 0.0
        for block in original.blocks(blocksize=samplerate * 10, dtype="float32", always_2d=True):
            mono = block.mean(axis=1, dtype=np.float64)
            total += float(mono.sum())
            total_squared += float(np.square(mono).sum())
        mean = total / length
        std = max(1e-5, (max(0, total_squared / length - mean * mean)) ** 0.5)
        triangle = np.concatenate([np.arange(1, segment // 2 + 1), np.arange(segment - segment // 2, 0, -1)]).astype("float32")
        triangle /= triangle.max()
        accumulator = np.zeros((segment, 2), dtype="float32")
        weights = np.zeros(segment, dtype="float32")
        output.mkdir(parents=True, exist_ok=True)
        with sf.SoundFile(output / "vocals.wav", "w", samplerate=samplerate, channels=2, subtype="PCM_16") as vocals_file, sf.SoundFile(output / "instrumental.wav", "w", samplerate=samplerate, channels=2, subtype="PCM_16") as music_file:
            for offset in range(0, length, stride):
                original.seek(offset)
                block = original.read(segment, dtype="float32", always_2d=True)
                count = len(block)
                wave = torch.from_numpy(((block - mean) / std).T.copy())
                with torch.inference_mode():
                    separated = apply_model(model, wave[None], shifts=0, split=False, segment=segment_seconds, device="cpu", num_workers=0)
                estimate = separated[0, model.sources.index("vocals")].T.cpu().numpy() * std + mean
                accumulator[:count] += estimate * triangle[:count, None]
                weights[:count] += triangle[:count]
                # Overlap-add and flush only the region no future segment can
                # change. The residual preserves everything except the vocal
                # estimate, including background music and ambient sound.
                written = min(stride, length - offset)
                vocal = accumulator[:written] / weights[:written, None]
                vocals_file.write(vocal)
                music_file.write(block[:written] - vocal)
                accumulator[:-stride] = accumulator[stride:]
                accumulator[-stride:] = 0
                weights[:-stride] = weights[stride:]
                weights[-stride:] = 0
                del separated, wave, estimate
                report(5 + 93 * min(length, offset + written) / length)
    report(100)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    args = parser.parse_args()
    run(args.input, args.output, args.model_dir)
