"""Publish a saved export with durable, resumable YouTube upload state.

The session URL is a credential: keep it in SQLite and never send it to the UI.
An uncertain final request is always probed before anything can be sent again.
"""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import time
from typing import Literal
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException
import httpx
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

from . import db, youtube_auth

router = APIRouter(prefix="/api/youtube", tags=["YouTube publishing"])
CHUNK_SIZE = 8 * 1024 * 1024  # YouTube requires multiples of 256 KiB.
POLL_SECONDS = 30
API_ROOT = "https://www.googleapis.com/youtube/v3"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
_WORKERS = ThreadPoolExecutor(max_workers=2, thread_name_prefix="youtube-upload")
_PUBLIC_FIELDS = (
    "id",
    "clip_id",
    "asset_id",
    "channel_id",
    "channel_title",
    "title",
    "privacy_status",
    "status",
    "progress",
    "error",
    "video_id",
    "created_at",
    "updated_at",
)
_SCHEMA = """
CREATE TABLE IF NOT EXISTS youtube_uploads (
    id TEXT PRIMARY KEY, clip_id TEXT NOT NULL, asset_id TEXT NOT NULL,
    channel_id TEXT NOT NULL, channel_title TEXT NOT NULL, title TEXT NOT NULL,
    privacy_status TEXT NOT NULL, metadata TEXT NOT NULL,
    status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, error TEXT,
    video_id TEXT, retryable INTEGER NOT NULL DEFAULT 0,
    session_url TEXT, bytes_uploaded INTEGER NOT NULL DEFAULT 0,
    final_attempted INTEGER NOT NULL DEFAULT 0,
    file_size INTEGER NOT NULL, file_sha256 TEXT NOT NULL,
    next_attempt_at REAL NOT NULL DEFAULT 0, process_checked_at REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(asset_id, channel_id)
);
CREATE INDEX IF NOT EXISTS youtube_uploads_by_clip ON youtube_uploads(clip_id, created_at);
"""


class UploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    clip_id: str = Field(min_length=1)
    asset_id: str = Field(min_length=1)
    channel_id: str = Field(min_length=1)
    title: str = Field(max_length=100)
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    privacy_status: Literal["private", "unlisted", "public"] = "private"
    self_declared_made_for_kids: StrictBool
    contains_synthetic_media: StrictBool

    @field_validator("title")
    @classmethod
    def valid_title(cls, value):
        value = value.strip()
        if not value or any(c in value for c in "<>\x00"):
            raise ValueError(
                "Enter a title without angle brackets, up to 100 characters."
            )
        return value

    @field_validator("description")
    @classmethod
    def valid_description(cls, value):
        if len(value.encode("utf-8")) > 5000 or any(c in value for c in "<>\x00"):
            raise ValueError(
                "Description must be at most 5000 UTF-8 bytes, without angle brackets."
            )
        return value

    @field_validator("tags")
    @classmethod
    def valid_tags(cls, values):
        tags = [value.strip() for value in values]
        if any(not tag or any(c in tag for c in "<>\x00") for tag in tags):
            raise ValueError("Tags must be nonempty and contain no angle brackets.")
        # YouTube counts separating commas and quotes around tags containing spaces.
        length = sum(len(tag) + (2 if " " in tag else 0) for tag in tags)
        if length + max(0, len(tags) - 1) > 500:
            raise ValueError("Tags exceed YouTube's combined 500-character limit.")
        return tags


def init_storage():
    with db.connect() as conn:
        conn.executescript(_SCHEMA)


def _row(upload_id):
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM youtube_uploads WHERE id=?", (upload_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "YouTube upload not found.")
    return dict(row)


def _public(row):
    return {
        **{key: row[key] for key in _PUBLIC_FIELDS},
        "retryable": bool(row["retryable"]),
        "video_url": f"https://www.youtube.com/watch?v={row['video_id']}"
        if row["video_id"]
        else None,
    }


def _update(upload_id, **fields):
    fields["updated_at"] = db.now()
    with db.connect() as conn:
        conn.execute(
            "UPDATE youtube_uploads SET "
            + ",".join(f"{key}=?" for key in fields)
            + " WHERE id=?",
            (*fields.values(), upload_id),
        )


