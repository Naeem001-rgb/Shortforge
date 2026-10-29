"""Concurrent extraction/transcription cannot schedule duplicate worker jobs."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from engine.core import db, media, script_extraction
from engine.core.tests.test_core import import_one, playable_video


@pytest.fixture
def source_clip(client, monkeypatch):
    clip = import_one(client)
    path = db.DATA_DIR / "source.mp4"
    path.write_bytes(playable_video())
    db.add_asset(clip["id"], "source", path)
    available = media.tool_available
    monkeypatch.setattr(
        media,
        "tool_available",
        lambda name: name == "faster_whisper" or available(name),
    )
    return clip


@pytest.mark.parametrize("kind", ["transcribe", "extract-script"])
def test_concurrent_requests_schedule_one_job_and_reject_the_duplicate(
    client, source_clip, monkeypatch, kind
):
    new_job = db.new_job
    ready = Barrier(2, timeout=3)
    started = []

    def create(*args, **kwargs):
        # Both requests reached creation before either can insert. A separate
        # earlier duplicate check would let both through this barrier.
        ready.wait()
        return new_job(*args, **kwargs)

    def worker(job_id, *_):
        started.append(job_id)

    monkeypatch.setattr(db, "new_job", create)
    monkeypatch.setattr(media, "transcribe_job", worker)
    monkeypatch.setattr(script_extraction, "extract_script_job", worker)
    endpoint = f"/api/clips/{source_clip['id']}/{kind}"
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: client.post(endpoint, json={}), range(2)))
    assert sorted(response.status_code for response in responses) == [200, 409]
    accepted = next(
        response.json() for response in responses if response.status_code == 200
    )
    rejected = next(
        response.json() for response in responses if response.status_code == 409
    )
    assert (
        rejected["detail"]
        == "This clip already has that job running. Wait for it to finish."
    )
    assert started == [accepted["id"]]
    with db.connect() as conn:
        jobs = conn.execute("SELECT id,status FROM jobs").fetchall()
    assert [dict(job) for job in jobs] == [{"id": accepted["id"], "status": "queued"}]


@pytest.mark.parametrize("kind", ["transcribe", "extract-script"])
def test_a_failed_job_can_be_retried(client, source_clip, monkeypatch, kind):
    started = []

    def worker(job_id, *_):
        started.append(job_id)
        db.update_job(job_id, status="failed", error="Fixture failure")

    monkeypatch.setattr(media, "transcribe_job", worker)
    monkeypatch.setattr(script_extraction, "extract_script_job", worker)
    endpoint = f"/api/clips/{source_clip['id']}/{kind}"
    responses = [client.post(endpoint, json={}) for _ in range(2)]
    assert all(response.status_code == 200 for response in responses)
    ids = [response.json()["id"] for response in responses]
    assert len(set(ids)) == 2
    assert started == ids
    assert all(db.get_job(job_id)["status"] == "failed" for job_id in ids)


@pytest.mark.parametrize("kind", ["transcribe", "extract-script"])
def test_deletion_before_claim_returns_not_found_without_scheduling(
    client, source_clip, monkeypatch, kind
):
    new_job = db.new_job

    def deleted(*args, **kwargs):
        db.delete_clip(source_clip["id"])
        return new_job(*args, **kwargs)

    monkeypatch.setattr(db, "new_job", deleted)
    monkeypatch.setattr(media, "transcribe_job", lambda *_: pytest.fail("No worker"))
    monkeypatch.setattr(
        script_extraction, "extract_script_job", lambda *_: pytest.fail("No worker")
    )
    response = client.post(f"/api/clips/{source_clip['id']}/{kind}", json={})
    assert response.status_code == 404
    assert response.json()["detail"] == "Clip not found."
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0
