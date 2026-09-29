"""Small SQLite helpers shared by the editor and AI tools.

Files stay inside DATA_DIR. API keys are used internally; the settings endpoint
returns only whether a key exists, never the key itself.
"""

from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
from uuid import uuid4

from fastapi import HTTPException


DATA_DIR = Path(os.getenv("SHORTFORGE_DATA_DIR", Path(__file__).resolve().parents[2] / "data")).resolve()
DEFAULT_SETTINGS = {
    "gemini_model": "gemini-3.8-flash",
    "niche": "",
    "language": "English",
    "min_likes": 5000,
    "min_views": 10000,
    "target_count": 30,
    "scout_mode": "narrated",
    "tts_provider": "piper",
    "piper_model": "",
    "whisper_model": "base",
    "clone_model_path": "",
    "clone_vocab_path": "",
    "clone_config_path": "",
}
SECRET_SETTINGS = {"youtube_api_key", "gemini_api_key", "elevenlabs_api_key"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY, video_id TEXT UNIQUE, url TEXT NOT NULL DEFAULT '',
    channel_name TEXT NOT NULL DEFAULT '', channel_handle TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
    likes INTEGER, views INTEGER, published_at TEXT, credit_target TEXT NOT NULL DEFAULT '',
    credit_snippet TEXT NOT NULL DEFAULT '',
    license_status TEXT NOT NULL DEFAULT 'unknown' CHECK (license_status IN ('unknown','cc_by','permission','owned')),
    permission_note TEXT NOT NULL DEFAULT '', thumbnail_url TEXT NOT NULL DEFAULT '',
    workflow_status TEXT NOT NULL DEFAULT 'collected' CHECK (workflow_status IN ('collected','downloaded','transcribed','editing','exported','archived')),
    discovery_mode TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, clip_id TEXT REFERENCES clips(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued', progress REAL NOT NULL DEFAULT 0,
    error TEXT, result TEXT
);
CREATE TABLE IF NOT EXISTS scripts (
    clip_id TEXT PRIMARY KEY REFERENCES clips(id) ON DELETE CASCADE,
    original_text TEXT NOT NULL, rewritten_text TEXT NOT NULL,
    words_original INTEGER NOT NULL, words_rewritten INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY, clip_id TEXT REFERENCES clips(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transcripts (
    clip_id TEXT PRIMARY KEY REFERENCES clips(id) ON DELETE CASCADE,
    text TEXT NOT NULL, words TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS voices (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    reference_asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
    reference_text TEXT NOT NULL DEFAULT '', consent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_by_clip ON assets(clip_id, created_at);
CREATE INDEX IF NOT EXISTS clips_by_created ON clips(created_at);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        # The WAL journal can contain settings too, so protect the entire folder.
        DATA_DIR.chmod(0o700)
    database = DATA_DIR / "shortforge.db"
    conn = sqlite3.connect(database, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    if os.name != "nt":
        database.chmod(0o600)
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_clip(clip_id: str) -> dict:
    with connect() as conn:
        row = conn.execute("SELECT * FROM clips WHERE id = ?", (clip_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Clip not found.")
    return dict(row)


def require_editable(clip_id: str) -> dict:
    clip = get_clip(clip_id)
    if clip["license_status"] not in {"cc_by", "permission", "owned"}:
        raise HTTPException(403, "This clip is inspiration only. Add the creator's permission with a note, or upload footage you own before downloading or editing.")
    return clip


def resolve_data_path(path: str | Path) -> Path:
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = DATA_DIR / candidate
    resolved = candidate.resolve()
    if not resolved.is_relative_to(DATA_DIR.resolve()) or resolved == DATA_DIR.resolve():
        raise HTTPException(400, "The file must be inside ShortForge's data folder.")
    return resolved


def asset_dict(row) -> dict:
    asset = dict(row)
    asset["url"] = f"/api/assets/{asset['id']}"
    return asset


def add_asset(clip_id: str | None, kind: str, path: Path) -> dict:
    if kind not in {"source", "voiceover", "export", "reference"}:
        raise ValueError("Unsupported asset kind")
    resolved = resolve_data_path(path)
    if clip_id is not None:
        get_clip(clip_id)
    asset = {"id": str(uuid4()), "clip_id": clip_id, "kind": kind,
             "path": str(resolved.relative_to(DATA_DIR.resolve())), "created_at": now()}
    with connect() as conn:
        conn.execute("INSERT INTO assets (id,clip_id,kind,path,created_at) VALUES (:id,:clip_id,:kind,:path,:created_at)", asset)
    return asset_dict(asset)


def get_asset(asset_id: str) -> dict:
    with connect() as conn:
        row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "File not found.")
    return asset_dict(row)


def get_settings() -> dict:
    settings = dict(DEFAULT_SETTINGS)
    for key in SECRET_SETTINGS:
        settings[key] = os.getenv(key.upper(), "")
    for key in DEFAULT_SETTINGS:
        value = os.getenv(key.upper())
        if value is not None:
            if isinstance(DEFAULT_SETTINGS[key], int):
                try:
                    settings[key] = int(value)
                except ValueError:
                    pass
            else:
                settings[key] = value
    with connect() as conn:
        for row in conn.execute("SELECT key,value FROM settings"):
            if row["key"] in DEFAULT_SETTINGS or row["key"] in SECRET_SETTINGS:
                settings[row["key"]] = json.loads(row["value"])
    return settings


def public_settings() -> dict:
    values = get_settings()
    return {**{key: values[key] for key in DEFAULT_SETTINGS},
            **{f"{key}_set": bool(values.get(key)) for key in SECRET_SETTINGS}}


def save_script(clip_id: str, original_text: str, rewritten_text: str) -> dict:
    get_clip(clip_id)
    script = {"clip_id": clip_id, "original_text": original_text,
              "rewritten_text": rewritten_text,
              "words_original": len(re.findall(r"\S+", original_text)),
              "words_rewritten": len(re.findall(r"\S+", rewritten_text))}
    with connect() as conn:
        conn.execute("INSERT INTO scripts VALUES (:clip_id,:original_text,:rewritten_text,:words_original,:words_rewritten) ON CONFLICT(clip_id) DO UPDATE SET original_text=excluded.original_text, rewritten_text=excluded.rewritten_text, words_original=excluded.words_original, words_rewritten=excluded.words_rewritten", script)
    return script


def new_job(type: str, clip_id: str | None) -> dict:
    if clip_id is not None:
        get_clip(clip_id)
    job = {"id": str(uuid4()), "type": type, "clip_id": clip_id, "status": "queued", "progress": 0, "error": None, "result": None}
    with connect() as conn:
        conn.execute("INSERT INTO jobs VALUES (:id,:type,:clip_id,:status,:progress,:error,:result)", job)
    return job


def update_job(job_id: str, **fields):
    if not fields or not set(fields).issubset({"status", "progress", "error", "result"}):
        raise ValueError("Unsupported job fields")
    if "progress" in fields:
        fields["progress"] = max(0, min(100, float(fields["progress"])))
    if "status" in fields and fields["status"] not in {"queued", "running", "completed", "failed"}:
        raise ValueError("Unsupported job status")
    if "error" in fields and fields["error"]:
        fields["error"] = redact_secrets(str(fields["error"]))[:2000]
    if "result" in fields:
        fields["result"] = json.dumps(fields["result"])
    with connect() as conn:
        assignments = ",".join(f"{key} = ?" for key in fields)
        conn.execute(f"UPDATE jobs SET {assignments} WHERE id = ?", (*fields.values(), job_id))


def get_job(job_id: str) -> dict:
    with connect() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Job not found.")
    result = dict(row)
    result["result"] = json.loads(result["result"]) if result["result"] else None
    return result


def redact_secrets(message: str) -> str:
    values = get_settings()
    for key in SECRET_SETTINGS:
        if values.get(key):
            message = message.replace(values[key], "[redacted]")
    return message
