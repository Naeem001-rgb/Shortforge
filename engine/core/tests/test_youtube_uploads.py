"""No real OAuth, uploads, or background threads: exercise the saved protocol state."""

import json

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import httpx
import pytest

from engine.core import db, youtube_uploads as uploads

CHANNEL = "UCshortforge-test"
VIDEO = "Abc123_xY-0"
SESSION = (
    "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=private-session"
)
REAL_HTTP_CLIENT = httpx.Client
REAL_SCHEDULE_UPLOAD = uploads._schedule_upload


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    uploads.init_storage()
    with db.connect() as conn:
        conn.executemany(
            "INSERT INTO clips (id,title,created_at) VALUES (?,?,?)",
            [("clip", "Clip", db.now()), ("other", "Other", db.now())],
        )
    path = tmp_path / "saved.mp4"
    data = b"finished export bytes, captions and audio"
    path.write_bytes(data)
    asset = db.add_asset("clip", "export", path)
    scheduled = []
    monkeypatch.setattr(uploads, "_schedule_upload", scheduled.append)
    monkeypatch.setattr(
        uploads.youtube_auth,
        "get_channel",
        lambda channel_id: {
            "id": channel_id,
            "title": "My channel",
            "thumbnail_url": "",
        },
    )
    monkeypatch.setattr(
        uploads.youtube_auth,
        "get_access_token",
        lambda channel_id: "private-access-token",
    )
    app = FastAPI()
    app.include_router(uploads.router)
    with TestClient(app) as client:
        yield {
            "client": client,
            "path": path,
            "data": data,
            "asset": asset,
            "scheduled": scheduled,
            "payload": {
                "clip_id": "clip",
                "asset_id": asset["id"],
                "channel_id": CHANNEL,
                "title": "My finished short",
                "description": "A description",
                "tags": ["test", "short video"],
                "self_declared_made_for_kids": False,
                "contains_synthetic_media": True,
            },
        }


def mock_provider(monkeypatch, handler):
    requests = []

    def wrapped(request):
        requests.append(request)
        assert request.headers["Authorization"] == "Bearer private-access-token"
        return handler(request)

    monkeypatch.setattr(
        uploads.httpx,
        "Client",
        lambda **kwargs: REAL_HTTP_CLIENT(
            transport=httpx.MockTransport(wrapped), **kwargs
        ),
    )
    return requests


def channel_response():
    return httpx.Response(200, json={"items": [{"id": CHANNEL}]})


def create(setup, **changes):
    response = setup["client"].post(
        "/api/youtube/uploads", json={**setup["payload"], **changes}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_upload_sends_exact_saved_file_and_reviewed_metadata(setup, monkeypatch):
    def provider(request):
        if request.url.path.endswith("/channels"):
            assert dict(request.url.params) == {"part": "id", "mine": "true"}
            return channel_response()
        if request.method == "POST":
            assert request.headers["X-Upload-Content-Length"] == str(len(setup["data"]))
            assert request.headers["X-Upload-Content-Type"] == "video/mp4"
            assert json.loads(request.content) == {
                "snippet": {
                    "title": "My finished short",
                    "description": "A description",
                    "categoryId": "22",
                    "tags": ["test", "short video"],
                },
                "status": {
                    "privacyStatus": "private",
                    "selfDeclaredMadeForKids": False,
                    "containsSyntheticMedia": True,
                },
            }
            return httpx.Response(200, headers={"Location": SESSION})
        assert request.content == setup["data"]
        assert (
            request.headers["Content-Range"]
            == f"bytes 0-{len(setup['data']) - 1}/{len(setup['data'])}"
        )
        return httpx.Response(
            201, json={"id": VIDEO, "status": {"privacyStatus": "private"}}
        )

    calls = mock_provider(monkeypatch, provider)
    job = create(setup)
    assert job["status"] == "queued"
    assert setup["scheduled"] == [job["id"]]
    assert calls == []  # A request is queued before the background worker runs.
    uploads._run_upload(job["id"])
    row = uploads._row(job["id"])
    assert row["status"] == "processing"
    assert row["progress"] == 100
    public = (
        setup["client"].get("/api/youtube/uploads?clip_id=clip").json()["uploads"][0]
    )
    assert public["video_url"] == f"https://www.youtube.com/watch?v={VIDEO}"
    assert (
        not {"session_url", "metadata", "file_sha256", "final_attempted"}
        & public.keys()
    )
    assert "private-session" not in json.dumps(public)
    assert "private-access-token" not in json.dumps(public)


def test_duplicate_submission_retains_original_metadata_and_only_one_job(setup):
    first = create(setup)
    second = create(setup, title="A changed title", privacy_status="public")
    assert second["id"] == first["id"]
    assert second["title"] == "My finished short"
    assert second["privacy_status"] == "private"
    assert setup["scheduled"] == [first["id"]]
    response = setup["client"].post(
        "/api/youtube/uploads", json={**setup["payload"], "clip_id": "other"}
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "   "},
        {"title": "x" * 101},
        {"title": "<title>"},
        {"description": "é" * 2501},
        {"description": "bad > text"},
        {"tags": [" "]},
        {"tags": ["one two", "x" * 491]},
        {"tags": ["x" * 251, "y" * 250]},
        {"tags": [12]},
        {"privacy_status": "unknown"},
        {"self_declared_made_for_kids": "false"},
    ],
)
def test_metadata_rejected_before_job_is_created(setup, changes):
    response = setup["client"].post(
        "/api/youtube/uploads", json={**setup["payload"], **changes}
    )
    assert response.status_code == 422
    assert setup["scheduled"] == []
    assert setup["client"].get("/api/youtube/uploads?clip_id=clip").json() == {
        "uploads": []
    }


