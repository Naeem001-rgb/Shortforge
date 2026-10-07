"""Multi-platform imports must keep identities, metadata and transports separate."""

from pathlib import Path
import sys
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from engine.core import db, media, routes, script_extraction
from engine.core.app import app
from engine.core.source_urls import canonical_clip_url, instagram_thumbnail_url


SHORTCODE = "CxAbCdEf_12"
REEL_URL = f"https://www.instagram.com/reel/{SHORTCODE}/"
YOUTUBE_ID = "tleaVXWF3YI"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    for key in db.SECRET_SETTINGS:
        monkeypatch.delenv(key.upper(), raising=False)
    with TestClient(app, base_url="http://localhost") as session:
        yield session


def import_reel(client, **extra):
    response = client.post("/api/clips", json={"clips": [{"url": REEL_URL, **extra}]})
    assert response.status_code == 200, response.text
    return response.json()["clips"][0]


@pytest.mark.parametrize("url", [
    REEL_URL, f"https://instagram.com/reels/{SHORTCODE}?igsh=ignored",
    f"instagram.com/reel/{SHORTCODE}/", f"http://m.instagram.com/reel/{SHORTCODE}/#share",
])
def test_reel_links_get_stable_platform_identity(url):
    assert canonical_clip_url(url) == (f"ig:{SHORTCODE}", REEL_URL)
    assert canonical_clip_url(url, f"ig:{SHORTCODE}") == (f"ig:{SHORTCODE}", REEL_URL)


def test_id_only_imports_and_existing_youtube_urls_keep_identity():
    assert canonical_clip_url("", f"ig:{SHORTCODE}") == (f"ig:{SHORTCODE}", REEL_URL)
    assert canonical_clip_url("", YOUTUBE_ID) == (YOUTUBE_ID, f"https://www.youtube.com/shorts/{YOUTUBE_ID}")
    assert canonical_clip_url(f"https://youtu.be/{YOUTUBE_ID}?t=5")[0] == YOUTUBE_ID


@pytest.mark.parametrize("url", [
    f"https://instagram.com.evil.example/reel/{SHORTCODE}/",
    f"https://instagram.com@evil.example/reel/{SHORTCODE}/",
    f"https://user@www.instagram.com/reel/{SHORTCODE}/",
    f"https://@www.instagram.com/reel/{SHORTCODE}/",
    f"https://www.instagram.com:443/reel/{SHORTCODE}/",
    f"https://www.instagram.com:bad/reel/{SHORTCODE}/",
    f"https://www.instagram.com:8787/reel/{SHORTCODE}/",
    f"https://www.insta\ngram.com/reel/{SHORTCODE}/",
    f"https://www.instagram.com/reel/{SHORTCODE}/extra",
    f"https://www.instagram.com/p/{SHORTCODE}/",
    "https://www.instagram.com/competitor/reels/",
    "https://www.instagram.com/reel/../", "https://www.instagram.com/reel/a%2Fb/",
    "https://www.instagram.com/reel/", "https://[bad/reel/id", "file:///etc/passwd",
])
def test_reel_import_rejects_untrusted_or_non_clip_urls(url):
    with pytest.raises(HTTPException) as error:
        canonical_clip_url(url)
    assert error.value.status_code == 422


@pytest.mark.parametrize("identity", [SHORTCODE, "ig:someone_else", YOUTUBE_ID])
def test_reel_identity_must_agree_with_url(identity):
    with pytest.raises(HTTPException):
        canonical_clip_url(REEL_URL, identity)


def test_same_shortcode_on_both_platforms_does_not_collide(client):
    response = client.post("/api/clips", json={"clips": [
        {"url": REEL_URL, "video_id": f"ig:{SHORTCODE}"},
        {"url": f"https://youtu.be/{SHORTCODE}"},
    ]})
    assert response.status_code == 200, response.text
    assert response.json()["added"] == 2
    reel, short = response.json()["clips"]
    assert reel["id"] != short["id"]
    assert reel["video_id"] == f"ig:{SHORTCODE}"
    assert short["video_id"] == SHORTCODE
    again = client.post("/api/clips", json={"clips": [{"url": f"https://instagram.com/reels/{SHORTCODE}?igsh=tracking"}]})
    assert again.json()["added"] == 0
    assert again.json()["clips"][0]["id"] == reel["id"]


def test_invalid_reel_in_mixed_batch_leaves_no_partial_import(client):
    response = client.post("/api/clips", json={"clips": [
        {"video_id": YOUTUBE_ID}, {"url": REEL_URL}, {"url": "https://www.instagram.com/competitor/reels/"},
    ]})
    assert response.status_code == 422
    assert client.get("/api/clips").json()["clips"] == []


@pytest.mark.parametrize("thumbnail", [
    "https://scontent.cdninstagram.com/image.jpg?token=sample",
    "https://scontent.xx.fbcdn.net/image.jpg?token=sample",
])
def test_reel_uses_safe_input_thumbnail_and_records_only_real_rights(client, thumbnail):
    clip = import_reel(client, thumbnail_url=thumbnail, license_status="cc_by", workflow_status="downloaded")
    assert clip["thumbnail_url"] == thumbnail
    assert clip["title"] == f"Instagram Reel · {SHORTCODE}"
    assert clip["license_status"] == "unknown"
    assert clip["workflow_status"] == "collected"


