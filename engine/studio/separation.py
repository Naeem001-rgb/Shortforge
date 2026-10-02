"""Local audio extraction and optional, isolated CPU vocal separation.

Importing this module or checking availability never imports Torch or downloads
anything. A separate Python runtime keeps model memory out of the web server.
"""

from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import selectors
import subprocess
import tempfile
import time
from typing import Callable

from .media import ffmpeg_binary

ROOT = Path(__file__).resolve().parents[2]
MODEL_FILE = "955717e8-8726e21a.th"
MODEL_SHA256 = "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"
SEPARATION_NOTE = "Local vocal separation can leave speech or music artifacts. Preview both stems before exporting."


def runtime_python() -> Path:
    default = ROOT / "data" / "runtime" / "separation" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    return Path(os.environ.get("SHORTFORGE_SEPARATION_PYTHON", default)).expanduser().absolute()


def model_directory() -> Path:
    return Path(os.environ.get("SHORTFORGE_SEPARATION_MODEL_DIR", ROOT / "data" / "models" / "demucs")).expanduser().resolve()


@lru_cache(maxsize=4)
def _runtime_ready(python: str, modified: int) -> bool:
    # Import metadata is enough for ordinary capability requests. Full model
    # loading only happens in the worker on an explicit separation request.
    try:
        process = subprocess.run([python, "-c", "from importlib.metadata import version; assert version('demucs') == '4.0.1'; assert version('torch') == '2.5.1+cpu'; assert version('torchaudio') == '2.5.1+cpu'; import soundfile"], capture_output=True, timeout=10)
        return process.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


@lru_cache(maxsize=4)
def _model_ready(path: str, modified: int, size: int) -> bool:
    try:
        with Path(path).open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        return digest == MODEL_SHA256
    except OSError:
        return False


def separation_capability() -> dict:
    python = runtime_python()
    checkpoint = model_directory() / MODEL_FILE
    runtime = _runtime_ready(str(python), python.stat().st_mtime_ns) if python.is_file() else False
    model = _model_ready(str(checkpoint), checkpoint.stat().st_mtime_ns, checkpoint.stat().st_size) if checkpoint.is_file() else False
    if runtime and model:
        message = "Local vocal separation is ready (CPU). " + SEPARATION_NOTE
    elif not runtime:
        message = "Install the local separation runtime with scripts/setup-separation.sh, then restart ShortForge. No model is downloaded automatically."
    else:
        message = "The local vocal model is missing or incomplete. Run scripts/setup-separation.sh to install it."
    return {"available": runtime and model, "model_ready": model, "message": message}


def extract_audio(source: Path, output: Path) -> Path:
    """Decode the entire first soundtrack to browser-compatible stereo PCM."""
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run([ffmpeg_binary(), "-nostdin", "-v", "error", "-y", "-i", str(source), "-map", "0:a:0", "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(output)], capture_output=True, check=True, timeout=180)
    except subprocess.TimeoutExpired:
        output.unlink(missing_ok=True)
        raise ValueError("Audio extraction took too long. Try a shorter source file.") from None
    except (OSError, subprocess.CalledProcessError):
        output.unlink(missing_ok=True)
        raise ValueError("The original soundtrack could not be extracted. Check that the source contains playable audio.") from None
    return output


def separate_audio(source: Path, directory: Path, progress: Callable[[float], None] | None = None) -> tuple[Path, Path]:
    capability = separation_capability()
    if not capability["available"]:
        raise ValueError(capability["message"])
    directory.mkdir(parents=True, exist_ok=True)
    command = [str(runtime_python()), str(Path(__file__).with_name("separation_worker.py")), "--model-dir", str(model_directory()), "--input", str(source), "--output", str(directory)]
    environment = {**os.environ, "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2", "CUDA_VISIBLE_DEVICES": "", "PYTHONUNBUFFERED": "1"}
    # Bounded CPU jobs can still take minutes on a laptop. A stalled worker is
    # terminated, and stderr stays local rather than being exposed in the UI.
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as errors:
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors, text=True, env=environment) as process:
            try:
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ)
                    deadline = time.monotonic() + 3600
                    while selector.get_map():
                        if time.monotonic() > deadline:
                            raise ValueError("Vocal separation exceeded one hour. Try a shorter audio file.")
                        for key, _ in selector.select(timeout=1):
                            line = key.fileobj.readline()
                            if not line:
                                selector.unregister(key.fileobj)
                                continue
                            try:
                                value = json.loads(line).get("progress")
                                if isinstance(value, (int, float)) and progress:
                                    progress(max(0, min(100, value)))
                            except (json.JSONDecodeError, AttributeError):
                                pass
                    if process.wait(timeout=10) != 0:
                        raise ValueError("Local vocal separation failed. Check available memory and rerun scripts/setup-separation.sh if the runtime needs repair.")
            except BaseException:
                process.kill()
                process.wait()
                raise
    vocals, instrumental = directory / "vocals.wav", directory / "instrumental.wav"
    if not all(path.is_file() and path.stat().st_size > 44 for path in (vocals, instrumental)):
        raise ValueError("The separation model did not produce playable stems. Try another source file.")
    return vocals, instrumental
