"""Admission and disk limits protect the engine while keeping recovery usable."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from types import SimpleNamespace

from engine.core import db, http_security
from engine.core.tests.test_core import playable_video, import_one
from engine.studio import editor_media


def test_full_storage_blocks_growth_but_allows_reads_deletion_and_reconnection(
    client, monkeypatch
):
    clip = import_one(client)
    monkeypatch.setattr(
        http_security.shutil, "disk_usage", lambda path: SimpleNamespace(free=0)
    )
    assert client.put("/api/settings", json={"niche": "more data"}).status_code == 507
    assert client.get("/api/clips").status_code == 200
    assert (
        client.post("/api/clips/delete-bulk", json={"ids": [clip["id"]]}).status_code
        == 200
    )
    assert client.get("/api/clips").json()["clips"] == []
    from engine.core import security

    code = security.create_pairing()
    assert (
        client.post(
            "/api/security/pair",
            headers={"Authorization": "", "Origin": "http://127.0.0.1:8787"},
            json={"code": code},
        ).status_code
        == 200
    )


def test_busy_media_workers_leave_health_available_and_reject_extra_work(
    client, monkeypatch
):
    video = playable_video()
    occupied, release = Event(), Event()
    lock = Lock()
    active = 0

    def probe(path):
        nonlocal active
        with lock:
            active += 1
            if active == 2:
                occupied.set()
        assert release.wait(10)
        return {
            "media_type": "video",
            "duration": 1,
            "width": 64,
            "height": 64,
            "has_audio": False,
        }

    monkeypatch.setattr(editor_media, "probe_media", probe)
    monkeypatch.setattr(editor_media, "normalize_browser_video", lambda path: path)

    def upload():
        return client.post(
            "/api/upload", files={"file": ("fixture.mp4", video, "video/mp4")}
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(upload) for _ in range(2)]
        try:
            assert occupied.wait(5)
            assert upload().status_code == 429
            assert client.get("/api/health").status_code == 200
        finally:
            release.set()
        assert all(job.result().status_code == 200 for job in jobs)
    with db.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM clips").fetchone()[0] == 2
