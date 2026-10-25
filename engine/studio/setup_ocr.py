"""Explicit installer: python3 engine/studio/setup_ocr.py

Adds local CPU OCR and caches its models for Scout caption checks.
PaddleOCR models: Apache-2.0. rapidocr: Apache-2.0. Nothing here runs at
import time; Scout only reports whether OCR is present.

Installs into the current interpreter and downloads models once. Pass --check
to verify without changing anything.
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


def local_models() -> dict[str, str]:
    """Locate cached models without loading OCR or triggering downloads."""
    spec = importlib.util.find_spec("rapidocr")
    if spec is None or spec.origin is None:
        return {}
    directory = Path(spec.origin).parent / "models"
    names = {
        "Det": "PP-OCRv6_det_small.onnx",
        "Rec": "PP-OCRv6_rec_small.onnx",
        "Cls": "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
    }
    return {
        key: str(directory / name)
        for key, name in names.items()
        if (directory / name).is_file() and (directory / name).stat().st_size > 1024
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="Report whether OCR is available and exit."
    )
    args = parser.parse_args()

    if args.check:
        missing = [name for name in PACKAGES if name not in installed()]
        if missing:
            print(
                "On-screen caption reading is unavailable. Missing: "
                + ", ".join(missing)
            )
            return 1
        if len(local_models()) != 3:
            print("Local OCR models are missing. Run setup_ocr.py to cache them.")
            return 1
        print("Scout caption checking is ready (CPU).")
        return 0

    print(f"Installing on-screen caption reading from {REQUIREMENTS}")
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS)]
    )
    if result.returncode:
        print("Install failed. Scout caption checking remains unavailable.")
        return result.returncode
    print("Preparing local OCR models for Scout...")
    try:
        from rapidocr import RapidOCR

        RapidOCR(
            params={
                "Global.log_level": "error",
                "EngineConfig.onnxruntime.intra_op_num_threads": 2,
                "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            }
        )
    except Exception as exc:
        print(f"OCR model setup failed: {exc}. Run setup_ocr.py again to retry.")
        return 1
    if len(local_models()) != 3:
        print("OCR models are incomplete. Run setup_ocr.py again to retry.")
        return 1
    print("Done. Scout caption checking can use the cached models without downloads.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
