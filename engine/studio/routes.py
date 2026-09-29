"""Studio endpoints: access gate, caption treatment and background MP4 export."""

import json
from pathlib import Path
import subprocess
import tempfile
from threading import Lock
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from engine.core import db
from engine.core.media import get_source
from .captions import all_presets, detect_caption_region, get_preset, make_ass, prepare_fonts, shifted_words
from .media import approximate_words, audio_fit_note, ffmpeg_binary, probe_media, resolve_data_path
from .render import build_export_command

router = APIRouter(prefix="/api")
RENDER_LOCK = Lock()


class CaptionRegion(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    x: float = Field(default=0, ge=0, le=0.98)
    y: float = Field(default=0.6, ge=0, le=0.98)
    width: float = Field(default=1, ge=0.02, le=1)
    height: float = Field(default=0.18, ge=0.02, le=1)

    @model_validator(mode="after")
    def stays_in_frame(self):
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("The caption region must stay inside the video.")
        return self


class ExportRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    clip_id: str
    trim_start: float = Field(default=0, ge=0, le=36000)
    trim_end: float | None = Field(default=None, gt=0, le=36000)
    crop_zoom: float = Field(default=1, ge=1, le=2)
    caption_mode: Literal["none", "blur", "cover", "crop"] = "none"
    caption_region: CaptionRegion = Field(default_factory=CaptionRegion)
    preset: str = "bold-pop"
    captions: bool = True
    caption_text: str | None = Field(default=None, max_length=30000)
    font_size: int = Field(default=64, ge=24, le=120)
    caption_position: float = Field(default=0.75, ge=0.1, le=0.9)
    words_per_line: int = Field(default=4, ge=1, le=12)
    caption_color: str = Field(default="#FFFFFF", pattern=r"^#[0-9a-fA-F]{6}$")
    highlight_color: str = Field(default="#0A84FF", pattern=r"^#[0-9a-fA-F]{6}$")
    audio_mode: Literal["original", "replace", "mix"] = "original"
    original_volume: float = Field(default=1, ge=0, le=2)
    voice_volume: float = Field(default=1, ge=0, le=2)


class DetectRequest(BaseModel):
    clip_id: str


def latest_voice(clip_id: str) -> Path | None:
    with db.connect() as connection:
        row = connection.execute("SELECT path FROM assets WHERE clip_id = ? AND kind = 'voiceover' ORDER BY created_at DESC LIMIT 1", (clip_id,)).fetchone()
    return resolve_data_path(db.DATA_DIR, row["path"]) if row else None


def caption_timing(payload: ExportRequest, duration: float, voiceover: Path | None) -> dict:
    timing = None
    offset = 0
    if voiceover:
        sidecar = voiceover.with_suffix(".timing.json")
        if sidecar.is_file():
            timing = json.loads(sidecar.read_text(encoding="utf-8"))
    else:
        with db.connect() as connection:
            row = connection.execute("SELECT text,words FROM transcripts WHERE clip_id = ?", (payload.clip_id,)).fetchone()
        if row:
            timing = {"text": row["text"], "words": json.loads(row["words"]), "timing_method": "transcript", "timing_note": "Caption timestamps follow the source transcript."}
            offset = payload.trim_start
    if timing and timing.get("words"):
        text_unchanged = payload.caption_text is None or " ".join(payload.caption_text.split()) == " ".join(timing["text"].split())
        if text_unchanged:
            return {**timing, "words": shifted_words(timing["words"], offset, duration)}
    text = payload.caption_text
    if not text and timing:
        text = timing.get("text", "")
    if not text:
        with db.connect() as connection:
            row = connection.execute("SELECT rewritten_text FROM scripts WHERE clip_id = ?", (payload.clip_id,)).fetchone()
        text = row["rewritten_text"] if row else ""
    if not text.strip():
        raise ValueError("Add a transcript or caption text, or turn captions off before exporting.")
    # Even when a sidecar is missing, never spread short narration over a longer
    # video or compress long narration's last words into the selected trim.
    spoken_duration = float(timing.get("duration", duration)) if timing and voiceover else duration
    if voiceover and (not timing or "duration" not in timing):
        spoken_duration = probe_media(voiceover)["duration"]
    note = "Approximate caption timing: text is distributed across the available narration. Transcribe the audio for word timestamps, and review the final video."
    if timing and payload.caption_text and " ".join(payload.caption_text.split()) != " ".join(timing["text"].split()):
        note = "Caption text differs from the saved voice timings; timing is approximate. Review the generated narration and captions together." if voiceover else "Caption text differs from the source transcript; timing is approximate. Original audio remains unchanged. Generate and select a new voiceover to speak the rewritten script."
    words = shifted_words(approximate_words(text, spoken_duration), 0, duration)
    return {"text": text, "words": words, "timing_method": "approximate", "timing_note": note}


def export_summary(payload: ExportRequest, source: Path, voiceover: Path | None) -> tuple[dict, dict, dict]:
    """Preflight information is also returned with the queued job for the UI."""
    media = probe_media(source)
    if not media["video"]:
        raise ValueError("The source has no video stream. Add a playable video before exporting.")
    end = min(payload.trim_end or media["duration"], media["duration"])
    duration = end - payload.trim_start
    if duration <= 0:
        raise ValueError("Trim start must be before the end of the source video.")
    if duration > 600:
        raise ValueError("Trim this video to ten minutes or less before exporting on this local editor.")
    if payload.audio_mode != "original" and not voiceover:
        raise ValueError("Generate a voiceover first, or choose original audio.")
    voice_duration = probe_media(voiceover)["duration"] if voiceover else None
    timing = caption_timing(payload, duration, voiceover) if payload.captions else {"timing_method": "none", "timing_note": "Captions are off."}
    caption_notes = {"none": "", "blur": "Old captions are blurred approximately; their shapes may remain visible.", "cover": "A solid black band covers the selected caption region.", "crop": "Crop cleanup keeps the larger usable area above or below the caption band, then fills the vertical frame. Some surrounding footage is lost."}
    summary = {
        "duration": duration, "source_duration": media["duration"], "voice_duration": voice_duration,
        "width": 1080, "height": 1920,
        "timing_method": timing["timing_method"], "timing_note": timing["timing_note"],
        "audio_note": audio_fit_note(duration, voice_duration, payload.audio_mode, media["audio"], payload.original_volume, payload.voice_volume),
        "caption_note": caption_notes[payload.caption_mode],
        "trim_note": f"Requested end exceeds the source; the export ends at {media['duration']:.2f}s." if payload.trim_end and payload.trim_end > media["duration"] else "",
    }
    return summary, media, timing


@router.get("/presets")
def presets():
    return {"presets": all_presets()}


@router.post("/captions/detect")
def detect(payload: DetectRequest):
    db.require_editable(payload.clip_id)
    _, source = get_source(payload.clip_id)
    try:
        return detect_caption_region(source)
    except (ValueError, subprocess.SubprocessError) as exc:
        raise HTTPException(400, str(exc) if isinstance(exc, ValueError) else "Frame sampling failed. Try adjusting the caption region manually.") from None


def render_job(job_id: str, payload: ExportRequest, source: Path, voiceover: Path | None):
    output = None
    try:
        # One render at a time keeps a modest laptop responsive.
        with RENDER_LOCK:
            db.require_editable(payload.clip_id)
            db.update_job(job_id, status="running", progress=3)
            summary, media, timing = export_summary(payload, source, voiceover)
            duration = summary["duration"]
            db.update_job(job_id, result=summary)
            directory = db.DATA_DIR / "exports"
            directory.mkdir(parents=True, exist_ok=True)
            output = directory / f"{job_id}.mp4"
            ass_name = None
            if payload.captions:
                prepare_fonts(directory)
                ass_name = f"{job_id}.ass"
                (directory / ass_name).write_text(make_ass(timing["words"], get_preset(payload.preset), payload.font_size, payload.caption_position, payload.words_per_line, payload.caption_color, payload.highlight_color), encoding="utf-8")
            command = build_export_command(ffmpeg_binary(), source, output, payload.model_dump(), duration, media["audio"], voiceover, ass_name)
            with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as errors:
                with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors, text=True, cwd=directory) as process:
                    last_progress = 3
                    for line in process.stdout:
                        if line.startswith("out_time_us="):
                            try:
                                progress = min(98, 5 + float(line.split("=", 1)[1]) / 1_000_000 / duration * 93)
                                if progress > last_progress + 1:
                                    db.update_job(job_id, progress=progress)
                                    last_progress = progress
                            except ValueError:
                                pass
                    if process.wait() != 0:
                        errors.seek(0)
                        log = errors.read()
                        if "No such filter: 'ass'" in log or "No such filter: ass" in log:
                            raise ValueError("This FFmpeg build cannot render captions. Install an FFmpeg build with libass or use the packaged binary, then retry.")
                        raise ValueError("FFmpeg could not render this video. Check that the file plays, the trim range is valid, and your FFmpeg build supports H.264 and ASS subtitles.")
            db.require_editable(payload.clip_id)
            asset = db.add_asset(payload.clip_id, "export", output)
            with db.connect() as connection:
                connection.execute("UPDATE clips SET workflow_status = 'exported' WHERE id = ?", (payload.clip_id,))
            summary["audio_note"] = audio_fit_note(duration, summary["voice_duration"], payload.audio_mode, media["audio"], payload.original_volume, payload.voice_volume, completed=True)
            db.update_job(job_id, status="completed", progress=100, result={"asset": asset, **summary})
    except Exception as exc:
        if output:
            output.unlink(missing_ok=True)
        message = str(exc) if isinstance(exc, ValueError) else exc.detail if isinstance(exc, HTTPException) else "Export failed. Check the source file and local media dependencies, then try again."
        db.update_job(job_id, status="failed", error=message)


@router.post("/export")
def export(payload: ExportRequest, background: BackgroundTasks):
    # The gate runs before source, dependencies or work creation, including direct API requests.
    db.require_editable(payload.clip_id)
    _, source = get_source(payload.clip_id)
    try:
        ffmpeg_binary()
        get_preset(payload.preset)
        if payload.trim_end is not None and payload.trim_end <= payload.trim_start:
            raise ValueError("Trim end must come after trim start.")
        voiceover = latest_voice(payload.clip_id) if payload.audio_mode != "original" else None
        summary, _, _ = export_summary(payload, source, voiceover)
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(400, str(exc) if isinstance(exc, ValueError) else "The media could not be inspected. Check that FFmpeg is available and the source plays, then retry.") from None
    job = db.new_job("export", payload.clip_id)
    db.update_job(job["id"], result=summary)
    job["result"] = summary
    background.add_task(render_job, job["id"], payload, source, voiceover)
    return job
