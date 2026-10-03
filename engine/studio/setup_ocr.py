"""Explicit installer: python3 engine/studio/setup_ocr.py

Adds local CPU OCR so Studio can read subtitles that are painted into a video.
PaddleOCR models: Apache-2.0. rapidocr: Apache-2.0. Nothing here runs at
import time; the editor only reports whether OCR is present.

Installs into the current interpreter. Pass --check to verify without changing
anything.
"""
import argparse
import importlib.util
from pathlib import Path
import subprocess
import sys

REQUIREMENTS = Path(__file__).resolve().parents[1] / "requirements-ocr.txt"
PACKAGES = ("rapidocr", "onnxruntime", "cv2")


def installed() -> list[str]:
    return [name for name in PACKAGES if importlib.util.find_spec(name)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="Report whether OCR is available and exit.")
    args = parser.parse_args()

    if args.check:
        missing = [name for name in PACKAGES if name not in installed()]
        if missing:
            print("On-screen caption reading is unavailable. Missing: " + ", ".join(missing))
            return 1
        print("On-screen caption reading is ready (CPU).")
        return 0

    print(f"Installing on-screen caption reading from {REQUIREMENTS}")
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS)]
    )
    if result.returncode:
        print("Install failed. The editor still works; only caption reading is unavailable.")
        return result.returncode
    print("Done. Models download once on the first caption scan and are cached locally.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())