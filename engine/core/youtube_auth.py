"""Local Google Desktop OAuth grants for explicitly chosen YouTube channels.

Only channel identity crosses the dashboard API. Access/refresh tokens, PKCE
verifiers and client credentials stay in the engine's protected SQLite folder.
"""

import base64
import hashlib
import html
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
from typing import Literal
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from . import db, security


router = APIRouter(prefix="/api/youtube", tags=["YouTube publishing"])
SCOPES = (
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
)
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"
CALLBACK_PATH = "/api/youtube/oauth/callback"
STATE_LIFETIME = 10 * 60
_auth_lock = threading.RLock()
SCHEMA = """
CREATE TABLE IF NOT EXISTS youtube_oauth_states (
    state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL,
    redirect_uri TEXT NOT NULL, client_fingerprint TEXT NOT NULL,
    expires_at REAL NOT NULL,
    return_to TEXT NOT NULL DEFAULT '/?settings=youtube',
    theme TEXT NOT NULL DEFAULT 'system'
);
CREATE TABLE IF NOT EXISTS youtube_channels (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, thumbnail_url TEXT NOT NULL,
    access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
    expires_at REAL NOT NULL, scopes TEXT NOT NULL,
    client_fingerprint TEXT NOT NULL, connected_at TEXT NOT NULL
);
"""


def init_storage() -> None:
    # Do not cache initialization: tests and local installations can change DATA_DIR.
    with _auth_lock, db.connect() as conn:
        conn.executescript(SCHEMA)
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(youtube_oauth_states)")
        }
        if "return_to" not in columns:
            conn.execute(
                "ALTER TABLE youtube_oauth_states ADD COLUMN return_to TEXT NOT NULL DEFAULT '/?settings=youtube'"
            )
        if "theme" not in columns:
            conn.execute(
                "ALTER TABLE youtube_oauth_states ADD COLUMN theme TEXT NOT NULL DEFAULT 'system'"
            )


def _credentials() -> tuple[str, str]:
    settings = db.get_settings()
    return (
        settings.get("youtube_client_id", "").strip(),
        settings.get("youtube_client_secret", "").strip(),
    )


def _fingerprint(credentials: tuple[str, str]) -> str:
    return hashlib.sha256(json.dumps(credentials).encode()).hexdigest()


def _redirect_uri() -> str:
    uri = os.getenv(
        "SHORTFORGE_YOUTUBE_REDIRECT_URI", f"http://127.0.0.1:8787{CALLBACK_PATH}"
    )
    try:
        parsed = urlsplit(uri)
        valid = (
            parsed.scheme == "http"
            and parsed.hostname in {"127.0.0.1", "::1"}
            and parsed.path == CALLBACK_PATH
            and not parsed.username
            and not parsed.password
            and not parsed.query
            and not parsed.fragment
            and (parsed.port is None or 1 <= parsed.port <= 65535)
        )
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(
            503,
            "Set SHORTFORGE_YOUTUBE_REDIRECT_URI to the engine's loopback HTTP "
            f"address ending in {CALLBACK_PATH}.",
        )
    return uri


def _client() -> httpx.Client:
    return httpx.Client(
        timeout=httpx.Timeout(20, connect=10), follow_redirects=False, trust_env=False
    )


def _google_json(method: str, url: str, **kwargs) -> dict:
    # Never include provider bodies or exception text in public errors: both can
    # repeat codes, tokens or credentials. Redirects must not forward a grant.
    try:
        with _client() as client:
            response = client.request(method, url, **kwargs)
        if response.status_code in {400, 401}:
            raise HTTPException(
                401,
                "Google could not authorize this connection. Check the Desktop app "
                "credentials and reconnect the channel in Settings.",
            )
        if response.status_code == 403:
            raise HTTPException(
                403,
                "YouTube denied access. Enable YouTube Data API v3 in your Google "
                "project, check its quota and grant both requested permissions.",
            )
        if response.status_code != 200:
            raise HTTPException(
                502,
                "Google is unavailable right now. Try connecting the channel again.",
            )
        result = response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            502, "Could not reach Google. Check your connection and try again."
        ) from None
    if not isinstance(result, dict):
        raise HTTPException(502, "Google returned an unreadable response. Try again.")
    return result


def _token_values(result: dict, fallback_scopes: str) -> tuple[str, float, str]:
    access_token = result.get("access_token")
    token_type = result.get("token_type", "Bearer")
    if (
        not isinstance(access_token, str)
        or not access_token
        or len(access_token) > 16384
        or not isinstance(token_type, str)
        or token_type.lower() != "bearer"
    ):
        raise HTTPException(
            502, "Google did not return a usable access token. Reconnect."
        )
    scopes = result.get("scope", fallback_scopes)
    if not isinstance(scopes, str) or not set(SCOPES).issubset(scopes.split()):
        raise HTTPException(
            403,
            "Both YouTube upload and channel read permissions are required. "
            "Reconnect and allow both permissions.",
        )
    try:
        expires_in = float(result.get("expires_in", 0))
        if not 0 < expires_in <= 86400:
            raise ValueError
    except (TypeError, ValueError):
        raise HTTPException(
            502, "Google returned an invalid token lifetime. Reconnect."
        ) from None
    return access_token, time.time() + expires_in, scopes


