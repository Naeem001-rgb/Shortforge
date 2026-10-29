"""Storage, API boundaries, and license checks; no cloud calls or model downloads."""

import json
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path
import subprocess
import tempfile
from threading import Event
from types import SimpleNamespace
import sys

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from engine.core import db, media, routes, runtime, source_urls
from engine.core.app import app


VIDEO_ID = "tleaVXWF3YI"
VIDEO = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"


@lru_cache(maxsize=1)
def playable_video():
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "fixture.mp4"
        subprocess.run(
            [
                media.find_ffmpeg(),
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=purple:s=32x32:r=10:d=0.2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(path),
            ],
            check=True,
            capture_output=True,
        )
        return path.read_bytes()


def import_one(client, **extra):
    response = client.post(
        "/api/clips",
        json={
            "clips": [{"url": f"https://www.youtube.com/shorts/{VIDEO_ID}", **extra}]
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["clips"][0]


def permit(client, clip):
    response = client.patch(
        f"/api/clips/{clip['id']}",
        json={
            "license_status": "permission",
            "permission_note": "Creator gave permission by email on 2026-09-29.",
        },
    )
    assert response.status_code == 200
    return response.json()


def upload_one(client):
    response = client.post(
        "/api/upload",
        files={"file": ("my-clip.mp4", playable_video(), "video/mp4")},
        data={"title": "My footage"},
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(
    "url",
    [
        f"https://youtube.com/shorts/{VIDEO_ID}?feature=share",
        f"https://www.youtube.com/watch?v={VIDEO_ID}&t=2",
        f"https://youtu.be/{VIDEO_ID}",
        f"youtube.com/shorts/{VIDEO_ID}",
    ],
)
def test_youtube_links_are_canonical(url):
    assert source_urls.canonical_youtube_url(url) == (
        VIDEO_ID,
        f"https://www.youtube.com/shorts/{VIDEO_ID}",
    )


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:8000/private",
        "file:///etc/passwd",
        f"https://youtube.com.evil.example/shorts/{VIDEO_ID}",
        f"https://youtube.com@evil.example/shorts/{VIDEO_ID}",
        f"https://youtube.com:8443/shorts/{VIDEO_ID}",
        "https://youtube.com/shorts/bad-id",
    ],
)
def test_remote_import_cannot_fetch_arbitrary_url(url):
    with pytest.raises(HTTPException):
        source_urls.canonical_youtube_url(url)


def test_import_never_trusts_client_license_or_workflow(client):
    clip = import_one(
        client,
        title="Narrated wildlife",
        license_status="owned",
        permission_note="made up",
        workflow_status="exported",
        discovery_mode="narrated",
    )
    assert clip["license_status"] == "unknown"
    assert clip["permission_note"] == ""
    assert clip["workflow_status"] == "collected"
    assert clip["discovery_mode"] == "narrated"
    assert clip["credit_target"] == ""
    again = client.post(
        "/api/clips",
        json={"clips": [{"url": f"https://youtu.be/{VIDEO_ID}", "title": "Duplicate"}]},
    )
    assert again.json()["added"] == 0
    assert len(client.get("/api/clips").json()["clips"]) == 1


def test_import_batch_is_atomic(client):
    response = client.post(
        "/api/clips",
        json={
            "clips": [{"video_id": VIDEO_ID}, {"url": "https://evil.example/private"}]
        },
    )
    assert response.status_code == 422
    assert client.get("/api/clips").json()["clips"] == []


def test_scout_and_dashboard_can_import_the_same_clip_together(client):
    def collect(_):
        return client.post(
            "/api/clips", json={"clips": [{"video_id": VIDEO_ID}]}
        ).json()

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(collect, range(8)))
    assert sum(result["added"] for result in results) == 1
    assert len({result["clips"][0]["id"] for result in results}) == 1


def test_counts_exceeding_sqlite_integer_limits_return_validation_error(client):
    response = client.post(
        "/api/clips", json={"clips": [{"video_id": VIDEO_ID, "views": 10**30}]}
    )
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


