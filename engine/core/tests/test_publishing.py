"""Local publishing orchestration; all YouTube traffic uses a fake transport."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import subprocess
from uuid import uuid4

from fastapi import BackgroundTasks, HTTPException
import httpx
import pytest

from engine.core import concat, db, media, publishing, youtube_uploads
from engine.core.concat_rpc import ConcatRPC
from engine.core.tests.test_core import import_one, playable_video

REAL_HTTP_CLIENT = httpx.Client
REAL_RENDER = publishing._render
REAL_RUN_UPLOAD = youtube_uploads._run_upload
VIDEO_ID = "Abc123_xY-0"
CHANNEL = "UCpublishing-test"


@pytest.fixture
def prepared(client, monkeypatch):
    clip = import_one(
        client,
        title="A Lahore walk #Lahore",
        description="Evening in the city. #Pakistan",
    )
    project = concat.project_folder(clip["id"])
    project.mkdir(parents=True)
    manifest = project / "concat.json"
    manifest.write_text(
        json.dumps(
            {
                "name": "My saved cuts",
                "media": [],
                "fonts": [],
                "clips": [{"duration": 1}],
            }
        )
    )
    queued, sent, rendered = [], [], []
    monkeypatch.setattr(publishing, "_submit", queued.append)
    monkeypatch.setattr(
        concat, "capability", lambda: {"available": True, "editor": "Concat"}
    )

    def channel(channel_id):
        if channel_id != CHANNEL:
            raise HTTPException(404, "Channel not connected.")
        return {"id": CHANNEL, "title": "My channel", "thumbnail_url": ""}

    monkeypatch.setattr(youtube_uploads.youtube_auth, "get_channel", channel)
    monkeypatch.setattr(youtube_uploads, "_run_upload", sent.append)

    def render(row):
        rendered.append(row["id"])
        path = publishing._folder(row["id"]) / "finished.mp4"
        path.write_bytes(playable_video())
        return path

    monkeypatch.setattr(publishing, "_render", render)
    state = client.get(f"/api/studio/publishing?clip_id={clip['id']}").json()
    return {
        "client": client,
        "clip": clip,
        "manifest": manifest,
        "queued": queued,
        "sent": sent,
        "rendered": rendered,
        "payload": {
            "clip_id": clip["id"],
            "request_id": str(uuid4()),
            "project_revision": state["project"]["revision"],
            "channel_id": CHANNEL,
            "title": "My finished Lahore short",
            "description": "Reviewed description",
            "tags": ["Lahore", "short video"],
            "privacy_status": "private",
            "self_declared_made_for_kids": False,
            "contains_synthetic_media": False,
        },
    }


def create(prepared, **changes):
    response = prepared["client"].post(
        "/api/studio/publish", json={**prepared["payload"], **changes}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_reading_publishing_never_renders_or_posts_and_prefills_local_details(prepared):
    state = (
        prepared["client"]
        .get(f"/api/studio/publishing?clip_id={prepared['clip']['id']}")
        .json()
    )
    assert state["project"]["ready"]
    assert state["defaults"]["tags"] == ["Lahore", "Pakistan"]
    assert state["publications"] == []
    assert prepared["queued"] == prepared["sent"] == prepared["rendered"] == []


def test_history_batches_upload_reads_and_keeps_recent_public_status(
    prepared, monkeypatch
):
    job = create(prepared)
    publishing._run(job["id"])
    row = publishing._row(job["id"])
    youtube_uploads._update(
        row["upload_id"],
        status="completed",
        progress=100,
        video_id=VIDEO_ID,
        privacy_status="public",
    )
    with db.connect() as conn:
        for index in range(60):
            copy = {
                **row,
                "id": f"history-{index}",
                "request_id": f"request-{index}",
                "created_at": f"2090-01-01T00:{index:02}:00+00:00",
            }
            # Keep an interrupted render and a missing upload in the same page.
            if index == 58:
                copy.update(
                    upload_id=None, status="failed", retryable=1, error="Retry render"
                )
            elif index == 59:
                copy.update(
                    upload_id="missing",
                    status="failed",
                    retryable=1,
                    error="Upload missing",
                )
            conn.execute(
                f"INSERT INTO studio_publications ({','.join(copy)}) VALUES ({','.join('?' for _ in copy)})",
                tuple(copy.values()),
            )
    real_connect = db.connect
    queries, connections = [], []

    @contextmanager
    def counted_connect():
        connections.append(1)
        with real_connect() as conn:
            conn.set_trace_callback(queries.append)
            yield conn

    def unexpected_poll(*args, **kwargs):
        pytest.fail("Reading history must not contact YouTube")

    monkeypatch.setattr(db, "connect", counted_connect)
    monkeypatch.setattr(youtube_uploads, "get_upload", unexpected_poll)
    result = publishing.publishing_state(prepared["clip"]["id"])["publications"]
    assert len(result) == 50
    assert [item["id"] for item in result] == [f"history-{i}" for i in range(59, 9, -1)]
    assert result[0]["error"] == "Upload missing" and result[0]["retryable"]
    assert result[1]["error"] == "Retry render" and result[1]["retryable"]
    for item in result[2:]:
        assert item["status"] == "completed" and item["progress"] == 100
        assert item["privacy_status"] == "public"
        assert item["video_url"] == f"https://www.youtube.com/watch?v={VIDEO_ID}"
        assert not item["can_cancel"]
        assert "session_url" not in item and "metadata" not in item
    assert len(connections) == 4  # Clip, two storage initializers, bounded history.
    assert sum("SELECT * FROM youtube_uploads" in query for query in queries) == 1


def test_publish_snapshots_reviewed_edit_and_registers_its_exact_render(prepared):
    original = prepared["manifest"].read_bytes()
    job = create(prepared)
    assert job["status"] == "queued"
    assert prepared["queued"] == [job["id"]]
    snapshot = publishing._folder(job["id"]) / "project/concat.json"
    assert snapshot.read_bytes() == original
    prepared["manifest"].write_text('{"name":"Later unsent changes"}')
    publishing._run(job["id"])
    row = publishing._row(job["id"])
    asset = db.get_asset(row["asset_id"])
    upload = youtube_uploads._row(row["upload_id"])
    assert snapshot.read_bytes() == original
    assert prepared["manifest"].read_text() == '{"name":"Later unsent changes"}'
    assert prepared["rendered"] == [job["id"]]
    assert prepared["sent"] == [row["upload_id"]]
    assert asset["kind"] == "export" and asset["clip_id"] == prepared["clip"]["id"]
    assert db.resolve_data_path(asset["path"]).read_bytes() == playable_video()
    assert upload["file_sha256"] == hashlib.sha256(playable_video()).hexdigest()
    metadata = json.loads(upload["metadata"])
    assert metadata["snippet"]["title"] == prepared["payload"]["title"]
    assert metadata["snippet"]["tags"] == ["Lahore", "short video"]
    assert metadata["status"]["privacyStatus"] == "private"


def test_scheduling_converts_pakistan_time_and_uploads_privately(prepared):
    future = datetime.now(timezone(timedelta(hours=5))) + timedelta(days=1)
    job = create(prepared, publish_at=future.isoformat())
    publishing._run(job["id"])
    upload = youtube_uploads._row(publishing._row(job["id"])["upload_id"])
    expected = future.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    assert json.loads(upload["metadata"])["status"]["publishAt"] == expected
    assert upload["privacy_status"] == "private"
    assert upload["publish_at"] == expected


@pytest.mark.parametrize(
    "changes",
    [
        {"title": " "},
        {"channel_id": "not-connected"},
        {"project_revision": "b" * 64},
        {"path": "/some/file"},
        {"publish_at": "2020-01-01T12:00:00Z"},
        {"publish_at": "2090-01-01T12:00:00"},
        {"publish_at": "2090-01-01T12:00:00Z", "privacy_status": "public"},
    ],
)
def test_invalid_or_stale_requests_do_not_start_work(prepared, changes):
    response = prepared["client"].post(
        "/api/studio/publish", json={**prepared["payload"], **changes}
    )
    assert response.status_code in {404, 409, 422}
    assert prepared["queued"] == []


def test_missing_saved_edit_cannot_publish_the_library_source(prepared):
    prepared["manifest"].unlink()
    response = prepared["client"].post("/api/studio/publish", json=prepared["payload"])
    assert response.status_code == 409
    assert "save" in response.json()["detail"].lower()
    assert prepared["queued"] == []


def test_double_clicks_and_fresh_requests_do_not_duplicate_an_edit(prepared):
    first = create(prepared)
    repeated = create(prepared)
    fresh = create(prepared, request_id=str(uuid4()), title="Changed details")
    assert first["id"] == repeated["id"] == fresh["id"]
    assert fresh["title"] == prepared["payload"]["title"]
    assert prepared["queued"] == [first["id"]]


def test_concurrent_submissions_claim_one_render(prepared):
    def submit(_):
        payload = publishing.PublishRequest(
            **{**prepared["payload"], "request_id": str(uuid4())}
        )
        return publishing.publish(payload, BackgroundTasks())

    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = list(pool.map(submit, range(2)))
    assert jobs[0]["id"] == jobs[1]["id"]
    with db.connect() as conn:
        assert (
            conn.execute("SELECT COUNT(*) FROM studio_publications").fetchone()[0] == 1
        )


def test_queued_cancellation_cannot_upload(prepared):
    job = create(prepared)
    response = prepared["client"].post(f"/api/studio/publications/{job['id']}/cancel")
    assert response.json()["status"] == "cancelled"
    publishing._run(job["id"])
    assert prepared["rendered"] == prepared["sent"] == []


# Extended by /ship test coverage audit.
# Value: protects=unsafe saved edits stop before native export or upload;
# fails_when=snapshot digest or missing-input guards are removed;
# why_new=the existing render-failure fixture bypassed real renderer guards;
# seam=none; no_claim=native export and provider acceptance (RPC/uploader mocked).
@pytest.mark.parametrize("failure", ["effect", "snapshot", "missing-input"])
def test_render_failure_has_retry_and_never_uploads_source(
    prepared, monkeypatch, failure
):
    real_render = publishing._render
    missing = prepared["manifest"].parent / "missing.mp4"
    if failure == "missing-input":
        prepared["manifest"].write_text(
            json.dumps({"media": [{"path": str(missing)}], "fonts": []})
        )
        prepared["payload"]["project_revision"] = hashlib.sha256(
            prepared["manifest"].read_bytes()
        ).hexdigest()
    if failure == "effect":
        monkeypatch.setattr(
            publishing,
            "_render",
            lambda _: (_ for _ in ()).throw(RuntimeError("Missing effect")),
        )
    else:
        monkeypatch.setattr(concat, "find_binary", lambda: "unused-renderer")
        monkeypatch.setattr(
            publishing,
            "ConcatRPC",
            lambda *args: pytest.fail("Unsafe edit started a native export"),
        )
        monkeypatch.setattr(publishing, "_render", REAL_RENDER)
    job = create(prepared)
    snapshot = publishing._folder(job["id"]) / "project/concat.json"
    original = snapshot.read_bytes()
    if failure == "snapshot":
        snapshot.write_text('{"name":"Unreviewed replacement"}')
    publishing._run(job["id"])
    failed = publishing.get_publication(job["id"])
    assert failed["status"] == "failed" and failed["retryable"]
    expected = {
        "effect": "Missing effect",
        "snapshot": "snapshot changed",
        "missing-input": "file used by this edit is missing",
    }
    assert expected[failure] in failed["error"]
    assert prepared["sent"] == []
    snapshot.write_bytes(original)
    if failure == "missing-input":
        missing.write_bytes(playable_video())
    monkeypatch.setattr(publishing, "_render", real_render)
    response = prepared["client"].post(f"/api/studio/publications/{job['id']}/retry")
    assert response.json()["id"] == job["id"]
    publishing._run(job["id"])
    assert len(prepared["sent"]) == 1


def test_upload_retry_reuses_finished_file_without_rendering_again(
    prepared, monkeypatch
):
    job = create(prepared)
    publishing._run(job["id"])
    row = publishing._row(job["id"])
    youtube_uploads._update(
        row["upload_id"], status="failed", retryable=1, error="Connection lost"
    )
    resumed = []
    monkeypatch.setattr(youtube_uploads, "_schedule_upload", resumed.append)
    response = prepared["client"].post(f"/api/studio/publications/{job['id']}/retry")
    assert response.status_code == 200
    assert resumed == [row["upload_id"]]
    assert len(prepared["rendered"]) == 1


def test_expired_schedule_after_render_never_becomes_publish_now(prepared, monkeypatch):
    when = datetime.now(timezone.utc) + timedelta(hours=1)
    real_render = publishing._render

    class LateClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return when + timedelta(minutes=1)

    def late_render(row):
        path = real_render(row)
        monkeypatch.setattr(youtube_uploads, "datetime", LateClock)
        return path

    monkeypatch.setattr(publishing, "_render", late_render)
    job = create(prepared, publish_at=when.isoformat())
    publishing._run(job["id"])
    row = publishing._row(job["id"])
    assert row["status"] == "failed"
    assert row["asset_id"] and not row["upload_id"]
    assert "scheduled time passed" in row["error"]
    assert prepared["sent"] == []


def test_interrupted_final_upload_blocks_a_new_duplicate_attempt(prepared):
    job = create(prepared)
    publishing._run(job["id"])
    row = publishing._row(job["id"])
    youtube_uploads._update(
        row["upload_id"], status="failed", retryable=1, final_attempted=1
    )
    duplicate = create(prepared, request_id=str(uuid4()), title="Another attempt")
    assert duplicate["id"] == job["id"]
    assert len(prepared["queued"]) == 1


def test_new_time_can_replace_a_failed_attempt_that_never_finished_uploading(prepared):
    job = create(prepared)
    publishing._run(job["id"])
    row = publishing._row(job["id"])
    youtube_uploads._update(
        row["upload_id"], status="failed", retryable=0, final_attempted=0
    )
    another = create(
        prepared, request_id=str(uuid4()), publish_at="2090-01-01T12:00:00+05:00"
    )
    assert another["id"] != job["id"]


def test_recovery_preserves_snapshot_and_existing_upload_identity(prepared):
    job = create(prepared)
    publishing._update(job["id"], status="rendering")
    publishing.recover_publications()
    row = publishing._row(job["id"])
    assert row["status"] == "failed" and row["retryable"]
    assert (publishing._folder(job["id"]) / "project/concat.json").is_file()
    prepared["client"].post(f"/api/studio/publications/{job['id']}/retry")
    publishing._run(job["id"])
    upload_id = publishing._row(job["id"])["upload_id"]
    youtube_uploads.recover_uploads()
    publishing.recover_publications()
    assert publishing._row(job["id"])["upload_id"] == upload_id
    assert publishing.get_publication(job["id"])["retryable"]


def test_queue_is_bounded_before_another_snapshot_is_created(prepared, monkeypatch):
    monkeypatch.setattr(publishing, "MAX_PENDING", 1)
    create(prepared)
    prepared["manifest"].write_text('{"name":"A new edit"}')
    revision = hashlib.sha256(prepared["manifest"].read_bytes()).hexdigest()
    response = prepared["client"].post(
        "/api/studio/publish",
        json={
            **prepared["payload"],
            "request_id": str(uuid4()),
            "project_revision": revision,
        },
    )
    assert response.status_code == 429
    assert len(prepared["queued"]) == 1


def test_shutdown_does_not_start_queued_media_work(prepared):
    job = create(prepared)
    publishing.stop_publications()
    publishing._run(job["id"])
    assert publishing._row(job["id"])["status"] == "failed"
    assert prepared["rendered"] == prepared["sent"] == []


@pytest.mark.skipif(
    os.getenv("SHORTFORGE_TEST_NATIVE_CONCAT") != "1",
    reason="Opt-in real local Concat render",
)
def test_real_concat_saved_edit_renders_and_hands_exact_mp4_to_mock_youtube(
    prepared, monkeypatch
):
    # Use the real renderer and uploader only inside this generated project.
    monkeypatch.setattr(publishing, "_render", REAL_RENDER)
    monkeypatch.setattr(youtube_uploads, "_run_upload", REAL_RUN_UPLOAD)
    data_dir = db.DATA_DIR
    publishing._STOP.clear()
    source = data_dir / "fixture.mp4"
    subprocess.run(
        [
            media.find_ffmpeg(),
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=purple:s=160x90:r=10:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(source),
        ],
        check=True,
        capture_output=True,
    )
    project = prepared["manifest"].parent
    prepared["manifest"].unlink()
    binary = concat.find_binary()
    assert binary is not None
    with ConcatRPC(binary, concat.rpc_env()) as rpc:
        rpc.call(
            "project_create",
            {
                "location": str(project.parent),
                "name": "edit",
                "video": {"width": 160, "height": 284, "rateNum": 30, "rateDen": 1},
            },
        )
        imported = rpc.call("media_import", {"path": str(project), "file": str(source)})
        track = imported["timeline"]["tracks"][0]["id"]
        placed = rpc.call(
            "clip_add",
            {
                "path": str(project),
                "mediaId": imported["createdId"],
                "trackId": track,
                "start": 0,
            },
        )
        rpc.call(
            "clip_trim",
            {
                "path": str(project),
                "clipId": placed["createdId"],
                "edge": "end",
                "delta": -0.5,
            },
        )
        rpc.call("project_save", {"path": str(project)})
        rpc.call("project_close", {"path": str(project), "save": True})
    original = prepared["manifest"].read_bytes()
    queued = []
    monkeypatch.setattr(publishing, "_submit", queued.append)
    monkeypatch.setattr(
        youtube_uploads.youtube_auth,
        "get_channel",
        lambda _: {"id": CHANNEL, "title": "Fixture channel"},
    )
    monkeypatch.setattr(
        youtube_uploads.youtube_auth, "get_access_token", lambda _: "fixture-token"
    )
    received = []

    def provider(request):
        if request.url.path.endswith("/channels"):
            return httpx.Response(200, json={"items": [{"id": CHANNEL}]})
        if request.method == "POST":
            return httpx.Response(
                200,
                headers={
                    "Location": "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture"
                },
            )
        received.append(request.content)
        return httpx.Response(
            201, json={"id": VIDEO_ID, "status": {"privacyStatus": "private"}}
        )

    monkeypatch.setattr(
        youtube_uploads.httpx,
        "Client",
        lambda **kwargs: REAL_HTTP_CLIENT(
            transport=httpx.MockTransport(provider), **kwargs
        ),
    )
    revision = hashlib.sha256(original).hexdigest()
    payload = publishing.PublishRequest(
        **{**prepared["payload"], "project_revision": revision}
    )
    job = publishing.publish(payload, BackgroundTasks())
    publishing._run(job["id"])
    row = publishing._row(job["id"])
    assert row["upload_id"], row
    output = db.resolve_data_path(db.get_asset(row["asset_id"])["path"])
    from engine.studio.editor_media import probe_media

    info = probe_media(output)
    assert (info["width"], info["height"]) == (160, 284)
    assert info["has_audio"] and 0.45 <= info["duration"] <= 0.65
    subprocess.run(
        [
            media.find_ffmpeg(),
            "-v",
            "error",
            "-xerror",
            "-i",
            str(output),
            "-f",
            "null",
            "-",
        ],
        check=True,
        capture_output=True,
    )
    assert b"".join(received) == output.read_bytes()
    assert prepared["manifest"].read_bytes() == original
    upload = youtube_uploads._row(row["upload_id"])
    assert upload["video_id"] == VIDEO_ID and upload["status"] == "processing"
