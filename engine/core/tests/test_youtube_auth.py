"""OAuth tests use a transport double; no Google request leaves the machine."""

import base64
import hashlib
import json
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException
import httpx
import pytest

from engine.core import db, youtube_auth as auth


CHANNEL_ID = "UC" + "a" * 22
OTHER_CHANNEL = "UC" + "b" * 22
CREDENTIALS = {
    "client_id": "local-client.apps.googleusercontent.com",
    "client_secret": "desktop-client-secret",
}


@pytest.fixture
def google(monkeypatch):
    responses = {
        "token": {
            "access_token": "access-token-private",
            "refresh_token": "refresh-token-private",
            "expires_in": 3600,
            "token_type": "Bearer",
            "scope": " ".join(auth.SCOPES),
        },
        "identity": {
            "items": [
                {
                    "id": CHANNEL_ID,
                    "snippet": {
                        "title": "My chosen channel",
                        "thumbnails": {
                            "default": {"url": "https://yt3.ggpht.com/example"}
                        },
                    },
                }
            ],
        },
        "requests": [],
        "token_status": 200,
    }

    def handle(request):
        responses["requests"].append(request)
        if request.url == auth.TOKEN_URL:
            return httpx.Response(responses["token_status"], json=responses["token"])
        assert request.url.path == "/youtube/v3/channels"
        assert request.url.params["mine"] == "true"
        assert request.url.params["part"] == "snippet"
        assert "access_token" not in request.url.params
        assert (
            request.headers["Authorization"]
            == "Bearer " + responses["token"]["access_token"]
        )
        return httpx.Response(200, json=responses["identity"])

    monkeypatch.setattr(
        auth, "_client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    return responses


def start(client):
    assert client.put("/api/youtube/config", json=CREDENTIALS).status_code == 200
    response = client.post("/api/youtube/oauth/start", json={})
    assert response.status_code == 200, response.text
    return parse_qs(urlsplit(response.json()["authorization_url"]).query)


def connect(client):
    params = start(client)
    response = client.get(
        "/api/youtube/oauth/callback",
        params={"state": params["state"][0], "code": "authorization-code-private"},
    )
    assert response.status_code == 200, response.text
    return response


def test_configuration_is_local_and_redacted(client):
    status = client.get("/api/youtube/channels").json()
    assert status["configured"] is False
    assert status["channels"] == []
    assert client.post("/api/youtube/oauth/start", json={}).status_code == 409
    response = client.put("/api/youtube/config", json=CREDENTIALS)
    assert response.json() == {"configured": True}
    assert client.get("/api/youtube/channels").json()["configured"] is True
    settings = client.get("/api/settings")
    assert settings.json()["youtube_client_secret_set"] is True
    assert settings.json()["youtube_client_id_set"] is True
    for key in CREDENTIALS.values():
        assert key not in settings.text
        assert key not in response.text
    # The general settings route must not bypass connection invalidation.
    assert (
        client.put(
            "/api/settings", json={"youtube_client_secret": "replacement"}
        ).status_code
        == 422
    )
    assert db.get_settings()["youtube_client_secret"] == CREDENTIALS["client_secret"]


def test_pkce_channel_identity_and_single_use_callback(client, google):
    params = start(client)
    assert params["code_challenge_method"] == ["S256"]
    assert set(params["scope"][0].split()) == set(auth.SCOPES)
    assert params["access_type"] == ["offline"]
    assert "client_secret" not in params
    state = params["state"][0]
    callback = client.get(
        "/api/youtube/oauth/callback",
        params={"state": state, "code": "private-code"},
        headers={"sec-fetch-site": "cross-site"},
    )
    assert callback.status_code == 200
    exchange = parse_qs(google["requests"][0].content.decode())
    challenge = (
        base64.urlsafe_b64encode(
            hashlib.sha256(exchange["code_verifier"][0].encode()).digest()
        )
        .rstrip(b"=")
        .decode()
    )
    assert params["code_challenge"] == [challenge]
    assert exchange["code"] == ["private-code"]
    assert exchange["redirect_uri"] == params["redirect_uri"]
    status = client.get("/api/youtube/channels")
    assert status.json()["channels"] == [
        {
            "id": CHANNEL_ID,
            "title": "My chosen channel",
            "thumbnail_url": "https://yt3.ggpht.com/example",
        }
    ]
    assert set(auth.get_channel(CHANNEL_ID)) == {"id", "title", "thumbnail_url"}
    for secret in (
        "private-code",
        google["token"]["access_token"],
        google["token"]["refresh_token"],
        state,
        CREDENTIALS["client_secret"],
    ):
        assert secret not in callback.text
        assert secret not in status.text
    assert callback.headers["cache-control"] == "no-store"
    assert "default-src 'none'" in callback.headers["content-security-policy"]
    assert (
        client.get(
            "/api/youtube/oauth/callback",
            params={"state": state, "code": "private-code"},
        ).status_code
        == 400
    )
    assert len(google["requests"]) == 2


@pytest.mark.parametrize(
    "failure", ["expired", "denied", "missing-code", "unknown-state"]
)
def test_failed_callback_consumes_state_without_network_or_reflection(
    client, google, failure
):
    params = start(client)
    state = params["state"][0]
    request = {"state": state, "code": "private-code"}
    if failure == "expired":
        with db.connect() as conn:
            conn.execute("UPDATE youtube_oauth_states SET expires_at=0")
    elif failure == "denied":
        request["error"] = "access_denied<script>provider-secret</script>"
    elif failure == "missing-code":
        request.pop("code")
    else:
        request["state"] = "unknown-state"
    response = client.get("/api/youtube/oauth/callback", params=request)
    assert response.status_code == 400
    assert "provider-secret" not in response.text
    assert "private-code" not in response.text
    assert not google["requests"]
    if failure != "unknown-state":
        with db.connect() as conn:
            assert (
                conn.execute("SELECT count(*) FROM youtube_oauth_states").fetchone()[0]
                == 0
            )
        assert (
            client.get(
                "/api/youtube/oauth/callback",
                params={"state": state, "code": "another-code"},
            ).status_code
            == 400
        )


@pytest.mark.parametrize("scopes", [auth.SCOPES[0], auth.SCOPES[1], "", None])
def test_partial_permissions_never_save_channel(client, google, scopes):
    params = start(client)
    google["token"]["scope"] = scopes
    response = client.get(
        "/api/youtube/oauth/callback",
        params={"state": params["state"][0], "code": "private"},
    )
    assert response.status_code == 403
    assert "both permissions" in response.text
    assert client.get("/api/youtube/channels").json()["channels"] == []
    assert len(google["requests"]) == 1


def test_omitted_scope_means_the_requested_scopes(client, google):
    google["token"].pop("scope")
    connect(client)
    assert auth.get_access_token(CHANNEL_ID) == "access-token-private"


@pytest.mark.parametrize(
    "identity",
    [
        {"items": []},
        {"items": [{}, {}]},
        {"items": [{"id": "bad", "snippet": {"title": "bad"}}]},
    ],
)
def test_only_a_single_valid_authorized_channel_can_connect(client, google, identity):
    params = start(client)
    google["identity"] = identity
    response = client.get(
        "/api/youtube/oauth/callback",
        params={"state": params["state"][0], "code": "private"},
    )
    assert response.status_code in {409, 502}
    assert client.get("/api/youtube/channels").json()["channels"] == []


def test_refresh_reuses_refresh_grant_and_confirms_destination(client, google):
    connect(client)
    with db.connect() as conn:
        conn.execute("UPDATE youtube_channels SET expires_at=0")
    google["token"] = {
        "access_token": "refreshed-token-private",
        "expires_in": 3600,
        "token_type": "Bearer",
    }
    assert auth.get_access_token(CHANNEL_ID) == "refreshed-token-private"
    request = parse_qs(google["requests"][2].content.decode())
    assert request["grant_type"] == ["refresh_token"]
    assert request["refresh_token"] == ["refresh-token-private"]
    with db.connect() as conn:
        assert (
            conn.execute("SELECT refresh_token FROM youtube_channels").fetchone()[0]
            == "refresh-token-private"
        )
    assert auth.get_access_token(CHANNEL_ID) == "refreshed-token-private"
    assert len(google["requests"]) == 4  # Cached token needs no second refresh.


def test_refresh_must_not_change_channel(client, google):
    connect(client)
    with db.connect() as conn:
        conn.execute("UPDATE youtube_channels SET expires_at=0")
    google["identity"]["items"][0]["id"] = OTHER_CHANNEL
    google["token"]["access_token"] = "wrong-channel-token"
    with pytest.raises(HTTPException, match="different channel"):
        auth.get_access_token(CHANNEL_ID)
    with db.connect() as conn:
        assert (
            conn.execute("SELECT access_token FROM youtube_channels").fetchone()[0]
            == "access-token-private"
        )


def test_replacing_credentials_clears_connections_and_states(client, google):
    connect(client)
    params = start(client)  # Resaving identical credentials preserves the connection.
    assert len(client.get("/api/youtube/channels").json()["channels"]) == 1
    replacement = {**CREDENTIALS, "client_secret": "replacement-secret"}
    assert client.put("/api/youtube/config", json=replacement).status_code == 200
    assert client.get("/api/youtube/channels").json()["channels"] == []
    with pytest.raises(HTTPException):
        auth.get_access_token(CHANNEL_ID)
    assert (
        client.get(
            "/api/youtube/oauth/callback",
            params={"state": params["state"][0], "code": "private"},
        ).status_code
        == 400
    )
    assert len(google["requests"]) == 2


def test_changed_credentials_cannot_refresh_a_previous_grant(client, google):
    connect(client)
    with db.connect() as conn:
        conn.execute(
            "UPDATE settings SET value=? WHERE key='youtube_client_id'",
            (json.dumps("other.apps.googleusercontent.com"),),
        )
    with pytest.raises(HTTPException, match="credentials changed"):
        auth.get_access_token(CHANNEL_ID)
    assert client.get("/api/youtube/channels").json()["channels"] == []
    assert len(google["requests"]) == 2


def test_disconnect_removes_local_tokens_only(client, google):
    connect(client)
    assert client.delete(f"/api/youtube/channels/{CHANNEL_ID}").json() == {
        "disconnected": True
    }
    with db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM youtube_channels").fetchone()[0] == 0
    with pytest.raises(HTTPException):
        auth.get_access_token(CHANNEL_ID)
    assert len(google["requests"]) == 2


def test_provider_error_does_not_echo_tokens_credentials_or_code(client, google):
    params = start(client)
    google["token_status"] = 400
    google["token"] = {
        "error": "invalid_grant",
        "error_description": "desktop-client-secret private-code refresh-token-private",
    }
    response = client.get(
        "/api/youtube/oauth/callback",
        params={"state": params["state"][0], "code": "private-code"},
    )
    assert response.status_code == 401
    for secret in ("desktop-client-secret", "private-code", "refresh-token-private"):
        assert secret not in response.text
    assert client.get("/api/youtube/channels").json()["channels"] == []


def test_network_exception_is_sanitized(client, google, monkeypatch):
    params = start(client)

    def fail(request):
        raise httpx.ConnectError("desktop-client-secret private-code", request=request)

    monkeypatch.setattr(
        auth, "_client", lambda: httpx.Client(transport=httpx.MockTransport(fail))
    )
    response = client.get(
        "/api/youtube/oauth/callback",
        params={"state": params["state"][0], "code": "private-code"},
    )
    assert response.status_code == 502
    assert "desktop-client-secret" not in response.text
    assert "private-code" not in response.text


def test_callback_exception_does_not_open_other_cross_site_routes(client):
    response = client.get(
        "/api/youtube/channels", headers={"sec-fetch-site": "cross-site"}
    )
    assert response.status_code == 403
    response = client.post(
        "/api/youtube/oauth/start", json={}, headers={"origin": "https://evil.example"}
    )
    assert response.status_code == 403


def test_redirect_override_must_stay_on_the_loopback_callback(client, monkeypatch):
    monkeypatch.setenv(
        "SHORTFORGE_YOUTUBE_REDIRECT_URI",
        "https://evil.example/api/youtube/oauth/callback",
    )
    assert client.get("/api/youtube/channels").status_code == 503
    monkeypatch.setenv("SHORTFORGE_YOUTUBE_REDIRECT_URI", "http://[invalid-address")
    assert client.get("/api/youtube/channels").status_code == 503
    monkeypatch.setenv(
        "SHORTFORGE_YOUTUBE_REDIRECT_URI",
        "http://127.0.0.1:9191/api/youtube/oauth/callback",
    )
    assert (
        client.get("/api/youtube/channels")
        .json()["redirect_uri"]
        .startswith("http://127.0.0.1:9191/")
    )