def test_valid_boundary_metadata_and_explicit_audience_required(setup):
    create(setup, title="x" * 100, description="é" * 2500, tags=["x" * 500])
    payload = dict(setup["payload"])
    del payload["self_declared_made_for_kids"]
    assert setup["client"].post("/api/youtube/uploads", json=payload).status_code == 422


@pytest.mark.parametrize("kind,clip_id", [("source", "clip"), ("export", "other")])
def test_only_export_owned_by_selected_project_is_accepted(setup, kind, clip_id):
    asset = db.add_asset(clip_id, kind, setup["path"])
    response = setup["client"].post(
        "/api/youtube/uploads", json={**setup["payload"], "asset_id": asset["id"]}
    )
    assert response.status_code == 422
    assert setup["scheduled"] == []


def test_missing_export_cannot_be_queued(setup):
    setup["path"].unlink()
    response = setup["client"].post("/api/youtube/uploads", json=setup["payload"])
    assert response.status_code == 422


def test_file_changed_after_review_is_never_uploaded(setup, monkeypatch):
    job = create(setup)
    setup["path"].write_bytes(b"changed export bytes, captions and audio")
    calls = mock_provider(monkeypatch, lambda request: pytest.fail("No HTTP expected"))
    uploads._run_upload(job["id"])
    assert not calls
    row = uploads._row(job["id"])
    assert row["status"] == "failed" and not row["retryable"]


def test_channel_mismatch_stops_before_session_creation(setup, monkeypatch):
    calls = mock_provider(
        monkeypatch,
        lambda request: httpx.Response(200, json={"items": [{"id": "UCsomeone-else"}]}),
    )
    job = create(setup)
    uploads._run_upload(job["id"])
    row = uploads._row(job["id"])
    assert row["status"] == "failed"
    assert "different channel" in row["error"]
    assert len(calls) == 1 and calls[0].method == "GET"


def test_uncertain_final_response_retry_finds_existing_video_without_reposting(
    setup, monkeypatch
):
    def provider(request):
        if request.url.path.endswith("/channels"):
            return channel_response()
        if request.method == "POST":
            return httpx.Response(200, headers={"Location": SESSION})
        if request.headers["Content-Range"].startswith("bytes */"):
            return httpx.Response(201, json={"id": VIDEO})
        raise httpx.ReadTimeout("private-access-token private-session", request=request)

    calls = mock_provider(monkeypatch, provider)
    job = create(setup)
    uploads._run_upload(job["id"])
    row = uploads._row(job["id"])
    assert row["status"] == "failed" and row["retryable"]
    assert row["final_attempted"] == 1 and row["session_url"] == SESSION
    assert "private-access-token" not in row["error"]
    assert (
        setup["client"]
        .post(f"/api/youtube/uploads/{job['id']}/retry", json={})
        .status_code
        == 200
    )
    uploads._run_upload(job["id"])
    assert uploads._row(job["id"])["video_id"] == VIDEO
    assert len([r for r in calls if r.method == "POST"]) == 1
    assert len([r for r in calls if r.method == "PUT" and r.content]) == 1


