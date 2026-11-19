"""Local authenticated API and production dashboard."""

from contextlib import asynccontextmanager
import importlib
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import db, security
from .http_security import AccessMiddleware, BodyLimitMiddleware, WorkLimitMiddleware
from .routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await run_in_threadpool(security.start_session)
    with db.connect() as conn:
        conn.execute(
            "UPDATE jobs SET status='failed',error='ShortForge restarted before this job finished. Please run it again.' WHERE status IN ('queued','running')"
        )
    from .youtube_uploads import recover_uploads
    from .publishing import recover_publications, stop_publications

    recover_uploads()
    recover_publications()
    await run_in_threadpool(db.migrate_secrets)
    try:
        yield
    finally:
        stop_publications()


app = FastAPI(
    title="ShortForge local engine",
    version="0.2.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.add_middleware(BodyLimitMiddleware)
app.add_middleware(WorkLimitMiddleware)
app.add_middleware(AccessMiddleware)
# Preflight grants no access. Private requests require an approved origin and
# an origin-bound credential in AccessMiddleware.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(?:http://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?|chrome-extension://[a-p]{32})$",
    allow_credentials=False,
    allow_methods=["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Content-Disposition"],
)
app.add_middleware(
    TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]"]
)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    details = []
    for error in exc.errors():
        field = ".".join(str(part) for part in error["loc"] if part != "body")
        details.append(f"{field}: {error['msg']}")
    return JSONResponse({"detail": "; ".join(details)}, status_code=422)


app.include_router(security.router)
app.include_router(router)
for module_name in (
    "engine.core.concat",
    "engine.core.publishing",
    "engine.core.youtube_auth",
    "engine.core.youtube_uploads",
    "engine.core.scout_routes",
    "engine.ai.routes",
):
    module = importlib.import_module(module_name)
    app.include_router(module.router)


@app.api_route(
    "/api/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]
)
def missing_api(path: str):
    return JSONResponse({"detail": "Not Found"}, status_code=404)


app.mount(
    "/",
    StaticFiles(
        directory=Path(__file__).resolve().parents[2] / "extension/dist/dashboard",
        html=True,
        check_dir=False,
    ),
    name="dashboard",
)
