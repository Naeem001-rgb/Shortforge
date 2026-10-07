"""Local, full-track speech screening for Scout's optional small-text policy.

The caller must download the original audio as well as the video, or establish
that the original has no audio. A video-only rendition is not a silent source.
No imports or functions in this module download models. See SCOUT_SPEECH.md.
"""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess

from engine.core import db
from .media import ffmpeg_binary

MODEL_COMMIT = "be95df9152c0d7618fa1edfeb296fc3dae32376f"
MODEL_URL = (f"https://raw.githubusercontent.com/snakers4/silero-vad/{MODEL_COMMIT}"
             "/src/silero_vad/data/silero_vad.onnx")
MODEL_SHA256 = "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"
MODEL_BYTES = 2327524
MODEL_NAME = "Silero VAD v6.2 (ONNX, CPU)"
SAMPLE_RATE = 16000
WINDOW = 512
MAX_DURATION = 180
# AAC priming/resampling can account for a few milliseconds, never seconds.
COVERAGE_TOLERANCE = 0.12
NOTE = "Speech detection is an estimate: music can trigger it, and quiet or very brief speech may be missed."
SETUP_NOTE = "Run python -m engine.studio.setup_scout_speech with ShortForge's Python, then restart the engine."


def model_path() -> Path:
    return db.DATA_DIR / "models" / "scout-speech" / "silero-vad-v6.2.onnx"


def valid_model(path: Path) -> bool:
    """Verify the small pinned file before loading executable model data."""
    try:
        return (path.is_file() and path.stat().st_size == MODEL_BYTES
                and hashlib.sha256(path.read_bytes()).hexdigest() == MODEL_SHA256)
    except OSError:
        return False


def ffprobe_binary() -> str | None:
    configured = os.environ.get("FFPROBE_PATH")
    executable = str(Path(configured).resolve()) if configured and Path(configured).is_file() else shutil.which("ffprobe")
    return executable


def speech_capability() -> dict:
    missing = [name for name in ("numpy", "onnxruntime") if importlib.util.find_spec(name) is None]
    if missing:
        return {"available": False, "message": "Scout speech checking needs local NumPy and ONNX Runtime. "
                "Install engine/requirements-ocr.txt with ShortForge's Python, then "
                "run python -m engine.studio.setup_scout_speech and restart the engine."}
    try:
        ffmpeg_binary()
    except ValueError as exc:
        return {"available": False, "message": str(exc)}
    if not valid_model(model_path()):
        return {"available": False, "message": "The small local Scout speech model is missing or incomplete. " + SETUP_NOTE}
    return {"available": True, "message": "Local Scout speech checking is ready. " + NOTE}


def _unknown(reason: str) -> dict:
    return {"speech_status": "unknown", "speech_seconds": None,
            "speech_analysis_duration": 0, "speech_model": MODEL_NAME,
            "reason": reason + " This clip was skipped."}


def _number(value) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError("The source has missing or unreadable audio or video timing.") from None
    if not math.isfinite(number):
        raise ValueError("The source has unreliable audio or video timing.")
    return number


