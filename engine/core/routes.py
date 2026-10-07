"""The public core API for local footage, YouTube videos and Instagram Reels."""

import asyncio
import json
import mimetypes
from pathlib import Path
import shutil
import subprocess
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Body, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
import httpx
from starlette.concurrency import run_in_threadpool

from . import db, media, runtime, script_extraction
from .models import ClipBatch, ClipDeleteInput, ClipPatch, ExtractScriptInput, ProjectInput, SettingsPatch, TranscribeInput, TranscriptInput
from .source_urls import canonical_clip_url, canonical_youtube_url, instagram_thumbnail_url, is_youtube_clip


router = APIRouter(prefix="/api")
MAX_UPLOAD = 500 * 1024 * 1024


def enrich_clips(clip_ids: list[str], *, strict: bool = False):
    clips = [db.get_clip(clip_id) for clip_id in clip_ids]
    external = {clip["video_id"]: clip for clip in clips if is_youtube_clip(clip)}
    if not external:
        return
    settings = db.get_settings()
    key = settings.get("youtube_api_key")
    if not key:
        if strict:
            raise HTTPException(400, "Add a free YouTube Data API key in Settings to check video statistics and license labels.")
        return
    ids = list(external)
    for offset in range(0, len(ids), 50):
        try:
            response = httpx.get("https://www.googleapis.com/youtube/v3/videos", params={
                "part": "snippet,statistics,status", "id": ",".join(ids[offset:offset + 50]), "key": key,
            }, timeout=20)
            response.raise_for_status()
            items = response.json().get("items", [])
        except (httpx.HTTPError, ValueError) as exc:
            if strict:
                raise HTTPException(502, "YouTube could not verify the clip. Check your API key, YouTube Data API access, and quota in Google Cloud.") from exc
            return
        if strict and not items:
            raise HTTPException(404, "YouTube could not find this video. It may be private or removed.")
        with db.connect() as conn:
            for item in items:
                if item.get("id") not in external:
                    continue
                old = external[item["id"]]
                snippet, stats = item.get("snippet", {}), item.get("statistics", {})
                license_status = "cc_by" if item.get("status", {}).get("license") == "creativeCommon" else "unknown"
                # Keep permission granted while the network lookup was pending.
                conn.execute("UPDATE clips SET title=?,description=?,channel_name=?,likes=?,views=?,published_at=?,license_status=CASE WHEN license_status IN ('permission','owned') THEN license_status ELSE ? END WHERE id=?", (
                    snippet.get("title", old["title"]), snippet.get("description", old["description"]),
                    snippet.get("channelTitle", old["channel_name"]),
                    int(stats["likeCount"]) if "likeCount" in stats else old["likes"],
                    int(stats["viewCount"]) if "viewCount" in stats else old["views"],
                    snippet.get("publishedAt", old["published_at"]), license_status, old["id"],
                ))


@router.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0", "runtime": runtime.status(), "tools": {
        "ffmpeg": bool(media.find_ffmpeg()), "yt_dlp": media.tool_available("yt_dlp"),
        "whisper": media.tool_available("faster_whisper"),
        "piper": bool(shutil.which("piper")) or media.tool_available("piper"),
        "espeak": bool(shutil.which("espeak-ng") or shutil.which("espeak")),
    }}