def _channel_identity(access_token: str) -> dict:
    result = _google_json(
        "GET",
        CHANNELS_URL,
        params={"part": "snippet", "mine": "true", "maxResults": 2},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    items = result.get("items")
    if not isinstance(items, list) or len(items) != 1 or result.get("nextPageToken"):
        raise HTTPException(
            409,
            "Choose one specific YouTube channel in Google's connection screen. "
            "The selected Google account must have a YouTube channel.",
        )
    item = items[0]
    if not isinstance(item, dict) or not isinstance(item.get("snippet"), dict):
        raise HTTPException(502, "YouTube returned an unreadable channel identity.")
    channel_id = item.get("id")
    title = item["snippet"].get("title")
    if (
        not isinstance(channel_id, str)
        or not re.fullmatch(r"UC[A-Za-z0-9_-]{22}", channel_id)
        or not isinstance(title, str)
        or not title.strip()
    ):
        raise HTTPException(502, "YouTube returned an unreadable channel identity.")
    thumbnails = item["snippet"].get("thumbnails", {})
    thumbnail = (
        thumbnails.get("default", {}).get("url", "")
        if isinstance(thumbnails, dict)
        and isinstance(thumbnails.get("default", {}), dict)
        else ""
    )
    if not isinstance(thumbnail, str) or not thumbnail.startswith("https://"):
        thumbnail = ""
    return {"id": channel_id, "title": title[:1000], "thumbnail_url": thumbnail}


def _stored_channel(channel_id: str) -> dict:
    init_storage()
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM youtube_channels WHERE id=?", (channel_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Connect this YouTube channel in Settings first.")
    if row["client_fingerprint"] != _fingerprint(_credentials()):
        raise HTTPException(
            401, "The Google app credentials changed. Reconnect this channel."
        )
    return {
        **dict(row),
        "access_token": db.reveal_secret(row["access_token"]),
        "refresh_token": db.reveal_secret(row["refresh_token"]),
    }


def get_channel(channel_id: str) -> dict:
    channel = _stored_channel(channel_id)
    return {key: channel[key] for key in ("id", "title", "thumbnail_url")}


def get_access_token(channel_id: str) -> str:
    """Internal only. Refresh grants without ever switching the upload channel."""
    with _auth_lock:
        channel = _stored_channel(channel_id)
        credentials = _credentials()
        if not all(credentials):
            raise HTTPException(
                401, "Configure your Google Desktop app in Settings first."
            )
        if channel["expires_at"] > time.time() + 60:
            return channel["access_token"]
        result = _google_json(
            "POST",
            TOKEN_URL,
            data={
                "client_id": credentials[0],
                "client_secret": credentials[1],
                "refresh_token": channel["refresh_token"],
                "grant_type": "refresh_token",
            },
        )
        token, expiry, scopes = _token_values(result, channel["scopes"])
        identity = _channel_identity(token)
        if identity["id"] != channel_id:
            raise HTTPException(
                409,
                "Google returned a different channel. Reconnect the intended channel before publishing.",
            )
        if _fingerprint(_credentials()) != channel["client_fingerprint"]:
            raise HTTPException(
                409, "The Google app credentials changed. Reconnect this channel."
            )
        # Google normally keeps the old refresh token, but can rotate it.
        refresh_token = result.get("refresh_token", channel["refresh_token"])
        if (
            not isinstance(refresh_token, str)
            or not refresh_token
            or len(refresh_token) > 16384
        ):
            raise HTTPException(
                502, "Google did not return a usable refresh token. Reconnect."
            )
        with db.connect() as conn:
            changed = conn.execute(
                "UPDATE youtube_channels SET access_token=?,refresh_token=?,expires_at=?,scopes=?,"
                "title=?,thumbnail_url=? WHERE id=? AND client_fingerprint=?",
                (
                    db.protect_secret(token),
                    db.protect_secret(refresh_token),
                    expiry,
                    scopes,
                    identity["title"],
                    identity["thumbnail_url"],
                    channel_id,
                    channel["client_fingerprint"],
                ),
            ).rowcount
        if not changed:
            raise HTTPException(
                409, "This channel was disconnected. Reconnect before publishing."
            )
        return token


class YouTubeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: str = Field(min_length=1, max_length=512)
    client_secret: SecretStr = Field(min_length=1, max_length=4096)


