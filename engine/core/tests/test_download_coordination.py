"""Source acquisition is shared by Library requests and native Studio."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

from fastapi import BackgroundTasks, HTTPException
import pytest

from engine.core import concat, db, media, routes
from engine.core.tests.test_core import import_one, playable_video


def test_studio_waits_for_the_api_download_without_holding_a_writer_lock(
    client, monkeypatch
):
    clip = import_one(client)
    path = db.DATA_DIR / "shared-source.mp4"
    source = playable_video()
    started, waiting, release = Event(), Event(), Event()
    downloads = []
    get_job = db.get_job

    def download(job_id, clip_id):
        downloads.append(job_id)
        db.update_job(job_id, status="running", progress=20)
        started.set()
        assert release.wait(5)
        path.write_bytes(source)
        asset = db.add_asset(clip_id, "source", path)
        db.update_job(job_id, status="completed", progress=100, result={"asset": asset})

    def observe_job(job_id):
        job = get_job(job_id)
        if job["status"] == "running":
            waiting.set()
        return job

    monkeypatch.setattr(media, "download_job", download)
    monkeypatch.setattr(db, "get_job", observe_job)
    endpoint = f"/api/clips/{clip['id']}/download"
    with ThreadPoolExecutor(max_workers=3) as pool:
        api = pool.submit(client.post, endpoint)
        try:
            assert started.wait(3)
            studio = pool.submit(concat.source_for_clip, clip["id"], lambda _: None)
            assert waiting.wait(3)
            assert not studio.done()
            update = pool.submit(
                client.patch,
                f"/api/clips/{clip['id']}",
                json={"title": "Saved while Studio waits"},
            )
            assert update.result(timeout=3).status_code == 200
            assert len(downloads) == 1
        finally:
            release.set()
        response = api.result(timeout=5)
        assert response.status_code == 200
        assert studio.result(timeout=5) == path
    assert client.post(endpoint).json()["id"] == response.json()["id"]
    assert concat.source_for_clip(clip["id"], lambda _: None) == path
    assert downloads == [response.json()["id"]]
    assert len(client.get(f"/api/clips/{clip['id']}").json()["assets"]) == 1
    assert db.get_clip(clip["id"])["license_status"] == "unknown"


def test_api_reuses_the_download_claimed_by_studio(client, monkeypatch):
    clip = import_one(client)
    path = db.DATA_DIR / "studio-source.mp4"
    source = playable_video()
    started, release = Event(), Event()
    downloads = []

    def download(job_id, clip_id):
        downloads.append(job_id)
        db.update_job(job_id, status="running")
        started.set()
        assert release.wait(5)
        path.write_bytes(source)
        asset = db.add_asset(clip_id, "source", path)
        db.update_job(job_id, status="completed", progress=100, result={"asset": asset})

    monkeypatch.setattr(media, "download_job", download)
    with ThreadPoolExecutor(max_workers=1) as pool:
        studio = pool.submit(concat.source_for_clip, clip["id"], lambda _: None)
        try:
            assert started.wait(3)
            response = client.post(f"/api/clips/{clip['id']}/download")
            assert response.status_code == 200
            assert response.json()["status"] == "running"
            assert downloads == [response.json()["id"]]
        finally:
            release.set()
        assert studio.result(timeout=5) == path
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 1


@pytest.mark.parametrize(
    "outcome", ["completed", "failed", "job-deleted", "clip-deleted"]
)
def test_studio_observes_the_queued_owners_result(client, monkeypatch, outcome):
    clip = import_one(client)
    background = BackgroundTasks()
    queued = routes.download(clip["id"], background)
    path = db.DATA_DIR / "queued-source.mp4"
    source = playable_video()
    downloads = []

    def download(*_):
        pytest.fail("Studio must not run a download already queued by the API")

    def finish(_):
        downloads.append(queued["id"])
        if outcome == "completed":
            path.write_bytes(source)
            asset = db.add_asset(clip["id"], "source", path)
            db.update_job(
                queued["id"], status="completed", progress=100, result={"asset": asset}
            )
        elif outcome == "failed":
            db.update_job(
                queued["id"], status="failed", error="Stored download failure"
            )
        elif outcome == "job-deleted":
            with db.connect() as conn:
                conn.execute("DELETE FROM jobs WHERE id=?", (queued["id"],))
        else:
            db.delete_clip(clip["id"])

    monkeypatch.setattr(media, "download_job", download)
    monkeypatch.setattr(
        concat, "time", SimpleNamespace(monotonic=lambda: 0, sleep=finish)
    )
    assert len(background.tasks) == 1
    if outcome == "completed":
        assert concat.source_for_clip(clip["id"], lambda _: None) == path
    elif outcome == "failed":
        with pytest.raises(RuntimeError, match="Stored download failure"):
            concat.source_for_clip(clip["id"], lambda _: None)
    else:
        with pytest.raises(HTTPException) as error:
            concat.source_for_clip(clip["id"], lambda _: None)
        assert error.value.status_code == 404
    assert downloads == [queued["id"]]


def test_studio_wait_timeout_does_not_cancel_or_duplicate_the_owner(
    client, monkeypatch
):
    clip = import_one(client)
    job = db.new_job("download", clip["id"])
    clock = SimpleNamespace(now=0.0)
    waits = []

    def advance(seconds):
        waits.append(seconds)
        clock.now += seconds

    monkeypatch.setattr(concat, "SOURCE_WAIT_SECONDS", 1.25)
    monkeypatch.setattr(
        concat, "time", SimpleNamespace(monotonic=lambda: clock.now, sleep=advance)
    )
    monkeypatch.setattr(
        media, "download_job", lambda *_: pytest.fail("Another request owns this job")
    )
    with pytest.raises(RuntimeError, match="still downloading"):
        concat.source_for_clip(clip["id"], lambda _: None)
    assert sum(waits) == 1.25
    assert db.get_job(job["id"])["status"] == "queued"
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 1


@pytest.mark.parametrize("invalid", [False, True])
def test_studio_revalidates_the_source_after_a_shared_download(
    client, monkeypatch, invalid
):
    clip = import_one(client)
    job = db.new_job("download", clip["id"])

    def finish(_):
        result = None
        if invalid:
            path = db.DATA_DIR / "invalid.mp4"
            path.write_bytes(b"not a readable video")
            result = {"asset": db.add_asset(clip["id"], "source", path)}
        db.update_job(job["id"], status="completed", progress=100, result=result)

    monkeypatch.setattr(
        concat, "time", SimpleNamespace(monotonic=lambda: 0, sleep=finish)
    )
    monkeypatch.setattr(
        media, "download_job", lambda *_: pytest.fail("Another request owns this job")
    )
    with pytest.raises(ValueError if invalid else HTTPException):
        concat.source_for_clip(clip["id"], lambda _: None)


def test_deleting_a_clip_during_source_validation_cannot_claim_a_download(
    client, monkeypatch
):
    clip = import_one(client)
    get_source = media.get_source

    def deleted_source(clip_id):
        db.delete_clip(clip_id)
        return get_source(clip_id)

    monkeypatch.setattr(media, "get_source", deleted_source)
    with pytest.raises(HTTPException) as error:
        media.claim_download(clip["id"])
    assert error.value.status_code == 404
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0