@pytest.mark.parametrize("local_change", ["deleted", "changed"])
def test_lost_final_response_recovers_video_even_when_local_export_changed(
    setup, monkeypatch, local_change
):
    def provider(request):
        if request.url.path.endswith("/channels"):
            return channel_response()
        if request.method == "POST":
            return httpx.Response(200, headers={"Location": SESSION})
        if request.headers["Content-Range"].startswith("bytes */"):
            assert request.content == b""
            return httpx.Response(201, json={"id": VIDEO})
        raise httpx.ReadTimeout("Final reply was lost", request=request)

    calls = mock_provider(monkeypatch, provider)
    job = create(setup)
    uploads._run_upload(job["id"])
    assert uploads._row(job["id"])["final_attempted"] == 1
    if local_change == "deleted":
        setup["path"].unlink()
    else:
        setup["path"].write_bytes(b"A different edited video")
    response = setup["client"].post(f"/api/youtube/uploads/{job['id']}/retry", json={})
    assert response.status_code == 200
    uploads._run_upload(job["id"])
    recovered = uploads._row(job["id"])
    assert recovered["status"] == "processing"
    assert recovered["video_id"] == VIDEO
    assert len([request for request in calls if request.method == "POST"]) == 1
    assert (
        len(
            [
                request
                for request in calls
                if request.method == "PUT" and request.content
            ]
        )
        == 1
    )


def test_missing_export_and_expired_uncertain_session_requires_studio_check(
    setup, monkeypatch
):
    def provider(request):
        if request.url.path.endswith("/channels"):
            return channel_response()
        assert request.method == "PUT" and not request.content
        return httpx.Response(410)

    calls = mock_provider(monkeypatch, provider)
    job = create(setup)
    uploads._update(
        job["id"], status="failed", retryable=1, session_url=SESSION, final_attempted=1
    )
    setup["path"].unlink()
    assert (
        setup["client"]
        .post(f"/api/youtube/uploads/{job['id']}/retry", json={})
        .status_code
        == 200
    )
    uploads._run_upload(job["id"])
    recovered = uploads._row(job["id"])
    assert recovered["status"] == "needs_attention"
    assert "YouTube Studio" in recovered["error"]
    assert not recovered["retryable"]
    assert all(request.method != "POST" for request in calls)


def test_resumes_from_server_offset_after_restart(setup, monkeypatch):
    chunk = 256 * 1024
    monkeypatch.setattr(uploads, "CHUNK_SIZE", chunk)
    content = b"a" * chunk + b"b" * chunk + b"c" * 100
    setup["path"].write_bytes(content)
    interrupted = False

    def provider(request):
        nonlocal interrupted
        if request.url.path.endswith("/channels"):
            return channel_response()
        if request.method == "POST":
            return httpx.Response(200, headers={"Location": SESSION})
        position = request.headers["Content-Range"]
        if position.startswith("bytes */"):
            return httpx.Response(308, headers={"Range": f"bytes=0-{2 * chunk - 1}"})
        if position.startswith("bytes 0-"):
            assert request.content == content[:chunk]
            return httpx.Response(308, headers={"Range": f"bytes=0-{chunk - 1}"})
        if not interrupted:
            interrupted = True
            assert request.content == content[chunk : 2 * chunk]
            raise httpx.ReadError("response lost", request=request)
        assert request.content == content[2 * chunk :]
        return httpx.Response(201, json={"id": VIDEO})

    calls = mock_provider(monkeypatch, provider)
    job = create(setup)
    uploads._run_upload(job["id"])
    assert uploads._row(job["id"])["bytes_uploaded"] == chunk
    uploads._update(job["id"], status="uploading")
    uploads.recover_uploads()
    row = uploads._row(job["id"])
    assert row["status"] == "failed" and row["retryable"]
    assert row["session_url"] == SESSION
    setup["client"].post(f"/api/youtube/uploads/{job['id']}/retry", json={})
    uploads._run_upload(job["id"])
    assert uploads._row(job["id"])["status"] == "processing"
    assert len([r for r in calls if r.method == "POST"]) == 1
    assert max(len(r.content) for r in calls if r.method == "PUT") == chunk


