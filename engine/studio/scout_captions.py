"""Temporary, local full-frame OCR checks for Scout candidates.

A disposable worker bounds CPU time and releases model memory afterwards. OCR is
sampled every half-second: this estimates visible text, not caption absence.
"""
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
from threading import BoundedSemaphore, Event, Lock
import time

from engine.core import db
from .media import ffmpeg_binary

INTERVAL = 0.5
MAX_DURATION = 180
MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024
MAX_WORK_BYTES = 100 * 1024 * 1024
JOB_TIMEOUT = 480
SLOTS = BoundedSemaphore(1)
CANCEL_LOCK = Lock()
CANCEL_EVENTS: dict[str, Event] = {}
NOTE = "Sampled visible-text estimate every 0.5 seconds across the full frame; brief flashes may be missed and scene text can count as captions."


def local_models() -> dict[str, str]:
    """Use cached models only. Scout must never trigger a model download."""
    spec = importlib.util.find_spec("rapidocr")
    if spec is None or spec.origin is None:
        return {}
    directory = Path(spec.origin).parent / "models"
    names = {"Det": "PP-OCRv6_det_small.onnx", "Rec": "PP-OCRv6_rec_small.onnx",
             "Cls": "ch_ppocr_mobile_v2.0_cls_mobile.onnx"}
    return {key: str(directory / name) for key, name in names.items()
            if (directory / name).is_file() and (directory / name).stat().st_size > 1024}


def caption_capability() -> dict:
    missing = [name for name in ("rapidocr", "onnxruntime", "cv2", "yt_dlp")
               if importlib.util.find_spec(name) is None]
    if missing:
        return {"available": False, "message": "Scout caption checking needs local OCR and yt-dlp. "
                "Run engine/studio/setup_ocr.py and the ShortForge setup, then restart the engine. "
                f"Missing: {', '.join(missing)}."}
    try:
        ffmpeg_binary()
    except ValueError as exc:
        return {"available": False, "message": str(exc)}
    if len(local_models()) != 3:
        return {"available": False, "message": "Local OCR models are not cached yet. "
                "Complete a Studio ‘Read on-screen captions’ scan to finish OCR setup, then try Scout again."}
    return {"available": True, "message": "Local Scout caption checking is ready. " + NOTE}


def unknown_result(video_id: str, url: str, reason: str) -> dict:
    return {"video_id": video_id, "url": url, "status": "unknown", "duration": None,
            "caption_seconds": None, "coverage": None, "frames_scanned": 0,
            "interval": INTERVAL, "reason": reason}


def classify_samples(samples: list[bool], duration: float, max_caption_seconds: float,
                     interval: float = INTERVAL) -> dict:
    """Each sample represents its half-second bin; reject incomplete coverage."""
    expected = math.ceil(duration / interval) if math.isfinite(duration) and duration > 0 else 0
    if not expected or len(samples) != expected:
        return {"status": "unknown", "duration": duration, "caption_seconds": None,
                "coverage": None, "frames_scanned": len(samples), "interval": interval,
                "reason": "The whole video could not be checked. This clip was skipped."}
    seconds = sum(min(interval, duration - index * interval)
                  for index, present in enumerate(samples) if present)
    status = "clear" if seconds == 0 else "brief" if seconds <= max_caption_seconds + 1e-6 else "persistent"
    descriptions = {"clear": "No likely captions detected in the sampled frames.",
                    "brief": f"Text was detected for about {seconds:.1f}s, within the {max_caption_seconds:g}s allowance.",
                    "persistent": f"Text was detected for about {seconds:.1f}s, above the {max_caption_seconds:g}s allowance."}
    return {"status": status, "duration": round(duration, 3), "caption_seconds": round(seconds, 3),
            "coverage": round(seconds / duration, 4), "frames_scanned": len(samples),
            "interval": interval, "reason": descriptions[status] + " " + NOTE}


