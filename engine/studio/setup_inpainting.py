"""Install the pinned local MI-GAN model: .venv/bin/python -m engine.studio.setup_inpainting."""
import argparse
import hashlib
from pathlib import Path
import urllib.request

from engine.core import db

MODEL_SHA256 = "6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b"
MODEL_URL = "https://huggingface.co/Carve/MI-GAN-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/migan_pipeline_v2.onnx"


def model_path() -> Path:
    return db.DATA_DIR / "models" / "inpainting" / "migan_pipeline_v2.onnx"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = model_path()
    valid = False
    if path.is_file():
        with path.open("rb") as stream:
            valid = hashlib.file_digest(stream, "sha256").hexdigest() == MODEL_SHA256
    if valid:
        print("MI-GAN caption removal model is ready.")
        return 0
    if args.check:
        print("MI-GAN model is not installed or is incomplete.")
        return 1
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".download")
    print("Downloading the 28 MB MI-GAN model. Video stays on this computer.", flush=True)
    try:
        with urllib.request.urlopen(MODEL_URL, timeout=60) as response, partial.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        with partial.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != MODEL_SHA256:
                raise RuntimeError("Model verification failed. Run setup again.")
        partial.replace(path)
    finally:
        partial.unlink(missing_ok=True)
    print("MI-GAN caption removal model installed and verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