@router.get("/clips")
def list_clips(q: str = "", license_status: str | None = None, workflow_status: str | None = None, sort: str = "date"):
    orders = {"date": "created_at DESC", "created_at": "created_at DESC", "newest": "created_at DESC", "views": "views DESC, created_at DESC", "likes": "likes DESC, created_at DESC", "title": "title COLLATE NOCASE"}
    if sort not in orders:
        raise HTTPException(422, "Choose date, views, likes, or title sorting.")
    predicates, values = [], []
    if q:
        predicates.append("(title LIKE ? OR description LIKE ? OR channel_name LIKE ? OR credit_target LIKE ?)")
        values.extend([f"%{q[:1000]}%"] * 4)
    if license_status and license_status != "all":
        if license_status not in {"unknown", "cc_by", "permission", "owned"}:
            raise HTTPException(422, "Unknown license filter.")
        predicates.append("license_status = ?")
        values.append(license_status)
    if workflow_status and workflow_status != "all":
        if workflow_status not in {"collected", "downloaded", "transcribed", "editing", "exported", "archived"}:
            raise HTTPException(422, "Unknown workflow filter.")
        predicates.append("workflow_status = ?")
        values.append(workflow_status)
    where = " WHERE " + " AND ".join(predicates) if predicates else ""
    with db.connect() as conn:
        clips = [dict(row) for row in conn.execute(f"SELECT * FROM clips{where} ORDER BY {orders[sort]}", values)]
    return {"clips": clips}


