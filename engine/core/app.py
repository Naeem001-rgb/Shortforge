"""Run with: python -m uvicorn engine.core.app:app --host 127.0.0.1 --port 8787."""

from contextlib import asynccontextmanager
import importlib
import re

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db
from .routes import router


LOCAL_ORIGIN = re.compile(r"^(?:https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?|chrome-extension://[a-p]{32})$")


class BodyLimitMiddleware:
    """Bound streamed bodies too; Content-Length is optional for HTTP clients."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        multipart = b"multipart/form-data" in headers.get(b"content-type", b"")
        limit = 501 * 1024 * 1024 if multipart else 2 * 1024 * 1024
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise StarletteHTTPException(413, "The request is too large.")
            return message

        await self.app(scope, limited_receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # A terminated process cannot resume in-memory jobs. Show a useful failure
    # rather than keeping the progress indicator running forever after restart.
    with db.connect() as conn:
        conn.execute("UPDATE jobs SET status='failed',error='ShortForge restarted before this job finished. Please run it again.' WHERE status IN ('queued','running')")
    yield


app = FastAPI(title="ShortForge local engine", version="0.1.0", lifespan=lifespan)
app.add_middleware(BodyLimitMiddleware)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]"])


@app.middleware("http")
async def protect_local_engine(request: Request, call_next):
    origin = request.headers.get("origin")
    # CORS alone does not stop a website from sending a form POST to localhost.
    # Block the request itself before any state or files can change.
    if origin and not LOCAL_ORIGIN.fullmatch(origin):
        return JSONResponse({"detail": "ShortForge only accepts requests from its local dashboard and Chrome extension."}, status_code=403)
    if request.headers.get("sec-fetch-site") == "cross-site" and not origin:
        return JSONResponse({"detail": "Cross-site requests to the local engine are blocked."}, status_code=403)
    raw_length = request.headers.get("content-length")
    if raw_length:
        try:
            size = int(raw_length)
        except ValueError:
            return JSONResponse({"detail": "Invalid content length."}, status_code=400)
        limit = 501 * 1024 * 1024 if "multipart/form-data" in request.headers.get("content-type", "") else 2 * 1024 * 1024
        if size < 0 or size > limit:
            return JSONResponse({"detail": "This upload is too large (videos: 500 MB; JSON: 2 MB)."}, status_code=413)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


app.add_middleware(CORSMiddleware, allow_origin_regex=LOCAL_ORIGIN.pattern, allow_credentials=False,
                   allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
                   allow_headers=["Content-Type"], expose_headers=["Content-Disposition"])


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # Pydantic's default response repeats input values, which could include keys.
    details = []
    for error in exc.errors():
        field = ".".join(str(part) for part in error["loc"] if part != "body")
        details.append(f"{field}: {error['msg']}")
    return JSONResponse({"detail": "; ".join(details)}, status_code=422)


app.include_router(router)
for module_name in ("engine.ai.routes", "engine.studio.routes", "engine.studio.editor_routes", "engine.studio.separation_routes"):
    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as exc:
        # A missing optional router during development is fine; a missing
        # dependency inside an existing router is a real error, not a hidden one.
        if exc.name != module_name:
            raise
    else:
        app.include_router(module.router)
