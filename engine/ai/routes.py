"""Writing and voice API. Provider calls happen only after an explicit action."""

import json
from pathlib import Path
import subprocess
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from engine.core import db
from engine.studio.media import audio_fit_note, probe_media, resolve_data_path
from .voice import (
    align_voice,
    builtin_voices,
    clone_readiness,
    elevenlabs_voices,
    provider_list,
    synthesize,
)
from .writing import original_script, rewrite_script

router = APIRouter(prefix="/api")
AUDIO_REFERENCE_FORMATS = {
    ".wav": "wav",
    ".mp3": "mp3",
    ".m4a": "mov",
    ".ogg": "ogg",
    ".flac": "flac",
    ".webm": "matroska",
}


class RewriteRequest(BaseModel):
    clip_id: str
    text: str = Field(default="", max_length=30000)
    mode: Literal["rewrite", "original"] = "rewrite"
    topic: str = Field(default="", max_length=30000)


class ScriptRequest(BaseModel):
    original_text: str = Field(max_length=30000)
    rewritten_text: str = Field(max_length=30000)


class TTSRequest(BaseModel):
    clip_id: str
    text: str = Field(min_length=1, max_length=12000)
    provider: Literal["piper", "espeak", "edge", "elevenlabs", "clone"] = "piper"
    voice_id: str = Field(default="piper-local", max_length=100)
    speed: float = Field(default=1, ge=0.7, le=1.2)
    stability: float = Field(default=0.5, ge=0, le=1)
    pitch: float = Field(default=0, ge=-50, le=50)


@router.post("/rewrite")
def rewrite(payload: RewriteRequest):
    clip = db.get_clip(payload.clip_id)
    # Script work is available for Library references without changing source
    # rights metadata. Cloud writing only runs after this explicit request.
    try:
        if payload.mode == "original":
            # Unknown footage is never fetched or transcribed for this mode.
            topic = (
                payload.topic.strip()
                or f"{clip['title']}\n{clip.get('description', '')}"
            )[:2000]
            result = original_script(topic, db.get_settings())
        else:
            result = rewrite_script(payload.text, db.get_settings())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    db.save_script(payload.clip_id, result["original_text"], result["rewritten_text"])
    return result


@router.put("/scripts/{clip_id}")
def save_script(clip_id: str, payload: ScriptRequest):
    db.get_clip(clip_id)
    return db.save_script(clip_id, payload.original_text, payload.rewritten_text)


def profile_view(row: dict, settings: dict) -> dict:
    available, note = clone_readiness(settings)
    return {
        "id": row["id"],
        "name": row["name"],
        "provider": "clone",
        "language": "English",
        "description": note,
        "available": available,
        "cloned": True,
    }


@router.get("/voices")
def voices():
    settings = db.get_settings()
    with db.connect() as connection:
        profiles = [
            dict(row)
            for row in connection.execute(
                "SELECT * FROM voices ORDER BY created_at DESC"
            )
        ]
    providers = provider_list(settings)
    try:
        remote = elevenlabs_voices(settings)
    except ValueError as exc:
        remote = []
        provider = next(item for item in providers if item["id"] == "elevenlabs")
        provider.update(available=False, note=str(exc))
    return {
        "voices": builtin_voices(settings)
        + remote
        + [profile_view(row, settings) for row in profiles],
        "providers": providers,
    }


@router.post("/voices/clone")
def clone_voice(
    file: UploadFile = File(...),
    name: str = Form(...),
    consent: str = Form(...),
    reference_text: str = Form(""),
):
    path = None
    saved = False
    try:
        if consent != "true":
            raise HTTPException(
                400,
                "Confirm that this is your voice or you have the speaker's permission to clone it.",
            )
        if not name.strip() or len(name) > 80 or len(reference_text) > 5000:
            raise HTTPException(
                400,
                "Add a voice name (up to 80 characters). The optional sample transcript must be under 5,000 characters.",
            )
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in AUDIO_REFERENCE_FORMATS:
            raise HTTPException(
                400, "Use a WAV, MP3, M4A, OGG, FLAC or WebM voice recording."
            )
        identity = str(uuid4())
        path = db.resolve_data_path(Path("voices") / f"{identity}{suffix}")
        path.parent.mkdir(parents=True, exist_ok=True)
        size = 0
        with path.open("wb") as destination:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > 20 * 1024 * 1024:
                    raise ValueError("Voice references must be smaller than 20 MB.")
                destination.write(chunk)
        # Force the declared audio container. A DASH/HLS/concat document with an
        # audio suffix must not reference other local files or remote services.
        media = probe_media(path, input_format=AUDIO_REFERENCE_FORMATS[suffix])
        if not media["audio"] or not 6 <= media["duration"] <= 30:
            raise ValueError(
                "Use a clear 6–30 second voice recording with one speaker and no background music."
            )
        created_at = db.now()
        asset = {
            "id": str(uuid4()),
            "path": str(path.relative_to(db.DATA_DIR.resolve())),
            "created_at": created_at,
        }
        row = {
            "id": identity,
            "name": name.strip(),
            "reference_asset_id": asset["id"],
            "reference_text": reference_text.strip(),
            "consent": 1,
            "created_at": created_at,
        }
        profile = profile_view(row, db.get_settings())
        with db.connect() as connection:
            connection.execute(
                "INSERT INTO assets (id,clip_id,kind,path,created_at) VALUES (:id,NULL,'reference',:path,:created_at)",
                asset,
            )
            connection.execute(
                "INSERT INTO voices (id,name,reference_asset_id,reference_text,consent,created_at) VALUES (:id,:name,:reference_asset_id,:reference_text,:consent,:created_at)",
                row,
            )
        saved = True
        return profile
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except subprocess.TimeoutExpired:
        raise HTTPException(
            400,
            "Reading this voice recording took too long. Try another 6–30 second recording.",
        ) from None
    except (OSError, subprocess.SubprocessError):
        raise HTTPException(
            400,
            "This voice recording could not be read. Try another WAV, MP3, M4A, OGG, FLAC or WebM file.",
        ) from None
    finally:
        file.file.close()
        if path is not None and not saved:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass  # A cleanup error must not hide the original upload error.


