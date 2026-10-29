"""Batched local reads retain enrichment ordering and missing-clip errors."""

from fastapi import HTTPException
import httpx
import pytest

from engine.core import db, routes
from engine.core.tests.test_core import import_one


def test_enrichment_keeps_request_order_across_remote_batches(client, monkeypatch):
    videos = [f"vid{index:08d}" for index in range(60)]
    response = client.post(
        "/api/clips",
        json={"clips": [{"url": f"https://youtu.be/{video}"} for video in videos]},
    )
    assert response.status_code == 200
    clips = list(reversed(response.json()["clips"]))
    requests = []

    def lookup(url, *, params, timeout):
        batch = params["id"].split(",")
        requests.append(batch)
        # YouTube can return items in a different order from the request.
        return httpx.Response(
            200,
            request=httpx.Request("GET", url),
            json={
                "items": [
                    {
                        "id": video,
                        "snippet": {"title": f"Updated {video}"},
                        "statistics": {"likeCount": "25"},
                    }
                    for video in reversed(batch)
                ]
            },
        )

    monkeypatch.setattr(db, "get_settings", lambda: {"youtube_api_key": "fixture"})
    monkeypatch.setattr(routes.httpx, "get", lookup)
    # Duplicate requested IDs do not move the first occurrence or add API work.
    routes.enrich_clips([clips[0]["id"], *[clip["id"] for clip in clips]])
    expected = [clip["video_id"] for clip in clips]
    assert requests == [expected[:50], expected[50:]]
    for clip in clips:
        updated = db.get_clip(clip["id"])
        assert updated["title"] == f"Updated {clip['video_id']}"
        assert updated["likes"] == 25
        assert updated["views"] is None
        assert updated["license_status"] == "unknown"


@pytest.mark.parametrize("strict", [False, True])
def test_enrichment_missing_clip_fails_before_remote_work(client, monkeypatch, strict):
    clip = import_one(client)
    monkeypatch.setattr(
        routes.httpx, "get", lambda *_args, **_kwargs: pytest.fail("No remote lookup")
    )
    with pytest.raises(HTTPException) as error:
        routes.enrich_clips([clip["id"], "missing", clip["id"]], strict=strict)
    assert error.value.status_code == 404
    assert error.value.detail == "Clip not found."
    assert db.get_clip(clip["id"])["title"] == clip["title"]
