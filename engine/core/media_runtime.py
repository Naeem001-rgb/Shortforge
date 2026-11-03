"""Verified native media tools; Python package versions are not binary versions."""

from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
MIN_VERSION = (8, 1, 3)


def platform_key() -> str:
    architecture = platform.machine().lower()
    architecture = {"amd64": "x86_64", "arm64": "aarch64"}.get(
        architecture, architecture
    )
    return f"{platform.system()}-{architecture}"


def pin() -> dict:
    return json.loads((ROOT / "vendor/ffmpeg-release.json").read_text())


@lru_cache(maxsize=16)
def _hash(path: str, size: int, modified: int) -> str:
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def managed_binary(name: str) -> str | None:
    manifest = pin()
    package = manifest["platforms"].get(platform_key())
    if package is None:
        return None
    directory = ROOT / "data/runtime/ffmpeg" / manifest["release"]
    path = directory / (name + (".exe" if os.name == "nt" else ""))
    try:
        if path.is_symlink():
            return None
        record = json.loads((directory / "verified.json").read_text())
        stat = path.stat()
        if record["archive_sha256"] == package["sha256"] and record["binaries"][
            path.name
        ] == _hash(str(path), stat.st_size, stat.st_mtime_ns):
            return str(path)
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


@lru_cache(maxsize=16)
def _supported(path: str, size: int, modified: int) -> bool:
    from .sandbox import clean_environment

    try:
        result = subprocess.run(
            [path, "-version"],
            capture_output=True,
            text=True,
            timeout=10,
            env=clean_environment(),
        )
        match = re.match(
            r"ff(?:mpeg|probe) version (?:n)?(\d+)\.(\d+)(?:\.(\d+))?", result.stdout
        )
        return (
            result.returncode == 0
            and match is not None
            and tuple(int(n or 0) for n in match.groups()) >= MIN_VERSION
        )
    except (OSError, subprocess.SubprocessError):
        return False


def supported_binary(path: str) -> bool:
    try:
        stat = Path(path).stat()
        return _supported(str(Path(path).resolve()), stat.st_size, stat.st_mtime_ns)
    except OSError:
        return False