@pytest.mark.parametrize("thumbnail", [
    "", "http://scontent.cdninstagram.com/image.jpg", "https://127.0.0.1/private",
    "https://scontent.cdninstagram.com.evil.example/image.jpg",
    "https://evilcdninstagram.com/image.jpg", "https://fbcdn.net.evil.example/image.jpg",
    "https://user@scontent.cdninstagram.com/image.jpg", "https://scontent.cdninstagram.com:8787/image.jpg",
    "https://i.ytimg.com/vi/CxAbCdEf_12/hqdefault.jpg", "data:image/png;base64,anything",
])
def test_untrusted_thumbnails_are_ignored(thumbnail):
    assert instagram_thumbnail_url(thumbnail) == ""


def test_reel_without_thumbnail_never_gets_youtube_image(client):
    assert import_reel(client)["thumbnail_url"] == ""


def test_instagram_only_import_and_enrichment_never_call_youtube(client, monkeypatch):
    client.put("/api/settings", json={"youtube_api_key": "test-key"})
    monkeypatch.setattr(routes.httpx, "get", lambda *_args, **_kwargs: pytest.fail("Instagram must not call YouTube"))
    clip = import_reel(client, likes=5500, views=20000)
    response = client.post(f"/api/clips/{clip['id']}/enrich")
    assert response.status_code == 400
    assert "Instagram" in response.json()["detail"]
    assert db.get_clip(clip["id"])["views"] == 20000


def test_mixed_enrichment_sends_only_youtube_ids(client, monkeypatch):
    reel = import_reel(client, views=20000)
    short = client.post("/api/clips", json={"clips": [{"video_id": YOUTUBE_ID}]}).json()["clips"][0]
    client.put("/api/settings", json={"youtube_api_key": "test-key"})
    calls = []

    def youtube(*_args, **kwargs):
        calls.append(kwargs["params"]["id"])
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"items": [
            {"id": YOUTUBE_ID, "statistics": {"viewCount": "30000"}},
        ]})

    monkeypatch.setattr(routes.httpx, "get", youtube)
    routes.enrich_clips([reel["id"], short["id"]])
    assert calls == [YOUTUBE_ID]
    assert db.get_clip(reel["id"])["views"] == 20000
    assert db.get_clip(short["id"])["views"] == 30000


def test_reel_download_uses_canonical_instagram_transport_and_saves_asset(client, monkeypatch):
    from engine.studio import editor_media

    clip = import_reel(client)
    requested_urls = []

    class Downloader:
        def __init__(self, options):
            self.path = Path(options["outtmpl"].replace("%(ext)s", "mp4"))
            assert options["noplaylist"] is True
            assert "cookiesfrombrowser" not in options
            assert "cookiefile" not in options

        def __enter__(self): return self
        def __exit__(self, *_args): pass

        def extract_info(self, url, download):
            assert download is True
            requested_urls.append(url)
            self.path.write_bytes(b"video-fixture")
            return {"ext": "mp4"}

        def prepare_filename(self, _info): return str(self.path)

    monkeypatch.setitem(sys.modules, "yt_dlp", SimpleNamespace(YoutubeDL=Downloader))
    monkeypatch.setattr(media, "tool_available", lambda _: True)
    monkeypatch.setattr(media, "find_ffmpeg", lambda: "/fake/ffmpeg")
    monkeypatch.setattr(editor_media, "normalize_browser_video", lambda path: path)
    monkeypatch.setattr(editor_media, "probe_media", lambda _: {"media_type": "video"})
    response = client.post(f"/api/clips/{clip['id']}/download")
    assert response.status_code == 200, response.text
    job = client.get(f"/api/jobs/{response.json()['id']}").json()
    assert job["status"] == "completed", job
    assert requested_urls == [REEL_URL]
    assert job["result"]["asset"]["kind"] == "source"
    assert db.get_clip(clip["id"])["workflow_status"] == "downloaded"
    assert db.get_clip(clip["id"])["license_status"] == "unknown"


@pytest.mark.parametrize("provider", ["auto", "gemini"])
def test_reel_script_extraction_does_not_send_instagram_to_youtube(client, monkeypatch, provider):
    clip = import_reel(client)
    monkeypatch.setattr(script_extraction, "youtube_captions", lambda *_: pytest.fail("Not a YouTube clip"))
    monkeypatch.setattr(script_extraction, "gemini_transcript", lambda *_: pytest.fail("Instagram URLs are not Gemini YouTube input"))
    response = client.post(f"/api/clips/{clip['id']}/extract-script", json={"provider": provider})
    job = client.get(f"/api/jobs/{response.json()['id']}").json()
    assert job["status"] == "failed", job
    assert "Instagram" in job["error"]
    assert "paste" in job["error"]


def test_reel_script_extraction_can_use_existing_local_footage(client, monkeypatch):
    clip = import_reel(client)
    client.patch(f"/api/clips/{clip['id']}", json={"license_status": "permission", "permission_note": "Creator confirmed"})
    source = db.DATA_DIR / "reel.mp4"
    source.write_bytes(b"existing video")
    db.add_asset(clip["id"], "source", source)
    monkeypatch.setattr(script_extraction, "youtube_captions", lambda *_: pytest.fail("Not a YouTube clip"))
    monkeypatch.setattr(media, "transcribe_file", lambda _: {"text": "Words from the Reel.", "words": []})
    response = client.post(f"/api/clips/{clip['id']}/extract-script")
    job = client.get(f"/api/jobs/{response.json()['id']}").json()
    assert job["status"] == "completed", job
    assert job["result"]["source"] == "local-whisper"
