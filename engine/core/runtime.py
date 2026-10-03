"""Identify a running engine without depending on Git or exposing local paths."""

from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path


ENGINE_ROOT = Path(__file__).resolve().parents[1]
STARTED_AT = datetime.now(timezone.utc).isoformat()


def source_revision() -> str:
    digest = sha256()
    for path in sorted(ENGINE_ROOT.rglob("*.py")):
        relative = path.relative_to(ENGINE_ROOT)
        if "tests" in relative.parts or path.name.startswith("test_"):
            continue
        digest.update(relative.as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


LOADED_REVISION = source_revision()


def status() -> dict:
    try:
        disk_revision = source_revision()
    except OSError:
        disk_revision = None
    return {
        "started_at": STARTED_AT,
        "loaded_revision": LOADED_REVISION,
        "disk_revision": disk_revision,
        "restart_required": disk_revision is not None and disk_revision != LOADED_REVISION,
        "studio_protocol": 2,
    }
