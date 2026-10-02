"""Optional media tools. Importing the engine never downloads a model."""

import importlib.util
import os
from pathlib import Path
import re
import shutil
import subprocess

from fastapi import HTTPException

from . import db


def tool_available(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def find_ffmpeg() -> str | None:
    configured = os.getenv("FFMPEG_PATH")
    if configured and Path(configured).is_file():
        return str(Path(configured).resolve())
    executable = shutil.which("ffmpeg")
    if executable:
        return executable
    if tool_available("imageio_ffmpeg"):
        try:
            import imageio_ffmpeg
            return imageio_ffmpeg.get_ffmpeg_exe()
        except RuntimeError:
            return None
    return None


def find_ffprobe() -> str | None:
    configured = os.getenv("FFPROBE_PATH")
    if configured and Path(configured).is_file():
        return str(Path(configured).resolve())
    if executable := shutil.which("ffprobe"):
        return executable
    ffmpeg = find_ffmpeg()
    if ffmpeg:
        sibling = Path(ffmpeg).with_name("ffprobe.exe" if os.name == "nt" else "ffprobe")
        if sibling.is_file():
            return str(sibling)
    return None


def get_source(clip_id: str) -> tuple[dict, Path]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM assets WHERE clip_id = ? AND kind = 'source' ORDER BY created_at DESC LIMIT 1", (clip_id,)).fetchone()
    if row is None:
        raise HTTPException(400, "Add your own video or download this clip before continuing.")
    asset = db.asset_dict(row)
    path = db.resolve_data_path(asset["path"])
    if not path.is_file():
        raise HTTPException(404, "The source video is missing from the data folder. Import it again.")
    return asset, path


def media_duration(path: Path) -> float | None:
    executable = find_ffmpeg()
    if not executable:
        return None
    result = subprocess.run([executable, "-hide_banner", "-i", str(path)], capture_output=True, text=True, timeout=20)
    match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", result.stderr)
    if match:
        return int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])
    return None


def transcribe_file(path: Path, model_name: str | None = None) -> dict:
    if not tool_available("faster_whisper"):
        raise RuntimeError("Local transcription is optional. Install faster-whisper in the engine environment, then download a base or small model yourself. No model was downloaded.")
    from faster_whisper import WhisperModel

    model_name = model_name or db.get_settings().get("whisper_model") or "base"
    local_model = Path(model_name).expanduser()
    if local_model.is_dir():
        model_name = str(local_model.resolve())
    try:
        model = WhisperModel(model_name, device="cpu", compute_type="int8", local_files_only=True,
                             download_root=str(db.DATA_DIR / "models" / "whisper"), cpu_threads=min(os.cpu_count() or 2, 4))
    except Exception as exc:
        raise RuntimeError("The Whisper model is not installed locally. Set its existing folder in Settings, or download base/small into data/models/whisper before trying again. No model was downloaded.") from exc
    segments, _ = model.transcribe(str(path), word_timestamps=True, vad_filter=True)
    text_parts = []
    words = []
    for segment in segments:
        text_parts.append(segment.text.strip())
        for word in segment.words or []:
            clean_word = word.word.strip()
            if clean_word:
                words.append({"word": clean_word, "start": round(max(0, word.start), 3), "end": round(max(word.start, word.end), 3)})
    return {"text": " ".join(text_parts), "words": words}


def transcribe_job(job_id: str, clip_id: str, path: Path, model_name: str | None):
    try:
        db.require_editable(clip_id)
        db.update_job(job_id, status="running", progress=10)
        transcript = transcribe_file(path, model_name)
        from .script_extraction import persist_original_transcript
        persist_original_transcript(clip_id, transcript)
        db.update_job(job_id, status="completed", progress=100, result=transcript)
    except Exception as exc:
        db.update_job(job_id, status="failed", error=str(exc))


class QuietDownloadLogger:
    # yt-dlp messages can include remote request URLs. Keep them out of logs.
    def debug(self, message):
        pass

    def warning(self, message):
        pass

    def error(self, message):
        pass


def download_job(job_id: str, clip_id: str):
    output = None
    try:
        import yt_dlp
        from engine.studio.editor_media import normalize_browser_video, probe_media
        clip = db.require_editable(clip_id)
        db.update_job(job_id, status="running", progress=1)
        output = db.DATA_DIR / "downloads" / clip_id / job_id
        output.mkdir(parents=True, exist_ok=True)

        def progress(hook):
            if hook["status"] == "downloading":
                total = hook.get("total_bytes") or hook.get("total_bytes_estimate")
                if total:
                    db.update_job(job_id, progress=min(90, hook.get("downloaded_bytes", 0) / total * 90))
            elif hook["status"] == "finished":
                db.update_job(job_id, progress=95)

        options = {
            "format": "bestvideo[ext=mp4][width<=1080][height<=1920]+bestaudio[ext=m4a]/best[ext=mp4][width<=1080][height<=1920]/best[width<=1080][height<=1920]",
            "outtmpl": str(output / "source.%(ext)s"), "merge_output_format": "mp4",
            "ffmpeg_location": find_ffmpeg(), "noplaylist": True, "quiet": True,
            "no_warnings": True, "logger": QuietDownloadLogger(), "progress_hooks": [progress],
            "socket_timeout": 30, "retries": 2, "max_filesize": 500 * 1024 * 1024,
            "restrictfilenames": True,
        }
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(clip["url"], download=True)
            proposed = Path(downloader.prepare_filename(info))
        candidates = [proposed.with_suffix(".mp4"), proposed, *output.glob("source.*")]
        path = next((p for p in candidates if p.is_file() and p.suffix in {".mp4", ".mkv", ".webm", ".mov"}), None)
        if path is None:
            raise RuntimeError("YouTube did not produce a downloadable video. Update yt-dlp or upload footage you own.")
        playable = normalize_browser_video(path)
        probe_media(playable)
        if playable != path:
            path.unlink(missing_ok=True)
            path = playable
        db.require_editable(clip_id)
        asset = db.add_asset(clip_id, "source", path)
        with db.connect() as conn:
            conn.execute("UPDATE clips SET workflow_status='downloaded' WHERE id=? AND workflow_status='collected'", (clip_id,))
        db.update_job(job_id, status="completed", progress=100, result={"asset": asset})
    except Exception as exc:
        if output:
            shutil.rmtree(output, ignore_errors=True)
        message = str(exc)
        if isinstance(exc, HTTPException):
            message = str(exc.detail)
        elif not isinstance(exc, (RuntimeError, ValueError)):
            message = "Download failed. YouTube may require a browser session or a newer yt-dlp. Try again after updating yt-dlp, or upload your own video."
        db.update_job(job_id, status="failed", error=message)
