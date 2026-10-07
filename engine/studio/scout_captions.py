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
from .media import ffmpeg_binary, probe_media

INTERVAL = 0.5
MAX_DURATION = 180
MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024
MAX_WORK_BYTES = 100 * 1024 * 1024
JOB_TIMEOUT = 480
SLOTS = BoundedSemaphore(1)
CANCEL_LOCK = Lock()
CANCEL_EVENTS: dict[str, Event] = {}
NOTE = "Sampled visible-text estimate every 0.5 seconds across the full frame; brief flashes may be missed and scene text can count as captions."
SMALL_TEXT_POLICY = "small-text-no-speech"
POLICIES = {"brief-only", SMALL_TEXT_POLICY}
SMALL_TEXT_NOTE = "Small, short Han-script annotations are allowed; size and amount are estimated, not caption style or language."


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


def unknown_result(video_id: str, url: str, reason: str, policy: str = "brief-only") -> dict:
    result = {"video_id": video_id, "url": url, "status": "unknown", "duration": None,
            "caption_seconds": None, "coverage": None, "frames_scanned": 0,
            "interval": INTERVAL, "reason": reason, "policy": policy}
    if policy == SMALL_TEXT_POLICY:
        result.update(small_text_seconds=None, speech_status="unknown", speech_seconds=None,
                      speech_analysis_duration=None, speech_model=None)
    return result


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


def text_readings(result, width: int, height: int) -> list[dict]:
    """Keep every reading so a small label cannot hide another large caption."""
    if result is None or not hasattr(result, "txts") or width <= 0 or height <= 0:
        raise ValueError("OCR did not return a readable result. This clip was skipped.")
    texts = result.txts
    scores, boxes = getattr(result, "scores", None), getattr(result, "boxes", None)
    try:
        if isinstance(texts, (str, bytes)):
            raise ValueError("Text readings must be a sequence")
        if texts is None or len(texts) == 0:
            if ((scores is not None and len(scores)) or (boxes is not None and len(boxes))):
                raise ValueError("Unexpected OCR boxes without text")
            return []
        if scores is None or boxes is None or len(texts) != len(scores) or len(texts) != len(boxes):
            raise ValueError("Incomplete readings")
        readings = []
        for text, confidence, box in zip(texts, scores, boxes):
            if not isinstance(text, str) or not text.strip() or not math.isfinite(float(confidence)) or not 0 <= float(confidence) <= 1:
                raise ValueError("Invalid text or confidence")
            if len(box) != 4 or any(len(point) != 2 for point in box):
                raise ValueError("Invalid text box")
            xs = [float(point[0]) / width for point in box]
            ys = [float(point[1]) / height for point in box]
            if not all(math.isfinite(value) and 0 <= value <= 1 for value in xs + ys):
                raise ValueError("Text box outside the frame")
            box_width, box_height = max(xs) - min(xs), max(ys) - min(ys)
            if box_width <= 0 or box_height <= 0:
                raise ValueError("Empty text box")
            readings.append({"text": text.strip(), "confidence": float(confidence),
                             "xs": xs, "ys": ys, "width": box_width, "height": box_height})
        return readings
    except (TypeError, ValueError, OverflowError, IndexError):
        raise ValueError("OCR returned incomplete or unreadable text readings. This clip was skipped.") from None


def has_caption_text(result, width: int, height: int) -> bool:
    """Count confident text anywhere; ignore only obvious small corner handles.

    Scene signs and title cards deliberately remain conservative matches. A
    static subtitle is still a subtitle, so persistence alone never ignores it.
    """
    for reading in text_readings(result, width, height):
        text = reading["text"]
        if reading["confidence"] < 0.55 or sum(char.isalnum() for char in text) < 2:
            continue
        xs, ys = reading["xs"], reading["ys"]
        small = reading["width"] <= 0.32 and reading["height"] <= 0.06
        corner = (max(xs) < 0.4 or min(xs) > 0.6) and (max(ys) < 0.15 or min(ys) > 0.85)
        handle = re.fullmatch(r"@?[\w.]+(?:\.com)?", text, re.UNICODE)
        branded = text.lower() in {"tiktok", "instagram", "youtube", "youtube shorts"}
        if small and corner and ((handle and (text.startswith("@") or text.endswith(".com"))) or branded):
            continue
        return True
    return False


def is_han(character: str) -> bool:
    value = ord(character)
    return (0x3400 <= value <= 0x4DBF or 0x4E00 <= value <= 0x9FFF
            or 0xF900 <= value <= 0xFAFF or 0x20000 <= value <= 0x323AF)


