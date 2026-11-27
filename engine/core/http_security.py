"""Enforce access and budgets before FastAPI parses or processes a request."""

import asyncio
from collections import OrderedDict, deque
from email.message import Message
import shutil
from threading import BoundedSemaphore, Lock
import time

from fastapi import Request
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import db, security

MIB = 1024 * 1024
DASHBOARD_CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data: blob: https://i.ytimg.com https://yt3.ggpht.com https://yt3.googleusercontent.com",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)


def body_limit(scope) -> int:
    headers = dict(scope.get("headers", []))
    content_type = Message()
    content_type["content-type"] = headers.get(b"content-type", b"").decode("latin1")
    if content_type.get_content_type() == "multipart/form-data":
        if scope["path"] == "/api/upload":
            return 501 * MIB
        if scope["path"] == "/api/voices/clone":
            return 21 * MIB
    return 2 * MIB


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = body_limit(scope)
        lengths = [
            value for name, value in scope["headers"] if name == b"content-length"
        ]
        if lengths:
            try:
                size = int(lengths[0])
            except ValueError:
                size = -1
            if len(lengths) != 1 or size < 0 or size > limit:
                response = JSONResponse(
                    {"detail": "This request is too large or has an invalid length."},
                    status_code=413 if size > limit else 400,
                )
                return await response(scope, receive, send)
        received = 0

        async def limited_receive():
            nonlocal received
            try:
                message = await asyncio.wait_for(receive(), timeout=30)
            except TimeoutError:
                raise HTTPException(
                    408, "The upload stopped sending data. Please retry."
                ) from None
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise HTTPException(413, "This request exceeds its size limit.")
            return message

        await self.app(scope, limited_receive, send)


class AccessMiddleware:
    def __init__(self, app):
        self.app = app
        self._attempts = OrderedDict()
        self._lock = Lock()

    def rate_allowed(self, key: str, limit: int) -> bool:
        now = time.monotonic()
        with self._lock:
            attempts = self._attempts.setdefault(key, deque())
            self._attempts.move_to_end(key)
            while attempts and attempts[0] <= now - 60:
                attempts.popleft()
            if len(attempts) >= limit:
                return False
            attempts.append(now)
            while len(self._attempts) > 256:
                self._attempts.popitem(last=False)
        return True

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request = Request(scope)
        path = scope["path"]
        status = 500

        async def secured_send(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = list(message.get("headers", []))
                existing = {name for name, _ in headers}
                for name, value in (
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"content-security-policy", DASHBOARD_CSP.encode()),
                    (
                        b"permissions-policy",
                        b"camera=(), microphone=(), geolocation=()",
                    ),
                ):
                    if name not in existing:
                        headers.append((name, value))
                if path.startswith("/api/security/"):
                    headers = [
                        (name, value)
                        for name, value in headers
                        if name != b"cache-control"
                    ]
                    headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        async def reject(code: int, detail: str):
            await JSONResponse({"detail": detail}, status_code=code)(
                scope, receive, secured_send
            )

        if not path.startswith("/api/"):
            return await self.app(scope, receive, secured_send)
        for sensitive in (b"authorization", b"origin", b"content-type"):
            if sum(name == sensitive for name, _ in scope["headers"]) > 1:
                return await reject(400, "Ambiguous request headers.")
        origin = request.headers.get("origin")
        callback = request.method == "GET" and path == "/api/youtube/oauth/callback"
        if not callback and (
            (origin is not None and not security.allowed_origin(origin))
            or (not origin and request.headers.get("sec-fetch-site") == "cross-site")
        ):
            return await reject(
                403,
                "Only your connected ShortForge dashboard and Scout can use this engine.",
            )
        authorization = request.headers.get("authorization", "")
        client = (
            await run_in_threadpool(security.authenticate, authorization[7:], origin)
            if authorization.startswith("Bearer ")
            else None
        )
        request.state.client = client
        public = (
            callback
            or (request.method == "GET" and path == "/api/health")
            or (request.method == "POST" and path == "/api/security/pair")
        )
        media = request.method in {"GET", "HEAD"} and security.valid_media_url(
            path, request.query_params
        )
        if not client and not public and not media:
            return await reject(
                401,
                "This browser is not connected. Start ShortForge to open a connected window, or connect Scout from Settings.",
            )
        if (
            public
            and not client
            and not self.rate_allowed("public:" + str(db.DATA_DIR), 180)
        ):
            return await reject(429, "Too many requests. Wait a minute and retry.")
        if path == "/api/security/pair":
            key = "pair:" + str(db.DATA_DIR)
            if not self.rate_allowed(key, 10):
                return await reject(
                    429,
                    "Too many connection attempts. Wait a minute and use a fresh connection link.",
                )
        if client and not media:
            kind = "read" if request.method in {"GET", "HEAD"} else "write"
            if not self.rate_allowed(
                client["id"] + kind, 1200 if kind == "read" else 600
            ):
                return await reject(
                    429,
                    "ShortForge is receiving too many requests. Wait a minute and retry.",
                )
        await self.app(scope, receive, secured_send)
        if client and request.method not in {"GET", "HEAD", "OPTIONS"} and status < 400:
            await run_in_threadpool(
                security.audit, f"{request.method} {path[:160]}", client["id"]
            )


class WorkLimitMiddleware:
    """Admission control leaves request workers free for pause, status and reads."""

    def __init__(self, app, maximum: int = 2):
        self.app = app
        self.slots = BoundedSemaphore(maximum)

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        growing = (
            scope["type"] == "http"
            and scope["method"] in {"POST", "PUT", "PATCH"}
            and path.startswith("/api/")
            and not path.startswith("/api/security/")
            and not path.endswith("/cancel")
            and path != "/api/clips/delete-bulk"
        )
        if growing:
            database = db.DATA_DIR / "shortforge.db"
            if shutil.disk_usage(db.DATA_DIR).free < 1024 * MIB or (
                database.exists() and database.stat().st_size > 512 * MIB
            ):
                return await JSONResponse(
                    {
                        "detail": "Storage is nearly full. Remove unneeded Library items or free disk space before saving more data."
                    },
                    status_code=507,
                )(scope, receive, send)
        expensive = (
            scope["type"] == "http"
            and scope["method"] == "POST"
            and (
                path
                in {
                    "/api/upload",
                    "/api/voices/clone",
                    "/api/tts",
                    "/api/studio/open",
                    "/api/scout/caption-check",
                }
                or path.startswith("/api/clips/")
                and path.rsplit("/", 1)[-1]
                in {"download", "transcribe", "extract-script", "enrich"}
            )
        )
        if not expensive:
            return await self.app(scope, receive, send)
        deadline = time.monotonic() + 0.5
        acquired = self.slots.acquire(blocking=False)
        while not acquired and time.monotonic() < deadline:
            await asyncio.sleep(0.01)
            acquired = self.slots.acquire(blocking=False)
        if not acquired:
            return await JSONResponse(
                {
                    "detail": "Two tasks are already running. Wait for one to finish, then retry."
                },
                status_code=429,
            )(scope, receive, send)
        try:
            if shutil.disk_usage(db.DATA_DIR).free < 1024 * MIB:
                return await JSONResponse(
                    {
                        "detail": "Less than 1 GB of free space remains. Free some disk space before adding or processing media."
                    },
                    status_code=507,
                )(scope, receive, send)
            await self.app(scope, receive, send)
        finally:
            self.slots.release()