def _probe_source(path: Path, expected_duration: float) -> tuple[float, dict | None]:
    """Read every frame, so a truncated silent download cannot count as clear."""
    if not math.isfinite(expected_duration) or not 0 < expected_duration <= MAX_DURATION:
        raise ValueError("Speech checking needs a complete video of at most 180 seconds.")
    binary = ffprobe_binary()
    if not binary:
        return _probe_with_ffmpeg(path, expected_duration)
    probe = subprocess.run([binary, "-v", "error", "-threads", "2",
                            "-count_frames", "-show_format", "-show_streams", "-of", "json", str(path)],
                           capture_output=True, text=True, timeout=90)
    if probe.returncode or probe.stderr.strip():
        raise ValueError("The complete original audio and video could not be verified.")
    info = json.loads(probe.stdout)
    streams = info.get("streams", [])
    videos = [s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")]
    audios = [s for s in streams if s.get("codec_type") == "audio"]
    if len(videos) != 1 or len(audios) > 1:
        raise ValueError("The original video or audio tracks could not be checked reliably.")
    video = videos[0]
    duration = _number(video.get("duration") or info.get("format", {}).get("duration"))
    if not 0 < duration <= MAX_DURATION + COVERAGE_TOLERANCE or abs(duration - expected_duration) > 1:
        raise ValueError("The complete video duration could not be verified for speech checking.")
    read_frames = _number(video.get("nb_read_frames"))
    if read_frames <= 0:
        raise ValueError("The original video has no readable frames.")
    declared_frames = video.get("nb_frames")
    if declared_frames not in (None, "N/A") and abs(read_frames - _number(declared_frames)) > 1:
        raise ValueError("The original video is incomplete.")
    # MP4 supplies a frame count; other containers must supply a usable average
    # frame rate. Never treat a metadata duration alone as proof of coverage.
    rate = str(video.get("avg_frame_rate", "0/1")).split("/")
    fps = _number(rate[0]) / _number(rate[1]) if len(rate) == 2 and _number(rate[1]) else 0
    if fps <= 0 or abs(read_frames / fps - duration) > max(0.15, 2 / fps):
        raise ValueError("The original video's full duration could not be read.")
    if not audios:
        return duration, None
    audio = audios[0]
    video_start = _number(video.get("start_time", info.get("format", {}).get("start_time", 0)))
    audio_start = _number(audio.get("start_time", info.get("format", {}).get("start_time", 0)))
    if abs(audio_start - video_start) > COVERAGE_TOLERANCE:
        raise ValueError("The audio does not cover the beginning of the video.")
    if audio.get("duration") not in (None, "N/A") and _number(audio["duration"]) < duration - COVERAGE_TOLERANCE:
        raise ValueError("The original audio is shorter than the video; full speech coverage is unknown.")
    if _number(audio.get("nb_read_frames")) <= 0:
        raise ValueError("The original audio track has no readable frames.")
    return duration, audio


def _probe_with_ffmpeg(path: Path, expected_duration: float) -> tuple[float, dict | None]:
    """The bundled FFmpeg lacks FFprobe; fully decode and verify its timeline.

    Input stream metadata, not the audio-less output, determines track presence.
    A successful process alone is insufficient: decoded time must reach the end.
    """
    command = [ffmpeg_binary(), "-hide_banner", "-nostdin", "-xerror", "-err_detect", "explode",
               "-threads", "2", "-i", str(path), "-map", "0:v:0", "-an", "-sn", "-dn",
               "-t", str(MAX_DURATION + 1), "-threads", "2", "-progress", "pipe:1",
               "-nostats", "-f", "null", "-"]
    probe = subprocess.run(command, capture_output=True, text=True, timeout=90)
    if probe.returncode or "progress=end" not in probe.stdout:
        raise ValueError("The complete original audio and video could not be verified.")
    header = probe.stderr.split("Stream mapping:", 1)[0]
    streams = re.findall(r"^\s*Stream #0:\d+[^\n]*", header, re.MULTILINE)
    videos = [stream for stream in streams if "Video:" in stream and "attached pic" not in stream]
    audios = [stream for stream in streams if "Audio:" in stream]
    duration_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", header)
    times = re.findall(r"^out_time_us=(\d+)$", probe.stdout, re.MULTILINE)
    frames = re.findall(r"^frame=(\d+)$", probe.stdout, re.MULTILINE)
    if len(videos) != 1 or len(audios) > 1 or not duration_match or not times or not frames or int(frames[-1]) <= 0:
        raise ValueError("The original video or audio tracks could not be checked reliably.")
    duration = int(duration_match[1]) * 3600 + int(duration_match[2]) * 60 + float(duration_match[3])
    decoded_duration = int(times[-1]) / 1_000_000
    if (not 0 < duration <= MAX_DURATION + COVERAGE_TOLERANCE
            or abs(duration - expected_duration) > 1 or abs(decoded_duration - duration) > .15):
        raise ValueError("The original video's full duration could not be read.")
    return duration, {"codec_type": "audio"} if audios else None


def _decode_audio(path: Path, duration: float):
    import numpy as np

    # The extra second is a sentinel: long inputs fail coverage checks. This
    # bounds decoded output to under 12 MB without padding any missing sound.
    command = [ffmpeg_binary(), "-hide_banner", "-v", "info", "-nostats", "-nostdin", "-xerror", "-err_detect", "explode",
               "-threads", "2", "-i", str(path), "-map", "0:a:0", "-vn", "-sn", "-dn",
               "-t", str(MAX_DURATION + 1), "-ac", "1", "-ar", str(SAMPLE_RATE),
               "-af", "aformat=sample_fmts=flt:sample_rates=16000:channel_layouts=mono,ashowinfo",
               "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"]
    decoded = subprocess.run(command, capture_output=True, timeout=90)
    if decoded.returncode or not decoded.stdout or len(decoded.stdout) % 4:
        raise ValueError("The whole original audio track could not be decoded.")
    # Showinfo reports timestamps after resampling but before output. This also
    # verifies the beginning on systems shipping FFmpeg without FFprobe.
    frames = re.findall(r"ashowinfo[^\n]*\bpts_time:([\d.eE+-]+)[^\n]*\bnb_samples:(\d+)",
                        decoded.stderr.decode("utf-8", errors="replace"))
    if not frames or abs(_number(frames[0][0])) > COVERAGE_TOLERANCE:
        raise ValueError("The original audio does not cover the beginning of the video.")
    previous_end = _number(frames[0][0])
    for timestamp, count in frames:
        timestamp = _number(timestamp)
        if abs(timestamp - previous_end) > COVERAGE_TOLERANCE:
            raise ValueError("The original audio has gaps; full speech coverage is unknown.")
        previous_end = timestamp + int(count) / SAMPLE_RATE
    audio = np.frombuffer(decoded.stdout, dtype="<f4")
    seconds = len(audio) / SAMPLE_RATE
    if not np.isfinite(audio).all() or abs(seconds - duration) > COVERAGE_TOLERANCE:
        raise ValueError("The decoded audio does not cover the whole video; speech could not be ruled out.")
    return audio


def _speech_seconds(audio) -> float:
    """Use Silero's documented recurrent ONNX inputs, with NumPy only.

    The inference state/context convention follows the MIT-licensed upstream
    OnnxWrapper. Our conservative segmentation counts runs lasting 128 ms,
    joining sub-96 ms gaps with 0.5/0.35 probability hysteresis.
    """
    import numpy as np
    import onnxruntime as ort

    if not valid_model(model_path()):
        raise ValueError("The local speech model failed its integrity check. " + SETUP_NOTE)
    options = ort.SessionOptions()
    options.inter_op_num_threads = 1
    options.intra_op_num_threads = 1
    session = ort.InferenceSession(str(model_path()), sess_options=options, providers=["CPUExecutionProvider"])
    state = np.zeros((2, 1, 128), dtype=np.float32)
    context = np.zeros((1, 64), dtype=np.float32)
    probabilities = []
    for start in range(0, len(audio), WINDOW):
        chunk = np.zeros((1, WINDOW), dtype=np.float32)
        actual = audio[start:start + WINDOW]
        chunk[0, :len(actual)] = actual
        samples = np.concatenate((context, chunk), axis=1)
        output, state = session.run(None, {"input": samples, "state": state,
                                           "sr": np.array(SAMPLE_RATE, dtype=np.int64)})
        probability = float(np.asarray(output).reshape(-1)[0])
        if not math.isfinite(probability) or not 0 <= probability <= 1 or not np.isfinite(state).all():
            raise ValueError("The speech model returned an unreadable result.")
        probabilities.append(probability)
        context = samples[:, -64:].copy()
    return _segment_seconds(probabilities, len(audio))


def _segment_seconds(probabilities: list[float], sample_count: int) -> float:
    start = silence_start = None
    detected = 0
    for index, probability in enumerate(probabilities):
        current = index * WINDOW
        if probability >= .5:
            if start is None:
                start = current
            silence_start = None
        elif start is not None and probability < .35:
            if silence_start is None:
                silence_start = current
            if current - silence_start >= SAMPLE_RATE * .096:
                if silence_start - start >= SAMPLE_RATE * .128:
                    detected += silence_start - start
                start = silence_start = None
    if start is not None:
        end = silence_start if silence_start is not None else sample_count
        if end - start >= SAMPLE_RATE * .128:
            detected += end - start
    return detected / SAMPLE_RATE


def inspect_speech(path: Path, expected_duration: float) -> dict:
    """Return unknown on incomplete input, missing dependencies or any failure."""
    try:
        duration, audio_stream = _probe_source(path, expected_duration)
        if audio_stream is None:
            return {"speech_status": "absent", "speech_seconds": 0,
                    "speech_analysis_duration": round(duration, 3), "speech_model": MODEL_NAME,
                    "reason": "The verified original video has no audio track."}
        capability = speech_capability()
        if not capability["available"]:
            return _unknown(capability["message"])
        audio = _decode_audio(path, duration)
        seconds = _speech_seconds(audio)
        present = seconds > 0
        return {"speech_status": "present" if present else "absent", "speech_seconds": round(seconds, 3),
                "speech_analysis_duration": round(duration, 3), "speech_model": MODEL_NAME,
                "reason": (f"Speech was detected for about {seconds:.1f}s." if present else
                           "No speech was detected across the full audio track.") + " " + NOTE}
    except subprocess.TimeoutExpired:
        return _unknown("Verifying the full audio and video took too long.")
    except (ValueError, TypeError, KeyError, OSError, subprocess.SubprocessError) as exc:
        reason = str(exc) if isinstance(exc, ValueError) and not isinstance(exc, json.JSONDecodeError) else "The complete original audio and video could not be read."
        return _unknown(reason)
    except Exception:
        # ONNX Runtime exceptions are runtime-specific. None can be silence.
        return _unknown("The local speech model could not finish checking this clip.")