def has_caption_text(result, width: int, height: int) -> bool:
    """Count confident text anywhere; ignore only obvious small corner handles.

    Scene signs and title cards deliberately remain conservative matches. A
    static subtitle is still a subtitle, so persistence alone never ignores it.
    """
    if result is None or not hasattr(result, "txts"):
        raise ValueError("OCR did not return a readable result. This clip was skipped.")
    texts = getattr(result, "txts", None)
    if texts is None or len(texts) == 0:
        return False
    scores = getattr(result, "scores", None)
    boxes = getattr(result, "boxes", None)
    if scores is None or boxes is None or len(texts) != len(scores) or len(texts) != len(boxes):
        raise ValueError("OCR returned incomplete text readings. This clip was skipped.")
    for text, confidence, box in zip(texts, scores, boxes):
        text = str(text).strip()
        if float(confidence) < 0.55 or sum(char.isalnum() for char in text) < 2:
            continue
        xs, ys = [float(point[0]) / width for point in box], [float(point[1]) / height for point in box]
        small = max(xs) - min(xs) <= 0.32 and max(ys) - min(ys) <= 0.06
        corner = (max(xs) < 0.4 or min(xs) > 0.6) and (max(ys) < 0.15 or min(ys) > 0.85)
        handle = re.fullmatch(r"@?[\w.]+(?:\.com)?", text, re.UNICODE)
        branded = text.lower() in {"tiktok", "instagram", "youtube", "youtube shorts"}
        if small and corner and ((handle and (text.startswith("@") or text.endswith(".com"))) or branded):
            continue
        return True
    return False


def make_ocr():
    from rapidocr import RapidOCR
    models = local_models()
    if len(models) != 3:
        raise ValueError(caption_capability()["message"])
    return RapidOCR(params={**{f"{key}.model_path": path for key, path in models.items()},
                            "Global.use_cls": False, "Global.log_level": "error",
                            "Det.limit_type": "max", "Det.limit_side_len": 960,
                            "EngineConfig.onnxruntime.intra_op_num_threads": 2,
                            "EngineConfig.onnxruntime.inter_op_num_threads": 1})


def download_source(url: str, directory: Path) -> tuple[Path, float]:
    """Public extraction only: no cookies, login, browser profiles or config."""
    import yt_dlp

    class QuietLog:
        def debug(self, message): pass
        def warning(self, message): pass
        def error(self, message): pass

    def bounded_progress(data):
        if (data.get("downloaded_bytes") or 0) > MAX_DOWNLOAD_BYTES:
            raise ValueError("This video exceeds Scout's 80 MB temporary download limit.")

    options = {"noplaylist": True, "quiet": True, "no_warnings": True, "logger": QuietLog(),
               "format": "bv*[height<=1280][width<=1280]/b[height<=1280][width<=1280]",
               "outtmpl": str(directory / "source.%(ext)s"), "max_filesize": MAX_DOWNLOAD_BYTES,
               "socket_timeout": 15, "retries": 1, "fragment_retries": 1,
               "concurrent_fragment_downloads": 1, "cachedir": False,
               "progress_hooks": [bounded_progress]}
    with yt_dlp.YoutubeDL(options) as downloader:
        try:
            info = downloader.extract_info(url, download=False)
            duration = float((info or {}).get("duration") or 0)
            if not info or info.get("_type") in {"playlist", "multi_video"} or info.get("is_live"):
                raise ValueError("Choose one public, recorded Short or Reel for caption checking.")
            if not math.isfinite(duration) or not 0 < duration <= MAX_DURATION:
                raise ValueError(f"Scout caption checking supports videos up to {MAX_DURATION} seconds with a known duration.")
            downloader.process_info(info)
        except yt_dlp.utils.DownloadError:
            raise ValueError("The public video could not be downloaded for caption checking. "
                             "It may need login or be unavailable; this clip was skipped.") from None
    files = [path for path in directory.glob("source.*") if path.suffix not in {".part", ".ytdl", ".json"}]
    if len(files) != 1 or not files[0].stat().st_size:
        raise ValueError("The public video download was incomplete or exceeded 80 MB. This clip was skipped.")
    if files[0].stat().st_size > MAX_DOWNLOAD_BYTES:
        raise ValueError("This video exceeds Scout's 80 MB temporary download limit.")
    return files[0], duration


