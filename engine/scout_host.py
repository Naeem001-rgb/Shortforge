"""User-installed Chrome native messaging host for the Scout Library button."""

import http.client
import json
import os
from pathlib import Path
import shlex
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
NAME = "com.shortforge.scout"
FRAME = struct.Struct("=I")


def install_file(path: Path, contents: str, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if (
        path.is_file()
        and path.read_text() == contents
        and (os.name == "nt" or path.stat().st_mode & 0o777 == mode)
    ):
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        temp = Path(tmp.name)
        try:
            tmp.write(contents.encode())
            tmp.close()
            temp.chmod(mode)
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)


def install() -> None:
    from engine.core.security import scout_origin

    if os.name == "nt":
        import winreg

        folder = Path(os.environ["LOCALAPPDATA"]) / "ShortForge/ScoutHost"
        executable = folder / "scout-host.cmd"
        # Run only our module. Paths are quoted and percent expansion is escaped.
        root = str(ROOT).replace("%", "%%")
        python = sys.executable.replace("%", "%%")
        wrapper = f'@echo off\r\ncd /d "{root}" || exit /b 1\r\n"{python}" -m engine.scout_host %*\r\n'
        manifests = [folder / f"{NAME}.json"]
    else:
        if sys.platform == "darwin":
            base = Path.home() / "Library/Application Support"
            browsers = [base / "Google/Chrome", base / "Chromium"]
        else:
            base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
            browsers = [base / "google-chrome", base / "chromium"]
        executable = base / "ShortForge/scout-host"
        wrapper = f'#!/bin/sh\ncd {shlex.quote(str(ROOT))} || exit 1\nexec {shlex.quote(sys.executable)} -m engine.scout_host "$@"\n'
        manifests = [b / "NativeMessagingHosts" / f"{NAME}.json" for b in browsers]
    install_file(executable, wrapper, 0o700)
    manifest = (
        json.dumps(
            {
                "name": NAME,
                "description": "Open the local ShortForge Library from Scout",
                "path": str(executable),
                "type": "stdio",
                "allowed_origins": [scout_origin() + "/"],
            },
            indent=2,
        )
        + "\n"
    )
    for path in manifests:
        install_file(path, manifest, 0o600)
    if os.name == "nt":
        with winreg.CreateKey(
            winreg.HKEY_CURRENT_USER,
            rf"Software\Google\Chrome\NativeMessagingHosts\{NAME}",
        ) as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifests[0]))


def engine_ready() -> bool:
    conn = http.client.HTTPConnection("127.0.0.1", 8787, timeout=2)
    try:
        conn.request("GET", "/api/health")
        response = conn.getresponse()
        if response.status == 200:
            health = json.loads(response.read(65536))
            if (
                health.get("status") == "ok"
                and health.get("version") == "0.2.0"
                and health.get("runtime", {}).get("started_at")
            ):
                return True
    except (ConnectionRefusedError, TimeoutError):
        return False
    except (OSError, http.client.HTTPException, ValueError, AttributeError, TypeError):
        pass
    finally:
        conn.close()
    raise RuntimeError(
        "Another application is using ShortForge’s local port. Close it and try Library again."
    )


def ensure_engine() -> None:
    if engine_ready():
        return
    # The engine binds its loopback socket before startup. Concurrent clicks
    # can race to start it, but only the process owning that socket can serve.
    if os.name != "nt":
        options = {"start_new_session": True}
    else:
        options = {
            "creationflags": subprocess.CREATE_NEW_PROCESS_GROUP
            | subprocess.DETACHED_PROCESS
        }
    subprocess.Popen(
        [sys.executable, "-m", "engine"],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        **options,
    )
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if engine_ready():
            return
        time.sleep(0.25)
    raise RuntimeError(
        "ShortForge could not start its local engine. Check the installation and try again."
    )


def serve(origin, source, destination) -> None:
    from engine.core import security

    try:
        if origin != security.scout_origin() + "/":
            raise ValueError("Unrecognized extension")
        header = source.read(FRAME.size)
        if len(header) != FRAME.size:
            raise ValueError("Invalid native message")
        size = FRAME.unpack(header)[0]
        if not 0 < size <= 256:
            raise ValueError("Invalid native message size")
        raw = source.read(size)
        if len(raw) != size or json.loads(raw) != {"action": "open-library"}:
            raise ValueError("Unknown native action")
        ensure_engine()
        client = security.local_client(security.scout_origin())
        result = {"token": client["token"], "expires_at": client["expires_at"]}
    except RuntimeError as exc:
        result = {"error": str(exc)}
    except (OSError, ValueError, sqlite3.Error):
        result = {"error": "Scout could not connect to this ShortForge installation."}
    payload = json.dumps(result).encode()
    destination.write(FRAME.pack(len(payload)) + payload)
    destination.flush()


if __name__ == "__main__":
    if sys.argv[1:] == ["--install"]:
        install()
    elif len(sys.argv) > 1:
        from dotenv import load_dotenv

        if os.name == "nt":
            import msvcrt

            msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
            msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
        load_dotenv(ROOT / ".env")
        serve(sys.argv[1], sys.stdin.buffer, sys.stdout.buffer)