def test_unknown_source_can_store_transcripts_without_fabricating_permission(
    client, monkeypatch
):
    clip = import_one(client)
    monkeypatch.setattr(media, "tool_available", lambda name: False)
    response = client.post(f"/api/clips/{clip['id']}/download")
    assert response.status_code == 503
    assert "yt-dlp" in response.text
    transcript = {"text": "A reviewed transcript", "words": []}
    assert (
        client.put(f"/api/clips/{clip['id']}/transcript", json=transcript).status_code
        == 200
    )
    result = db.get_clip(clip["id"])
    assert result["license_status"] == "unknown"
    assert result["permission_note"] == ""


def test_library_reference_can_rewrite_script_without_unlocking_footage(
    client, monkeypatch
):
    from engine.ai import routes as writing_routes

    clip = import_one(client)
    received = []

    def generate(text, settings):
        received.append(text)
        return {
            "original_text": text,
            "rewritten_text": "Different narration",
            "words_original": 2,
            "words_rewritten": 2,
            "within_tolerance": True,
            "exact_word_count": True,
            "attempts": 1,
        }

    monkeypatch.setattr(writing_routes, "rewrite_script", generate)
    response = client.post(
        "/api/rewrite",
        json={"clip_id": clip["id"], "text": "Existing narration", "mode": "rewrite"},
    )
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
    assert response.content == playable_video()[:4]


def test_upload_rejects_executable_and_false_video(client):
    for name, data in (
        ("script.html", b"<html>"),
        ("video.mp4", b"<html>"),
        ("video.mp4", b""),
        ("truncated.mp4", VIDEO),
    ):
        response = client.post("/api/upload", files={"file": (name, data, "video/mp4")})
        assert response.status_code == 422
    assert client.get("/api/clips").json()["clips"] == []
    assert list((db.DATA_DIR / "uploads").glob("*")) == []


def test_oversized_upload_is_rejected_and_partial_file_removed(client, monkeypatch):
    monkeypatch.setattr(routes, "MAX_UPLOAD", 12)
    response = client.post(
        "/api/upload", files={"file": ("video.mp4", VIDEO, "video/mp4")}
    )
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
    response = client.put(
        "/api/settings", json={"gemini_api_key": key, "scout_mode": "narrated"}
    )
    assert response.status_code == 200
    assert key not in response.text
    assert response.json()["gemini_api_key_set"] is True
    assert key not in client.get("/api/settings").text
    assert db.get_settings()["gemini_api_key"] == key
    rejected = client.put(
        "/api/settings", json={"gemini_api_key": key, "anything": key}
    )
    assert rejected.status_code == 422
    assert key not in rejected.text
    assert (
        client.put("/api/settings", json={"gemini_api_key": ""}).json()[
            "gemini_api_key_set"
        ]
        is False
    )


def test_untrusted_websites_cannot_write_to_local_engine(client):
    response = client.put(
        "/api/settings",
        json={"niche": "hijacked"},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403
    assert db.get_settings()["niche"] == ""
    assert (
        client.post(
            "/api/clips",
            json={"clips": [{"video_id": VIDEO_ID}]},
            headers={"Origin": "null"},
        ).status_code
        == 403
    )
    assert (
        client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
    )


def test_dashboard_and_extension_origins_work(client):
    for origin in (
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "chrome-extension://" + "a" * 32,
    ):
        response = client.options(
            "/api/clips",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == origin
        assert client.get("/api/health", headers={"Origin": origin}).status_code == 200


def test_chunked_requests_have_size_limit_without_content_length(client):
    def chunks():
        yield b'{"niche":"'
        yield b"x" * (2 * 1024 * 1024)
        yield b'"}'

    response = client.put(
        "/api/settings", content=chunks(), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert db.get_settings()["niche"] == ""


def test_transcript_validation_and_persistence(client):
    clip = upload_one(client)
    path = f"/api/clips/{clip['id']}/transcript"
    transcript = {
        "text": "Hello world",
        "words": [
            {"word": "Hello", "start": 0, "end": 0.5},
            {"word": "world", "start": 0.5, "end": 1},
        ],
    }
    assert client.put(path, json=transcript).json() == transcript
    detail = client.get(f"/api/clips/{clip['id']}").json()
    assert detail["transcript"] == transcript
    assert detail["workflow_status"] == "transcribed"
    assert (
        client.put(
            path, json={"text": "bad", "words": [{"word": "bad", "start": 2, "end": 1}]}
        ).status_code
        == 422
    )


def test_job_updates_mask_secrets_and_sse_finishes(client):
    client.put("/api/settings", json={"gemini_api_key": "secret-123"})
    job = db.new_job("test", None)
    db.update_job(
        job["id"], status="failed", progress=120, error="Provider leaked secret-123"
    )
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
    assert client.get(f"/api/jobs/{response.json()['id']}").json()["result"] == {
        "done": True
    }


def test_enrichment_only_trusts_youtube_status_license(client, monkeypatch):
    clip = import_one(client)
    client.put("/api/settings", json={"youtube_api_key": "secret-google-key"})

    def youtube(*args, **kwargs):
        assert kwargs["params"]["part"] == "snippet,statistics,status"
        assert kwargs["params"]["id"] == VIDEO_ID
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {
                "items": [
                    {
                        "id": VIDEO_ID,
                        "status": {"license": "creativeCommon"},
                        "snippet": {"title": "Verified title"},
                        "statistics": {"viewCount": "23000", "likeCount": "6000"},
                    }
                ]
            },
        )

    monkeypatch.setattr(routes.httpx, "get", youtube)
    response = client.post(f"/api/clips/{clip['id']}/enrich")
    assert response.status_code == 200
    assert response.json()["license_status"] == "cc_by"
    assert response.json()["views"] == 23000
    assert db.require_editable(clip["id"])["title"] == "Verified title"


def test_pending_enrichment_preserves_permission_given_during_lookup(
    client, monkeypatch
):
    clip = import_one(client)
    client.put("/api/settings", json={"youtube_api_key": "test-key"})

    def youtube(*args, **kwargs):
        with db.connect() as conn:
            conn.execute(
                "UPDATE clips SET license_status='permission',permission_note='Creator email' WHERE id=?",
                (clip["id"],),
            )
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {
                "items": [{"id": VIDEO_ID, "status": {"license": "youtube"}}]
            },
        )

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
    monkeypatch.setitem(
        sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=OfflineModel)
    )
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


