"""Untrusted footage must not turn local media tools into network clients."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from threading import Thread
from types import SimpleNamespace

import pytest

from engine.core import db, media
from engine.studio import editor_media
from engine.studio.media import LOCAL_MEDIA_FORMATS


@pytest.fixture
def manifest_server():
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            self.send_response(404)
            self.end_headers()

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    # The leading XML comment also matches an accepted MP4 atom signature.
    manifest = (
        "<!--free-->\n"
        '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" '
        'profiles="urn:mpeg:dash:profile:isoff-main:2011" type="static" '
        'mediaPresentationDuration="PT8S" minBufferTime="PT1.5S">'
        '<Period><AdaptationSet mimeType="audio/mp4">'
        '<Representation id="a" bandwidth="64000" codecs="mp4a.40.2">'
        f"<BaseURL>http://127.0.0.1:{server.server_port}/fixture.m4a</BaseURL>"
        '<SegmentBase indexRange="0-10"><Initialization range="0-10" />'
        "</SegmentBase></Representation></AdaptationSet></Period></MPD>"
    ).encode()
    try:
        yield manifest, requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def require_ffmpeg():
    if not media.find_ffmpeg():
        pytest.skip("FFmpeg is not installed")


@pytest.mark.parametrize("suffix", [".mp4", ".mov", ".m4v"])
def test_library_upload_rejects_disguised_manifest_without_http_or_orphans(
    client, monkeypatch, manifest_server, suffix
):
    require_ffmpeg()
    monkeypatch.setattr(editor_media, "find_ffprobe", lambda: None)
    manifest, requests = manifest_server
    response = client.post(
        "/api/upload",
        files={"file": ("footage" + suffix, manifest, "video/mp4")},
        data={"title": "Imported footage"},
    )
    assert response.status_code == 422, response.text
    assert requests == []
    assert not list((db.DATA_DIR / "uploads").glob("*"))
    with db.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM clips").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM assets").fetchone()[0] == 0


@pytest.mark.parametrize("operation", ["probe", "normalize", "thumbnail"])
def test_local_media_operations_reject_network_manifests(
    tmp_path, monkeypatch, manifest_server, operation
):
    require_ffmpeg()
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    monkeypatch.setattr(editor_media, "find_ffprobe", lambda: None)
    manifest, requests = manifest_server
    path = tmp_path / "footage.mp4"
    path.write_bytes(manifest)
    with pytest.raises(ValueError):
        if operation == "probe":
            editor_media.probe_media(path)
        elif operation == "normalize":
            editor_media.normalize_browser_video(path)
        else:
            editor_media.media_thumbnail(path, {"duration": 8, "media_type": "video"})
    assert requests == []
    assert not (tmp_path / "footage-playable.mp4").exists()
    assert not list((tmp_path / "editor-thumbnails").glob("*.jpg"))


@pytest.mark.parametrize("probe_status", [0, 1])
def test_ffprobe_and_fallback_both_restrict_demuxers(
    tmp_path, monkeypatch, probe_status
):
    monkeypatch.setattr(editor_media, "find_ffprobe", lambda: "ffprobe")
    monkeypatch.setattr(editor_media, "ffmpeg_binary", lambda: "ffmpeg")
    commands = []

    def run(command, **kwargs):
        commands.append(command)
        if command[0] == "ffprobe":
            return SimpleNamespace(
                returncode=probe_status,
                stdout=json.dumps(
                    {
                        "format": {"duration": "8"},
                        "streams": [{"codec_type": "video", "width": 32, "height": 32}],
                    }
                ),
            )
        return SimpleNamespace(
            stderr="Duration: 00:00:08.00\nStream #0:0: Video: h264, yuv420p, 32x32"
        )

    monkeypatch.setattr(editor_media.subprocess, "run", run)
    path = tmp_path / "footage.mp4"
    path.write_bytes(b"fixture")
    result = editor_media.probe_media(path)
    assert result["media_type"] == "video"
    assert result["duration"] == 8
    assert len(commands) == (1 if probe_status == 0 else 2)
    for command in commands:
        protocol = command.index("-protocol_whitelist")
        demuxer = command.index("-format_whitelist")
        assert command[protocol + 1] == "file,pipe"
        assert command[demuxer + 1] == LOCAL_MEDIA_FORMATS
        assert protocol < command.index(str(path))
        assert demuxer < command.index(str(path))
