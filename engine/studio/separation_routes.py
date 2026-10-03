"""Non-destructive soundtrack extraction and vocal separation jobs."""

from pathlib import Path
import shutil
import subprocess
from threading import Lock

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from engine.core import db
from .editor_media import editor_media, get_editor_asset
from .separation import SEPARATION_NOTE, extract_audio, separate_audio, separation_capability

router = APIRouter(prefix="/api")
AUDIO_LOCK = Lock()


class AudioRequest(BaseModel):
    asset_id: str = Field(min_length=1, max_length=100)


def check_source(clip_id: str, asset_id: str) -> Path:
    db.require_editable(clip_id)
    try:
        _, path, metadata = get_editor_asset(clip_id, asset_id)
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(400, str(exc) if isinstance(exc, ValueError) else "This media could not be read. Import it again.") from None
    if not metadata["has_audio"]:
        raise HTTPException(400, "This media has no soundtrack. Choose a video or audio file with sound.")
    if not 0 < metadata["duration"] <= 600:
        raise HTTPException(400, "Audio extraction and separation support sources up to ten minutes long.")
    return path


@router.get("/editor-capabilities")
def capabilities():
    from .ocr_captions import ocr_capability
    from .transcription import transcription_capability
    return {"separation": separation_capability(), "transcription":transcription_capability(),
            "ocr":ocr_capability()}


def audio_job(job_id: str, clip_id: str, asset_id: str, split_voice: bool):
    directory = db.DATA_DIR / "editor-audio" / clip_id / job_id
    saved_assets = []
    try:
        with AUDIO_LOCK:
            source = check_source(clip_id, asset_id)
            db.update_job(job_id, status="running", progress=2)
            extracted = extract_audio(source, directory / "soundtrack.wav")
            db.update_job(job_id, progress=10 if split_voice else 85)
            if split_voice:
                vocals, instrumental = separate_audio(extracted, directory, lambda value: db.update_job(job_id, progress=10 + value * .85))
                # Recheck permission after a potentially long model operation.
                db.require_editable(clip_id)
                saved_assets.append(db.add_asset(clip_id, "vocals", vocals))
                saved_assets.append(db.add_asset(clip_id, "instrumental", instrumental))
                result = {"vocals": editor_media(saved_assets[0]), "instrumental": editor_media(saved_assets[1]), "note": SEPARATION_NOTE}
                extracted.unlink(missing_ok=True)
            else:
                db.require_editable(clip_id)
                saved_assets.append(db.add_asset(clip_id, "audio", extracted))
                result = {"asset": editor_media(saved_assets[0])}
            db.update_job(job_id, status="completed", progress=100, result=result)
    except Exception as exc:
        if saved_assets:
            with db.connect() as connection:
                connection.executemany("DELETE FROM assets WHERE id = ?", [(asset["id"],) for asset in saved_assets])
        shutil.rmtree(directory, ignore_errors=True)
        message = exc.detail if isinstance(exc, HTTPException) else str(exc) if isinstance(exc, ValueError) else "Audio processing failed. Check that the source file is still available and try again."
        db.update_job(job_id, status="failed", error=message)


@router.post("/editor/{clip_id}/extract-audio")
def extract(clip_id: str, payload: AudioRequest, background: BackgroundTasks):
    check_source(clip_id, payload.asset_id)
    job = db.new_job("editor_extract_audio", clip_id)
    background.add_task(audio_job, job["id"], clip_id, payload.asset_id, False)
    return job


@router.post("/editor/{clip_id}/separate-audio")
def separate(clip_id: str, payload: AudioRequest, background: BackgroundTasks):
    check_source(clip_id, payload.asset_id)
    capability = separation_capability()
    if not capability["available"]:
        raise HTTPException(503, capability["message"])
    job = db.new_job("editor_separate_audio", clip_id)
    background.add_task(audio_job, job["id"], clip_id, payload.asset_id, True)
    return job
