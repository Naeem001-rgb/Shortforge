"""Explicitly install Scout's small pinned local speech model (2.33 MB).

Run with ShortForge's Python: python -m engine.studio.setup_scout_speech
Pass --check for a read-only availability check. No packages are installed.
"""
import argparse
import hashlib
from pathlib import Path
import sys
import tempfile
import urllib.request

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.studio.scout_speech import MODEL_BYTES, MODEL_SHA256, MODEL_URL, model_path, speech_capability, valid_model


def install_model() -> Path:
    target = model_path()
    if valid_model(target):
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with urllib.request.urlopen(MODEL_URL, timeout=30) as response:
            # One extra byte detects unexpected payloads without unbounded reads.
            payload = response.read(MODEL_BYTES + 1)
        if len(payload) != MODEL_BYTES or hashlib.sha256(payload).hexdigest() != MODEL_SHA256:
            raise ValueError("The downloaded speech model failed its pinned checksum. Nothing was installed.")
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix="silero-", suffix=".part", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(payload)
        temporary.replace(target)
        return target
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check readiness without downloading anything.")
    arguments = parser.parse_args()
    if not arguments.check:
        try:
            print(f"Scout speech model ready at {install_model()}")
        except (OSError, ValueError) as exc:
            print(f"Scout speech setup failed: {exc}")
            return 1
    capability = speech_capability()
    print(capability["message"])
    return 0 if capability["available"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