@pytest.mark.parametrize("final_attempted", [False, True])
def test_expired_session_only_restarts_if_final_bytes_were_never_attempted(
    setup, monkeypatch, final_attempted
):
    def provider(request):
        if request.url.path.endswith("/channels"):
            return channel_response()
        if request.method == "POST":
            return httpx.Response(200, headers={"Location": SESSION})
        if not request.content:
            return httpx.Response(410)
        return httpx.Response(201, json={"id": VIDEO})

    calls = mock_provider(monkeypatch, provider)
    job = create(setup)
    uploads._update(
        job["id"], session_url=SESSION, final_attempted=int(final_attempted)
    )
    uploads._run_upload(job["id"])
    row = uploads._row(job["id"])
    if final_attempted:
        assert row["status"] == "needs_attention" and not row["retryable"]
        assert "YouTube Studio" in row["error"]
        assert not [r for r in calls if r.method == "POST"]
        assert (
            setup["client"]
            .post(f"/api/youtube/uploads/{job['id']}/retry", json={})
            .status_code
            == 409
        )
    else:
        assert row["status"] == "processing"
        assert len([r for r in calls if r.method == "POST"]) == 1


@pytest.mark.parametrize(
    "status,reason,can_retry,message",
    [
        (403, "quotaExceeded", True, "limit"),
        (401, "authError", True, "Reconnect"),
        (503, "backendError", True, "temporarily"),
        (403, "forbidden", False, "rejected"),
    ],
)
def test_provider_errors_are_safe_and_actionable(
    setup, monkeypatch, status, reason, can_retry, message
):
    def provider(request):
        if request.url.path.endswith("/channels"):
            return channel_response()
        return httpx.Response(
            status,
            json={
                "error": {
                    "message": "secret private-access-token " + SESSION,
                    "errors": [{"reason": reason}],
                }
            },
        )

    mock_provider(monkeypatch, provider)
    job = create(setup)
    uploads._run_upload(job["id"])
    row = uploads._row(job["id"])
    assert row["status"] == "failed" and bool(row["retryable"]) == can_retry
    assert message in row["error"]
    assert "private-access-token" not in row["error"] and SESSION not in row["error"]


def test_auth_refresh_failure_is_retryable_and_does_not_leak_details(
    setup, monkeypatch
):
    def expired(channel_id):
        raise HTTPException(401, "private-access-token")

    monkeypatch.setattr(uploads.youtube_auth, "get_access_token", expired)
    calls = mock_provider(
        monkeypatch, lambda request: pytest.fail("No provider request expected")
    )
    job = create(setup)
    uploads._run_upload(job["id"])
    row = uploads._row(job["id"])
    assert not calls
    assert row["retryable"] and "Reconnect" in row["error"]
    assert "private-access-token" not in row["error"]


def test_processing_is_throttled_and_reports_actual_privacy(setup, monkeypatch):
    processed = False

    def provider(request):
        assert request.url.path.endswith("/videos")
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "id": VIDEO,
                        "status": {
                            "uploadStatus": "processed" if processed else "uploaded",
                            "privacyStatus": "private",
                        },
                        "processingDetails": {
                            "processingStatus": "succeeded"
                            if processed
                            else "processing"
                        },
                    }
                ]
            },
        )

    calls = mock_provider(monkeypatch, provider)
    job = create(setup, privacy_status="public")
    uploads._update(job["id"], status="processing", video_id=VIDEO, progress=100)
    url = f"/api/youtube/uploads/{job['id']}"
    first = setup["client"].get(url).json()
    assert first["status"] == "processing" and first["privacy_status"] == "private"
    assert setup["client"].get(url).json()["status"] == "processing"
    assert len(calls) == 1
    processed = True
    uploads._update(job["id"], process_checked_at=0)
    finished = setup["client"].get(url).json()
    assert finished["status"] == "completed" and finished["privacy_status"] == "private"
    assert len(calls) == 2


