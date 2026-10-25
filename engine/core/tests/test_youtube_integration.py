"""Exercise the mounted local API from channel consent through upload completion."""

import json
from urllib.parse import parse_qs, urlsplit

import httpx

from engine.core import db, youtube_auth, youtube_uploads


def test_connected_channel_can_publish_saved_export_through_app(client, monkeypatch):
    channel_id = "UC" + "a" * 22
    video_id = "Published01"
    session_url = (
        "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture"
    )
    requests = []
    rendered = b"finished video with the user's captions and audio"

    def google(request):
        requests.append(request)
        if request.url.path == "/token":
            return httpx.Response(
                200,
                json={
                    "access_token": "fixture-access",
                    "refresh_token": "fixture-refresh",
                    "expires_in": 3600,
                    "scope": " ".join(youtube_auth.SCOPES),
                },
            )
        assert request.headers["Authorization"] == "Bearer fixture-access"
        if request.url.path.endswith("/channels"):
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": channel_id,
                            "snippet": {"title": "My intended channel"},
                        }
                    ]
                },
            )
        if request.method == "POST":
            body = json.loads(request.content)
            assert body["snippet"]["title"] == "Reviewed title"
            assert body["snippet"]["tags"] == ["science", "short story"]
            assert body["status"]["privacyStatus"] == "private"
            return httpx.Response(200, headers={"Location": session_url})
        if request.method == "PUT":
            assert request.content == rendered
            return httpx.Response(
                201,
                json={
                    "id": video_id,
                    "snippet": {"channelId": channel_id},
                    "status": {"privacyStatus": "private"},
                },
            )
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "id": video_id,
                        "status": {
                            "uploadStatus": "processed",
                            "privacyStatus": "private",
                        },
                        "processingDetails": {"processingStatus": "succeeded"},
                    }
                ]
            },
        )

    real_client = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: real_client(
            transport=httpx.MockTransport(google),
            **kwargs,
        ),
    )
    monkeypatch.setattr(
        youtube_uploads, "_schedule_upload", youtube_uploads._run_upload
    )

    assert (
        client.put(
            "/api/youtube/config",
            json={
                "client_id": "fixture.apps.googleusercontent.com",
                "client_secret": "fixture-secret",
            },
        ).status_code
        == 200
    )
    authorization = client.post("/api/youtube/oauth/start").json()["authorization_url"]
    state = parse_qs(urlsplit(authorization).query)["state"][0]
    callback = client.get(
        "/api/youtube/oauth/callback",
        params={"state": state, "code": "fixture-code"},
        headers={"sec-fetch-site": "cross-site"},
    )
    assert callback.status_code == 200
    assert client.get("/api/youtube/channels").json()["channels"][0]["id"] == channel_id

    imported = client.post(
        "/api/clips",
        json={
            "clips": [
                {
                    "url": "https://www.youtube.com/shorts/abcdefghijk",
                    "title": "Finished video",
                }
            ]
        },
    )
    assert imported.status_code == 200, imported.text
    clip = imported.json()["clips"][0]
    path = db.DATA_DIR / "finished.mp4"
    path.write_bytes(rendered)
    asset = db.add_asset(clip["id"], "export", path)
    payload = {
        "clip_id": clip["id"],
        "asset_id": asset["id"],
        "channel_id": channel_id,
        "title": "Reviewed title",
        "description": "Reviewed description",
        "tags": ["science", "short story"],
        "privacy_status": "private",
        "self_declared_made_for_kids": False,
        "contains_synthetic_media": False,
    }
    created = client.post("/api/youtube/uploads", json=payload)
    assert created.status_code == 200, created.text
    upload_id = created.json()["id"]
    complete = client.get(f"/api/youtube/uploads/{upload_id}").json()
    assert complete["status"] == "completed"
    assert complete["video_url"] == f"https://www.youtube.com/watch?v={video_id}"
    assert complete["channel_title"] == "My intended channel"
    assert complete["privacy_status"] == "private"
    duplicate = client.post("/api/youtube/uploads", json=payload)
    assert duplicate.json()["id"] == upload_id
    assert sum(request.method == "PUT" for request in requests) == 1
    history = client.get("/api/youtube/uploads", params={"clip_id": clip["id"]})
    assert history.json()["uploads"][0]["status"] == "completed"
    for response in (created, history, client.get("/api/settings")):
        assert "fixture-access" not in response.text
        assert "fixture-refresh" not in response.text
        assert "fixture-secret" not in response.text
        assert "upload_id=fixture" not in response.text