def small_text_sample(result, width: int, height: int) -> tuple[bool, bool]:
    """Return (caption, exempt annotation), based on the whole frame's text."""
    readings = [item for item in text_readings(result, width, height)
                if any(character.isalnum() for character in item["text"])]
    if not readings:
        return False, False
    characters = [character for item in readings for character in item["text"] if character.isalnum()]
    allowed = (len(readings) <= 2 and len(characters) <= 12
               and sum(is_han(character) for character in characters) / len(characters) >= .8
               and all(item["confidence"] >= .55 and item["width"] <= .4 + 1e-9
                       and item["height"] <= .06 + 1e-9 for item in readings)
               and sum(item["width"] * item["height"] for item in readings) <= .03 + 1e-9)
    return not allowed, allowed


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


def source_audio_state(info: dict) -> str:
    """Only explicit extractor metadata can establish that a source is silent."""
    formats = info.get("formats") or info.get("requested_formats") or [info]
    if not isinstance(formats, list) or not formats or any(not isinstance(item, dict) for item in formats):
        return "unknown"
    codecs = [item.get("acodec") for item in formats]
    if any(isinstance(codec, str) and codec not in {"", "none"} for codec in codecs):
        return "present"
    return "absent" if all(codec == "none" for codec in codecs) else "unknown"


def download_source(url: str, directory: Path, require_audio: bool = False) -> tuple[Path, float]:
    """Public extraction only: no cookies, login, browser profiles or config."""
    import yt_dlp

    class QuietLog:
        def debug(self, message): pass
        def warning(self, message): pass
        def error(self, message): pass

    def bounded_progress(data):
        if (data.get("downloaded_bytes") or 0) > MAX_DOWNLOAD_BYTES:
            raise ValueError("This video exceeds Scout's 80 MB temporary download limit.")

    video_format = "bv*[height<=1280][width<=1280]/b[height<=1280][width<=1280]"
    if require_audio:
        # Last fallback permits genuinely silent sources, verified below. It
        # must never turn missing/downloaded-away audio into a silent verdict.
        video_format = ("bv[height<=1280][width<=1280]+ba/"
                        "b[height<=1280][width<=1280]/bv[height<=1280][width<=1280]")
    options = {"noplaylist": True, "quiet": True, "no_warnings": True, "logger": QuietLog(),
               "format": video_format,
               "outtmpl": str(directory / "source.%(ext)s"), "max_filesize": MAX_DOWNLOAD_BYTES,
               "socket_timeout": 15, "retries": 1, "fragment_retries": 1,
               "concurrent_fragment_downloads": 1, "cachedir": False,
               "progress_hooks": [bounded_progress]}
    if require_audio:
        options.update(merge_output_format="mkv", ffmpeg_location=ffmpeg_binary())
    audio_state = "unknown"
    with yt_dlp.YoutubeDL(options) as downloader:
        try:
            info = downloader.extract_info(url, download=False)
            duration = float((info or {}).get("duration") or 0)
            if not info or info.get("_type") in {"playlist", "multi_video"} or info.get("is_live"):
                raise ValueError("Choose one public, recorded Short or Reel for caption checking.")
            if not math.isfinite(duration) or not 0 < duration <= MAX_DURATION:
                raise ValueError(f"Scout caption checking supports videos up to {MAX_DURATION} seconds with a known duration.")
            if require_audio:
                audio_state = source_audio_state(info)
                selected = info.get("requested_formats") or [info]
                if audio_state == "present" and source_audio_state({"formats": selected}) == "absent":
                    raise ValueError("Scout could not select the original audio for this video. This clip was skipped.")
            downloader.process_info(info)
        except yt_dlp.utils.DownloadError:
            raise ValueError("The public video could not be downloaded for caption checking. "
                             "It may need login or be unavailable; this clip was skipped.") from None
    files = [path for path in directory.glob("source.*") if path.suffix not in {".part", ".ytdl", ".json"}]
    if len(files) != 1 or not files[0].stat().st_size:
        raise ValueError("The public video download was incomplete or exceeded 80 MB. This clip was skipped.")
    if files[0].stat().st_size > MAX_DOWNLOAD_BYTES:
        raise ValueError("This video exceeds Scout's 80 MB temporary download limit.")
    if require_audio:
        actual = probe_media(files[0])
        # Instagram's direct MP4 entries may omit acodec even when sound is
        # present. A real audio track can be checked; an absent track is safe
        # only when the extractor explicitly established source silence.
        if (not actual.get("video") or (actual.get("audio") and audio_state == "absent")
                or (not actual.get("audio") and audio_state != "absent")):
            raise ValueError("The downloaded video does not contain the source's verified audio. This clip was skipped.")
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


