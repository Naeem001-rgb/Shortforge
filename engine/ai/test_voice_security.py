"""Voice references are real local media, with no network work during probing."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import subprocess
from threading import Thread
from types import SimpleNamespace
import wave

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from engine.ai import routes
from engine.core import db, media
from engine.studio import media as studio_media


@pytest.fixture
def recording():
    stream = io.BytesIO()
    with wave.open(stream, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\x01\x00" * 16000 * 8)
    return stream.getvalue()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    for key in db.SECRET_SETTINGS:
        monkeypatch.delenv(key.upper(), raising=False)
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app, raise_server_exceptions=False) as session:
        yield session


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
    url = f"http://127.0.0.1:{server.server_port}/fixture.m4a"
    manifest = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" '
        'profiles="urn:mpeg:dash:profile:isoff-main:2011" type="static" '
        'mediaPresentationDuration="PT8S" minBufferTime="PT1.5S">'
        '<Period><AdaptationSet mimeType="audio/mp4">'
        '<Representation id="a" bandwidth="64000" codecs="mp4a.40.2">'
        f"<BaseURL>{url}</BaseURL>"
        '<SegmentBase indexRange="0-10"><Initialization range="0-10" />'
        "</SegmentBase></Representation></AdaptationSet></Period></MPD>"
    ).encode()
    try:
        yield manifest, requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def post_reference(client, content, suffix=".wav"):
    return client.post(
        "/api/voices/clone",
        files={"file": ("recording" + suffix, content, "application/octet-stream")},
        data={"name": "My voice", "consent": "true", "reference_text": "Example"},
    )


def assert_no_reference():
    assert not list((db.DATA_DIR / "voices").glob("*"))
    with db.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM voices").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM assets").fetchone()[0] == 0


def require_ffmpeg():
    if not media.find_ffmpeg():
        pytest.skip("FFmpeg is not installed")


@pytest.mark.parametrize("probe_result", ["success", "failure", "missing"])
def test_probe_limits_protocols_and_container_for_ffprobe_and_fallback(
    tmp_path, monkeypatch, probe_result
):
    monkeypatch.setattr(
        studio_media,
        "find_ffprobe",
        lambda: None if probe_result == "missing" else "ffprobe",
    )
    monkeypatch.setattr(studio_media, "ffmpeg_binary", lambda: "ffmpeg")
    commands = []

    def run(command, **kwargs):
        commands.append(command)
        assert kwargs["timeout"] == 30
        if command[0] == "ffprobe":
            return SimpleNamespace(
                returncode=0 if probe_result == "success" else 1,
                stdout=json.dumps(
                    {"format": {"duration": "8"}, "streams": [{"codec_type": "audio"}]}
                ),
            )
        return SimpleNamespace(
            stderr="Duration: 00:00:08.00\nStream #0:0: Audio: pcm_s16le"
        )

    monkeypatch.setattr(studio_media.subprocess, "run", run)
    path = tmp_path / "recording.wav"
    assert studio_media.probe_media(path, input_format="wav") == {
        "duration": 8,
        "audio": True,
        "video": False,
    }
    assert len(commands) == (2 if probe_result == "failure" else 1)
    for command in commands:
        protocol = command.index("-protocol_whitelist")
        container = command.index("-f")
        assert command[protocol + 1] == "file,pipe"
        assert (
            command[command.index("-format_whitelist") + 1]
            == studio_media.LOCAL_MEDIA_FORMATS
        )
        assert command[container + 1] == "wav"
        assert protocol < command.index(str(path))
        assert container < command.index(str(path))


def test_actual_probe_cannot_contact_a_manifest_url(
    tmp_path, monkeypatch, manifest_server
):
    require_ffmpeg()
    # Exercise the bundled FFmpeg path even on machines with a system ffprobe.
    monkeypatch.setattr(studio_media, "find_ffprobe", lambda: None)
    manifest, requests = manifest_server
    path = tmp_path / "recording.wav"
    path.write_bytes(manifest)
    with pytest.raises(ValueError, match="could not be read"):
        studio_media.probe_media(path)
    assert requests == []


@pytest.mark.parametrize("suffix", list(routes.AUDIO_REFERENCE_FORMATS))
def test_audio_suffix_cannot_disguise_a_remote_manifest(
    client, manifest_server, suffix
):
    require_ffmpeg()
    manifest, requests = manifest_server
    response = post_reference(client, manifest, suffix)
    assert response.status_code == 400, response.text
    assert "could not be read" in response.json()["detail"]
    assert requests == []
    assert_no_reference()


def test_audio_suffix_cannot_disguise_a_local_playlist(client, tmp_path, recording):
    require_ffmpeg()
    # A concat playlist can otherwise reuse a sibling file despite file-only
    # protocol restrictions. It must never become a saved voice reference.
    directory = tmp_path / "voices"
    directory.mkdir()
    (directory / "other.wav").write_bytes(recording)
    response = post_reference(client, b"ffconcat version 1.0\nfile 'other.wav'\n")
    assert response.status_code == 400, response.text
    assert list(directory.iterdir()) == [directory / "other.wav"]
    with db.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM assets").fetchone()[0] == 0


@pytest.mark.parametrize(
    "suffix,codec",
    [
        (".wav", None),
        (".mp3", "libmp3lame"),
        (".m4a", "aac"),
        (".ogg", "libvorbis"),
        (".flac", "flac"),
        (".webm", "libopus"),
    ],
)
def test_real_reference_is_saved_without_changing_audio(
    client, tmp_path, recording, suffix, codec
):
    require_ffmpeg()
    if codec:
        source = tmp_path / "generated.wav"
        source.write_bytes(recording)
        encoded = tmp_path / ("generated" + suffix)
        subprocess.run(
            [
                media.find_ffmpeg(),
                "-v",
                "error",
                "-nostdin",
                "-i",
                str(source),
                "-c:a",
                codec,
                str(encoded),
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
        recording = encoded.read_bytes()
    response = post_reference(client, recording, suffix)
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "My voice"
    assert response.json()["cloned"] is True
    with db.connect() as connection:
        profile = connection.execute("SELECT * FROM voices").fetchone()
        asset = connection.execute("SELECT * FROM assets").fetchone()
    assert profile["reference_asset_id"] == asset["id"]
    assert profile["consent"] == 1
    assert asset["kind"] == "reference" and asset["clip_id"] is None
    path = db.resolve_data_path(asset["path"])
    assert path.read_bytes() == recording
    assert list((db.DATA_DIR / "voices").iterdir()) == [path]


@pytest.mark.parametrize(
    "failure",
    [
        ValueError("This file could not be read as audio or video."),
        subprocess.TimeoutExpired("ffprobe", 30),
        subprocess.CalledProcessError(1, "ffmpeg", stderr="private decoder detail"),
        OSError("private decoder detail"),
    ],
)
def test_probe_failure_returns_safe_error_and_removes_upload(
    client, monkeypatch, recording, failure
):
    def fail(*args, **kwargs):
        raise failure

    monkeypatch.setattr(routes, "probe_media", fail)
    response = post_reference(client, recording)
    assert response.status_code == 400, response.text
    assert "private decoder detail" not in response.text
    assert_no_reference()


def test_registration_failure_rolls_back_reference_asset_and_removes_file(
    client, monkeypatch, recording
):
    monkeypatch.setattr(
        routes, "probe_media", lambda *args, **kwargs: {"audio": True, "duration": 8}
    )
    with db.connect() as connection:
        connection.execute(
            "CREATE TRIGGER reject_voice BEFORE INSERT ON voices "
            "BEGIN SELECT RAISE(ABORT, 'fixture registration failure'); END"
        )
    response = post_reference(client, recording)
    assert response.status_code == 500
    assert_no_reference()