def normalize_source(path: Path) -> Path:
    """Decode web codecs with FFmpeg before handing a local H.264 copy to OCR.

    OpenCV's bundled codec support differs from the system FFmpeg: opening an
    AV1 MP4 can succeed even when every frame read fails. A complete conversion
    also catches decoding errors before any frames can be declared caption-free.
    """
    output = path.parent / "ocr-proxy.mp4"
    command = [ffmpeg_binary(), "-v", "error", "-nostdin", "-y", "-xerror",
               "-threads", "2", "-i", str(path), "-map", "0:v:0", "-an", "-sn", "-dn",
               "-vf", "scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
               "-pix_fmt", "yuv420p", "-threads", "2", "-movflags", "+faststart", str(output)]
    try:
        converted = subprocess.run(command, capture_output=True, timeout=120)
        if converted.returncode or not output.is_file() or not output.stat().st_size:
            raise ValueError("FFmpeg could not decode the complete video for caption checking. This clip was skipped.")
        if output.stat().st_size > MAX_DOWNLOAD_BYTES:
            raise ValueError("The decoded video exceeds Scout's temporary file limit. This clip was skipped.")
        return output
    except subprocess.TimeoutExpired:
        raise ValueError("Preparing this video for caption checking took too long. This clip was skipped.") from None
    except (OSError, subprocess.SubprocessError):
        raise ValueError("FFmpeg could not prepare this video for caption checking. This clip was skipped.") from None


def scan_video(path: Path, expected_duration: float, max_caption_seconds: float, progress=None, reader=None) -> dict:
    import cv2
    cv2.setNumThreads(1)
    capture = cv2.VideoCapture(str(path))
    try:
        fps, frame_count = capture.get(cv2.CAP_PROP_FPS), capture.get(cv2.CAP_PROP_FRAME_COUNT)
        if not capture.isOpened() or not math.isfinite(fps) or fps <= 0 or not math.isfinite(frame_count):
            raise ValueError("The downloaded video has no readable frames. This clip was skipped.")
        duration = frame_count / fps
        if not 0 < duration <= MAX_DURATION + 0.05 or abs(duration - expected_duration) > 1.0:
            raise ValueError("The complete video duration could not be verified. This clip was skipped.")
        reader = reader or make_ocr()
        samples = []
        total = math.ceil(duration / INTERVAL)
        for index in range(total):
            # Middle of each bin, including a short final bin. Reads at the end
            # prevent a truncated download from being classed as caption-free.
            timestamp = min(index * INTERVAL + INTERVAL / 2, max(0, duration - 1 / fps))
            if not capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000):
                raise ValueError("The video could not be sampled across its full duration.")
            ok, frame = capture.read()
            if not ok or frame is None:
                raise ValueError("A sampled video frame could not be read. This clip was skipped.")
            actual = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000
            if math.isfinite(actual) and abs(actual - timestamp) > max(INTERVAL, 2 / fps):
                raise ValueError("The video has unreliable frame timing. This clip was skipped.")
            height, width = frame.shape[:2]
            scale = min(1.0, 960 / max(height, width))
            if scale < 1:
                frame = cv2.resize(frame, (round(width * scale), round(height * scale)))
            height, width = frame.shape[:2]
            # RapidOCR consumes BGR, exactly what OpenCV returns. Errors are
            # never converted to an empty reading.
            samples.append(has_caption_text(reader(frame), width, height))
            if progress:
                progress(15 + 80 * (index + 1) / total)
        return classify_samples(samples, duration, max_caption_seconds)
    finally:
        capture.release()


