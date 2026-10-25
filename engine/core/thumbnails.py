"""Durable Reel previews, including recovery for imports with no poster."""

import hashlib
from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Lock, Semaphore

from fastapi import HTTPException
import httpx
from PIL import Image, ImageOps

from . import db, media
from .source_urls import canonical_clip_url, instagram_thumbnail_url


_locks = [Lock() for _ in range(32)]
_lookups = Semaphore(3)
MAX_IMAGE_BYTES = 8 * 1024 * 1024


def public_clip(clip: dict) -> dict:
    # The database keeps the original signed URL; clients use our durable URL.
    if (clip.get("video_id") or "").startswith("ig:"):
        return {**clip, "thumbnail_url": f"/api/clips/{clip['id']}/thumbnail"}
    return clip


def cache_path(clip_id: str) -> Path:
    name = hashlib.sha256(clip_id.encode()).hexdigest()
    return db.DATA_DIR / "clip-thumbnails" / f"{name}.jpg"


def remote_thumbnail(clip: dict) -> str:
    _, url = canonical_clip_url(clip["url"], clip["video_id"])
    # A subprocess bounds extractor time as well as individual network requests.
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "yt_dlp",
            "--skip-download",
            "--no-playlist",
            "--no-warnings",
            "--socket-timeout",
            "8",
            "--retries",
            "0",
            "--extractor-retries",
            "0",
            "--print",
            "%(thumbnail)j",
            url,
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode:
        raise ValueError("Instagram preview lookup failed.")
    value = json.loads(result.stdout)
    url = instagram_thumbnail_url(value) if isinstance(value, str) else ""
    if not url:
        raise ValueError("Instagram did not provide a preview.")
    return url


def download_image(url: str, target: Path) -> None:
    if not instagram_thumbnail_url(url):
        raise ValueError("Unsupported preview location.")
    # Never follow a CDN redirect to an arbitrary URL or pass through HTML/SVG.
    with httpx.stream("GET", url, timeout=12, follow_redirects=False) as response:
        response.raise_for_status()
        content = bytearray()
        for chunk in response.iter_bytes():
            content.extend(chunk)
            if len(content) > MAX_IMAGE_BYTES:
                raise ValueError("Preview is too large.")
    with Image.open(BytesIO(content)) as source:
        if source.width * source.height > 20_000_000:
            raise ValueError("Preview dimensions are too large.")
        source.thumbnail((640, 640))
        decoded = ImageOps.exif_transpose(source).convert("RGB")
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=target.parent) as directory:
            output = Path(directory) / "preview.jpg"
            decoded.save(output, "JPEG", quality=85)
            output.replace(target)


def clip_thumbnail(clip_id: str) -> Path:
    clip = db.get_clip(clip_id)
    if not (clip.get("video_id") or "").startswith("ig:"):
        raise HTTPException(404, "No Instagram preview for this clip.")
    target = cache_path(clip_id)
    lock = _locks[int(target.stem[:8], 16) % len(_locks)]
    with lock:
        if target.is_file():
            return target
        # Already downloaded footage works offline and needs no remote lookup.
        try:
            _, source = media.get_source(clip_id)
            from engine.studio.editor_media import media_thumbnail, probe_media

            return media_thumbnail(source, probe_media(source))
        except (HTTPException, ValueError, OSError, subprocess.SubprocessError):
            pass
        with _lookups:
            supplied = instagram_thumbnail_url(clip["thumbnail_url"])
            if supplied:
                try:
                    download_image(supplied, target)
                    return target
                except (httpx.HTTPError, ValueError, OSError):
                    pass  # Expired CDN URLs are recovered from the Reel itself.
            try:
                download_image(remote_thumbnail(clip), target)
            except (
                httpx.HTTPError,
                ValueError,
                OSError,
                subprocess.SubprocessError,
            ) as exc:
                raise HTTPException(
                    404,
                    "Instagram preview is currently unavailable.",
                    headers={"Cache-Control": "no-store"},
                ) from exc
        return target