@router.delete("/voices/{voice_id}")
def delete_voice(voice_id: str):
    with db.connect() as connection:
        row = connection.execute(
            "SELECT reference_asset_id FROM voices WHERE id = ?", (voice_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "That saved voice was not found.")
        asset_id = row["reference_asset_id"]
        asset = connection.execute(
            "SELECT path FROM assets WHERE id = ?", (asset_id,)
        ).fetchone()
        connection.execute("DELETE FROM voices WHERE id = ?", (voice_id,))
        connection.execute(
            "DELETE FROM assets WHERE id = ? AND kind = 'reference'", (asset_id,)
        )
    if asset:
        try:
            resolve_data_path(db.DATA_DIR, asset["path"]).unlink(missing_ok=True)
        except ValueError:
            pass
    return {"ok": True}


def voice_job(job_id: str, payload: TTSRequest, reference_path: Path | None):
    try:
        db.update_job(job_id, status="running", progress=10)
        directory = db.DATA_DIR / "voiceovers"
        directory.mkdir(parents=True, exist_ok=True)
        path = synthesize(
            payload.text,
            payload.provider,
            payload.voice_id,
            payload.speed,
            payload.pitch,
            directory / f"{job_id}.wav",
            db.get_settings(),
            reference_path,
            stability=payload.stability,
        )
        db.update_job(job_id, progress=80)
        timing = align_voice(path, payload.text)
        path.with_suffix(".timing.json").write_text(
            json.dumps(timing, ensure_ascii=False), encoding="utf-8"
        )
        asset = db.add_asset(payload.clip_id, "voiceover", path)
        audio_note = ""
        # The TTS screen does not choose a video trim. Compare with the full
        # source only, so the user has useful context before entering Export.
        try:
            from engine.core.media import get_source

            _, source = get_source(payload.clip_id)
            source_media = probe_media(source)
            fit = audio_fit_note(
                source_media["duration"],
                timing["duration"],
                "replace",
                source_media["audio"],
            )
            if fit:
                audio_note = (
                    "Compared with the full source video before trimming: " + fit
                )
        except (HTTPException, ValueError, OSError, subprocess.SubprocessError):
            pass
        db.update_job(
            job_id,
            status="completed",
            progress=100,
            result={"asset": asset, **timing, "audio_note": audio_note},
        )
    except Exception as exc:
        message = (
            str(exc)
            if isinstance(exc, ValueError)
            else "Voice generation failed. Check the selected provider, its installed dependencies and connection; then try again."
        )
        db.update_job(job_id, status="failed", error=message)


@router.post("/tts")
def tts(payload: TTSRequest, background: BackgroundTasks):
    db.get_clip(payload.clip_id)
    if not payload.text.strip():
        raise HTTPException(400, "Add narration text first.")
    settings = db.get_settings()
    provider = next(p for p in provider_list(settings) if p["id"] == payload.provider)
    if not provider["available"]:
        raise HTTPException(400, provider["note"])
    if payload.pitch and payload.provider != "edge":
        raise HTTPException(
            400,
            "Pitch is available for Edge voices only. Set pitch to 0 for this provider.",
        )
    reference_path = None
    if payload.provider == "clone":
        with db.connect() as connection:
            profile = connection.execute(
                "SELECT * FROM voices WHERE id = ? AND consent = 1", (payload.voice_id,)
            ).fetchone()
        if not profile:
            raise HTTPException(
                400, "Select a saved voice reference with speaker consent."
            )
        try:
            reference_path = resolve_data_path(
                db.DATA_DIR, db.get_asset(profile["reference_asset_id"])["path"]
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
    elif payload.provider != "elevenlabs" and payload.voice_id not in {
        voice["id"]
        for voice in builtin_voices(settings)
        if voice["provider"] == payload.provider
    }:
        raise HTTPException(400, "Choose a voice belonging to the selected provider.")
    job = db.new_job("tts", payload.clip_id)
    background.add_task(voice_job, job["id"], payload, reference_path)
    return job