def check_in_worker(config: dict, directory: Path) -> dict:
    path, duration = download_source(config["url"], directory)
    proxy = normalize_source(path)
    path.unlink()  # Only the temporary decoded copy is needed during OCR.
    return scan_video(proxy, duration, config["max_caption_seconds"],
                      progress=lambda value: (directory / "progress").write_text(str(value)))


def terminate_worker(process):
    if process.poll() is not None:
        return
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    else:
        # FFmpeg can be active inside the worker during cancellation.
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        if process.poll() is None:
            process.kill()
    process.wait(timeout=10)


def run_worker(config: dict, directory: Path, cancel: Event, progress=None) -> dict:
    config_path = directory / "request.json"
    config_path.write_text(json.dumps(config))
    process = subprocess.Popen([sys.executable, "-m", "engine.studio.scout_captions", str(config_path)],
                               cwd=Path(__file__).resolve().parents[2], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, start_new_session=os.name == "posix")
    deadline = time.monotonic() + JOB_TIMEOUT
    last_progress = None
    try:
        while process.poll() is None:
            if cancel.wait(0.25):
                raise ValueError("Caption check cancelled. This clip was skipped.")
            if time.monotonic() > deadline:
                raise ValueError("Caption checking reached its eight-minute limit. This clip was skipped.")
            try:
                work_bytes = sum(path.stat().st_size for path in directory.iterdir() if path.is_file())
            except FileNotFoundError:
                # The worker removes its source after creating the OCR proxy.
                # Recheck on the next tick if that overlaps this size snapshot.
                continue
            if work_bytes > MAX_WORK_BYTES:
                raise ValueError("This video exceeded Scout's temporary file limit. This clip was skipped.")
            if progress:
                try:
                    value = float((directory / "progress").read_text())
                    if math.isfinite(value) and value != last_progress:
                        progress(value)
                        last_progress = value
                except (OSError, ValueError):
                    pass
        if cancel.is_set():
            raise ValueError("Caption check cancelled. This clip was skipped.")
        result_path = directory / "result.json"
        if process.returncode or not result_path.is_file():
            raise ValueError("Local caption checking could not finish. This clip was skipped.")
        result = json.loads(result_path.read_text())
        if "error" in result:
            raise ValueError(result["error"])
        return result
    finally:
        terminate_worker(process)


def caption_check_job(job_id: str, video_id: str, url: str, max_caption_seconds: float, cancel: Event):
    try:
        if cancel.is_set():
            raise ValueError("Caption check cancelled. This clip was skipped.")
        db.update_job(job_id, status="running", progress=1)
        # Default temp storage is deleted on both success and exceptions.
        with tempfile.TemporaryDirectory(prefix="shortforge-scout-") as temporary:
            result = run_worker({"url": url, "max_caption_seconds": max_caption_seconds},
                                Path(temporary), cancel,
                                progress=lambda value: db.update_job(job_id, progress=value))
            if cancel.is_set():
                raise ValueError("Caption check cancelled. This clip was skipped.")
        db.update_job(job_id, status="completed", progress=100,
                      result={**result, "video_id": video_id, "url": url, "max_caption_seconds": max_caption_seconds})
    except Exception as exc:
        reason = str(exc) if isinstance(exc, ValueError) else "Local caption checking failed. This clip was skipped."
        db.update_job(job_id, status="failed", error=reason, result={**unknown_result(video_id, url, reason), "max_caption_seconds": max_caption_seconds})
    finally:
        with CANCEL_LOCK:
            # Absence from the registry means cleanup is finished and the
            # concurrency slot has already become reusable.
            SLOTS.release()
            CANCEL_EVENTS.pop(job_id, None)


def main():
    request_path = Path(sys.argv[1])
    try:
        result = check_in_worker(json.loads(request_path.read_text()), request_path.parent)
    except Exception as exc:
        result = {"error": str(exc) if isinstance(exc, ValueError)
                  else "Local OCR could not read this video. This clip was skipped."}
    (request_path.parent / "result.json").write_text(json.dumps(result))


if __name__ == "__main__":
    main()
