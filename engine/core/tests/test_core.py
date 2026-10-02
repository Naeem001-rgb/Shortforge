"""Storage, API boundaries, and license checks; no cloud calls or model downloads."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
import sys

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from engine.core import db, media, routes
from engine.core.app import app


VIDEO_ID = "tleaVXWF3YI"
VIDEO = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    for key in db.SECRET_SETTINGS:
        monkeypatch.delenv(key.upper(), raising=False)
    with TestClient(app, base_url="http://localhost") as session:
        yield session


def import_one(client, **extra):
    response = client.post("/api/clips", json={"clips": [{"url": f"https://www.youtube.com/shorts/{VIDEO_ID}", **extra}]})
    assert response.status_code == 200, response.text
    return response.json()["clips"][0]


def permit(client, clip):
    response = client.patch(f"/api/clips/{clip['id']}", json={"license_status": "permission", "permission_note": "Creator gave permission by email on 2026-09-29."})
    assert response.status_code == 200
    return response.json()


def upload_one(client):
    response = client.post("/api/upload", files={"file": ("my-clip.mp4", VIDEO, "video/mp4")}, data={"title": "My footage"})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("url", [
    f"https://youtube.com/shorts/{VIDEO_ID}?feature=share",
    f"https://www.youtube.com/watch?v={VIDEO_ID}&t=2",
    f"https://youtu.be/{VIDEO_ID}",
    f"youtube.com/shorts/{VIDEO_ID}",
])
def test_youtube_links_are_canonical(url):
    assert routes.canonical_youtube_url(url) == (VIDEO_ID, f"https://www.youtube.com/shorts/{VIDEO_ID}")


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:8000/private", "file:///etc/passwd",
    f"https://youtube.com.evil.example/shorts/{VIDEO_ID}",
    f"https://youtube.com@evil.example/shorts/{VIDEO_ID}",
    f"https://youtube.com:8443/shorts/{VIDEO_ID}", "https://youtube.com/shorts/bad-id",
])
def test_remote_import_cannot_fetch_arbitrary_url(url):
    with pytest.raises(HTTPException):
        routes.canonical_youtube_url(url)


def test_import_never_trusts_client_license_or_workflow(client):
    clip = import_one(client, title="Narrated wildlife", license_status="owned", permission_note="made up", workflow_status="exported", discovery_mode="narrated")
    assert clip["license_status"] == "unknown"
    assert clip["permission_note"] == ""
    assert clip["workflow_status"] == "collected"
    assert clip["discovery_mode"] == "narrated"
    assert clip["credit_target"] == ""
    again = client.post("/api/clips", json={"clips": [{"url": f"https://youtu.be/{VIDEO_ID}", "title": "Duplicate"}]})
    assert again.json()["added"] == 0
    assert len(client.get("/api/clips").json()["clips"]) == 1


def test_import_batch_is_atomic(client):
    response = client.post("/api/clips", json={"clips": [{"video_id": VIDEO_ID}, {"url": "https://evil.example/private"}]})
    assert response.status_code == 422
    assert client.get("/api/clips").json()["clips"] == []


def test_scout_and_dashboard_can_import_the_same_clip_together(client):
    def collect(_):
        return client.post("/api/clips", json={"clips": [{"video_id": VIDEO_ID}]}).json()

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(collect, range(8)))
    assert sum(result["added"] for result in results) == 1
    assert len({result["clips"][0]["id"] for result in results}) == 1


def test_counts_exceeding_sqlite_integer_limits_return_validation_error(client):
    response = client.post("/api/clips", json={"clips": [{"video_id": VIDEO_ID, "views": 10**30}]})
    assert response.status_code == 422


def test_permission_requires_evidence_and_cannot_claim_verified_license(client):
    clip = import_one(client)
    path = f"/api/clips/{clip['id']}"
    assert client.patch(path, json={"license_status": "permission"}).status_code == 422
    assert client.patch(path, json={"license_status": "cc_by"}).status_code == 422
    assert client.patch(path, json={"license_status": "owned"}).status_code == 422
    permit(client, clip)
    assert client.patch(path, json={"permission_note": "  "}).status_code == 422
    assert db.require_editable(clip["id"])["license_status"] == "permission"
    client.patch(path, json={"license_status": "unknown"})
    assert db.require_editable(clip["id"])["license_status"] == "unknown"


def test_unknown_source_can_edit_without_fabricating_permission(client, monkeypatch):
    clip = import_one(client)
    monkeypatch.setattr(media, "tool_available", lambda name: False)
    response = client.post(f"/api/clips/{clip['id']}/download")
    assert response.status_code == 503
    assert "yt-dlp" in response.text
    transcript = {"text": "A reviewed transcript", "words": []}
    assert client.put(f"/api/clips/{clip['id']}/transcript", json=transcript).status_code == 200
    assert client.post("/api/export", json={"clip_id": clip["id"]}).status_code == 400
    result = db.get_clip(clip["id"])
    assert result["license_status"] == "unknown"
    assert result["permission_note"] == ""


def test_library_reference_can_rewrite_script_without_unlocking_footage(client, monkeypatch):
    from engine.ai import routes as writing_routes
    clip = import_one(client)
    received = []
    def generate(text, settings):
        received.append(text)
        return {"original_text": text, "rewritten_text": "Different narration", "words_original": 2,
                "words_rewritten": 2, "within_tolerance": True, "exact_word_count": True, "attempts": 1}
    monkeypatch.setattr(writing_routes, "rewrite_script", generate)
    response = client.post("/api/rewrite", json={"clip_id": clip["id"], "text": "Existing narration", "mode": "rewrite"})
    assert response.status_code == 200
    assert received == ["Existing narration"]
    detail = client.get(f"/api/clips/{clip['id']}").json()
    assert detail["script"]["original_text"] == "Existing narration"
    assert detail["license_status"] == "unknown"
    assert db.require_editable(clip["id"])["license_status"] == "unknown"


def test_uploaded_video_is_owned_and_can_be_served_with_ranges(client):
    clip = upload_one(client)
    assert clip["license_status"] == "owned"
    assert clip["assets"][0]["kind"] == "source"
    asset = clip["assets"][0]
    assert not Path(asset["path"]).is_absolute()
    response = client.get(asset["url"], headers={"Range": "bytes=0-3"})
    assert response.status_code == 206
    assert response.content == VIDEO[:4]


def test_upload_rejects_executable_and_false_video(client):
    for name, data in (("script.html", b"<html>"), ("video.mp4", b"<html>"), ("video.mp4", b"")):
        response = client.post("/api/upload", files={"file": (name, data, "video/mp4")})
        assert response.status_code == 422
    assert client.get("/api/clips").json()["clips"] == []
    assert list((db.DATA_DIR / "uploads").glob("*")) == []


def test_oversized_upload_is_rejected_and_partial_file_removed(client, monkeypatch):
    monkeypatch.setattr(routes, "MAX_UPLOAD", 12)
    response = client.post("/api/upload", files={"file": ("video.mp4", VIDEO, "video/mp4")})
    assert response.status_code == 413
    assert list((db.DATA_DIR / "uploads").glob("*")) == []


def test_asset_paths_and_symlinks_cannot_escape_data(client, tmp_path):
    outside = tmp_path.parent / "outside-secret.txt"
    outside.write_text("secret")
    link = db.DATA_DIR / "shortcut.txt"
    link.symlink_to(outside)
    for path in (outside, link, Path("../outside-secret.txt")):
        with pytest.raises(HTTPException):
            db.add_asset(None, "reference", path)


def test_unknown_rights_do_not_block_existing_local_files(client):
    clip = import_one(client)
    permit(client, clip)
    path = db.DATA_DIR / "source.mp4"
    path.write_bytes(VIDEO)
    asset = db.add_asset(clip["id"], "source", path)
    assert client.get(asset["url"]).status_code == 200
    client.patch(f"/api/clips/{clip['id']}", json={"license_status": "unknown"})
    assert client.get(asset["url"]).status_code == 200
    assert db.get_clip(clip["id"])["license_status"] == "unknown"


def test_settings_never_echo_keys_and_unknown_fields_are_rejected(client):
    key = "my-super-secret-api-key"
    response = client.put("/api/settings", json={"gemini_api_key": key, "scout_mode": "narrated"})
    assert response.status_code == 200
    assert key not in response.text
    assert response.json()["gemini_api_key_set"] is True
    assert key not in client.get("/api/settings").text
    assert db.get_settings()["gemini_api_key"] == key
    rejected = client.put("/api/settings", json={"gemini_api_key": key, "anything": key})
    assert rejected.status_code == 422
    assert key not in rejected.text
    assert client.put("/api/settings", json={"gemini_api_key": ""}).json()["gemini_api_key_set"] is False


def test_untrusted_websites_cannot_write_to_local_engine(client):
    response = client.put("/api/settings", json={"niche": "hijacked"}, headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert db.get_settings()["niche"] == ""
    assert client.post("/api/clips", json={"clips": [{"video_id": VIDEO_ID}]}, headers={"Origin": "null"}).status_code == 403
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400


def test_dashboard_and_extension_origins_work(client):
    for origin in ("http://localhost:5173", "http://127.0.0.1:4173", "chrome-extension://" + "a" * 32):
        response = client.options("/api/clips", headers={"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type"})
        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == origin
        assert client.get("/api/health", headers={"Origin": origin}).status_code == 200


def test_chunked_requests_have_size_limit_without_content_length(client):
    def chunks():
        yield b'{"niche":"'
        yield b"x" * (2 * 1024 * 1024)
        yield b'"}'

    response = client.put("/api/settings", content=chunks(), headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert db.get_settings()["niche"] == ""


def test_transcript_validation_and_persistence(client):
    clip = upload_one(client)
    path = f"/api/clips/{clip['id']}/transcript"
    transcript = {"text": "Hello world", "words": [{"word": "Hello", "start": 0, "end": 0.5}, {"word": "world", "start": 0.5, "end": 1}]}
    assert client.put(path, json=transcript).json() == transcript
    detail = client.get(f"/api/clips/{clip['id']}").json()
    assert detail["transcript"] == transcript
    assert detail["workflow_status"] == "transcribed"
    assert client.put(path, json={"text": "bad", "words": [{"word": "bad", "start": 2, "end": 1}]}).status_code == 422


def test_job_updates_mask_secrets_and_sse_finishes(client):
    client.put("/api/settings", json={"gemini_api_key": "secret-123"})
    job = db.new_job("test", None)
    db.update_job(job["id"], status="failed", progress=120, error="Provider leaked secret-123")
    response = client.get(f"/api/jobs/{job['id']}/events")
    assert response.status_code == 200
    event = json.loads(response.text.split("data: ")[1].strip())
    assert event["progress"] == 100
    assert event["status"] == "failed"
    assert event["error"] == "Provider leaked [redacted]"


def test_download_runs_in_background_with_unknown_source(client, monkeypatch):
    clip = import_one(client)
    monkeypatch.setattr(media, "tool_available", lambda name: True)
    monkeypatch.setattr(media, "find_ffmpeg", lambda: "/fake/ffmpeg")
    executed = []

    def downloader(job_id, clip_id):
        executed.append(clip_id)
        db.update_job(job_id, status="completed", progress=100, result={"done": True})

    monkeypatch.setattr(media, "download_job", downloader)
    response = client.post(f"/api/clips/{clip['id']}/download")
    assert response.status_code == 200
    assert executed == [clip["id"]]
    assert client.get(f"/api/jobs/{response.json()['id']}").json()["result"] == {"done": True}


def test_enrichment_only_trusts_youtube_status_license(client, monkeypatch):
    clip = import_one(client)
    client.put("/api/settings", json={"youtube_api_key": "secret-google-key"})

    def youtube(*args, **kwargs):
        assert kwargs["params"]["part"] == "snippet,statistics,status"
        assert kwargs["params"]["id"] == VIDEO_ID
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"items": [{
            "id": VIDEO_ID, "status": {"license": "creativeCommon"},
            "snippet": {"title": "Verified title"}, "statistics": {"viewCount": "23000", "likeCount": "6000"},
        }]})

    monkeypatch.setattr(routes.httpx, "get", youtube)
    response = client.post(f"/api/clips/{clip['id']}/enrich")
    assert response.status_code == 200
    assert response.json()["license_status"] == "cc_by"
    assert response.json()["views"] == 23000
    assert db.require_editable(clip["id"])["title"] == "Verified title"


def test_pending_enrichment_preserves_permission_given_during_lookup(client, monkeypatch):
    clip = import_one(client)
    client.put("/api/settings", json={"youtube_api_key": "test-key"})

    def youtube(*args, **kwargs):
        with db.connect() as conn:
            conn.execute("UPDATE clips SET license_status='permission',permission_note='Creator email' WHERE id=?", (clip["id"],))
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"items": [{"id": VIDEO_ID, "status": {"license": "youtube"}}]})

    monkeypatch.setattr(routes.httpx, "get", youtube)
    response = client.post(f"/api/clips/{clip['id']}/enrich")
    assert response.status_code == 200
    assert response.json()["license_status"] == "permission"
    assert response.json()["permission_note"] == "Creator email"


def test_whisper_is_cpu_and_never_downloads_models(client, monkeypatch):
    calls = []

    class OfflineModel:
        def __init__(self, name, **kwargs):
            calls.append((name, kwargs))
            raise FileNotFoundError("missing checkpoint")

    monkeypatch.setattr(media, "tool_available", lambda name: True)
    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=OfflineModel))
    with pytest.raises(RuntimeError, match="No model was downloaded"):
        media.transcribe_file(db.DATA_DIR / "source.mp4", "base")
    assert calls[0][1]["local_files_only"] is True
    assert calls[0][1]["device"] == "cpu"


def test_delete_removes_db_relations_and_the_videos_files(client):
    clip = upload_one(client)
    path = db.resolve_data_path(clip["assets"][0]["path"])
    db.save_script(clip["id"], "Before", "After")
    db.new_job("test", clip["id"])
    assert client.delete(f"/api/clips/{clip['id']}").json() == {"ok": True}
    assert client.get(f"/api/clips/{clip['id']}").status_code == 404
    assert not path.exists()
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM scripts").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0


def test_delete_removes_voiceover_and_export_sidecars_but_keeps_voice_references(client):
    clip = upload_one(client)
    voice = db.DATA_DIR / "voiceovers" / "job-1.wav"
    voice.parent.mkdir(parents=True, exist_ok=True)
    voice.write_bytes(b"narration")
    voice.with_suffix(".timing.json").write_text("{}", encoding="utf-8")
    export = db.DATA_DIR / "exports" / "job-2.mp4"
    export.parent.mkdir(parents=True, exist_ok=True)
    export.write_bytes(b"rendered")
    export.with_suffix(".ass").write_text("dialogue", encoding="utf-8")
    for kind, path in (("voiceover", voice), ("export", export)):
        db.add_asset(clip["id"], kind, path)
    # A voice-clone reference is owned by its profile, not by this clip.
    reference = db.DATA_DIR / "voices" / "mine.wav"
    reference.parent.mkdir(parents=True, exist_ok=True)
    reference.write_bytes(b"my voice")
    db.add_asset(None, "reference", reference)

    client.delete(f"/api/clips/{clip['id']}")
    assert not voice.exists()
    assert not voice.with_suffix(".timing.json").exists()
    assert not export.exists()
    assert not export.with_suffix(".ass").exists()
    assert reference.exists()
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM assets WHERE kind='reference'").fetchone()[0] == 1


def test_delete_ignores_asset_paths_outside_the_data_folder(client):
    clip = upload_one(client)
    outside = db.DATA_DIR.parent / "not-ours.mp4"
    outside.write_bytes(b"someone else's file")
    with db.connect() as conn:
        conn.execute("UPDATE assets SET path=? WHERE clip_id=?", (str(outside), clip["id"]))
    assert client.delete(f"/api/clips/{clip['id']}").json() == {"ok": True}
    assert outside.exists()
    outside.unlink()


def test_bulk_delete_reports_an_honest_count_and_ignores_unknown_ids(client):
    first, second = upload_one(client), import_one(client)
    result = client.post("/api/clips/delete-bulk", json={"ids": [first["id"], second["id"], "missing-id", first["id"]]}).json()
    assert result["deleted"] == [first["id"], second["id"]]
    assert result["missing"] == ["missing-id"]
    assert client.get("/api/clips").json()["clips"] == []
    for body in ({"ids": []}, {"ids": ["a"], "unexpected": 1}):
        assert client.post("/api/clips/delete-bulk", json=body).status_code == 422
    assert client.post("/api/clips/delete-bulk", json={"ids": [first["id"]]}).json()["missing"] == [first["id"]]


def test_bulk_delete_keeps_going_when_one_clip_is_already_gone(client):
    first, second = upload_one(client), import_one(client)
    client.delete(f"/api/clips/{first['id']}")
    result = client.post("/api/clips/delete-bulk", json={"ids": [first["id"], second["id"]]}).json()
    assert result["deleted"] == [second["id"]]
    assert result["missing"] == [first["id"]]



def test_download_is_idempotent_for_inflight_and_cached_sources(client, monkeypatch):
    clip = import_one(client)
    monkeypatch.setattr(media, "tool_available", lambda name: True)
    monkeypatch.setattr(media, "find_ffmpeg", lambda: "/fake/ffmpeg")
    started = []
    monkeypatch.setattr(media, "download_job", lambda job_id, clip_id: started.append(job_id))
    def fetch(_):
        return client.post(f"/api/clips/{clip['id']}/download").json()
    with ThreadPoolExecutor(max_workers=4) as pool:
        requests = list(pool.map(fetch, range(8)))
    assert len({job["id"] for job in requests}) == 1
    assert len(started) == 1
    path = db.DATA_DIR / "source.mp4"
    path.write_bytes(VIDEO)
    asset = db.add_asset(clip["id"], "source", path)
    db.update_job(started[0], status="completed", progress=100, result={"asset": asset})
    monkeypatch.setattr(media, "tool_available", lambda name: False)
    cached = fetch(0)
    assert cached["id"] == started[0]
    assert cached["status"] == "completed"
    assert cached["result"]["asset"]["id"] == asset["id"]
    assert len(started) == 1
    assert db.get_clip(clip["id"])["license_status"] == "unknown"


def test_failed_acquisition_retries_without_replacing_existing_edit(client, monkeypatch):
    clip = import_one(client)
    with db.connect() as connection:
        connection.execute("INSERT INTO editor_projects VALUES (?,?,?)", (clip["id"], '{"items":[{"id":"my-title","kind":"text"}]}', db.now()))
    old = db.new_job("download", clip["id"])
    db.update_job(old["id"], status="failed", error="Retry me")
    monkeypatch.setattr(media, "tool_available", lambda name: True)
    monkeypatch.setattr(media, "find_ffmpeg", lambda: "/fake/ffmpeg")
    monkeypatch.setattr(media, "download_job", lambda *args: None)
    response = client.post(f"/api/clips/{clip['id']}/download").json()
    assert response["id"] != old["id"]
    assert db.get_job(old["id"])["error"] == "Retry me"
    with db.connect() as connection:
        assert "my-title" in connection.execute("SELECT project FROM editor_projects WHERE clip_id=?", (clip["id"],)).fetchone()[0]


def test_blank_project_and_duplicate_have_independent_owned_media(client):
    blank = client.post("/api/projects", json={"title": "My edit"}).json()
    assert blank["license_status"] == "owned"
    assert blank["assets"] == []
    assert blank["url"] == ""
    assert client.patch(f"/api/projects/{blank['id']}", json={"title": "Renamed edit"}).json()["title"] == "Renamed edit"
    clip = import_one(client)
    path = db.DATA_DIR / "copy-source.mp4"
    path.write_bytes(VIDEO)
    asset = db.add_asset(clip["id"], "source", path)
    with db.connect() as connection:
        connection.execute("INSERT INTO editor_projects VALUES (?,?,?)", (clip["id"], json.dumps({"items": [{"id": "saved-cut", "asset_id": asset["id"]}], "source_seeded": True}), db.now()))
    duplicate = client.post(f"/api/projects/{clip['id']}/duplicate").json()
    copy_asset = duplicate["assets"][0]
    assert duplicate["license_status"] == "unknown"
    assert duplicate["permission_note"] == ""
    assert copy_asset["clip_id"] == duplicate["id"]
    assert copy_asset["id"] != asset["id"]
    assert copy_asset["path"] != asset["path"]
    with db.connect() as connection:
        project = json.loads(connection.execute("SELECT project FROM editor_projects WHERE clip_id=?", (duplicate["id"],)).fetchone()[0])
    assert project["items"][0]["asset_id"] == copy_asset["id"]
    assert client.delete(f"/api/projects/{clip['id']}").status_code == 200
    assert not path.exists()
    assert client.get(copy_asset["url"]).content == VIDEO
    assert client.delete(f"/api/projects/{duplicate['id']}").status_code == 200
    assert not (db.DATA_DIR / copy_asset["path"]).exists()


@pytest.mark.parametrize("extension,codec", [("mp4", "libx264"), ("webm", "libvpx-vp9")])
def test_browser_export_is_validated_and_saved_to_local_history(client, tmp_path, extension, codec):
    import subprocess
    executable = media.find_ffmpeg()
    if not executable:
        pytest.skip("FFmpeg is unavailable")
    clip = import_one(client)
    fixture = tmp_path / f"browser-fixture.{extension}"
    subprocess.run([executable, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:size=160x284:rate=24", "-t", "0.5", "-c:v", codec, "-pix_fmt", "yuv420p", str(fixture)], check=True, timeout=30)
    with fixture.open("rb") as video:
        response = client.post(f"/api/projects/{clip['id']}/exports", files={"file": (fixture.name, video, f"video/{extension}")})
    assert response.status_code == 200, response.text
    asset = response.json()
    assert asset["kind"] == "export"
    assert asset["clip_id"] == clip["id"]
    assert client.get(asset["url"]).content == fixture.read_bytes()
    detail = client.get(f"/api/clips/{clip['id']}").json()
    assert detail["workflow_status"] == "exported"
    assert detail["license_status"] == "unknown"
    assert detail["assets"][-1]["id"] == asset["id"]


def test_browser_export_rejects_invalid_truncated_and_oversized_files(client, monkeypatch):
    clip = client.post("/api/projects").json()
    endpoint = f"/api/projects/{clip['id']}/exports"
    for name, content in [("bad.html", b"html"), ("empty.mp4", b""), ("bad.mp4", b"not-video"), ("truncated.mp4", VIDEO)]:
        response = client.post(endpoint, files={"file": (name, content)})
        assert response.status_code == 422, response.text
    monkeypatch.setattr(routes, "MAX_UPLOAD", 12)
    assert client.post(endpoint, files={"file": ("too-large.mp4", VIDEO)}).status_code == 413
    assert client.get(f"/api/clips/{clip['id']}").json()["assets"] == []
    assert list((db.DATA_DIR / "exports" / clip["id"]).glob("*")) == []
