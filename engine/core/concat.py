"""Open Library footage in desktop Concat without rewriting saved edits."""

from functools import lru_cache
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile
from threading import Thread
import time

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from . import db, media
from .concat_rpc import ConcatRPC


ROOT = Path(__file__).resolve().parents[2]
VERSION = "0.2.8"
SETUP_HINT = "Restart ShortForge with start.sh or start.bat to finish automatic Concat setup, then try Studio again."
JOB_TYPE = "studio-open"
SOURCE_WAIT_SECONDS = 30 * 60
router = APIRouter(prefix="/api/studio")


class OpenStudio(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    clip_id: str | None = Field(default=None, min_length=1, max_length=64)


def find_binary() -> Path | None:
    configured = os.getenv("CONCAT_PATH")
    if configured:
        candidate = Path(configured).expanduser()
        return candidate.resolve() if candidate.is_file() else None
    system = platform.system()
    suffix = ".exe" if system == "Windows" else ""
    managed = {
        "Linux": "squashfs-root/usr/bin/concat",
        "Windows": "windows/concat.exe",
        "Darwin": "Concat.app/Contents/MacOS/concat",
    }.get(system)
    candidates = [
        ROOT / f"vendor/concat/src/target/app/concat{suffix}",
        ROOT / f"vendor/concat/src/target/release/concat{suffix}",
    ]
    if managed:
        candidates.insert(0, ROOT / f"data/runtime/concat/v{VERSION}" / managed)
    if executable := shutil.which("concat"):
        candidates.append(Path(executable))
    if system == "Windows":
        for variable in ("LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"):
            if folder := os.getenv(variable):
                candidates.append(Path(folder) / "Programs/Concat/concat.exe")
                candidates.append(Path(folder) / "Concat/concat.exe")
    elif system == "Darwin":
        candidates.append(Path("/Applications/Concat.app/Contents/MacOS/concat"))
    return next((path.resolve() for path in candidates if path.is_file()), None)


@lru_cache(maxsize=8)
def binary_version(path: str, modified: int, size: int) -> str:
    result = subprocess.run(
        [path, "--version"],
        capture_output=True,
        text=True,
        timeout=10,
        env=runtime_env(),
    )
    match = re.search(r"concat (\d+\.\d+\.\d+)", result.stdout)
    if result.returncode or match is None:
        raise RuntimeError("Concat could not start on this machine. " + SETUP_HINT)
    version = match[1]
    if tuple(map(int, version.split("."))) < (0, 2, 8):
        raise RuntimeError("Studio needs Concat 0.2.8 or newer. " + SETUP_HINT)
    return version


def capability() -> dict:
    binary = find_binary()
    if binary is None:
        return {"available": False, "editor": "Concat", "message": SETUP_HINT}
    try:
        stat = binary.stat()
        version = binary_version(str(binary), stat.st_mtime_ns, stat.st_size)
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        return {"available": False, "editor": "Concat", "message": str(exc)}
    return {
        "available": True,
        "editor": "Concat",
        "version": version,
        "message": "Concat is ready.",
    }


def runtime_env() -> dict[str, str]:
    env = os.environ.copy()
    for key in db.SECRET_SETTINGS:
        env.pop(key.upper(), None)
    # AppImages can also be explicitly configured without FUSE installed.
    env["APPIMAGE_EXTRACT_AND_RUN"] = "1"
    return env


def rpc_env() -> dict[str, str]:
    env = runtime_env()
    env["CONCAT_MCP_ROOTS"] = str(db.DATA_DIR.resolve())
    # Preparation uses temporary project folders. Keep those recents and caches
    # out of the desktop editor's own settings and recent-project list.
    root = db.resolve_data_path("concat/automation")
    if os.name == "nt":
        env["APPDATA"] = str(root / "config")
        env["LOCALAPPDATA"] = str(root / "cache")
    elif platform.system() != "Darwin":
        env["XDG_CONFIG_HOME"] = str(root / "config")
        env["XDG_DATA_HOME"] = str(root / "cache")
    return env


def project_folder(clip_id: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", clip_id):
        raise HTTPException(422, "This video reference is not valid.")
    return db.resolve_data_path(Path("concat/projects") / clip_id / "edit")


def source_for_clip(clip_id: str, progress) -> Path:
    child, claimed = media.claim_download(clip_id)
    progress(10)
    if claimed:
        media.download_job(child["id"], clip_id)
    # An API request may already own acquisition. Waiting never holds a database
    # transaction, and a timeout must leave that owner's download intact.
    deadline = time.monotonic() + SOURCE_WAIT_SECONDS
    downloaded = db.get_job(child["id"])
    while downloaded["status"] in {"queued", "running"}:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(
                "The source video is still downloading. Wait for it to finish, then try Studio again."
            )
        time.sleep(min(0.5, remaining))
        downloaded = db.get_job(child["id"])
    if downloaded["status"] != "completed":
        raise RuntimeError(
            downloaded.get("error")
            or "The source video could not be downloaded. Try again or upload your own footage."
        )
    _, source = media.get_source(clip_id)
    from engine.studio.editor_media import probe_media

    if probe_media(source)["media_type"] != "video":
        raise RuntimeError("The downloaded source has no readable video. Try again.")
    return source


def prepare_project(
    binary: Path, clip: dict, progress=lambda _: None
) -> tuple[Path, bool]:
    project = project_folder(clip["id"])
    if (project / "concat.json").is_file():
        return project, False
    source = source_for_clip(clip["id"], progress)
    progress(35)
    parent = project.parent
    parent.mkdir(parents=True, exist_ok=True)
    owned_media = db.resolve_data_path(
        parent / "media" / ("source" + source.suffix.lower())
    )
    owned_media.parent.mkdir(parents=True, exist_ok=True)
    partial = owned_media.with_suffix(owned_media.suffix + ".part")
    try:
        shutil.copy2(source, partial)
        partial.replace(owned_media)
    finally:
        partial.unlink(missing_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".prepare-", dir=parent))
    staged_project = staging / "edit"
    try:
        with ConcatRPC(binary, rpc_env()) as client:
            client.call(
                "project_create",
                {
                    "location": str(staging),
                    "name": "edit",
                    "video": {
                        "width": 1080,
                        "height": 1920,
                        "rateNum": 30,
                        "rateDen": 1,
                    },
                },
            )
            imported = client.call(
                "media_import", {"path": str(staged_project), "file": str(owned_media)}
            )
            media_id = imported.get("createdId")
            if not media_id:
                raise RuntimeError(
                    "Concat could not import this video. Try a supported MP4."
                )
            tracks = imported.get("timeline", {}).get("tracks", [])
            track_id = (
                tracks[0]["id"]
                if tracks
                else client.call("track_add", {"path": str(staged_project)}).get(
                    "createdId"
                )
            )
            placed = client.call(
                "clip_add",
                {
                    "path": str(staged_project),
                    "mediaId": media_id,
                    "trackId": track_id,
                    "start": 0,
                },
            )
            if not placed.get("createdId"):
                raise RuntimeError(
                    "Concat could not place the video on its timeline. Try again."
                )
            client.call(
                "clip_update",
                {
                    "path": str(staged_project),
                    "clipId": placed["createdId"],
                    "patch": {"name": clip["title"]},
                },
            )
            client.call(
                "project_save",
                {"path": str(staged_project), "name": clip["title"] or "Library video"},
            )
            client.call("project_close", {"path": str(staged_project), "save": True})
        if not (staged_project / "concat.json").is_file():
            raise RuntimeError("Concat did not save the edit. Try again.")
        staged_project.rename(project)
        progress(75)
        return project, True
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def launch_desktop(binary: Path, project: Path | None):
    command = [str(binary)]
    if project is not None:
        command.extend(["--project", str(project)])
    log = db.resolve_data_path("concat/desktop.log")
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("ab") as output:
        process = subprocess.Popen(
            command,
            env=runtime_env(),
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    try:
        code = process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        # Reap the app when it closes without tying its lifetime to the dashboard.
        Thread(target=process.wait, daemon=True).start()
        return
    if code:
        raise RuntimeError(
            f"Concat could not start (exit code {code}). See {log} for details."
        )


def open_job(job_id: str, clip_id: str | None):
    try:
        db.update_job(job_id, status="running", progress=5)
        binary = find_binary()
        if binary is None:
            raise RuntimeError(SETUP_HINT)
        project, created, title = None, False, ""
        if clip_id is not None:
            clip = db.get_clip(clip_id)
            title = clip["title"]
            project, created = prepare_project(
                binary, clip, lambda value: db.update_job(job_id, progress=value)
            )
        db.update_job(job_id, progress=85)
        launch_desktop(binary, project)
        db.update_job(
            job_id,
            status="completed",
            progress=100,
            result={
                "editor": "Concat",
                "clip_id": clip_id,
                "title": title,
                "project_created": created,
                "project_path": str(project) if project else None,
                "opened": True,
            },
        )
    except Exception as exc:
        message = exc.detail if isinstance(exc, HTTPException) else str(exc)
        db.update_job(
            job_id,
            status="failed",
            error=message or "Studio could not open. Try again.",
        )


@router.get("/capabilities")
def studio_capabilities():
    return capability()


@router.post("/open")
def open_studio(body: OpenStudio, background: BackgroundTasks):
    if body.clip_id is not None:
        db.get_clip(body.clip_id)
        project_folder(body.clip_id)
    ready = studio_capabilities()
    if not ready["available"]:
        raise HTTPException(503, ready["message"])
    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM jobs WHERE type=? AND clip_id IS ? AND status IN ('queued','running') LIMIT 1",
            (JOB_TYPE, body.clip_id),
        ).fetchone()
        if row is not None:
            job = dict(row)
            job["result"] = json.loads(job["result"]) if job["result"] else None
            return job
        from uuid import uuid4

        job = {
            "id": str(uuid4()),
            "type": JOB_TYPE,
            "clip_id": body.clip_id,
            "status": "queued",
            "progress": 0,
            "error": None,
            "result": None,
        }
        conn.execute(
            "INSERT INTO jobs VALUES (:id,:type,:clip_id,:status,:progress,:error,:result)",
            job,
        )
    background.add_task(open_job, job["id"], body.clip_id)
    return job
