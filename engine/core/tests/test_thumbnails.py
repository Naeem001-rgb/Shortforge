"""Exercise missing/expired Reel covers and the actual cached image response."""

from io import BytesIO
import json
from threading import Event, Lock
from types import SimpleNamespace

import anyio
import httpx
from PIL import Image
import pytest

from engine.core import db, thumbnails
from engine.core.app import app

# The `client` fixture comes from conftest.py; pytest supplies it automatically.
from engine.core.tests.test_source_urls import import_reel


CDN = "https://scontent.cdninstagram.com/cover.jpg?token=fresh"


def image_bytes():
    output = BytesIO()
    Image.new("RGB", (800, 1200), "green").save(output, "PNG")
    return output.getvalue()


def mock_lookup(monkeypatch, url=CDN):
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=0, stdout=json.dumps(url))

    monkeypatch.setattr(thumbnails.subprocess, "run", run)
    return calls


def mock_cdn(monkeypatch, *, expired=False, body=None):
    calls = []

    def stream(method, url, **kwargs):
        calls.append(url)
        assert kwargs["follow_redirects"] is False
        return httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    403 if expired and "expired" in str(request.url) else 200,
                    content=image_bytes() if body is None else body,
                )
            )
        ).stream(method, url)

    monkeypatch.setattr(thumbnails.httpx, "stream", stream)
    return calls


def test_missing_cover_recovers_and_stays_cached_offline(client, monkeypatch):
    clip = import_reel(client)
    lookups = mock_lookup(monkeypatch)
    requests = mock_cdn(monkeypatch)
    response = client.get(clip["thumbnail_url"])
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    with Image.open(BytesIO(response.content)) as image:
        assert image.size == (427, 640)
    assert "--skip-download" in lookups[0]
    assert lookups[0][-1] == clip["url"]
    assert client.get(clip["thumbnail_url"]).content == response.content
    assert len(lookups) == len(requests) == 1
    assert (
        client.get("/api/clips").json()["clips"][0]["thumbnail_url"]
        == clip["thumbnail_url"]
    )
    assert (
        client.get(f"/api/clips/{clip['id']}").json()["thumbnail_url"]
        == clip["thumbnail_url"]
    )
    assert client.delete(f"/api/clips/{clip['id']}").status_code == 200
    assert not thumbnails.cache_path(clip["id"]).exists()
    assert client.get(clip["thumbnail_url"]).status_code == 404


def test_expired_cover_is_refreshed(client, monkeypatch):
    clip = import_reel(client, thumbnail_url=CDN.replace("fresh", "expired"))
    lookups = mock_lookup(monkeypatch)
    requests = mock_cdn(monkeypatch, expired=True)
    assert client.get(clip["thumbnail_url"]).status_code == 200
    assert len(requests) == 2
    assert len(lookups) == 1


def test_supplied_cover_needs_no_metadata_lookup_and_reimport_repairs_old_row(
    client, monkeypatch
):
    clip = import_reel(client)
    again = import_reel(client, thumbnail_url=CDN)
    assert again["id"] == clip["id"]
    assert db.get_clip(clip["id"])["thumbnail_url"] == CDN
    monkeypatch.setattr(
        thumbnails, "remote_thumbnail", lambda _: pytest.fail("Cover already supplied")
    )
    mock_cdn(monkeypatch)
    assert client.get(clip["thumbnail_url"]).status_code == 200


@pytest.mark.parametrize(
    "url,body",
    [
        ("https://127.0.0.1/private", b"ignored"),
        (CDN, b"<html>Sign in</html>"),
        (CDN, b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
    ],
)
def test_invalid_images_are_not_served_or_cached(client, monkeypatch, url, body):
    clip = import_reel(client)
    mock_lookup(monkeypatch, url)
    requests = mock_cdn(monkeypatch, body=body)
    response = client.get(clip["thumbnail_url"])
    assert response.status_code == 404
    assert response.headers["cache-control"] == "no-store"
    assert not thumbnails.cache_path(clip["id"]).exists()
    if "127.0.0.1" in url:
        assert requests == []


def test_queued_thumbnails_leave_workers_for_health_checks(client, monkeypatch):
    # Use distinct lock stripes so all three lookup slots can be exercised.
    clips, stripes = [], set()
    for index in range(100):
        clip_id = f"thumbnail-{index}"
        stripe = int(thumbnails.cache_path(clip_id).stem[:8], 16) % len(
            thumbnails._locks
        )
        if stripe not in stripes:
            stripes.add(stripe)
            clips.append(clip_id)
        if len(clips) == 6:
            break
    with db.connect() as conn:
        conn.executemany(
            "INSERT INTO clips(id,video_id,url,created_at) VALUES(?,?,?,?)",
            [
                (
                    clip_id,
                    f"ig:Fixture{index}",
                    f"https://www.instagram.com/reel/Fixture{index}/",
                    db.now(),
                )
                for index, clip_id in enumerate(clips)
            ],
        )
    release, occupied = Event(), Event()
    lock = Lock()
    active = 0

    def unavailable(_):
        nonlocal active
        with lock:
            active += 1
            if active == 3:
                occupied.set()
        assert release.wait(5)
        raise ValueError("Unavailable fixture thumbnail")

    monkeypatch.setattr(thumbnails, "remote_thumbnail", unavailable)

    async def exercise():
        # Three thumbnails may work; a fourth default worker stays available.
        limiter = anyio.to_thread.current_default_thread_limiter()
        original = limiter.total_tokens
        limiter.total_tokens = 4
        responses = []
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://localhost"
            ) as session:

                async def request(clip_id):
                    responses.append(
                        await session.get(f"/api/clips/{clip_id}/thumbnail")
                    )

                async with anyio.create_task_group() as group:
                    try:
                        for clip_id in clips:
                            group.start_soon(request, clip_id)
                        with anyio.fail_after(3):
                            while not occupied.is_set():
                                await anyio.sleep(0.005)
                        with anyio.fail_after(1):
                            response = await session.get("/api/health")
                        assert response.status_code == 200
                    finally:
                        release.set()
            assert len(responses) == len(clips)
            assert all(response.status_code == 404 for response in responses)
            assert all(
                response.headers["cache-control"] == "no-store"
                for response in responses
            )
        finally:
            limiter.total_tokens = original

    anyio.run(exercise)