@router.post("/clips")
def import_clips(batch: ClipBatch, background_tasks: BackgroundTasks):
    # Validate every URL first so a bad batch never leaves a partial import.
    prepared = [(item, canonical_clip_url(item.url, item.video_id)) for item in batch.clips]
    output, created = [], []
    with db.connect() as conn:
        for item, (video_id, url) in prepared:
            old = conn.execute("SELECT * FROM clips WHERE video_id = ?", (video_id,)).fetchone()
            if old:
                output.append(dict(old))
                continue
            instagram = video_id.startswith("ig:")
            clip = {**item.model_dump(), "id": str(uuid4()), "video_id": video_id, "url": url,
                    "title": item.title or (f"Instagram Reel · {video_id[3:]}" if instagram else f"YouTube Short · {video_id}"), "license_status": "unknown",
                    "permission_note": "", "workflow_status": "collected", "created_at": db.now(),
                    "thumbnail_url": instagram_thumbnail_url(item.thumbnail_url) if instagram else f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"}
            if clip["discovery_mode"] == "upload":
                clip["discovery_mode"] = "manual"
            inserted = conn.execute(f"INSERT INTO clips ({','.join(clip)}) VALUES ({','.join('?' for _ in clip)}) ON CONFLICT(video_id) DO NOTHING", tuple(clip.values()))
            if inserted.rowcount:
                created.append(clip["id"])
                output.append(clip)
            else:
                # Scout and the dashboard may import the same link together.
                existing = conn.execute("SELECT * FROM clips WHERE video_id = ?", (video_id,)).fetchone()
                output.append(dict(existing))
    if created and db.get_settings().get("youtube_api_key"):
        background_tasks.add_task(enrich_clips, created)
    return {"clips": output, "added": len(created)}


@router.get("/clips/{clip_id}")
def clip_detail(clip_id: str):
    clip = db.get_clip(clip_id)
    with db.connect() as conn:
        clip["assets"] = [db.asset_dict(row) for row in conn.execute("SELECT * FROM assets WHERE clip_id = ? ORDER BY created_at", (clip_id,))]
        script = conn.execute("SELECT * FROM scripts WHERE clip_id = ?", (clip_id,)).fetchone()
        transcript = conn.execute("SELECT text,words FROM transcripts WHERE clip_id = ?", (clip_id,)).fetchone()
    clip["script"] = dict(script) if script else None
    clip["transcript"] = {"text": transcript["text"], "words": json.loads(transcript["words"])} if transcript else None
    return clip


@router.patch("/clips/{clip_id}")
def patch_clip(clip_id: str, patch: ClipPatch):
    clip = db.get_clip(clip_id)
    fields = patch.model_dump(exclude_unset=True, exclude_none=True)
    status = fields.get("license_status", clip["license_status"])
    if status == "permission" and not fields.get("permission_note", clip["permission_note"]).strip():
        raise HTTPException(422, "Add a link or note recording the creator's permission.")
    if fields:
        with db.connect() as conn:
            conn.execute(f"UPDATE clips SET {','.join(f'{key}=?' for key in fields)} WHERE id=?", (*fields.values(), clip_id))
    return db.get_clip(clip_id)


@router.delete("/clips/{clip_id}")
def delete_clip(clip_id: str):
    db.delete_clip(clip_id)
    return {"ok": True}


@router.post("/projects")
def create_project(body: ProjectInput = Body(default=ProjectInput())):
    identity = str(uuid4())
    with db.connect() as conn:
        conn.execute("INSERT INTO clips(id,title,channel_name,license_status,discovery_mode,created_at) VALUES (?,?,?,?,?,?)", (identity, body.title, "Your workspace", "owned", "project", db.now()))
    return clip_detail(identity)


@router.patch("/projects/{clip_id}")
def rename_project(clip_id: str, body: ProjectInput):
    db.get_clip(clip_id)
    with db.connect() as conn:
        conn.execute("UPDATE clips SET title=? WHERE id=?", (body.title, clip_id))
        row = conn.execute("SELECT project FROM editor_projects WHERE clip_id=?", (clip_id,)).fetchone()
        if row:
            project = json.loads(row["project"])
            project["name"] = body.title
            conn.execute("UPDATE editor_projects SET project=?,saved_at=? WHERE clip_id=?", (json.dumps(project), db.now(), clip_id))
    return clip_detail(clip_id)


@router.delete("/projects/{clip_id}")
def delete_project(clip_id: str):
    return delete_clip(clip_id)


@router.post("/projects/{clip_id}/duplicate")
def duplicate_project(clip_id: str, body: ProjectInput | None = Body(default=None)):
    """Copy media and remap references so deleting either project is safe."""
    original = db.get_clip(clip_id)
    identity = str(uuid4())
    directory = db.DATA_DIR / "projects" / identity
    directory.mkdir(parents=True)
    try:
        with db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if not conn.execute("SELECT 1 FROM clips WHERE id=?", (clip_id,)).fetchone():
                raise HTTPException(404, "Clip not found.")
            copied = {**original, "id": identity, "video_id": None, "title": body.title if body else (original["title"] + " copy")[:1000], "created_at": db.now()}
            conn.execute(f"INSERT INTO clips ({','.join(copied)}) VALUES ({','.join('?' for _ in copied)})", tuple(copied.values()))
            mapping = {}
            for row in conn.execute("SELECT * FROM assets WHERE clip_id=?", (clip_id,)).fetchall():
                path = db.resolve_data_path(row["path"])
                if not path.is_file():
                    raise HTTPException(409, "A project file is missing. Relink it before duplicating this project.")
                asset_id = str(uuid4())
                target = directory / f"{asset_id}{path.suffix}"
                shutil.copy2(path, target)
                for source_sidecar, target_sidecar in (
                    (path.with_suffix(".timing.json"), target.with_suffix(".timing.json")),
                    (path.with_suffix(path.suffix + ".name.json"), target.with_suffix(target.suffix + ".name.json")),
                ):
                    if source_sidecar.is_file():
                        shutil.copy2(source_sidecar, target_sidecar)
                mapping[row["id"]] = asset_id
                conn.execute("INSERT INTO assets VALUES (?,?,?,?,?)", (asset_id, identity, row["kind"], str(target.relative_to(db.DATA_DIR)), db.now()))
            row = conn.execute("SELECT project FROM editor_projects WHERE clip_id=?", (clip_id,)).fetchone()
            if row:
                project = json.loads(row["project"])
                for item in project.get("items", []):
                    if item.get("asset_id"):
                        item["asset_id"] = mapping.get(item["asset_id"], item["asset_id"])
                project["name"] = copied["title"]
                conn.execute("INSERT INTO editor_projects VALUES (?,?,?)", (identity, json.dumps(project), db.now()))
            conn.execute("INSERT INTO scripts SELECT ?,original_text,rewritten_text,words_original,words_rewritten FROM scripts WHERE clip_id=?", (identity, clip_id))
            conn.execute("INSERT INTO transcripts SELECT ?,text,words FROM transcripts WHERE clip_id=?", (identity, clip_id))
        return clip_detail(identity)
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise


@router.post("/projects/{clip_id}/exports")
async def store_browser_export(clip_id: str, file: UploadFile = File(...)):
    """Keep a browser-rendered export in the project's local history."""
    db.get_clip(clip_id)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".mp4", ".webm"}:
        await file.close()
        raise HTTPException(422, "Save a rendered MP4 or WebM video to the export history.")
    path = db.DATA_DIR / "exports" / clip_id / f"{uuid4()}{suffix}"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        size = 0
        with path.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                if size == 0 and not video_header_valid(chunk[:32], suffix):
                    raise HTTPException(422, "The exported file is not a valid MP4 or WebM video. Try exporting again.")
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, "The export is larger than 500 MB. Use a shorter duration or lower quality.")
                destination.write(chunk)
        if not size:
            raise HTTPException(422, "The exported video is empty. Try exporting again.")
        from engine.studio.editor_media import probe_media
        try:
            metadata = await run_in_threadpool(probe_media, path)
            if metadata["media_type"] != "video":
                raise ValueError("The export contains no video. Try exporting again.")
        except (ValueError, OSError, subprocess.SubprocessError) as exc:
            raise HTTPException(422, str(exc) if isinstance(exc, ValueError) else "The export could not be inspected. Try exporting again.") from None
        asset = db.add_asset(clip_id, "export", path)
        with db.connect() as conn:
            conn.execute("UPDATE clips SET workflow_status='exported' WHERE id=? AND workflow_status!='archived'", (clip_id,))
        return asset
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@router.post("/clips/delete-bulk")
def delete_clips(body: ClipDeleteInput):
    """Delete several videos at once so the library reports one honest count."""
    deleted, missing = [], []
    for clip_id in body.ids:
        try:
            db.delete_clip(clip_id)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            missing.append(clip_id)
        else:
            deleted.append(clip_id)
    return {"deleted": deleted, "missing": missing}


