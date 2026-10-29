"""All media consumers use the same configured, system and bundled tools."""

import os
import sys
from types import SimpleNamespace

import pytest

from engine.core import media
from engine.studio import media as studio_media


@pytest.mark.parametrize("source", ["configured", "system", "bundled", "missing"])
def test_ffmpeg_lookup_is_shared(tmp_path, monkeypatch, source):
    configured = tmp_path / "ffmpeg"
    if source == "configured":
        configured.touch()
    monkeypatch.setenv("FFMPEG_PATH", str(configured))
    monkeypatch.setattr(
        media.shutil,
        "which",
        lambda name: "/system/ffmpeg" if source == "system" else None,
    )
    monkeypatch.setattr(media, "tool_available", lambda name: source == "bundled")
    monkeypatch.setitem(
        sys.modules,
        "imageio_ffmpeg",
        SimpleNamespace(get_ffmpeg_exe=lambda: "/bundled/ffmpeg"),
    )
    expected = {
        "configured": str(configured),
        "system": "/system/ffmpeg",
        "bundled": "/bundled/ffmpeg",
        "missing": None,
    }[source]
    assert media.find_ffmpeg() == expected
    if expected:
        assert studio_media.ffmpeg_binary() == expected
    else:
        with pytest.raises(ValueError, match="FFmpeg is missing"):
            studio_media.ffmpeg_binary()


@pytest.mark.parametrize("error", [ImportError, RuntimeError])
def test_broken_bundled_ffmpeg_reports_unavailable(monkeypatch, error):
    monkeypatch.delenv("FFMPEG_PATH", raising=False)
    monkeypatch.setattr(media.shutil, "which", lambda name: None)
    monkeypatch.setattr(media, "tool_available", lambda name: True)

    def unavailable():
        raise error("unavailable")

    monkeypatch.setitem(
        sys.modules, "imageio_ffmpeg", SimpleNamespace(get_ffmpeg_exe=unavailable)
    )
    assert media.find_ffmpeg() is None
    with pytest.raises(ValueError, match="FFmpeg is missing"):
        studio_media.ffmpeg_binary()


def test_probe_uses_ffmpeg_sibling_when_configured_ffprobe_is_missing(
    tmp_path, monkeypatch
):
    ffmpeg = tmp_path / "ffmpeg"
    ffprobe = tmp_path / ("ffprobe.exe" if os.name == "nt" else "ffprobe")
    ffmpeg.touch()
    ffprobe.touch()
    monkeypatch.setenv("FFMPEG_PATH", str(ffmpeg))
    monkeypatch.setenv("FFPROBE_PATH", str(tmp_path / "missing"))
    monkeypatch.setattr(media.shutil, "which", lambda name: None)
    commands = []

    def run(command, **kwargs):
        commands.append(command)
        return SimpleNamespace(
            returncode=0,
            stdout='{"format":{"duration":"2"},"streams":[{"codec_type":"audio"}]}',
        )

    monkeypatch.setattr(studio_media.subprocess, "run", run)
    assert studio_media.probe_media(tmp_path / "audio.wav") == {
        "duration": 2,
        "audio": True,
        "video": False,
    }
    assert commands[0][0] == str(ffprobe)
