"""Local client pairing, revocable access, and narrowly scoped media links.

Only the launcher can mint the first connection code. No unauthenticated HTTP
endpoint reveals a credential, even to a different process on this computer.
"""

import base64
from functools import lru_cache
from contextlib import contextmanager
import hashlib
import html
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
from threading import RLock
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from . import db
from .private_storage import private_directory, private_write

router = APIRouter(prefix="/api/security", tags=["Local connection"])
SESSION_SECONDS = 30 * 86400
PAIR_SECONDS = 300
MEDIA_SECONDS = 3600
_lock = RLock()
_media_epoch = secrets.token_hex(16)
_media_key = secrets.token_bytes(32)
EXTENSION_ORIGIN = re.compile(r"chrome-extension://[a-p]{32}")
MEDIA_PATH = re.compile(
    r"/api/(?:assets/[A-Za-z0-9_-]{1,80}|clips/[A-Za-z0-9_-]{1,80}/thumbnail)"
)
SCHEMA = """
CREATE TABLE IF NOT EXISTS clients (
 id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL,
 origin TEXT, expires_at REAL NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS pairing (
 code_hash TEXT PRIMARY KEY, origin TEXT NOT NULL, expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
 id INTEGER PRIMARY KEY, at REAL NOT NULL, event TEXT NOT NULL, client_id TEXT
);
"""