def video_header_valid(header: bytes, suffix: str) -> bool:
    if suffix in {".mp4", ".mov", ".m4v"}:
        return len(header) >= 12 and header[4:8] in {b"ftyp", b"moov", b"mdat", b"wide", b"free"}
    if suffix in {".mkv", ".webm"}:
        return header.startswith(b"\x1aE\xdf\xa3")
    if suffix == ".avi":
        return header[:4] == b"RIFF" and header[8:12] == b"AVI "
    return False


@router.post("/upload")
async def upload(file: UploadFile = File(...), title: str = Form("")):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}:
        await file.close()
        raise HTTPException(422, "Choose an MP4, MOV, WebM, MKV, M4V, or AVI video.")
    if len(title) > 1000:
        await file.close()
        raise HTTPException(422, "Use a video title under 1,000 characters.")
    clip_id = str(uuid4())
    path = db.DATA_DIR / "uploads" / f"{clip_id}{suffix}"
    original_path = path
    path.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    try:
        with path.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                if total == 0 and not video_header_valid(chunk[:32], suffix):
                    raise HTTPException(422, "The file contents do not match a supported video. Export a real video from your camera or editor and try again.")
                total += len(chunk)
                if total > MAX_UPLOAD:
                    raise HTTPException(413, "Choose a video smaller than 500 MB.")
                destination.write(chunk)
        if total == 0:
            raise HTTPException(422, "The video file is empty.")
        from engine.studio.editor_media import normalize_browser_video, probe_media
        try:
            # A valid container header alone does not mean the file can play.
            # Validate before registering a Library item, just as Studio does.
            metadata = await run_in_threadpool(probe_media, path)
            if metadata["media_type"] != "video":
                raise ValueError("This file contains no video. Import audio from inside Studio instead.")
            path = await run_in_threadpool(normalize_browser_video, path)
        except (ValueError, OSError, subprocess.SubprocessError) as exc:
            raise HTTPException(422, str(exc) if isinstance(exc, ValueError) else "This video could not be read. Try another MP4, MOV, or WebM file.") from None
        asset = {"id": str(uuid4()), "clip_id": clip_id, "kind": "source",
                 "path": str(db.resolve_data_path(path).relative_to(db.DATA_DIR)), "created_at": db.now()}
        with db.connect() as conn:
            conn.execute("INSERT INTO clips(id,url,channel_name,title,license_status,workflow_status,discovery_mode,created_at) VALUES (?,?,?,?,?,?,?,?)", (
                clip_id, "", "Your footage", title.strip() or Path(file.filename or "My video").stem[:1000], "owned", "downloaded", "upload", db.now(),
            ))
            conn.execute("INSERT INTO assets (id,clip_id,kind,path,created_at) VALUES (:id,:clip_id,:kind,:path,:created_at)", asset)
        if original_path != path:
            original_path.unlink(missing_ok=True)
        return clip_detail(clip_id)
    except BaseException:
        original_path.unlink(missing_ok=True)
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@router.post("/clips/{clip_id}/enrich")
def enrich_clip(clip_id: str):
    clip = db.get_clip(clip_id)
    if not clip["video_id"]:
        raise HTTPException(400, "Your own uploaded footage does not need a YouTube license lookup.")
    if not is_youtube_clip(clip):
        raise HTTPException(400, "YouTube statistics and license lookup is available only for YouTube clips. Instagram keeps the statistics collected by Scout.")
    enrich_clips([clip_id], strict=True)
    return db.get_clip(clip_id)


