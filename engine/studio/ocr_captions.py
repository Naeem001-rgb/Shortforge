"""Read burned-in subtitles off sampled video frames with local CPU OCR.

Shorts carry their captions as part of the picture, so nothing in the project
can tell you what they say. This samples the caption band over time and turns
repeated readings into timed cues the editor can turn into timeline items.

Everything runs locally. No frame ever leaves the machine.
"""
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
import re
import subprocess
from threading import Lock

import numpy as np

from engine.core import db
from .media import ffmpeg_binary

OCR_LOCK = Lock()

# Where subtitles usually sit. Kept generous because creators vary.
DEFAULT_BAND = (0.52, 0.96)
# One reading per half second is enough to see every caption without being slow.
INTERVALS = {"fast": 1.0, "balanced": 0.5, "accurate": 0.25}
MIN_SCORE = 0.55
SIMILARITY = 0.72
# No single caption runs longer than this, so one stuck reading cannot eat a clip.
MAX_CUE = 6.0


def ocr_capability() -> dict:
    """Whether local OCR can run, without importing the model in the web process."""
    try:
        import rapidocr  # noqa: F401
        import onnxruntime  # noqa: F401
    except Exception:
        return {
            "available": False,
            "message": "Local OCR is not installed. Run engine/studio/setup_ocr.py to add it, then restart the engine.",
        }
    return {
        "available": True,
        "message": "On-screen caption reading is ready (CPU, runs locally).",
    }


@lru_cache(maxsize=1)
def _engine():
    from rapidocr import RapidOCR

    return RapidOCR()


def _normalise(text: str) -> str:
    """Fold the styling differences OCR leaves between neighbouring frames."""
    return re.sub(r"[^A-Z0-9]+", "", (text or "").upper())