@contextmanager
def connect():
    folder = private_directory(db.DATA_DIR / "security")
    path = folder / "access.db"
    if path.is_symlink():
        raise RuntimeError("The connection database cannot be a symbolic link.")
    with _lock:
        connection = sqlite3.connect(path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.executescript(SCHEMA)
        if os.name != "nt":
            path.chmod(0o600)
        try:
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()


def dashboard_origins() -> set[str]:
    origins = {
        "http://127.0.0.1:8787",
        "http://localhost:8787",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    }
    for origin in os.getenv("SHORTFORGE_DASHBOARD_ORIGINS", "").split(","):
        if not origin:
            continue
        parsed = urlsplit(origin)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise RuntimeError("Dashboard origins must be exact local HTTP origins.")
        origins.add(origin)
    return origins


@lru_cache(maxsize=1)
def scout_origin() -> str:
    root = Path(__file__).resolve().parents[2]
    manifest = json.loads((root / "extension/static/manifest.json").read_text())
    if manifest.get("key"):
        material = base64.b64decode(manifest["key"], validate=True)
    else:
        # Chromium derives unpacked IDs from the absolute extension directory.
        path = str(root / "extension/dist")
        if os.name == "nt" and len(path) > 1 and path[1] == ":":
            path = path[0].upper() + path[1:]
        material = path.encode()
    identity = "".join(
        chr(ord("a") + int(n, 16)) for n in hashlib.sha256(material).hexdigest()[:32]
    )
    return "chrome-extension://" + identity


def allowed_origin(origin: str) -> bool:
    return origin in dashboard_origins() or origin == scout_origin()


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def audit(event: str, client_id: str | None = None) -> None:
    # Never store headers, connection codes, provider text, or query strings.
    with connect() as connection:
        connection.execute(
            "INSERT INTO audit(at,event,client_id) VALUES(?,?,?)",
            (time.time(), event, client_id),
        )
        connection.execute(
            "DELETE FROM audit WHERE id <= (SELECT COALESCE(MAX(id),0)-2000 FROM audit)"
        )


def _client(connection, origin: str | None) -> dict:
    token = secrets.token_urlsafe(32)
    identity = secrets.token_hex(16)
    expires = time.time() + SESSION_SECONDS
    connection.execute("DELETE FROM clients WHERE expires_at<=?", (time.time(),))
    connection.execute(
        "DELETE FROM clients WHERE id NOT IN (SELECT id FROM clients ORDER BY created_at DESC LIMIT 63)"
    )
    connection.execute(
        "INSERT INTO clients VALUES(?,?,?,?,?)",
        (identity, _digest(token), origin, expires, time.time()),
    )
    return {"token": token, "expires_at": expires, "client_id": identity}


def local_client(origin: str | None = None) -> dict:
    """Trusted local Python entry point for tools/tests; never exposed as HTTP."""
    with connect() as connection:
        return _client(connection, origin)


def start_session() -> None:
    # Old credentials are useless after restart, including if another local
    # process temporarily occupied the HTTP port while ShortForge was stopped.
    global _media_epoch, _media_key
    _media_epoch = secrets.token_hex(16)
    _media_key = secrets.token_bytes(32)
    with connect() as connection:
        connection.execute("DELETE FROM clients")
        connection.execute("DELETE FROM pairing WHERE expires_at<=?", (time.time(),))


def create_pairing(origin: str = "http://127.0.0.1:8787") -> str:
    if not allowed_origin(origin):
        raise ValueError("Unsupported connection origin")
    code = secrets.token_urlsafe(32)
    with connect() as connection:
        connection.execute("DELETE FROM pairing WHERE expires_at<=?", (time.time(),))
        connection.execute("DELETE FROM pairing WHERE origin=?", (origin,))
        connection.execute(
            "INSERT INTO pairing VALUES(?,?,?)",
            (_digest(code), origin, time.time() + PAIR_SECONDS),
        )
    return code


def launch_file(origin: str = "http://127.0.0.1:8787") -> Path:
    """Keep the one-use secret out of browser/xdg-open command arguments."""
    code = create_pairing(origin)
    folder = private_directory(db.DATA_DIR / "security")
    for previous in folder.glob("launch-*.html"):
        try:
            previous.unlink()
        except OSError:
            pass
    path = folder / ("launch-" + _digest(code) + ".html")
    url = html.escape(origin + "/#connect=" + code, quote=True)
    content = (
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        '<meta name="referrer" content="no-referrer">'
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; base-uri 'none'\">"
        f'<meta http-equiv="refresh" content="0;url={url}">'
        "<title>Opening ShortForge</title>"
        f'<p>Opening your private workspace… <a href="{url}">Continue to ShortForge</a></p></html>'
    )
    private_write(path, content.encode())
    return path


def authenticate(token: str, origin: str | None) -> dict | None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        return None
    with connect() as connection:
        row = connection.execute(
            "SELECT id,origin,expires_at FROM clients WHERE token_hash=? AND expires_at>?",
            (_digest(token), time.time()),
        ).fetchone()
    if row is None or (origin is not None and row["origin"] != origin):
        return None
    return dict(row)


def media_url(path: str) -> str:
    if not MEDIA_PATH.fullmatch(path):
        raise ValueError("Unsupported media URL")
    # Stable within a time bucket so unchanged Library responses retain ETags.
    expires = (int(time.time()) // MEDIA_SECONDS + 2) * MEDIA_SECONDS
    message = f"media:{_media_epoch}:{path}:{expires}".encode()
    signature = hmac.new(_media_key, message, hashlib.sha256).hexdigest()
    return f"{path}?expires={expires}&access={signature}"


def valid_media_url(path: str, query) -> bool:
    if not MEDIA_PATH.fullmatch(path):
        return False
    expires, signature = query.get("expires", ""), query.get("access", "")
    if not re.fullmatch(r"\d{1,12}", expires) or not re.fullmatch(
        r"[0-9a-f]{64}", signature
    ):
        return False
    if not time.time() < int(expires) <= time.time() + 2 * MEDIA_SECONDS:
        return False
    expected = hmac.new(
        _media_key, f"media:{_media_epoch}:{path}:{expires}".encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def refresh_media_links(value):
    if isinstance(value, list):
        return [refresh_media_links(item) for item in value]
    if isinstance(value, dict):
        return {
            key: media_url(urlsplit(item).path)
            if key in {"url", "thumbnail_url"}
            and isinstance(item, str)
            and MEDIA_PATH.fullmatch(urlsplit(item).path)
            else refresh_media_links(item)
            for key, item in value.items()
        }
    return value


class PairRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]+$")


@router.post("/pair")
def pair(body: PairRequest, request: Request):
    origin = request.headers.get("origin")
    if not origin or not allowed_origin(origin):
        raise HTTPException(
            403, "Open the connection link in ShortForge's local dashboard."
        )
    with connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT origin,expires_at FROM pairing WHERE code_hash=?",
            (_digest(body.code),),
        ).fetchone()
        if row is None or row["origin"] != origin or row["expires_at"] <= time.time():
            raise HTTPException(
                401,
                "This connection link expired or was already used. Start ShortForge again to open a fresh connected window.",
            )
        connection.execute(
            "DELETE FROM pairing WHERE code_hash=?", (_digest(body.code),)
        )
        client = _client(connection, origin)
    audit("client_connected", client["client_id"])
    try:
        (db.DATA_DIR / "security" / ("launch-" + _digest(body.code) + ".html")).unlink(
            missing_ok=True
        )
    except OSError:
        pass  # A browser can still hold the file open on Windows.
    return client


@router.get("/session")
def session(request: Request):
    return {"connected": True, "expires_at": request.state.client["expires_at"]}


@router.post("/scout-grant")
def scout_grant(request: Request):
    if request.state.client["origin"] not in dashboard_origins():
        raise HTTPException(403, "Connect Scout from the local dashboard.")
    origin = scout_origin()
    return {
        "extension_id": origin.removeprefix("chrome-extension://"),
        "code": create_pairing(origin),
    }


@router.delete("/session")
def disconnect(request: Request):
    identity = request.state.client["id"]
    with connect() as connection:
        connection.execute("DELETE FROM clients WHERE id=?", (identity,))
    audit("client_disconnected", identity)
    return {"disconnected": True}