@router.put("/config")
def configure(body: YouTubeConfig):
    credentials = (
        body.client_id.strip(),
        body.client_secret.get_secret_value().strip(),
    )
    if (
        not re.fullmatch(
            r"[A-Za-z0-9._-]+\.apps\.googleusercontent\.com", credentials[0]
        )
        or not credentials[1]
    ):
        raise HTTPException(
            422,
            "Enter the client ID and client secret from a Google Desktop app OAuth client.",
        )
    with _auth_lock:
        init_storage()
        changed = credentials != _credentials()
        with db.connect() as conn:
            for key, value in zip(
                ("youtube_client_id", "youtube_client_secret"), credentials
            ):
                conn.execute(
                    "INSERT INTO settings(key,value) VALUES (?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (key, db.setting_value(key, value)),
                )
            if changed:
                conn.execute("DELETE FROM youtube_channels")
                conn.execute("DELETE FROM youtube_oauth_states")
    return {"configured": True}


@router.get("/channels")
def channels():
    init_storage()
    credentials = _credentials()
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id,title,thumbnail_url FROM youtube_channels "
            "WHERE client_fingerprint=? ORDER BY connected_at,id",
            (_fingerprint(credentials),),
        ).fetchall()
    return {
        "configured": all(credentials),
        "redirect_uri": _redirect_uri(),
        "channels": [dict(row) for row in rows],
    }


class OAuthAppearance(BaseModel):
    model_config = ConfigDict(extra="forbid")
    theme: Literal["light", "dark", "system"] = "system"


def _settings_return(origin: str | None) -> str:
    if origin and security.allowed_origin(origin):
        path = "/dashboard/index.html" if origin == security.scout_origin() else "/"
        return origin + path + "?settings=youtube"
    return "/?settings=youtube"


@router.post("/oauth/start")
def start(request: Request, body: OAuthAppearance | None = None):
    with _auth_lock:
        init_storage()
        credentials = _credentials()
        if not all(credentials):
            raise HTTPException(
                409, "Configure your Google Desktop app in Settings first."
            )
        redirect_uri = _redirect_uri()
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        with db.connect() as conn:
            conn.execute(
                "DELETE FROM youtube_oauth_states WHERE expires_at<=?", (time.time(),)
            )
            # Bound abandoned tabs while allowing a few simultaneous connections.
            conn.execute(
                "DELETE FROM youtube_oauth_states WHERE state_hash NOT IN "
                "(SELECT state_hash FROM youtube_oauth_states ORDER BY expires_at DESC LIMIT 9)"
            )
            conn.execute(
                "INSERT INTO youtube_oauth_states "
                "(state_hash,verifier,redirect_uri,client_fingerprint,expires_at,return_to,theme) "
                "VALUES (?,?,?,?,?,?,?)",
                (
                    hashlib.sha256(state.encode()).hexdigest(),
                    db.protect_secret(verifier),
                    redirect_uri,
                    _fingerprint(credentials),
                    time.time() + STATE_LIFETIME,
                    _settings_return(
                        request.headers.get("origin") or request.state.client["origin"]
                    ),
                    body.theme if body else "system",
                ),
            )
    return {
        "authorization_url": AUTH_URL
        + "?"
        + urlencode(
            {
                "client_id": credentials[0],
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": " ".join(SCOPES),
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "access_type": "offline",
                "prompt": "consent select_account",
            }
        )
    }


def _callback_page(
    message: str,
    status_code: int = 200,
    *,
    result: str = "error",
    return_to: str = "/?settings=youtube",
    theme: str = "system",
    channel_title: str = "",
) -> HTMLResponse:
    titles = {
        "success": "YouTube is connected.",
        "cancelled": "Connection cancelled.",
        "expired": "This link has expired.",
        "error": "Let’s try that again.",
    }
    title = titles.get(result, titles["error"])
    # Only a known local workspace can be a return destination, even if a stale
    # or damaged pending record is read. Google query parameters never set it.
    parsed = urlsplit(return_to)
    allowed_return = _settings_return(f"{parsed.scheme}://{parsed.netloc}")
    if return_to != allowed_return:
        return_to = "/?settings=youtube"
    template_path = (
        Path(__file__).resolve().parents[2] / "extension/dist/dashboard/oauth.html"
    )
    try:
        template = template_path.read_text()
        # Vite's relative base also supports packaged extension pages. This
        # template is returned at a nested API URL, so its assets start at /.
        template = template.replace('src="./', 'src="/').replace('href="./', 'href="/')
    except FileNotFoundError:
        # API-only installations still get an honest result and recovery path.
        template = (
            '<!doctype html><html lang="en"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            "<title>__OAUTH_TITLE__ · ShortForge</title><body>"
            "<h1>__OAUTH_TITLE__</h1><p>__OAUTH_MESSAGE__</p>"
            '<a href="__OAUTH_RETURN__">Back to Settings</a></body></html>'
        )
    values = {
        "TITLE": title,
        "MESSAGE": message,
        "RESULT": result if result in titles else "error",
        "RETURN": return_to,
        "THEME": theme if theme in {"light", "dark"} else "system",
        "CHANNEL": channel_title,
        "CHANNEL_HIDDEN": "" if result == "success" and channel_title else "hidden",
    }
    content = re.sub(
        r"__OAUTH_([A-Z_]+)__",
        lambda match: html.escape(values[match[1]], quote=True),
        template,
    )
    return HTMLResponse(
        content,
        status_code=status_code,
        headers={
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": (
                "default-src 'none'; script-src 'self'; style-src 'self'; "
                "font-src 'self'; img-src 'self'; base-uri 'none'; "
                "form-action 'none'; frame-ancestors 'none'"
            ),
        },
    )