def _read_band(path: Path, width: int, height: int, interval: float, band=DEFAULT_BAND):
    """Yield (time, RGB array) for the caption band at roughly `interval` seconds.

    A single ffmpeg process streams raw frames: cropping and downsampling in the
    filter chain is far cheaper than decoding whole frames we would throw away.
    """
    top = max(0.0, min(0.9, float(band[0])))
    bottom = max(top + 0.05, min(1.0, float(band[1])))
    band_height = max(24, min(height, int(round(height * (bottom - top)))))
    band_top = max(0, min(height - band_height, int(round(height * top))))
    # Recognition wants readable text, so normalise the band's height and keep
    # the crop's aspect ratio rather than the source's.
    out_height = max(32, min(384, band_height))
    out_width = max(32, int(round(width * out_height / band_height)))
    filters = (
        f"fps=1/{max(0.05, interval)},crop={width}:{band_height}:0:{band_top},"
        f"scale={out_width}:{out_height}"
    )
    frame_bytes = out_width * out_height * 3
    process = subprocess.Popen(
        [ffmpeg_binary(), "-v", "error", "-nostdin", "-i", str(path), "-an",
         "-sn", "-dn", "-vf", filters, "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    try:
        index = 0
        while True:
            raw = process.stdout.read(frame_bytes)
            if not raw or len(raw) < frame_bytes:
                break
            yield index * interval, np.frombuffer(raw, np.uint8).reshape(
                out_height, out_width, 3
            )
            index += 1
    finally:
        if process.stdout:
            process.stdout.close()
        process.wait()


def _read_text(frame: np.ndarray) -> tuple[str, float]:
    """OCR one band image, retrying inverted because caption colours vary.

    Most Shorts are light text on a dark picture, so the plain pass runs first
    and the inverted pass only costs time when the first one finds nothing.
    """
    engine = _engine()
    best, best_score = "", 0.0
    for candidate in (frame, 255 - frame):
        try:
            result = engine(candidate)
        except Exception:
            continue
        texts = [t.strip() for t in (getattr(result, "txts", None) or []) if t and t.strip()]
        if not texts:
            continue
        scores = list(getattr(result, "scores", None) or [])
        score = float(max(scores)) if scores else 0.0
        text = " ".join(texts)
        if score > best_score:
            best, best_score = text, score
        if best_score >= MIN_SCORE:
            break
    return best, best_score


def _representative(run: list[tuple[float, str, float]]) -> str:
    """Pick the reading a run agrees on most, not merely the longest string.

    OCR jitters in case and spacing between frames, so the same caption arrives
    as several near-identical strings. The most repeated one is the real text.
    """
    tally: dict[str, list[float]] = {}
    for _, text, score in run:
        tally.setdefault(text, []).append(score)
    return max(tally, key=lambda text: (len(tally[text]), sum(tally[text]) / len(tally[text])))


def group_readings(readings: list[tuple[float, str, float]], interval: float) -> list[dict]:
    """Fold per-frame readings into cues.

    Neighbouring frames read the same line slightly differently, so readings are
    merged while they stay similar, and only then split into timed cues. A run
    longer than MAX_CUE is chunked rather than truncated, so no caption time is
    silently dropped.
    """
    cues: list[dict] = []
    run: list[tuple[float, str, float]] = []

    def flush():
        if not run:
            return
        text = _representative(run)
        index = 0
        boundary = None
        while index < len(run):
            # A chunk starts where the previous one ended so a caption that
            # outlives the limit stays continuous instead of leaving a gap.
            start = run[index][0] if boundary is None else boundary
            span = [run[index]]
            for candidate in run[index + 1:]:
                if candidate[0] - start > MAX_CUE:
                    break
                span.append(candidate)
            end = min(span[-1][0] + interval, start + MAX_CUE)
            if text and end - start >= max(0.2, interval * 0.5):
                cues.append(
                    {
                        "start": round(start, 3),
                        "end": round(end, 3),
                        "text": text,
                        "confidence": round(
                            sum(r[2] for r in span) / len(span), 3
                        ),
                    }
                )
            boundary = end
            index += len(span)
        run.clear()

    previous_key = ""
    for time, text, score in readings:
        key = _normalise(text)
        if not key or score < MIN_SCORE:
            continue
        if run and SequenceMatcher(None, previous_key, key).ratio() < SIMILARITY:
            flush()
        previous_key = key
        run.append((time, text.strip(), score))
    flush()
    return cues


def read_on_screen_captions(
    path: Path, width: int, height: int, duration: float,
    speed: str = "balanced", band=DEFAULT_BAND, progress=None,
) -> dict:
    """Sample the clip's caption band and return timed cues."""
    interval = INTERVALS.get(speed, INTERVALS["balanced"])
    total = max(1, int(duration / interval))
    readings = []
    for index, (time, frame) in enumerate(
        _read_band(path, int(width), int(height), interval, band)
    ):
        text, score = _read_text(frame)
        readings.append((time, text, score))
        if progress and index % 3 == 0:
            progress(min(99.0, 5.0 + 90.0 * index / total))
    cues = group_readings(readings, interval)
    return {
        "cues": cues,
        "frames_scanned": len(readings),
        "interval": interval,
        "band": [float(band[0]), float(band[1])],
    }


def ocr_captions_job(job_id: str, clip_id: str, asset_id: str, speed: str = "balanced"):
    """Background job wrapper so a long scan never blocks the editor."""
    from .editor_media import get_editor_asset

    try:
        with OCR_LOCK:
            _, path, metadata = get_editor_asset(clip_id, asset_id)
            if metadata.get("media_type") != "video":
                raise ValueError(
                    "Choose a video clip. On-screen captions are read from the picture."
                )
            if not metadata.get("width") or not metadata.get("height"):
                raise ValueError("This clip has no readable picture size.")
            db.update_job(job_id, status="running", progress=2)
            result = read_on_screen_captions(
                Path(path), int(metadata["width"]), int(metadata["height"]),
                float(metadata.get("duration") or 0.0), speed,
                progress=lambda value: db.update_job(job_id, progress=value),
            )
            db.update_job(
                job_id, status="completed", progress=100,
                result={**result, "asset_id": asset_id},
            )
    except Exception as exc:
        db.update_job(
            job_id, status="failed",
            error=str(exc) if isinstance(exc, (ValueError, RuntimeError))
            else "Reading on-screen captions failed on this clip. Try a shorter or clearer clip.",
        )