def test_rejected_processing_cannot_trigger_duplicate_upload(setup, monkeypatch):
    mock_provider(
        monkeypatch,
        lambda request: httpx.Response(
            200, json={"items": [{"id": VIDEO, "status": {"uploadStatus": "rejected"}}]}
        ),
    )
    job = create(setup)
    uploads._update(job["id"], status="processing", video_id=VIDEO, progress=100)
    result = setup["client"].get(f"/api/youtube/uploads/{job['id']}").json()
    assert result["status"] == "failed" and not result["retryable"]
    assert result["video_id"] == VIDEO
    assert (
        setup["client"]
        .post(f"/api/youtube/uploads/{job['id']}/retry", json={})
        .status_code
        == 409
    )


def test_retry_after_is_honored(setup, monkeypatch):
    def provider(request):
        if request.url.path.endswith("/channels"):
            return channel_response()
        return httpx.Response(429, headers={"Retry-After": "120"})

    mock_provider(monkeypatch, provider)
    job = create(setup)
    uploads._run_upload(job["id"])
    assert (
        setup["client"]
        .post(f"/api/youtube/uploads/{job['id']}/retry", json={})
        .status_code
        == 429
    )


def test_session_url_cannot_send_video_or_token_to_another_host(setup, monkeypatch):
    def provider(request):
        if request.url.path.endswith("/channels"):
            return channel_response()
        return httpx.Response(
            200, headers={"Location": "https://attacker.example/upload"}
        )

    calls = mock_provider(monkeypatch, provider)
    job = create(setup)
    uploads._run_upload(job["id"])
    assert uploads._row(job["id"])["status"] == "failed"
    assert len(calls) == 2
    assert all(r.url.host == "www.googleapis.com" for r in calls)


def test_restart_never_automatically_resubmits_a_job(setup):
    queued = create(setup)
    uploads.recover_uploads()
    recovered = uploads._row(queued["id"])
    assert recovered["status"] == "failed" and recovered["retryable"]
    assert setup["scheduled"] == [queued["id"]]


def test_immediate_retry_before_old_worker_exits_is_scheduled(setup, monkeypatch):
    pending = []

    class Executor:
        def submit(self, function, upload_id):
            pending.append((function, upload_id))

    monkeypatch.setattr(uploads, "_WORKERS", Executor())
    monkeypatch.setattr(uploads, "_schedule_upload", REAL_SCHEDULE_UPLOAD)
    first_attempt = True

    def provider(request):
        nonlocal first_attempt
        if request.url.path.endswith("/channels"):
            return channel_response()
        if request.method == "POST":
            if first_attempt:
                first_attempt = False
                return httpx.Response(503)
            return httpx.Response(200, headers={"Location": SESSION})
        return httpx.Response(201, json={"id": VIDEO})

    mock_provider(monkeypatch, provider)
    original_update = uploads._update

    def retry_immediately(upload_id, **fields):
        original_update(upload_id, **fields)
        if fields.get("status") == "failed":
            response = setup["client"].post(
                f"/api/youtube/uploads/{upload_id}/retry", json={}
            )
            assert response.status_code == 200

    monkeypatch.setattr(uploads, "_update", retry_immediately)
    job = create(setup)
    function, upload_id = pending.pop(0)
    function(upload_id)
    assert len(pending) == 1
    function, upload_id = pending.pop(0)
    function(upload_id)
    assert uploads._row(job["id"])["status"] == "processing"


def test_repeated_worker_invocations_cannot_send_a_completed_upload_again(
    setup, monkeypatch
):
    def provider(request):
        if request.url.path.endswith("/channels"):
            return channel_response()
        if request.method == "POST":
            return httpx.Response(200, headers={"Location": SESSION})
        return httpx.Response(201, json={"id": VIDEO})

    calls = mock_provider(monkeypatch, provider)
    job = create(setup)
    uploads._run_upload(job["id"])
    uploads._run_upload(job["id"])
    assert len([request for request in calls if request.method == "POST"]) == 1
    assert len([request for request in calls if request.method == "PUT"]) == 1
