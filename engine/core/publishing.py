"""Render a saved Concat edit locally, then hand it to the YouTube uploader.

The reviewed manifest is snapshotted before queuing. A single worker owns the
render-to-upload handoff; neither opening Studio nor saving an edit posts it.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
from threading import Event
import time
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import Field, ValidationError

from . import concat, db, youtube_auth, youtube_uploads
from .concat_rpc import ConcatRPC
from .youtube_uploads import PublicationMetadata, UploadRequest


router = APIRouter(prefix="/api/studio", tags=["Studio publishing"])
_WORKER = ThreadPoolExecutor(max_workers=1, thread_name_prefix="studio-publish")
_STOP = Event()
MAX_PENDING = 8
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
RENDER_TIMEOUT = 6 * 60 * 60
_SCHEMA = """
CREATE TABLE IF NOT EXISTS studio_publications (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
    clip_id TEXT NOT NULL, channel_id TEXT NOT NULL, channel_title TEXT NOT NULL,
    project_revision TEXT NOT NULL, metadata TEXT NOT NULL,
    status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0,
    error TEXT, retryable INTEGER NOT NULL DEFAULT 0,
    asset_id TEXT, upload_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS studio_publications_by_clip
ON studio_publications(clip_id, created_at);
"""


class PublishRequest(PublicationMetadata):
    clip_id: str = Field(min_length=1, max_length=64)
    request_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    project_revision: str = Field(pattern=r"^[a-f0-9]{64}$")


def init_storage():
    youtube_uploads.init_storage()
    with db.connect() as conn:
        conn.executescript(_SCHEMA)


def _row(publication_id):
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM studio_publications WHERE id=?", (publication_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Publishing job not found.")
    return dict(row)


def _update(publication_id, **fields):
    if fields.get("error"):
        fields["error"] = db.redact_secrets(str(fields["error"]))[:2000]
    fields["updated_at"] = db.now()
    with db.connect() as conn:
        conn.execute(
            "UPDATE studio_publications SET "
            + ",".join(f"{key}=?" for key in fields)
            + " WHERE id=?",
            (*fields.values(), publication_id),
        )


def _public(row, *, poll=False, uploads=None):
    metadata = json.loads(row["metadata"])
    result = {
        field: row[field]
        for field in (
            "id",
            "clip_id",
            "channel_id",
            "channel_title",
            "status",
            "progress",
            "error",
            "asset_id",
            "upload_id",
            "created_at",
            "updated_at",
        )
    }
    result.update(
        title=metadata["title"],
        privacy_status=metadata["privacy_status"],
        publish_at=metadata.get("publish_at"),
        retryable=bool(row["retryable"]),
        video_url=None,
        can_cancel=row["status"] in {"queued", "rendering"} and not row["upload_id"],
    )
    if row["upload_id"]:
        if poll:
            upload = youtube_uploads.get_upload(row["upload_id"])
        else:
            if uploads is None:
                with db.connect() as conn:
                    uploaded = conn.execute(
                        "SELECT * FROM youtube_uploads WHERE id=?", (row["upload_id"],)
                    ).fetchone()
            else:
                uploaded = uploads.get(row["upload_id"])
            upload = youtube_uploads._public(dict(uploaded)) if uploaded else None
        if upload:
            for key in (
                "status",
                "progress",
                "error",
                "retryable",
                "video_url",
                "privacy_status",
                "updated_at",
            ):
                result[key] = upload[key]
            # The render has already finished when its upload is queued.
            if result["status"] == "queued":
                result["status"] = "uploading"
            result["can_cancel"] = False
    return result


def _folder(publication_id: str) -> Path:
    return db.resolve_data_path(Path("concat/publishing") / publication_id)


def _manifest(clip_id: str) -> tuple[bytes, str, str]:
    path = concat.project_folder(clip_id) / "concat.json"
    try:
        with path.open("rb") as stream:
            raw = stream.read(MAX_MANIFEST_BYTES + 1)
        if len(raw) > MAX_MANIFEST_BYTES:
            raise HTTPException(422, "This saved edit is too large to publish.")
        if not isinstance(json.loads(raw), dict):
            raise ValueError("Expected a Concat document")
        saved_at = datetime.fromtimestamp(
            path.stat().st_mtime, timezone.utc
        ).isoformat()
    except FileNotFoundError:
        raise HTTPException(
            409, "Open this video in Concat and save your edit first."
        ) from None
    except (ValueError, OSError):
        raise HTTPException(
            409,
            "The saved edit could not be read. Save in Concat, then refresh the saved edit.",
        ) from None
    return raw, hashlib.sha256(raw).hexdigest(), saved_at


def _defaults(clip):
    def clean(value):
        return re.sub(r"[<>\x00]", "", value or "").strip()

    title = clean(clip["title"])[:100]
    description = clean(clip["description"])
    credit = clean(clip.get("credit_snippet"))
    if credit and credit not in description:
        description = (description + "\n\n" + credit).strip()
    description = description.encode("utf-8")[:5000].decode("utf-8", errors="ignore")
    tags = list(
        dict.fromkeys(re.findall(r"#([^\W_][\w]*)", title + " " + description))
    )[:10]
    # Keep defaults accepted by the same limits as manually reviewed metadata.
    while sum(len(tag) for tag in tags) + max(0, len(tags) - 1) > 500:
        tags.pop()
    return {"title": title, "description": description, "tags": tags}


@router.get("/publishing")
def publishing_state(clip_id: str):
    clip = db.get_clip(clip_id)
    init_storage()
    try:
        _, revision, saved_at = _manifest(clip_id)
        project = {
            "ready": True,
            "revision": revision,
            "saved_at": saved_at,
            "error": None,
        }
    except HTTPException as exc:
        project = {
            "ready": False,
            "revision": None,
            "saved_at": None,
            "error": exc.detail,
        }
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM studio_publications WHERE clip_id=? ORDER BY created_at DESC LIMIT 50",
            (clip_id,),
        ).fetchall()
        upload_ids = list({row["upload_id"] for row in rows if row["upload_id"]})
        uploads = (
            {
                row["id"]: row
                for row in conn.execute(
                    f"SELECT * FROM youtube_uploads WHERE id IN ({','.join('?' for _ in upload_ids)})",
                    upload_ids,
                )
            }
            if upload_ids
            else {}
        )
    return {
        "project": project,
        "defaults": _defaults(clip),
        "publications": [_public(dict(row), uploads=uploads) for row in rows],
    }


def _safe_to_replace(row, conn):
    if row["upload_id"]:
        upload = conn.execute(
            "SELECT status,video_id,final_attempted FROM youtube_uploads WHERE id=?",
            (row["upload_id"],),
        ).fetchone()
        return bool(
            upload
            and upload["status"] == "failed"
            and not upload["video_id"]
            and not upload["final_attempted"]
        )
    return row["status"] in {"failed", "cancelled"}


def _check_queue(conn):
    count = conn.execute(
        "SELECT COUNT(*) FROM studio_publications WHERE status IN ('queued','rendering','uploading')"
    ).fetchone()[0]
    if count >= MAX_PENDING:
        raise HTTPException(
            429,
            "The publishing queue is full. Wait for a video to finish, then try again.",
        )


@router.post("/publish")
def publish(payload: PublishRequest, background: BackgroundTasks):
    init_storage()
    db.get_clip(payload.clip_id)
    raw, revision, _ = _manifest(payload.clip_id)
    if revision != payload.project_revision:
        raise HTTPException(
            409, "Your saved edit changed. Refresh the saved edit, then publish again."
        )
    channel = youtube_auth.get_channel(payload.channel_id)
    ready = concat.capability()
    if not ready["available"]:
        raise HTTPException(503, ready["message"])
    metadata = payload.model_dump(exclude={"clip_id", "request_id", "project_revision"})
    identity, now = str(uuid4()), db.now()
    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            "SELECT * FROM studio_publications WHERE request_id=?",
            (payload.request_id,),
        ).fetchone()
        if existing:
            if (
                existing["clip_id"] != payload.clip_id
                or json.loads(existing["metadata"]) != metadata
                or existing["project_revision"] != revision
            ):
                raise HTTPException(
                    409,
                    "This publishing request was already used. Review the details and try again.",
                )
        else:
            matches = conn.execute(
                "SELECT * FROM studio_publications WHERE clip_id=? AND channel_id=? AND project_revision=? ORDER BY created_at DESC",
                (payload.clip_id, payload.channel_id, revision),
            ).fetchall()
            existing = next(
                (row for row in matches if not _safe_to_replace(row, conn)), None
            )
        if existing:
            result = dict(existing)
        else:
            _check_queue(conn)
            conn.execute(
                """INSERT INTO studio_publications
                (id,request_id,clip_id,channel_id,channel_title,project_revision,metadata,status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,'queued',?,?)""",
                (
                    identity,
                    payload.request_id,
                    payload.clip_id,
                    payload.channel_id,
                    channel["title"],
                    revision,
                    json.dumps(metadata),
                    now,
                    now,
                ),
            )
            result = None
    if result:
        return _public(result)
    try:
        snapshot = _folder(identity) / "project"
        snapshot.mkdir(parents=True)
        (snapshot / "concat.json").write_bytes(raw)
    except OSError:
        _update(
            identity,
            status="failed",
            error="The saved edit could not be copied. Free disk space and try again.",
            retryable=0,
        )
        raise HTTPException(
            507, "The saved edit could not be copied. Free disk space and try again."
        ) from None
    background.add_task(_submit, identity)
    return _public(_row(identity))


@router.get("/publications/{publication_id}")
def get_publication(publication_id: str):
    init_storage()
    return _public(_row(publication_id), poll=True)


@router.post("/publications/{publication_id}/cancel")
def cancel_publication(publication_id: str):
    init_storage()
    with db.connect() as conn:
        changed = conn.execute(
            """UPDATE studio_publications SET status='cancelled',retryable=0,error=NULL,updated_at=?
            WHERE id=? AND status IN ('queued','rendering') AND upload_id IS NULL""",
            (db.now(), publication_id),
        ).rowcount
    if not changed:
        raise HTTPException(
            409,
            "The upload has already started or this job has ended. Manage an uploaded video in YouTube Studio.",
        )
    return _public(_row(publication_id))


@router.post("/publications/{publication_id}/retry")
def retry_publication(publication_id: str, background: BackgroundTasks):
    init_storage()
    row = _row(publication_id)
    if row["upload_id"]:
        youtube_uploads.retry_upload(row["upload_id"], background)
        return _public(_row(publication_id))
    if row["status"] != "failed" or not row["retryable"]:
        raise HTTPException(
            409,
            "This job cannot be retried. Review your saved edit and publishing details.",
        )
    try:
        PublicationMetadata.model_validate(json.loads(row["metadata"]))
    except ValidationError:
        raise HTTPException(
            409, "Choose a future date and time, then schedule a new attempt."
        ) from None
    youtube_auth.get_channel(row["channel_id"])
    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _check_queue(conn)
        changed = conn.execute(
            "UPDATE studio_publications SET status='queued',progress=0,error=NULL,retryable=0,updated_at=? WHERE id=? AND status='failed' AND retryable=1",
            (db.now(), publication_id),
        ).rowcount
    if changed:
        background.add_task(_submit, publication_id)
    return _public(_row(publication_id))


def _submit(publication_id):
    _WORKER.submit(_run, publication_id)


class RenderCancelled(Exception):
    pass


def _render(row) -> Path:
    binary = concat.find_binary()
    if binary is None:
        raise RuntimeError(concat.SETUP_HINT)
    root = _folder(row["id"])
    snapshot = root / "project"
    output = root / "finished.mp4"
    raw = (snapshot / "concat.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != row["project_revision"]:
        raise RuntimeError(
            "This publishing snapshot changed. Review the saved edit and start a new attempt."
        )
    document = json.loads(raw)
    # Concat documents store absolute media/font paths. Retain the complete
    # manifest and stop on missing inputs instead of publishing blank footage.
    for item in [*document.get("media", []), *document.get("fonts", [])]:
        if item.get("path") and not Path(item["path"]).is_file():
            raise RuntimeError(
                "A file used by this edit is missing. Reconnect it in Concat, save, then publish again."
            )
    deadline = time.monotonic() + RENDER_TIMEOUT
    try:
        with ConcatRPC(binary, concat.rpc_env()) as client:
            opened = client.call("project_open", {"path": str(snapshot)})
            duration = opened.get("timeline", {}).get("duration", 0)
            if not duration or duration <= 0:
                raise RuntimeError(
                    "This saved timeline is empty. Add your video in Concat and save first."
                )
            started = client.call(
                "export_start",
                {
                    "path": str(snapshot),
                    "output": str(output),
                    "codec": "h264",
                    "tenBit": False,
                    "crf": 20,
                    "preset": "fast",
                },
            )
            job = started.get("job")
            if not job:
                raise RuntimeError(
                    "Concat did not start the export. Reopen the edit and try again."
                )
            last_progress = -1
            while True:
                if _STOP.is_set() or _row(row["id"])["status"] == "cancelled":
                    client.call("export_cancel", {"job": job})
                    if _STOP.is_set():
                        raise RuntimeError(
                            "ShortForge stopped during the export. Retry this publishing job after restarting."
                        )
                    raise RenderCancelled()
                if time.monotonic() >= deadline:
                    client.call("export_cancel", {"job": job})
                    raise RuntimeError(
                        "The export took more than six hours. Check this edit in Concat before retrying."
                    )
                status = client.call("export_wait", {"job": job, "timeoutSeconds": 2})
                state = status.get("state")
                if state == "done":
                    break
                if state in {"failed", "cancelled"}:
                    raise RuntimeError(
                        "Concat could not finish this export. Open the saved edit in Concat to check its media and effects, then retry."
                    )
                if state != "running":
                    raise RuntimeError(
                        "Concat returned an unknown export status. Reopen the edit and try again."
                    )
                stage = {
                    "cutout": 0,
                    "stabilize": 1,
                    "rendering": 2,
                    "mixing audio": 3,
                    "muxing": 4,
                }.get(status.get("stage"), 0)
                progress = min(
                    99,
                    int(
                        (stage + max(0, min(1, float(status.get("fraction", 0))))) * 20
                    ),
                )
                if progress > last_progress:
                    _update(row["id"], progress=progress)
                    last_progress = progress
            client.call("project_close", {"path": str(snapshot), "save": False})
        from engine.studio.editor_media import probe_media

        info = probe_media(output)
        if info["media_type"] != "video" or info["duration"] < max(
            0.01, duration - 0.25
        ):
            raise RuntimeError(
                "The finished video is incomplete. Check the saved edit in Concat and retry."
            )
        return output
    except BaseException:
        output.unlink(missing_ok=True)
        raise


def _run(publication_id):
    try:
        with db.connect() as conn:
            claimed = conn.execute(
                "UPDATE studio_publications SET status='rendering',progress=0,updated_at=? WHERE id=? AND status='queued' AND upload_id IS NULL",
                (db.now(), publication_id),
            ).rowcount
        if not claimed:
            return
        if _STOP.is_set():
            raise RuntimeError(
                "ShortForge stopped before this job finished. Retry after restarting."
            )
        row = _row(publication_id)
        metadata = PublicationMetadata.model_validate(json.loads(row["metadata"]))
        youtube_auth.get_channel(row["channel_id"])
        if row["asset_id"]:
            youtube_uploads._export_path(row["clip_id"], row["asset_id"])
            asset_id = row["asset_id"]
        else:
            if shutil.disk_usage(db.DATA_DIR).free < 1024 * 1024 * 1024:
                raise RuntimeError(
                    "Less than 1 GB of free disk space remains. Free some space, then retry."
                )
            output = _render(row)
            asset_id = db.add_asset(row["clip_id"], "export", output)["id"]
            _update(publication_id, asset_id=asset_id)
            with db.connect() as conn:
                conn.execute(
                    "UPDATE clips SET workflow_status='exported' WHERE id=? AND workflow_status!='archived'",
                    (row["clip_id"],),
                )
        if _STOP.is_set():
            raise RuntimeError(
                "ShortForge stopped before uploading. Retry to use the finished video."
            )
        with db.connect() as conn:
            claimed = conn.execute(
                "UPDATE studio_publications SET status='uploading',progress=0,updated_at=? WHERE id=? AND status='rendering'",
                (db.now(), publication_id),
            ).rowcount
        if not claimed:
            return
        # Revalidate a schedule after a potentially long queue/render. A past
        # publishAt must never turn into an immediate public upload.
        upload_request = UploadRequest(
            **metadata.model_dump(), clip_id=row["clip_id"], asset_id=asset_id
        )
        uploaded, _ = youtube_uploads.register_upload(upload_request)
        _update(publication_id, upload_id=uploaded["id"])
        youtube_uploads._run_upload(uploaded["id"])
        _update(publication_id, status="uploaded", progress=100)
    except RenderCancelled:
        pass
    except ValidationError:
        _update(
            publication_id,
            status="failed",
            retryable=0,
            error="The scheduled time passed before the video was ready. Choose a later date and time, then schedule a new attempt.",
        )
    except Exception as exc:
        # Do not overwrite a concurrent cancellation or lose an upload that
        # was already durably registered. Retrying reuses that exact export.
        row = _row(publication_id)
        if row["status"] != "cancelled":
            message = exc.detail if isinstance(exc, HTTPException) else str(exc)
            _update(
                publication_id,
                status="failed",
                retryable=1,
                error=message
                or "Publishing stopped. Check your saved edit and try again.",
            )


def recover_publications():
    _STOP.clear()
    init_storage()
    with db.connect() as conn:
        conn.execute(
            """UPDATE studio_publications SET status='failed',retryable=1,
            error='ShortForge restarted before this video finished. Retry to continue from the saved publishing job.',updated_at=?
            WHERE status IN ('queued','rendering','uploading') AND upload_id IS NULL""",
            (db.now(),),
        )
        conn.execute(
            "UPDATE studio_publications SET status='uploaded',updated_at=? WHERE upload_id IS NOT NULL AND status IN ('queued','rendering','uploading')",
            (db.now(),),
        )


def stop_publications():
    _STOP.set()