def scan_video(path: Path, expected_duration: float, max_caption_seconds: float, progress=None, reader=None,
               policy: str = "brief-only") -> dict:
    if policy not in POLICIES:
        raise ValueError("Unknown Scout caption policy.")
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
        small_samples = []
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
            reading = reader(frame)
            if policy == SMALL_TEXT_POLICY:
                caption, small_text = small_text_sample(reading, width, height)
                samples.append(caption)
                small_samples.append(small_text)
            else:
                samples.append(has_caption_text(reading, width, height))
            if progress:
                progress(15 + 80 * (index + 1) / total)
        result = classify_samples(samples, duration, max_caption_seconds)
        result["policy"] = policy
        if policy == SMALL_TEXT_POLICY:
            result["small_text_seconds"] = classify_samples(small_samples, duration, duration)["caption_seconds"]
            result["reason"] += " " + SMALL_TEXT_NOTE
        return result
    finally:
        capture.release()


def check_in_worker(config: dict, directory: Path) -> dict:
    policy = config.get("policy", "brief-only")
    if policy not in POLICIES:
        raise ValueError("Unknown Scout caption policy.")
    speech = None
    if policy == SMALL_TEXT_POLICY:
        from .scout_speech import inspect_speech
        path, duration = download_source(config["url"], directory, require_audio=True)
        # Inspect the original A/V file. The OCR proxy deliberately has no audio.
        speech = inspect_speech(path, duration)
        (directory / "progress").write_text("14")
    else:
        path, duration = download_source(config["url"], directory)
    proxy = normalize_source(path)
    path.unlink()  # Only the temporary decoded copy is needed during OCR.
    result = scan_video(proxy, duration, config["max_caption_seconds"], policy=policy,
                        progress=lambda value: (directory / "progress").write_text(str(value)))
    if speech is not None:
        result = combine_speech(result, speech)
    return result


def combine_speech(result: dict, speech: dict) -> dict:
    """A text exception is usable only with a complete, valid speech decision."""
    result = dict(result)
    fields = ("speech_status", "speech_seconds", "speech_analysis_duration", "speech_model")
    result.update({field: speech.get(field) for field in fields})
    seconds, checked = speech.get("speech_seconds"), speech.get("speech_analysis_duration")
    numeric = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    valid = (speech.get("speech_status") in {"absent", "present"} and numeric(seconds) and numeric(checked)
             and 0 <= seconds <= checked and abs(checked - result["duration"]) <= .1
             and isinstance(speech.get("speech_model"), str) and bool(speech["speech_model"].strip()))
    if not valid or (speech["speech_status"] == "absent" and seconds != 0) or (speech["speech_status"] == "present" and seconds == 0):
        result.update(status="unknown", speech_status="unknown")
        result["reason"] = (speech.get("reason") if speech.get("speech_status") == "unknown" else None) or "The whole audio track could not be verified. This clip was skipped."
    elif speech["speech_status"] == "present":
        result["status"] = "speech"
        result["reason"] = speech.get("reason") or "Speech was detected. This option requires a video without speech."
    else:
        result["reason"] += " " + (speech.get("reason") or "No speech was detected across the complete video.")
    return result


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


def caption_check_job(job_id: str, video_id: str, url: str, max_caption_seconds: float, cancel: Event,
                      policy: str = "brief-only"):
    try:
        if cancel.is_set():
            raise ValueError("Caption check cancelled. This clip was skipped.")
        db.update_job(job_id, status="running", progress=1)
        # Default temp storage is deleted on both success and exceptions.
        with tempfile.TemporaryDirectory(prefix="shortforge-scout-") as temporary:
            result = run_worker({"url": url, "max_caption_seconds": max_caption_seconds, "policy": policy},
                                Path(temporary), cancel,
                                progress=lambda value: db.update_job(job_id, progress=value))
            if cancel.is_set():
                raise ValueError("Caption check cancelled. This clip was skipped.")
        db.update_job(job_id, status="completed", progress=100,
                      result={**result, "video_id": video_id, "url": url, "max_caption_seconds": max_caption_seconds,
                              "policy": policy})
    except Exception as exc:
        reason = str(exc) if isinstance(exc, ValueError) else "Local caption checking failed. This clip was skipped."
        db.update_job(job_id, status="failed", error=reason,
                      result={**unknown_result(video_id, url, reason, policy), "max_caption_seconds": max_caption_seconds})
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
