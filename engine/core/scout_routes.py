"""Background caption checks which do not create Library clips."""
from threading import Event
import time

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from . import db
from .source_urls import canonical_clip_url
from engine.studio import scout_captions

router = APIRouter(prefix="/api/scout")
CANCEL_WAIT_SECONDS = 2.0


class CaptionCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=2048)
    max_caption_seconds: float = Field(3, ge=0, le=10, allow_inf_nan=False)


@router.post("/caption-check")
def caption_check(payload: CaptionCheckRequest, background: BackgroundTasks):
    video_id, url = canonical_clip_url(payload.url)
    capability = scout_captions.caption_capability()
    if not capability["available"]:
        raise HTTPException(503, capability["message"])
    if not scout_captions.SLOTS.acquire(blocking=False):
        raise HTTPException(409, "Scout is already checking a video's captions. Wait for it to finish or cancel that check.")
    job = None
    try:
        job = db.new_job("scout_caption_check", None)
        cancel = Event()
        with scout_captions.CANCEL_LOCK:
            scout_captions.CANCEL_EVENTS[job["id"]] = cancel
        db.update_job(job["id"], result={"video_id": video_id, "url": url,
                                       "max_caption_seconds": payload.max_caption_seconds})
        background.add_task(scout_captions.caption_check_job, job["id"], video_id, url,
                            payload.max_caption_seconds, cancel)
        return db.get_job(job["id"])
    except Exception:
        with scout_captions.CANCEL_LOCK:
            scout_captions.SLOTS.release()
            if job:
                scout_captions.CANCEL_EVENTS.pop(job["id"], None)
        raise


@router.post("/caption-check/{job_id}/cancel")
def cancel_caption_check(job_id: str):
    job = db.get_job(job_id)
    if job["type"] != "scout_caption_check":
        raise HTTPException(404, "Scout caption check not found.")
    with scout_captions.CANCEL_LOCK:
        cancel = scout_captions.CANCEL_EVENTS.get(job_id)
        if cancel:
            cancel.set()
    # A new check may follow this response immediately. Wait briefly for the
    # worker to remove its files and release the slot before acknowledging it.
    # A stalled worker still returns its actual running status after two seconds.
    deadline = time.monotonic() + CANCEL_WAIT_SECONDS
    while cancel:
        with scout_captions.CANCEL_LOCK:
            active = job_id in scout_captions.CANCEL_EVENTS
        remaining = deadline - time.monotonic()
        if not active or remaining <= 0:
            break
        time.sleep(min(.02, remaining))
    return db.get_job(job_id)
