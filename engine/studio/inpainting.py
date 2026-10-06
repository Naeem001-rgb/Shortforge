"""Local, cancellable caption removal jobs. Source media is never overwritten."""
import importlib.util
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
from threading import Lock

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import Field, model_validator

from engine.core import db
from engine.core.media import find_ffprobe
from .editor_media import editor_media, get_editor_asset
from .editor_models import StrictModel
from .setup_inpainting import model_path

router = APIRouter(prefix="/api/editor")
INPAINT_LOCK = Lock()
NOTE = "AI rebuilds the picture separately in each frame. Moving backgrounds may flicker or look smudged. Check the preview before using it."


def inpainting_capability():
    runtime_ready = all(importlib.util.find_spec(name) is not None for name in ("onnxruntime", "cv2", "rapidocr"))
    ready = model_path().is_file() and model_path().stat().st_size == 28079181
    return {"available": runtime_ready and ready, "model_ready": ready, "message":
            "Local AI caption removal is ready. Preview a short section first." if runtime_ready and ready else
            "AI caption removal needs local setup. See docs/CAPTION-REMOVAL.md.", "note": NOTE}


class RemovalRegion(StrictModel):
    x: float = Field(0.05, ge=0, lt=1, allow_inf_nan=False)
    y: float = Field(0.6, ge=0, lt=1, allow_inf_nan=False)
    width: float = Field(0.9, gt=0, le=1, allow_inf_nan=False)
    height: float = Field(0.14, gt=0, le=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def inside_picture(self):
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("Keep the caption area inside the picture.")
        return self


class RemovalRequest(StrictModel):
    asset_id: str = Field(min_length=1, max_length=120)
    item_id: str = Field(min_length=1, max_length=120)
    start: float = Field(0, ge=0, le=86400, allow_inf_nan=False)
    duration: float = Field(gt=0, le=600, allow_inf_nan=False)
    preview: bool = True
    mask_mode: str = Field("text", pattern="^(text|area)$")
    region: RemovalRegion = Field(default_factory=RemovalRegion)


def source_for_request(clip_id, payload):
    db.require_editable(clip_id)
    try:
        asset, path, metadata = get_editor_asset(clip_id, payload.asset_id)
    except (ValueError, OSError, subprocess.SubprocessError):
        raise HTTPException(400, "The source could not be read. Import or relink it first.") from None
    if metadata["media_type"] != "video":
        raise HTTPException(400, "Select a video to remove its burned-in captions.")
    if payload.start >= metadata["duration"] or payload.start + payload.duration > metadata["duration"] + .05:
        raise HTTPException(400, "The selection extends past the source video. Adjust its timing and try again.")
    if payload.preview and payload.duration > 2:
        raise HTTPException(400, "Caption-removal previews support up to two seconds.")
    if metadata["width"] * metadata["height"] > 3840 * 2160:
        raise HTTPException(400, "Use a video at 4K resolution or below for local caption removal.")
    return asset, path, metadata


def video_fps(path):
    probe = find_ffprobe()
    if probe:
        result = subprocess.run([probe, "-v", "error", "-select_streams", "v:0", "-show_entries",
                                 "stream=avg_frame_rate", "-of", "json", str(path)],
                                capture_output=True, text=True, timeout=30)
        try:
            num, den = json.loads(result.stdout)["streams"][0]["avg_frame_rate"].split("/")
            rate = float(num) / float(den)
            if math.isfinite(rate) and 1 <= rate <= 120:
                return rate
        except (ValueError, KeyError, IndexError, ZeroDivisionError):
            pass
    # OpenCV is also present on installations using only the packaged FFmpeg.
    import cv2
    capture = cv2.VideoCapture(str(path))
    try:
        rate = capture.get(cv2.CAP_PROP_FPS)
        return rate if math.isfinite(rate) and 1 <= rate <= 120 else 30
    finally:
        capture.release()


def removal_job(job_id, clip_id, payload):
    directory = db.DATA_DIR / "caption-removal" / clip_id / job_id
    process = None
    saved_asset = None
    try:
        asset, source, metadata = source_for_request(clip_id, payload)
        directory.mkdir(parents=True, exist_ok=True)
        cancelled = directory / "cancel"
        if cancelled.exists():
            raise ValueError("Caption removal cancelled. Your original is unchanged.")
        output = directory / ("caption-removal-preview.mp4" if payload.preview else "captions-removed.mp4")
        request = payload.model_dump()
        config = {**request, "source": str(source), "output": str(output), "cancel": str(cancelled),
                  "model": str(model_path()), "width": metadata["width"] // 2 * 2,
                  "height": metadata["height"] // 2 * 2, "fps": video_fps(source)}
        config_path = directory / "request.json"
        config_path.write_text(json.dumps(config))
        db.update_job(job_id, status="running", progress=1, result={"request": request})
        # A separate process releases model memory after completion or failure.
        process = subprocess.Popen([sys.executable, "-m", "engine.studio.inpainting_worker", str(config_path)],
                                   cwd=Path(__file__).resolve().parents[2], stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, text=True)
        failure = "AI removal stopped. Close memory-heavy apps and try a one-second preview."
        stats = None
        for line in process.stdout:
            try:
                data = json.loads(line)
            except ValueError:
                continue  # Optional model libraries may log to stdout.
            if "error" in data:
                failure = data["error"]
            elif "done" in data:
                stats = data["done"]
            elif "progress" in data:
                db.update_job(job_id, progress=data["progress"], result={"request": request, **data})
        if process.wait() or stats is None:
            raise ValueError(failure)
        if cancelled.exists():
            raise ValueError("Caption removal cancelled. Your original is unchanged.")
        db.require_editable(clip_id)
        # Names are metadata only, never filesystem paths.
        title = editor_media(asset)["name"]
        output.with_suffix(".mp4.name.json").write_text(json.dumps({"name": f"{title} — {'removal preview' if payload.preview else 'captions removed'}"}))
        saved_asset = db.add_asset(clip_id, "video", output)
        result = {"request": request, "asset": editor_media(saved_asset), "note": NOTE, **stats}
        db.update_job(job_id, status="completed", progress=100, result=result)
        config_path.unlink(missing_ok=True)
    except Exception as exc:
        if saved_asset:
            with db.connect() as connection:
                connection.execute("DELETE FROM assets WHERE id=?", (saved_asset["id"],))
        shutil.rmtree(directory, ignore_errors=True)
        message = exc.detail if isinstance(exc, HTTPException) else str(exc) if isinstance(exc, ValueError) else "Caption removal failed. Try a shorter selection."
        db.update_job(job_id, status="failed", error=message)
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()
        INPAINT_LOCK.release()


@router.post("/{clip_id}/remove-captions")
def remove_captions(clip_id: str, payload: RemovalRequest, background: BackgroundTasks):
    source_for_request(clip_id, payload)
    capability = inpainting_capability()
    if not capability["available"]:
        raise HTTPException(503, capability["message"])
    if not INPAINT_LOCK.acquire(blocking=False):
        raise HTTPException(409, "Another caption removal is running. Finish or cancel it first.")
    try:
        job = db.new_job("editor_remove_captions", clip_id)
        db.update_job(job["id"], result={"request": payload.model_dump()})
        background.add_task(removal_job, job["id"], clip_id, payload)
        return db.get_job(job["id"])
    except BaseException:
        INPAINT_LOCK.release()
        raise


@router.post("/{clip_id}/remove-captions/{job_id}/cancel")
def cancel_removal(clip_id: str, job_id: str):
    db.require_editable(clip_id)
    job = db.get_job(job_id)
    if job["clip_id"] != clip_id or job["type"] != "editor_remove_captions":
        raise HTTPException(404, "Caption removal job not found.")
    if job["status"] in {"queued", "running"}:
        directory = db.DATA_DIR / "caption-removal" / clip_id / job_id
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "cancel").touch()
    return {"message": "Cancellation requested. Finishing the current frame."}