def _export_path(clip_id, asset_id) -> Path:
    db.get_clip(clip_id)
    asset = db.get_asset(asset_id)
    if asset["clip_id"] != clip_id or asset["kind"] != "export":
        raise HTTPException(422, "Choose a saved export belonging to this project.")
    path = db.resolve_data_path(asset["path"])
    if (
        path.suffix.lower() not in {".mp4", ".webm"}
        or not path.is_file()
        or not path.stat().st_size
    ):
        raise HTTPException(
            422, "This saved export is missing or empty. Export the video again."
        )
    return path


def _fingerprint(stream):
    digest = hashlib.sha256()
    size = 0
    while block := stream.read(CHUNK_SIZE):
        size += len(block)
        digest.update(block)
    stream.seek(0)
    return size, digest.hexdigest()


@router.post("/uploads")
def create_upload(payload: UploadRequest, background: BackgroundTasks):
    init_storage()
    with db.connect() as conn:
        existing = conn.execute(
            "SELECT * FROM youtube_uploads WHERE asset_id=? AND channel_id=?",
            (payload.asset_id, payload.channel_id),
        ).fetchone()
    if existing:
        if existing["clip_id"] != payload.clip_id:
            raise HTTPException(422, "Choose a saved export belonging to this project.")
        return _public(dict(existing))
    channel = youtube_auth.get_channel(payload.channel_id)
    path = _export_path(payload.clip_id, payload.asset_id)
    with path.open("rb") as stream:
        size, digest = _fingerprint(stream)
    metadata = {
        "snippet": {
            "title": payload.title,
            "description": payload.description,
            "categoryId": "22",
        },
        "status": {
            "privacyStatus": payload.privacy_status,
            "selfDeclaredMadeForKids": payload.self_declared_made_for_kids,
            "containsSyntheticMedia": payload.contains_synthetic_media,
        },
    }
    if payload.tags:
        metadata["snippet"]["tags"] = payload.tags
    now = db.now()
    upload_id = str(uuid4())
    with db.connect() as conn:
        created = conn.execute(
            """INSERT OR IGNORE INTO youtube_uploads
            (id,clip_id,asset_id,channel_id,channel_title,title,privacy_status,metadata,status,
             file_size,file_sha256,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                upload_id,
                payload.clip_id,
                payload.asset_id,
                payload.channel_id,
                channel["title"],
                payload.title,
                payload.privacy_status,
                json.dumps(metadata),
                "queued",
                size,
                digest,
                now,
                now,
            ),
        ).rowcount
        row = dict(
            conn.execute(
                "SELECT * FROM youtube_uploads WHERE asset_id=? AND channel_id=?",
                (payload.asset_id, payload.channel_id),
            ).fetchone()
        )
    if created:
        background.add_task(_schedule_upload, upload_id)
    return _public(row)


@router.get("/uploads")
def list_uploads(clip_id: str):
    init_storage()
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM youtube_uploads WHERE clip_id=? ORDER BY created_at DESC",
            (clip_id,),
        ).fetchall()
    return {"uploads": [_public(dict(row)) for row in rows]}


@router.get("/uploads/{upload_id}")
def get_upload(upload_id: str):
    init_storage()
    row = _row(upload_id)
    if row["status"] == "processing" and row["video_id"]:
        _poll_processing(row)
        row = _row(upload_id)
    return _public(row)


@router.post("/uploads/{upload_id}/retry")
def retry_upload(upload_id: str, background: BackgroundTasks):
    init_storage()
    row = _row(upload_id)
    if row["status"] in {"queued", "uploading", "processing", "completed"}:
        return _public(row)
    if not row["retryable"] or row["video_id"]:
        raise HTTPException(
            409, "Check this upload in YouTube Studio before starting another upload."
        )
    if row["next_attempt_at"] > time.time():
        raise HTTPException(
            429, "YouTube asked ShortForge to wait. Please retry later."
        )
    youtube_auth.get_channel(row["channel_id"])
    # A completed remote upload can be recovered without its local file. Do not
    # force a fresh export before checking whether the last request succeeded.
    if not row["session_url"]:
        _export_path(row["clip_id"], row["asset_id"])
    with db.connect() as conn:
        changed = conn.execute(
            """UPDATE youtube_uploads SET status='queued',error=NULL,retryable=0,updated_at=?
               WHERE id=? AND status='failed' AND retryable=1""",
            (db.now(), upload_id),
        ).rowcount
    if changed:
        background.add_task(_schedule_upload, upload_id)
    return _public(_row(upload_id))


def _schedule_upload(upload_id):
    # The worker's atomic SQLite claim prevents concurrent sends. A second
    # in-memory guard would lose retries arriving while an old worker exits.
    _WORKERS.submit(_run_upload, upload_id)


class UploadFailure(Exception):
    def __init__(self, message, retryable=True, attention=False):
        super().__init__(message)
        self.retryable = retryable
        self.attention = attention


def _headers(channel_id):
    try:
        return {"Authorization": "Bearer " + youtube_auth.get_access_token(channel_id)}
    except HTTPException:
        raise UploadFailure(
            "Reconnect this YouTube channel in Settings, then retry."
        ) from None


def _response_error(response):
    try:
        reason = (
            response.json().get("error", {}).get("errors", [{}])[0].get("reason", "")
        )
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        reason = ""
    if response.status_code == 401 or reason in {
        "authError",
        "insufficientPermissions",
    }:
        return UploadFailure(
            "YouTube authorization expired or lacks permission. Reconnect the channel in Settings, then retry."
        )
    if response.status_code == 429 or reason in {
        "quotaExceeded",
        "dailyLimitExceeded",
        "uploadLimitExceeded",
        "rateLimitExceeded",
        "userRateLimitExceeded",
    }:
        return UploadFailure(
            "YouTube's upload or API limit was reached. Wait for the limit to reset, then retry."
        )
    if response.status_code >= 500:
        return UploadFailure(
            "YouTube is temporarily unavailable. Retry to resume this upload."
        )
    return UploadFailure(
        "YouTube rejected the upload. Check the channel's upload permissions and video details.",
        retryable=False,
    )


def _check(response):
    if not response.is_success:
        raise _response_error(response)


def _retry_after(response, upload_id):
    value = response.headers.get("Retry-After", "")
    if not value:
        return
    try:
        seconds = float(value)
    except ValueError:
        from email.utils import parsedate_to_datetime

        try:
            seconds = parsedate_to_datetime(value).timestamp() - time.time()
        except (ValueError, TypeError, OverflowError):
            return
    if seconds > 0:
        _update(upload_id, next_attempt_at=time.time() + min(seconds, 86400))


def _verify_channel(client, row):
    response = client.get(
        API_ROOT + "/channels",
        params={"part": "id", "mine": "true"},
        headers=_headers(row["channel_id"]),
    )
    _check(response)
    items = response.json().get("items", [])
    if len(items) != 1 or items[0].get("id") != row["channel_id"]:
        raise UploadFailure(
            "The Google authorization belongs to a different channel. Reconnect the selected channel in Settings."
        )


def _session_url(value):
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in {"www.googleapis.com", "youtube.googleapis.com"}
        or parsed.username
        or parsed.password
        or parsed.port not in {None, 443}
        or parsed.fragment
    ):
        raise UploadFailure("YouTube returned an invalid upload session. Please retry.")
    return value


def _start_session(client, row, mime):
    response = client.post(
        UPLOAD_URL,
        params={"uploadType": "resumable", "part": "snippet,status"},
        headers={
            **_headers(row["channel_id"]),
            "X-Upload-Content-Length": str(row["file_size"]),
            "X-Upload-Content-Type": mime,
        },
        json=json.loads(row["metadata"]),
    )
    _retry_after(response, row["id"])
    _check(response)
    session = _session_url(response.headers.get("Location", ""))
    _update(
        row["id"],
        session_url=session,
        bytes_uploaded=0,
        final_attempted=0,
        next_attempt_at=0,
    )
    return session


def _acknowledged(response, total):
    value = response.headers.get("Range")
    if not value:
        return 0
    match = re.fullmatch(r"bytes=0-(\d+)", value)
    if not match or not 0 < int(match[1]) + 1 <= total:
        raise UploadFailure(
            "YouTube returned an invalid upload position. Retry to check the session."
        )
    return int(match[1]) + 1


def _record_video(row, response):
    try:
        video = response.json()
        video_id = video.get("id", "")
    except ValueError:
        video_id = ""
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise UploadFailure(
            "YouTube accepted the file but did not confirm its video ID. Retry to check the existing upload."
        )
    privacy = video.get("status", {}).get("privacyStatus", row["privacy_status"])
    if privacy not in {"private", "unlisted", "public"}:
        privacy = row["privacy_status"]
    mismatch = (
        video.get("snippet", {}).get("channelId", row["channel_id"])
        != row["channel_id"]
    )
    _update(
        row["id"],
        video_id=video_id,
        privacy_status=privacy,
        status="needs_attention" if mismatch else "processing",
        progress=100,
        bytes_uploaded=row["file_size"],
        retryable=0,
        error="YouTube returned a different destination channel. Check this video in YouTube Studio."
        if mismatch
        else None,
    )


def _resume_position(client, row):
    """Return the confirmed session/offset, or None after recovering a video ID."""
    session = row["session_url"]
    offset = 0
    if session:
        response = client.put(
            _session_url(session),
            headers={
                **_headers(row["channel_id"]),
                "Content-Length": "0",
                "Content-Range": f"bytes */{row['file_size']}",
            },
            content=b"",
        )
        _retry_after(response, row["id"])
        if response.status_code in {200, 201}:
            _record_video(row, response)
            return
        if response.status_code in {404, 410}:
            if row["final_attempted"]:
                raise UploadFailure(
                    "The upload session expired after the final file bytes may have arrived. Check YouTube Studio for this video before uploading again; ShortForge will not risk a duplicate.",
                    retryable=False,
                    attention=True,
                )
            session = None
            _update(row["id"], session_url=None, bytes_uploaded=0, progress=0)
        elif response.status_code == 308:
            offset = _acknowledged(response, row["file_size"])
            if offset == row["file_size"]:
                raise UploadFailure(
                    "YouTube received the file but has not confirmed its video ID. Retry to check the existing upload."
                )
        else:
            raise _response_error(response)
    return session, offset


def _transfer(client, row, stream, mime, session, offset):
    if not session:
        session = _start_session(client, row, mime)
    _update(row["id"], bytes_uploaded=offset, progress=100 * offset / row["file_size"])
    while offset < row["file_size"]:
        if _row(row["id"])["next_attempt_at"] > time.time():
            raise UploadFailure(
                "YouTube asked ShortForge to pause. Retry this upload later."
            )
        stream.seek(offset)
        chunk = stream.read(min(CHUNK_SIZE, row["file_size"] - offset))
        if not chunk:
            raise UploadFailure(
                "The saved export changed during upload. Export the video again.",
                retryable=False,
            )
        end = offset + len(chunk)
        if end == row["file_size"]:
            # Commit before the request: even a crash after the server receives it is safe.
            _update(row["id"], final_attempted=1)
        response = client.put(
            session,
            content=chunk,
            headers={
                **_headers(row["channel_id"]),
                "Content-Type": mime,
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {offset}-{end - 1}/{row['file_size']}",
            },
        )
        _retry_after(response, row["id"])
        if response.status_code in {200, 201}:
            _record_video(row, response)
            return
        if response.status_code in {404, 410}:
            uncertain = bool(_row(row["id"])["final_attempted"])
            raise UploadFailure(
                "The upload session expired. Check YouTube Studio for this video before uploading again."
                if uncertain
                else "The upload session expired before the file was sent. Retry this upload.",
                retryable=not uncertain,
                attention=uncertain,
            )
        if response.status_code != 308:
            raise _response_error(response)
        acknowledged = _acknowledged(response, row["file_size"])
        if acknowledged <= offset or acknowledged > end:
            raise UploadFailure(
                "YouTube did not confirm the expected upload progress. Retry to check the session."
            )
        offset = acknowledged
        _update(
            row["id"],
            bytes_uploaded=offset,
            progress=min(99, 100 * offset / row["file_size"]),
        )
    raise UploadFailure(
        "YouTube received the file but has not confirmed its video ID. Retry to check the existing upload."
    )


def _run_upload(upload_id):
    try:
        with db.connect() as conn:
            claimed = conn.execute(
                "UPDATE youtube_uploads SET status='uploading',updated_at=? WHERE id=? AND status='queued'",
                (db.now(), upload_id),
            ).rowcount
        if not claimed:
            return
        row = _row(upload_id)
        with httpx.Client(
            timeout=httpx.Timeout(60, connect=15),
            follow_redirects=False,
            trust_env=False,
        ) as client:
            resumed = (None, 0)
            if row["session_url"]:
                _verify_channel(client, row)
                resumed = _resume_position(client, row)
                if resumed is None:
                    return
            path = _export_path(row["clip_id"], row["asset_id"])
            with path.open("rb") as stream:
                if _fingerprint(stream) != (row["file_size"], row["file_sha256"]):
                    raise UploadFailure(
                        "The saved export changed. Export the video again before publishing.",
                        retryable=False,
                    )
                mime = "video/webm" if path.suffix.lower() == ".webm" else "video/mp4"
                if not row["session_url"]:
                    _verify_channel(client, row)
                _transfer(client, row, stream, mime, *resumed)
    except UploadFailure as exc:
        _update(
            upload_id,
            status="needs_attention" if exc.attention else "failed",
            retryable=int(exc.retryable),
            error=str(exc),
        )
    except httpx.RequestError:
        _update(
            upload_id,
            status="failed",
            retryable=1,
            error="The connection to YouTube was interrupted. Retry to check and resume the existing upload.",
        )
    except (HTTPException, OSError):
        _update(
            upload_id,
            status="failed",
            retryable=0,
            error="This saved export is no longer available. Export the video again.",
        )
    except Exception:
        # Provider responses and exception strings can contain session URLs or tokens.
        _update(
            upload_id,
            status="failed",
            retryable=1,
            error="YouTube's response could not be read. Retry to check the existing upload.",
        )


def _poll_processing(row):
    now = time.time()
    with db.connect() as conn:
        claimed = conn.execute(
            "UPDATE youtube_uploads SET process_checked_at=? WHERE id=? AND process_checked_at<? AND status='processing'",
            (now, row["id"], now - POLL_SECONDS),
        ).rowcount
    if not claimed:
        return
    try:
        with httpx.Client(
            timeout=20, follow_redirects=False, trust_env=False
        ) as client:
            response = client.get(
                API_ROOT + "/videos",
                params={"part": "status,processingDetails", "id": row["video_id"]},
                headers=_headers(row["channel_id"]),
            )
        _check(response)
        items = response.json().get("items", [])
        if not items:
            raise UploadFailure(
                "YouTube has not returned this video's status yet. Check its link in YouTube Studio."
            )
        video = items[0]
        status = video.get("status", {})
        processing = video.get("processingDetails", {}).get("processingStatus")
        fields = {"error": None}
        if status.get("privacyStatus") in {"private", "unlisted", "public"}:
            fields["privacy_status"] = status["privacyStatus"]
        if status.get("uploadStatus") in {
            "failed",
            "rejected",
            "deleted",
        } or processing in {"failed", "terminated"}:
            fields.update(
                status="failed",
                retryable=0,
                error="YouTube could not process or accept this video. Open YouTube Studio to see the reason.",
            )
        elif status.get("uploadStatus") == "processed" or processing == "succeeded":
            fields.update(status="completed", progress=100, retryable=0)
        _update(row["id"], **fields)
    except UploadFailure as exc:
        _update(row["id"], error=str(exc))
    except (httpx.RequestError, ValueError, TypeError, KeyError, AttributeError):
        _update(
            row["id"],
            error="The video was uploaded, but YouTube's processing status is unavailable. Check again shortly.",
        )


def recover_uploads():
    """An engine restart never starts a second video or silently loses a session."""
    init_storage()
    with db.connect() as conn:
        conn.execute(
            """UPDATE youtube_uploads SET status='failed',retryable=1,
            error='ShortForge restarted during this upload. Retry to check and resume the same upload.',updated_at=?
            WHERE status IN ('queued','uploading') AND video_id IS NULL""",
            (db.now(),),
        )
        conn.execute(
            "UPDATE youtube_uploads SET status='processing',retryable=0,updated_at=? WHERE status IN ('queued','uploading') AND video_id IS NOT NULL",
            (db.now(),),
        )