def test_delete_removes_voiceover_and_export_sidecars_but_keeps_voice_references(
    client,
):
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
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM assets WHERE kind='reference'"
            ).fetchone()[0]
            == 1
        )


def test_delete_ignores_asset_paths_outside_the_data_folder(client):
    clip = upload_one(client)
    outside = db.DATA_DIR.parent / "not-ours.mp4"
    outside.write_bytes(b"someone else's file")
    with db.connect() as conn:
        conn.execute(
            "UPDATE assets SET path=? WHERE clip_id=?", (str(outside), clip["id"])
        )
    assert client.delete(f"/api/clips/{clip['id']}").json() == {"ok": True}
    assert outside.exists()
    outside.unlink()


def test_bulk_delete_reports_an_honest_count_and_ignores_unknown_ids(client):
    first, second = upload_one(client), import_one(client)
    result = client.post(
        "/api/clips/delete-bulk",
        json={"ids": [first["id"], second["id"], "missing-id", first["id"]]},
    ).json()
    assert result["deleted"] == [first["id"], second["id"]]
    assert result["missing"] == ["missing-id"]
    assert client.get("/api/clips").json()["clips"] == []
    for body in ({"ids": []}, {"ids": ["a"], "unexpected": 1}):
        assert client.post("/api/clips/delete-bulk", json=body).status_code == 422
    assert client.post("/api/clips/delete-bulk", json={"ids": [first["id"]]}).json()[
        "missing"
    ] == [first["id"]]


def test_bulk_delete_keeps_going_when_one_clip_is_already_gone(client):
    first, second = upload_one(client), import_one(client)
    client.delete(f"/api/clips/{first['id']}")
    result = client.post(
        "/api/clips/delete-bulk", json={"ids": [first["id"], second["id"]]}
    ).json()
    assert result["deleted"] == [second["id"]]
    assert result["missing"] == [first["id"]]


