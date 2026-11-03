"""Native archives are verified before execution and never extracted verbatim."""

import hashlib
import importlib.util
import os
from io import BytesIO
from pathlib import Path
import tarfile

import pytest

from engine.core import media_runtime


@pytest.fixture
def setup_media():
    script = Path(__file__).resolve().parents[3] / "scripts/setup-media.py"
    spec = importlib.util.spec_from_file_location("media_setup_test", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_media_archive_extraction_uses_only_fixed_executable_names(
    setup_media, tmp_path
):
    archive = tmp_path / "tools.tar.xz"
    output = tmp_path / "output"
    output.mkdir()
    suffix = ".exe" if os.name == "nt" else ""
    with tarfile.open(archive, "w:xz") as package:
        for name, data in (
            ("../../outside.txt", b"unsafe"),
            ("bundle/bin/ffmpeg" + suffix, b"ffmpeg fixture"),
            ("bundle/bin/ffprobe" + suffix, b"ffprobe fixture"),
        ):
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            package.addfile(entry, BytesIO(data))
    result = setup_media.extract(archive, output)
    assert set(result) == {"ffmpeg" + suffix, "ffprobe" + suffix}
    assert {path.name for path in output.iterdir()} == {
        "ffmpeg" + suffix,
        "ffprobe" + suffix,
    }
    assert not (tmp_path.parent / "outside.txt").exists()
    assert result["ffmpeg" + suffix] == hashlib.sha256(b"ffmpeg fixture").hexdigest()


def test_bad_media_checksum_is_never_executed_or_installed(
    setup_media, tmp_path, monkeypatch
):
    payload = b"unverified native bytes"
    manifest = {
        "version": "8.1.3",
        "release": "test-release",
        "platforms": {
            "fixture": {
                "url": "https://example.invalid/tools.tar.xz",
                "sha256": "0" * 64,
                "bytes": len(payload),
            }
        },
    }
    monkeypatch.setattr(setup_media, "ROOT", tmp_path)
    monkeypatch.setattr(media_runtime, "pin", lambda: manifest)
    monkeypatch.setattr(media_runtime, "platform_key", lambda: "fixture")
    monkeypatch.setattr(
        setup_media, "urlopen", lambda *args, **kwargs: BytesIO(payload)
    )
    monkeypatch.setattr(
        media_runtime,
        "supported_binary",
        lambda path: pytest.fail("Unverified bytes must not execute"),
    )
    with pytest.raises(ValueError, match="checksum"):
        setup_media.install()
    assert not any(path.is_file() for path in (tmp_path / "data").rglob("*"))


def test_modified_installed_media_binary_is_not_trusted(tmp_path, monkeypatch):
    import json

    monkeypatch.setattr(media_runtime, "ROOT", tmp_path)
    monkeypatch.setattr(media_runtime, "platform_key", lambda: "fixture")
    manifest = {
        "release": "fixture-release",
        "platforms": {"fixture": {"sha256": "a" * 64}},
    }
    monkeypatch.setattr(media_runtime, "pin", lambda: manifest)
    directory = tmp_path / "data/runtime/ffmpeg/fixture-release"
    directory.mkdir(parents=True)
    name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    path = directory / name
    path.write_bytes(b"verified fixture")
    (directory / "verified.json").write_text(
        json.dumps(
            {
                "archive_sha256": "a" * 64,
                "binaries": {name: hashlib.sha256(path.read_bytes()).hexdigest()},
            }
        )
    )
    assert media_runtime.managed_binary("ffmpeg") == str(path)
    path.write_bytes(b"changed fixture bytes")
    assert media_runtime.managed_binary("ffmpeg") is None
