"""Linux media isolation and offline native-editor launches, without root."""

from functools import lru_cache
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def clean_environment(*, desktop: bool = False) -> dict[str, str]:
    names = {
        "PATH",
        "LANG",
        "LANGUAGE",
        "LC_ALL",
        "LC_CTYPE",
        "TZ",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "TEMP",
        "TMP",
    }
    if desktop:
        names.update(
            {
                "HOME",
                "USER",
                "LOGNAME",
                "USERPROFILE",
                "APPDATA",
                "LOCALAPPDATA",
                "DISPLAY",
                "WAYLAND_DISPLAY",
                "XAUTHORITY",
                "XDG_RUNTIME_DIR",
                "XDG_SESSION_TYPE",
                "DBUS_SESSION_BUS_ADDRESS",
                "XDG_CONFIG_HOME",
                "XDG_DATA_HOME",
                "QT_QPA_PLATFORM",
                "SLINT_BACKEND",
                "WGPU_BACKEND",
            }
        )
    result = {
        name: value
        for name, value in os.environ.items()
        if name in names or name.startswith("LC_")
    }
    result.update(
        PYTHONDONTWRITEBYTECODE="1", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1"
    )
    return result


@lru_cache(maxsize=1)
def network_isolation_available() -> bool:
    if platform.system() == "Linux" and shutil.which("bwrap"):
        try:
            return (
                subprocess.run(
                    [
                        "bwrap",
                        "--ro-bind",
                        "/",
                        "/",
                        "--unshare-net",
                        "--",
                        "/usr/bin/true",
                    ],
                    capture_output=True,
                    timeout=5,
                ).returncode
                == 0
            )
        except (OSError, subprocess.SubprocessError):
            return False
    return platform.system() == "Darwin" and bool(shutil.which("sandbox-exec"))


def offline_editor_command(command: list[str]) -> list[str]:
    if not network_isolation_available():
        raise RuntimeError(
            "This Concat release needs offline isolation before it can open safely. On Linux, install the free bubblewrap package and restart ShortForge."
        )
    if platform.system() == "Darwin":
        return [
            "sandbox-exec",
            "-p",
            "(version 1) (allow default) (deny network*)",
            *command,
        ]
    from . import db
    from .private_storage import key_directory

    # Preserve the desktop editor's normal file-picker/export workflow while
    # denying network access and hiding the engine's credentials and database.
    wrapped = [
        "bwrap",
        "--unshare-net",
        "--cap-drop",
        "ALL",
        "--bind",
        "/",
        "/",
        "--ro-bind",
        str(ROOT),
        str(ROOT),
    ]
    edits = db.DATA_DIR / "concat"
    edits.mkdir(parents=True, exist_ok=True)
    wrapped.extend(["--bind", str(edits), str(edits)])
    for directory in (db.DATA_DIR / "security", key_directory()):
        if directory.is_dir():
            wrapped.extend(["--tmpfs", str(directory)])
    for path in (
        ROOT / ".env",
        *(
            db.DATA_DIR / name
            for name in ("shortforge.db", "shortforge.db-wal", "shortforge.db-shm")
        ),
    ):
        if path.is_file():
            wrapped.extend(["--ro-bind", "/dev/null", str(path)])
    return [*wrapped, "--", *command]


def worker_command(
    command: list[str], *, reads=(), writes=(), network=False
) -> list[str]:
    """Only code, runtime libraries, selected inputs and output folders are visible."""
    if platform.system() != "Linux":
        return command
    if not network_isolation_available():
        raise RuntimeError(
            "Media isolation is unavailable. Install the free bubblewrap package, then restart ShortForge."
        )
    wrapped = [
        "bwrap",
        "--unshare-all",
        "--die-with-parent",
        "--new-session",
        "--cap-drop",
        "ALL",
    ]
    if network:
        wrapped.append("--share-net")
    wrapped.extend(["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"])
    for path in (
        Path("/usr"),
        Path("/lib"),
        Path("/lib64"),
        Path("/etc"),
        ROOT / ".venv",
        ROOT / "engine",
        ROOT / "vendor/ffmpeg-release.json",
        ROOT / "data/runtime/ffmpeg",
    ):
        if path.exists():
            wrapped.extend(["--ro-bind", str(path), str(path)])
    binary = Path(command[0]).resolve()
    if not str(binary).startswith("/usr/") and not binary.is_relative_to(
        ROOT / ".venv"
    ):
        wrapped.extend(["--ro-bind", str(binary.parent), str(binary.parent)])
    for path in writes:
        path = Path(path).resolve()
        wrapped.extend(["--bind", str(path), str(path)])
    for path in reads:
        path = Path(path).resolve()
        wrapped.extend(["--ro-bind", str(path), str(path)])
    wrapped.extend(["--chdir", str(ROOT), "--"])
    return [
        *wrapped,
        str(Path(sys.executable).resolve()),
        str(ROOT / "engine/core/worker_exec.py"),
        *command,
    ]


def run_media(command, *, capture_output=True, text=False, timeout=30, **kwargs):
    """Bound native logs as well as files, memory and CPU; preserve call results."""
    command = [str(item) for item in command]
    reads = []
    for index, argument in enumerate(command):
        if (
            index
            and (command[index - 1] == "-i" or index == len(command) - 1)
            and Path(argument).is_file()
        ):
            reads.append(Path(argument))
    last = Path(command[-1])
    writes = (
        [last.parent]
        if last.is_absolute() and last.parent.is_dir() and not last.is_file()
        else []
    )
    # Replacing a previously generated output is also permitted inside its job.
    if "-y" in command and last.is_absolute() and last.parent.is_dir():
        writes = [last.parent]
        reads = [path for path in reads if path != last]
    prepared = worker_command(command, reads=reads, writes=writes)
    environment = clean_environment()
    environment.update(kwargs.pop("env", {}))
    if not capture_output:
        return subprocess.run(
            prepared, env=environment, text=text, timeout=timeout, **kwargs
        )
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        result = subprocess.run(
            prepared,
            stdin=subprocess.DEVNULL,
            stdout=stdout,
            stderr=stderr,
            env=environment,
            timeout=timeout,
            **kwargs,
        )
        output = []
        for stream in (stdout, stderr):
            if stream.tell() > 32 * 1024 * 1024:
                raise ValueError(
                    "The media tool returned too much output. Try a different media file."
                )
            stream.seek(0)
            value = stream.read()
            output.append(value.decode("utf-8", errors="replace") if text else value)
        return subprocess.CompletedProcess(command, result.returncode, *output)