def test_download_is_idempotent_for_inflight_and_cached_sources(client, monkeypatch):
    clip = import_one(client)
    source_bytes = playable_video()
    tool_available = media.tool_available
    monkeypatch.setattr(media, "tool_available", lambda name: True)
    monkeypatch.setattr(media, "find_ffmpeg", lambda: "/fake/ffmpeg")
    started = []
    monkeypatch.setattr(
        media, "download_job", lambda job_id, clip_id: started.append(job_id)
    )

    def fetch(_):
        return client.post(f"/api/clips/{clip['id']}/download").json()

    with ThreadPoolExecutor(max_workers=4) as pool:
        requests = list(pool.map(fetch, range(8)))
    assert len({job["id"] for job in requests}) == 1
    assert len(started) == 1
    path = db.DATA_DIR / "source.mp4"
    path.write_bytes(source_bytes)
    asset = db.add_asset(clip["id"], "source", path)
    db.update_job(started[0], status="completed", progress=100, result={"asset": asset})
    # Cached sources still need media probing; only the downloader is unavailable.
    monkeypatch.setattr(
        media, "tool_available", lambda name: name != "yt_dlp" and tool_available(name)
    )
    cached = fetch(0)
    assert cached["id"] == started[0]
    assert cached["status"] == "completed"
    assert cached["result"]["asset"]["id"] == asset["id"]
    assert len(started) == 1
    assert db.get_clip(clip["id"])["license_status"] == "unknown"


def test_failed_acquisition_retries_without_replacing_existing_edit(
    client, monkeypatch
):
    clip = import_one(client)
    with db.connect() as connection:
        connection.execute(
            "INSERT INTO editor_projects VALUES (?,?,?)",
            (clip["id"], '{"items":[{"id":"my-title","kind":"text"}]}', db.now()),
        )
    old = db.new_job("download", clip["id"])
    db.update_job(old["id"], status="failed", error="Retry me")
    monkeypatch.setattr(media, "tool_available", lambda name: True)
    monkeypatch.setattr(media, "find_ffmpeg", lambda: "/fake/ffmpeg")
    monkeypatch.setattr(media, "download_job", lambda *args: None)
    response = client.post(f"/api/clips/{clip['id']}/download").json()
    assert response["id"] != old["id"]
    assert db.get_job(old["id"])["error"] == "Retry me"
    with db.connect() as connection:
        assert (
            "my-title"
            in connection.execute(
                "SELECT project FROM editor_projects WHERE clip_id=?", (clip["id"],)
            ).fetchone()[0]
        )


def test_corrupt_cached_source_allows_fresh_acquisition(client, monkeypatch):
    clip = import_one(client)
    path = db.DATA_DIR / "truncated.mp4"
    path.write_bytes(VIDEO)
    asset = db.add_asset(clip["id"], "source", path)
    old = db.new_job("download", clip["id"])
    db.update_job(old["id"], status="completed", progress=100, result={"asset": asset})
    monkeypatch.setattr(media, "tool_available", lambda name: True)
    monkeypatch.setattr(media, "find_ffmpeg", lambda: "/fake/ffmpeg")
    started = []
    monkeypatch.setattr(
        media, "download_job", lambda job_id, clip_id: started.append(job_id)
    )
    response = client.post(f"/api/clips/{clip['id']}/download")
    assert response.status_code == 200
    assert response.json()["status"] == "queued"
    assert started == [response.json()["id"]]
    assert response.json()["id"] != old["id"]
    assert path.is_file(), (
        "Retry must not delete a source referenced by an existing edit"
    )


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/api/projects"),
        ("PATCH", "/api/projects/{clip_id}"),
        ("DELETE", "/api/projects/{clip_id}"),
        ("POST", "/api/projects/{clip_id}/duplicate"),
        ("POST", "/api/projects/{clip_id}/exports"),
        ("GET", "/api/editor/{clip_id}"),
        ("PUT", "/api/editor/{clip_id}"),
        ("GET", "/api/editor-capabilities"),
        ("GET", "/api/presets"),
        ("POST", "/api/captions/detect"),
        ("POST", "/api/export"),
        ("POST", "/api/seo"),
    ],
)
def test_retired_editor_and_seo_routes_are_unavailable(client, method, path):
    clip = import_one(client)
    response = client.request(method, path.format(clip_id=clip["id"]), json={})
    assert response.status_code == 404, response.text
    assert client.get(f"/api/clips/{clip['id']}").status_code == 200


def test_health_identifies_loaded_engine_and_source_updates(client, monkeypatch):
    monkeypatch.setattr(runtime, "source_revision", lambda: runtime.LOADED_REVISION)
    current = client.get("/api/health").json()
    assert current["status"] == "ok" and "tools" in current and "version" in current
    assert "studio_protocol" not in current["runtime"]
    assert current["runtime"]["started_at"]
    assert current["runtime"]["restart_required"] is False
    monkeypatch.setattr(runtime, "source_revision", lambda: "updated-source")
    updated = client.get("/api/health").json()["runtime"]
    assert updated["restart_required"] is True
    assert updated["loaded_revision"] == current["runtime"]["loaded_revision"]
    assert updated["disk_revision"] == "updated-source"


