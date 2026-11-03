"""Owner-only application secrets, separate from portable Library data."""

from functools import lru_cache
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
from threading import RLock

from cryptography.fernet import Fernet, InvalidToken


_lock = RLock()
PREFIX = "shortforge-encrypted-v1:"


def private_directory(path: Path) -> Path:
    if path.is_symlink():
        raise RuntimeError("The private storage folder cannot be a symbolic link.")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name != "nt":
        path.chmod(0o700)
    return path


def private_write(path: Path, value: bytes) -> None:
    private_directory(path.parent)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())


def key_directory() -> Path:
    # Outside DATA_DIR: copying a Library or its backup must not copy its key.
    if configured := os.environ.get("SHORTFORGE_PRIVATE_KEYS_DIR"):
        return Path(configured)
    base = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local/share")))
    return base / "ShortForge" / "private-keys"


def _windows_protect(value: bytes, *, decrypt: bool = False) -> bytes:
    import ctypes
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = ctypes.create_string_buffer(value)
    source = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt = ctypes.windll.crypt32
    if decrypt:
        ok = crypt.CryptUnprotectData(
            ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)
        )
    else:
        ok = crypt.CryptProtectData(
            ctypes.byref(source),
            "ShortForge",
            None,
            None,
            None,
            1,
            ctypes.byref(target),
        )
    if not ok:
        raise RuntimeError("Windows could not unlock ShortForge's private key.")
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.windll.kernel32.LocalFree(target.data)


@lru_cache(maxsize=32)
def master_key(data_root: str) -> bytes:
    root = Path(data_root)
    metadata = private_directory(root / "security") / "vault.json"
    with _lock:
        if metadata.exists():
            record = json.loads(metadata.read_text())
        else:
            key = Fernet.generate_key()
            identity = secrets.token_hex(16)
            backend = "file"
            if (
                os.getenv("SHORTFORGE_KEY_STORAGE") != "file"
                and os.name != "nt"
                and shutil.which("secret-tool")
                and os.environ.get("DBUS_SESSION_BUS_ADDRESS")
            ):
                try:
                    saved = subprocess.run(
                        [
                            "secret-tool",
                            "store",
                            "--label=ShortForge private key",
                            "application",
                            "shortforge",
                            "vault",
                            identity,
                        ],
                        input=key,
                        capture_output=True,
                        timeout=5,
                    )
                    if saved.returncode == 0:
                        backend = "secret-service"
                except (OSError, subprocess.SubprocessError):
                    pass
            if backend == "file":
                directory = key_directory().resolve()
                if directory.is_relative_to(root.resolve()):
                    raise RuntimeError(
                        "ShortForge's private key must be stored outside its Library folder."
                    )
                private_write(
                    directory / identity,
                    _windows_protect(key) if os.name == "nt" else key,
                )
            record = {"id": identity, "backend": backend}
            private_write(metadata, json.dumps(record).encode())
            return key
        identity = record.get("id", "")
        if len(identity) != 32 or any(c not in "0123456789abcdef" for c in identity):
            raise RuntimeError(
                "ShortForge's private-key record is damaged. Restore it from your backup."
            )
        try:
            if record["backend"] == "secret-service":
                result = subprocess.run(
                    [
                        "secret-tool",
                        "lookup",
                        "application",
                        "shortforge",
                        "vault",
                        identity,
                    ],
                    capture_output=True,
                    timeout=5,
                    check=True,
                )
                key = result.stdout.strip()
            elif record["backend"] == "file":
                path = key_directory() / identity
                if path.is_symlink():
                    raise ValueError("Invalid key file")
                key = path.read_bytes()
                if os.name == "nt":
                    key = _windows_protect(key, decrypt=True)
            else:
                raise ValueError("Unknown key storage")
            Fernet(key)
            return key
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            raise RuntimeError(
                "ShortForge could not unlock its saved credentials. Unlock your system keyring or restore the private key; existing data was kept."
            ) from exc


def seal(root: Path, value: str) -> str:
    if not value:
        return value
    return (
        PREFIX
        + Fernet(master_key(str(root.resolve()))).encrypt(value.encode()).decode()
    )


def unseal(root: Path, value: str) -> str:
    if not value.startswith(PREFIX):
        return value  # Read old installations until the transactional migration.
    try:
        return (
            Fernet(master_key(str(root.resolve())))
            .decrypt(value[len(PREFIX) :].encode())
            .decode()
        )
    except (InvalidToken, UnicodeError) as exc:
        raise RuntimeError(
            "A saved credential could not be unlocked. Restore its original private key."
        ) from exc