def prevent_duplicate_job(clip_id: str, job_type: str):
    with db.connect() as conn:
        row = conn.execute("SELECT id FROM jobs WHERE clip_id = ? AND type = ? AND status IN ('queued','running')", (clip_id, job_type)).fetchone()
    if row:
        raise HTTPException(409, "This clip already has that job running. Wait for it to finish.")


@router.post("/clips/{clip_id}/download")
def download(clip_id: str, background_tasks: BackgroundTasks):
    clip = db.get_clip(clip_id)
    # Serialize check + insert across tabs/threads so one clip has one fetch.
    # A failed job is retained for diagnosis and a later request can retry.
    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM jobs WHERE clip_id=? AND type='download' AND status IN ('queued','running') LIMIT 1", (clip_id,)).fetchone()
        if row:
            job = dict(row)
            job["result"] = json.loads(job["result"]) if job["result"] else None
            return job
        source = conn.execute("SELECT * FROM assets WHERE clip_id=? AND kind='source' ORDER BY created_at DESC LIMIT 1", (clip_id,)).fetchone()
        asset = db.asset_dict(source) if source and db.resolve_data_path(source["path"]).is_file() else None
        if asset:
            from engine.studio.editor_media import probe_media
            try:
                if probe_media(db.resolve_data_path(asset["path"]))["media_type"] != "video":
                    asset = None
            except (ValueError, OSError, subprocess.SubprocessError):
                # Old imports and interrupted writes can leave an unusable file.
                # Preserve it for relinking, but let Retry fetch a fresh source.
                asset = None
        if asset:
            rows = conn.execute("SELECT * FROM jobs WHERE clip_id=? AND type='download' AND status='completed'", (clip_id,)).fetchall()
            for row in rows:
                result = json.loads(row["result"] or "{}")
                if result.get("asset", {}).get("id") == asset["id"]:
                    return {**dict(row), "result": result}
        else:
            if not clip["url"]:
                raise HTTPException(400, "Import footage into this project to start editing.")
            canonical_clip_url(clip["url"], clip["video_id"])
            if not media.tool_available("yt_dlp"):
                raise HTTPException(503, "Install yt-dlp in the engine environment to download source videos.")
            if not media.find_ffmpeg():
                raise HTTPException(503, "Install FFmpeg or set FFMPEG_PATH to its executable, then restart ShortForge.")
        job = {"id": str(uuid4()), "type": "download", "clip_id": clip_id, "status": "completed" if asset else "queued", "progress": 100 if asset else 0, "error": None, "result": {"asset": asset} if asset else None}
        conn.execute("INSERT INTO jobs VALUES (:id,:type,:clip_id,:status,:progress,:error,:result)", {**job, "result": json.dumps(job["result"]) if asset else None})
    if not asset:
        background_tasks.add_task(media.download_job, job["id"], clip_id)
    return job