def test_real_decoder_rejects_bad_upload_then_retry_keeps_one_source(client):
    failed = client.post("/api/upload", files={"file": ("truncated.mp4", VIDEO)})
    assert failed.status_code == 422
    assert client.get("/api/clips").json()["clips"] == []
    clip = upload_one(client)
    assert len(clip["assets"]) == 1
    source = clip["assets"][0]
    assert source["kind"] == "source"
    assert client.get(source["url"]).content == playable_video()
    assert client.get(f"/api/clips/{clip['id']}").json()["assets"] == clip["assets"]
    assert len(list((db.DATA_DIR / "uploads").glob("*"))) == 1


def test_downloader_failure_retry_and_reload_keep_source_metadata(client, monkeypatch):
    """Exercise the real job and normalization with a controlled transport."""
    clip = import_one(client)
    attempts = []
    download_started, finish_download = Event(), Event()

    class Downloader:
        def __init__(self, options):
            self.options = options
            self.path = Path(options["outtmpl"].replace("%(ext)s", "mp4"))

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download):
            assert url == clip["url"] and download is True
            attempts.append(self.path)
            if len(attempts) == 1:
                self.path.with_suffix(".part").write_bytes(b"interrupted")
                raise RuntimeError("Network interrupted. Please retry.")
            download_started.set()
            assert finish_download.wait(10), (
                "The test must release the controlled download"
            )
            self.path.write_bytes(playable_video())
            for hook in self.options["progress_hooks"]:
                hook({"status": "finished"})
            return {"ext": "mp4"}

        def prepare_filename(self, info):
            return str(self.path)

    monkeypatch.setitem(sys.modules, "yt_dlp", SimpleNamespace(YoutubeDL=Downloader))
    monkeypatch.setattr(media, "tool_available", lambda name: True)
    endpoint = f"/api/clips/{clip['id']}/download"
    first = client.post(endpoint).json()
    assert client.get(f"/api/jobs/{first['id']}").json()["status"] == "failed"
    assert not attempts[0].parent.exists(), "Failed transport must clean partial media"
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.post, endpoint)
        try:
            assert download_started.wait(10)
            library_clip = f"/api/clips/{clip['id']}"
            saved = client.patch(library_clip, json={"title": "Saved during download"})
            assert saved.status_code == 200, saved.text
            assert client.get(library_clip).json()["title"] == "Saved during download"
        finally:
            finish_download.set()
        second = pending.result().json()
    completed = client.get(f"/api/jobs/{second['id']}").json()
    assert second["id"] != first["id"]
    assert completed["status"] == "completed", completed
    detail = client.get(f"/api/clips/{clip['id']}").json()
    assert len(detail["assets"]) == 1
    assert detail["assets"][0]["kind"] == "source"
    assert client.get(detail["assets"][0]["url"]).content == playable_video()
    assert detail["title"] == "Saved during download"
    assert client.post(endpoint).json()["id"] == second["id"]
    assert len(attempts) == 2
    assert client.get(f"/api/clips/{clip['id']}").json()["assets"] == detail["assets"]
    assert detail["license_status"] == "unknown" and detail["permission_note"] == ""


def test_engine_restart_turns_abandoned_download_into_retryable_failure(
    client, monkeypatch
):
    clip = import_one(client)
    old = db.new_job("download", clip["id"])
    db.update_job(old["id"], status="running", progress=35)
    with TestClient(app, base_url="http://localhost") as restarted:
        failed = restarted.get(f"/api/jobs/{old['id']}").json()
        assert failed["status"] == "failed" and "restarted" in failed["error"]
        monkeypatch.setattr(media, "tool_available", lambda name: True)
        monkeypatch.setattr(media, "download_job", lambda *args: None)
        retried = restarted.post(f"/api/clips/{clip['id']}/download").json()
        assert retried["status"] == "queued" and retried["id"] != old["id"]


