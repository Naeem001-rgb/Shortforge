"""Inspect local media, normalize browser video, and generate thumbnails."""

from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

from engine.core import db
from engine.core.media import find_ffprobe
from .media import ffmpeg_binary

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def probe_media(path: Path) -> dict:
    path = Path(path)
    stat = path.stat()
    return dict(_probe(str(path.resolve()), stat.st_mtime_ns, stat.st_size))


@lru_cache(maxsize=256)
def _probe(path: str, modified: int, size: int) -> dict:
    if size == 0:
        raise ValueError("The media file is empty.")
    if Path(path).suffix.lower() in IMAGE_SUFFIXES:
        from PIL import Image, ImageOps, UnidentifiedImageError

        try:
            with Image.open(path) as source:
                if (
                    source.format not in {"PNG", "JPEG", "WEBP"}
                    or getattr(source, "n_frames", 1) != 1
                ):
                    raise ValueError("Choose a still PNG, JPEG, or WebP image.")
                if source.width > 8192 or source.height > 8192:
                    raise ValueError("Use an image no larger than 8K.")
                source.verify()
            with Image.open(path) as source:
                decoded = ImageOps.exif_transpose(source)
                decoded.load()
                width, height = decoded.size
        except (
            UnidentifiedImageError,
            OSError,
            SyntaxError,
            Image.DecompressionBombError,
        ) as exc:
            raise ValueError(
                "This image could not be decoded. Try a different PNG, JPEG, or WebP."
            ) from exc
        return {
            "duration": 5.0,
            "width": width,
            "height": height,
            "has_audio": False,
            "media_type": "image",
        }
    ffprobe = find_ffprobe()
    info = None
    if ffprobe:
        process = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-show_format",
                "-show_streams",
                "-of",
                "json",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if process.returncode == 0:
            info = json.loads(process.stdout)
    if info is not None:
        streams = info.get("streams", [])
        video = next(
            (
                s
                for s in streams
                if s.get("codec_type") == "video"
                and not s.get("disposition", {}).get("attached_pic")
            ),
            None,
        )
        audio = any(s.get("codec_type") == "audio" for s in streams)
        durations = [info.get("format", {}).get("duration")] + [
            s.get("duration") for s in streams
        ]
        duration = max(
            (float(d) for d in durations if d not in {None, "N/A"}), default=0
        )
        width, height = (
            (int(video.get("width", 0)), int(video.get("height", 0)))
            if video
            else (0, 0)
        )
        rotation = next(
            (
                float(s.get("rotation", 0))
                for s in (video or {}).get("side_data_list", [])
                if "rotation" in s
            ),
            0,
        )
        if abs(rotation) % 180 == 90:
            width, height = height, width
    else:
        result = subprocess.run(
            [
                ffmpeg_binary(),
                "-hide_banner",
                "-protocol_whitelist",
                "file,pipe",
                "-i",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        log = result.stderr
        match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", log)
        duration = (
            int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3]) if match else 0
        )
        video_line = next(
            (
                line
                for line in log.splitlines()
                if "Video:" in line and "attached pic" not in line
            ),
            "",
        )
        dimensions = re.search(r"\b(\d{2,5})x(\d{2,5})\b", video_line)
        width, height = (
            (int(dimensions[1]), int(dimensions[2])) if dimensions else (0, 0)
        )
        rotation = re.search(r"rotation of (-?\d+(?:\.\d+)?) degrees", log)
        if rotation and abs(float(rotation[1])) % 180 == 90:
            width, height = height, width
        video, audio = bool(video_line), "Audio:" in log
    if not math.isfinite(duration) or duration <= 0 or not (video or audio):
        raise ValueError(
            "This file is not readable audio or video with a known duration. Try MP4, WebM, WAV, or MP3."
        )
    if duration > 86400 or width > 8192 or height > 8192:
        raise ValueError("Use media shorter than 24 hours and no larger than 8K.")
    return {
        "duration": duration,
        "width": width,
        "height": height,
        "has_audio": audio,
        "media_type": "video" if video else "audio",
    }


def normalize_browser_video(path: Path) -> Path:
    """Return browser-playable MP4, keeping external originals untouched."""
    inspection = subprocess.run(
        [
            ffmpeg_binary(),
            "-hide_banner",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    video_line = next(
        (line for line in inspection.stderr.splitlines() if "Video:" in line), ""
    )
    audio_line = next(
        (line for line in inspection.stderr.splitlines() if "Audio:" in line), ""
    )
    video_compatible = "Video: h264" in video_line and bool(
        re.search(r"\byuv420p\b", video_line)
    )
    audio_compatible = not audio_line or "Audio: aac" in audio_line
    if path.suffix.lower() == ".mp4" and video_compatible and audio_compatible:
        return path
    output = path.with_name(path.stem + "-playable.mp4")
    command = [
        ffmpeg_binary(),
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        str(path),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
    ]
    if video_compatible:
        command += ["-c:v", "copy"]
    else:
        command += [
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-threads",
            "2",
        ]
    command += ["-c:a", "copy"] if audio_compatible else ["-c:a", "aac", "-b:a", "192k"]
    command += ["-movflags", "+faststart", str(output)]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=1800)
        if result.returncode:
            raise ValueError(
                "This video could not be converted for playback. Try a different MP4 file."
            )
        probe_media(output)
        return output
    except BaseException:
        output.unlink(missing_ok=True)
        raise


def media_thumbnail(path: Path, metadata: dict) -> Path:
    """Content-versioned local preview; never register it as editable media."""
    stat = path.stat()
    version = hashlib.sha256(
        f"{path.resolve()}:{stat.st_mtime_ns}:{stat.st_size}".encode()
    ).hexdigest()[:24]
    target = db.DATA_DIR / "editor-thumbnails" / (version + ".jpg")
    if target.is_file():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    import tempfile

    with tempfile.TemporaryDirectory(dir=target.parent) as directory:
        output = Path(directory) / "thumbnail.jpg"
        if metadata["media_type"] == "image":
            from PIL import Image, ImageOps

            with Image.open(path) as source:
                decoded = ImageOps.exif_transpose(source).convert("RGB")
                decoded.thumbnail((320, 320))
                decoded.save(output, quality=85)
        else:
            command = [
                ffmpeg_binary(),
                "-v",
                "error",
                "-nostdin",
                "-y",
                "-ss",
                str(min(0.5, metadata["duration"] / 2)),
                "-protocol_whitelist",
                "file,pipe",
                "-i",
                str(path),
                "-frames:v",
                "1",
                "-vf",
                "scale=320:320:force_original_aspect_ratio=decrease",
                "-q:v",
                "3",
                str(output),
            ]
            result = subprocess.run(command, capture_output=True, timeout=30)
            if result.returncode or not output.is_file():
                raise ValueError(
                    "A preview frame could not be generated. The media is still available."
                )
        output.replace(target)
    return target