@router.get("/oauth/callback", response_class=HTMLResponse)
def callback(state: str = "", code: str = "", error: str = ""):
    with _auth_lock:
        init_storage()
        if not state or len(state) > 512:
            return _callback_page(
                "This connection request is invalid or expired. Start again in Settings.",
                400,
                result="expired",
            )
        state_hash = hashlib.sha256(state.encode()).hexdigest()
        with db.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            pending = conn.execute(
                "SELECT * FROM youtube_oauth_states WHERE state_hash=?", (state_hash,)
            ).fetchone()
            # Commit consumption even for cancellation, expiry or an unusable code.
            conn.execute(
                "DELETE FROM youtube_oauth_states WHERE state_hash=?", (state_hash,)
            )
        credentials = _credentials()
        appearance = (
            {
                "return_to": pending["return_to"],
                "theme": pending["theme"],
            }
            if pending
            else {}
        )
        if (
            pending is None
            or pending["expires_at"] <= time.time()
            or pending["client_fingerprint"] != _fingerprint(credentials)
        ):
            return _callback_page(
                "This connection request is invalid or expired. Start again in Settings.",
                400,
                result="expired",
                **appearance,
            )
        if error:
            return _callback_page(
                "YouTube connection was cancelled or denied. No new channel was connected.",
                400,
                result="cancelled",
                **appearance,
            )
        if not code or len(code) > 8192:
            return _callback_page(
                "Google did not supply a usable connection code. Start again in Settings.",
                400,
                **appearance,
            )
        try:
            result = _google_json(
                "POST",
                TOKEN_URL,
                data={
                    "client_id": credentials[0],
                    "client_secret": credentials[1],
                    "code": code,
                    "code_verifier": db.reveal_secret(pending["verifier"]),
                    "redirect_uri": pending["redirect_uri"],
                    "grant_type": "authorization_code",
                },
            )
            token, expiry, scopes = _token_values(result, " ".join(SCOPES))
            identity = _channel_identity(token)
            refresh_token = result.get("refresh_token")
            if (
                not isinstance(refresh_token, str)
                or not refresh_token
                or len(refresh_token) > 16384
            ):
                raise HTTPException(
                    401,
                    "Google did not grant continuing access. Reconnect and approve the consent screen.",
                )
            if pending["client_fingerprint"] != _fingerprint(_credentials()):
                raise HTTPException(
                    409,
                    "The Google app credentials changed. Start connecting again in Settings.",
                )
            with db.connect() as conn:
                conn.execute(
                    "INSERT INTO youtube_channels VALUES (?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(id) DO UPDATE SET title=excluded.title,thumbnail_url=excluded.thumbnail_url,"
                    "access_token=excluded.access_token,refresh_token=excluded.refresh_token,"
                    "expires_at=excluded.expires_at,scopes=excluded.scopes,"
                    "client_fingerprint=excluded.client_fingerprint,connected_at=excluded.connected_at",
                    (
                        identity["id"],
                        identity["title"],
                        identity["thumbnail_url"],
                        db.protect_secret(token),
                        db.protect_secret(refresh_token),
                        expiry,
                        scopes,
                        pending["client_fingerprint"],
                        db.now(),
                    ),
                )
        except HTTPException as exc:
            return _callback_page(exc.detail, exc.status_code, **appearance)
        return _callback_page(
            "Review your channel in Settings, then choose a video to publish or schedule.",
            result="success",
            channel_title=identity["title"],
            **appearance,
        )


@router.delete("/channels/{channel_id}")
def disconnect(channel_id: str):
    with _auth_lock:
        init_storage()
        with db.connect() as conn:
            conn.execute("DELETE FROM youtube_channels WHERE id=?", (channel_id,))
    return {"disconnected": True}