def test_library_etag_tracks_mutations_and_filters(client):
    clip = import_one(client, title="Original")
    first = client.get("/api/clips")
    etag = first.headers["etag"]
    assert first.headers["cache-control"] == "private, no-cache"
    for validator in (etag, f'"old", W/{etag}', "*"):
        unchanged = client.get("/api/clips", headers={"If-None-Match": validator})
        assert unchanged.status_code == 304 and unchanged.content == b""
    filtered = client.get("/api/clips?q=missing", headers={"If-None-Match": etag})
    assert filtered.status_code == 200 and filtered.json() == {"clips": []}
    client.patch(f"/api/clips/{clip['id']}", json={"title": "Changed"})
    changed = client.get("/api/clips", headers={"If-None-Match": etag})
    assert changed.status_code == 200 and changed.headers["etag"] != etag
    assert changed.json()["clips"][0]["title"] == "Changed"
    client.delete(f"/api/clips/{clip['id']}")
    removed = client.get(
        "/api/clips", headers={"If-None-Match": changed.headers["etag"]}
    )
    assert removed.status_code == 200 and removed.json() == {"clips": []}


def test_cached_source_probe_does_not_hold_writer_lock(client, monkeypatch):
    from engine.studio import editor_media

    clip = upload_one(client)
    entered, release = Event(), Event()
    original = editor_media.probe_media

    def probe(path):
        entered.set()
        assert release.wait(10)
        return original(path)

    monkeypatch.setattr(editor_media, "probe_media", probe)
    with ThreadPoolExecutor(max_workers=2) as pool:
        downloading = pool.submit(client.post, f"/api/clips/{clip['id']}/download")
        try:
            assert entered.wait(5)
            update = pool.submit(
                client.patch,
                f"/api/clips/{clip['id']}",
                json={"title": "Still responsive"},
            )
            assert update.result(timeout=3).status_code == 200
        finally:
            release.set()
        assert downloading.result(timeout=5).status_code == 200


def test_source_changed_during_probe_is_not_reused(client, monkeypatch):
    from engine.studio import editor_media

    clip = upload_one(client)
    original = editor_media.probe_media

    def probe(path):
        metadata = original(path)
        path.write_bytes(path.read_bytes() + b"changed")
        return metadata

    monkeypatch.setattr(editor_media, "probe_media", probe)
    response = client.post(f"/api/clips/{clip['id']}/download")
    assert response.status_code == 409
    assert "source changed" in response.json()["detail"]


def test_upload_probe_does_not_block_other_requests(client, monkeypatch):
    from engine.studio import editor_media

    entered, release = Event(), Event()
    original = editor_media.probe_media

    def probe(path):
        entered.set()
        assert release.wait(10)
        return original(path)

    monkeypatch.setattr(editor_media, "probe_media", probe)
    with ThreadPoolExecutor(max_workers=2) as pool:
        uploading = pool.submit(
            client.post,
            "/api/upload",
            files={"file": ("video.mp4", playable_video(), "video/mp4")},
        )
        try:
            assert entered.wait(5)
            response = pool.submit(client.get, "/api/clips")
            assert response.result(timeout=3).status_code == 200
        finally:
            release.set()
        assert uploading.result(timeout=5).status_code == 200


def test_download_progress_is_throttled_without_losing_completion(client, monkeypatch):
    from unittest.mock import Mock
    import yt_dlp

    clip = import_one(client)
    job = db.new_job("download", clip["id"])
    clock = iter(100 + index * 0.001 for index in range(1000))
    monkeypatch.setattr(media, "time", SimpleNamespace(monotonic=lambda: next(clock)))
    writes = Mock(wraps=db.update_job)
    monkeypatch.setattr(db, "update_job", writes)
    source = playable_video()

    class Downloader:
        def __init__(self, options):
            self.options = options
            self.path = Path(options["outtmpl"].replace("%(ext)s", "mp4"))

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def extract_info(self, url, download):
            self.path.write_bytes(source)
            hook = self.options["progress_hooks"][0]
            for index in range(1000):
                hook(
                    {
                        "status": "downloading",
                        "total_bytes": 1000,
                        "downloaded_bytes": index,
                    }
                )
            hook({"status": "finished"})
            return {}

        def prepare_filename(self, info):
            return str(self.path)

    monkeypatch.setattr(yt_dlp, "YoutubeDL", Downloader)
    media.download_job(job["id"], clip["id"])
    assert db.get_job(job["id"])["status"] == "completed"
    assert writes.call_count <= 6
    assert any(call.kwargs.get("progress") == 95 for call in writes.call_args_list)