@router.post("/clips/{clip_id}/transcribe")
def transcribe(clip_id: str, background_tasks: BackgroundTasks, body: TranscribeInput = Body(default=TranscribeInput())):
    db.require_editable(clip_id)
    _, path = media.get_source(clip_id)
    if not media.tool_available("faster_whisper"):
        raise HTTPException(503, "Transcription needs optional faster-whisper and a local base/small model. See the setup guide. Nothing was downloaded.")
    prevent_duplicate_job(clip_id, "transcribe")
    job = db.new_job("transcribe", clip_id)
    background_tasks.add_task(media.transcribe_job, job["id"], clip_id, path, body.model)
    return job


@router.post("/clips/{clip_id}/extract-script")
def extract_script(clip_id: str, background_tasks: BackgroundTasks, body: ExtractScriptInput = Body(default=ExtractScriptInput())):
    # Text extraction is independent of permission to download or reuse footage.
    db.get_clip(clip_id)
    prevent_duplicate_job(clip_id, "extract-script")
    job = db.new_job("extract-script", clip_id)
    background_tasks.add_task(script_extraction.extract_script_job, job["id"], clip_id, body.provider, body.replace_existing)
    return job


@router.put("/clips/{clip_id}/transcript")
def save_transcript(clip_id: str, transcript: TranscriptInput):
    db.require_editable(clip_id)
    value = transcript.model_dump()
    with db.connect() as conn:
        conn.execute("INSERT INTO transcripts(clip_id,text,words) VALUES(?,?,?) ON CONFLICT(clip_id) DO UPDATE SET text=excluded.text,words=excluded.words", (clip_id, value["text"], json.dumps(value["words"])))
        conn.execute("UPDATE clips SET workflow_status='transcribed' WHERE id=?", (clip_id,))
    return value


@router.get("/jobs/{job_id}")
def job_detail(job_id: str):
    return db.get_job(job_id)


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request):
    db.get_job(job_id)

    async def stream():
        previous = None
        while not await request.is_disconnected():
            job = db.get_job(job_id)
            payload = json.dumps(job)
            if payload != previous:
                yield f"data: {payload}\n\n"
                previous = payload
            else:
                yield ": keep-alive\n\n"
            if job["status"] in {"completed", "failed"}:
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/assets/{asset_id}")
def serve_asset(asset_id: str):
    asset = db.get_asset(asset_id)
    if asset["clip_id"] and asset["kind"] in {"source", "export", "video", "voiceover", "music", "audio", "vocals", "instrumental"}:
        db.require_editable(asset["clip_id"])
    path = db.resolve_data_path(asset["path"])
    if not path.is_file():
        raise HTTPException(404, "The file is missing from your data folder.")
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=mime, filename=path.name, content_disposition_type="inline" if mime.startswith(("video/", "audio/")) else "attachment", headers={"X-Content-Type-Options": "nosniff"})


@router.get("/settings")
def settings():
    return db.public_settings()


@router.put("/settings")
def update_settings(patch: SettingsPatch):
    values = patch.model_dump(exclude_unset=True, exclude_none=True)
    with db.connect() as conn:
        for key, value in values.items():
            conn.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))
    return db.public_settings()
