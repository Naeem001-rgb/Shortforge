"""Regression tests for real access boundaries, encrypted storage and isolation."""

import json
import os
import re
import socket
import subprocess
import sys
from types import SimpleNamespace

import pytest

from engine.core import db, security, sandbox, media_runtime, youtube_auth
from engine.core.private_storage import PREFIX, key_directory

ORIGIN = "http://127.0.0.1:8787"
ANONYMOUS = {"Authorization": ""}


def saved_media(client):
    clip = client.post(
        "/api/clips",
        json={"clips": [{"video_id": "abcdefghijk", "title": "Private fixture"}]},
    ).json()["clips"][0]
    path = db.DATA_DIR / "private.mp4"
    path.write_bytes(b"private-media-fixture")
    return clip, db.add_asset(clip["id"], "source", path), path


def test_anonymous_clients_cannot_read_modify_or_delete_private_data(client):
    clip, asset, path = saved_media(client)
    for url in (
        "/api/clips",
        "/api/settings",
        f"/api/clips/{clip['id']}",
        f"/api/assets/{asset['id']}",
        "/api/security/session",
    ):
        assert client.get(url, headers=ANONYMOUS).status_code == 401
    assert (
        client.put(
            "/api/settings", headers=ANONYMOUS, json={"niche": "changed"}
        ).status_code
        == 401
    )
    assert (
        client.delete(f"/api/clips/{clip['id']}", headers=ANONYMOUS).status_code == 401
    )
    assert path.read_bytes() == b"private-media-fixture"
    assert db.get_clip(clip["id"])["title"] == "Private fixture"
    assert client.get("/api/health", headers=ANONYMOUS).status_code == 200


@pytest.mark.parametrize(
    "origin",
    [
        "https://attacker.example",
        "http://localhost:4444",
        "chrome-extension://" + "a" * 32,
        "null",
    ],
)
def test_unrelated_local_apps_and_extensions_are_not_trusted(client, origin):
    assert client.get("/api/clips", headers={"Origin": origin}).status_code == 403
    assert (
        client.post("/api/studio/open", headers={"Origin": origin}, json={}).status_code
        == 403
    )


def test_pairing_requires_a_private_origin_bound_single_use_code(client):
    code = security.create_pairing(ORIGIN)
    headers = {**ANONYMOUS, "Origin": ORIGIN}
    wrong = {**headers, "Origin": "http://localhost:8787"}
    assert (
        client.post(
            "/api/security/pair", json={"code": code}, headers=wrong
        ).status_code
        == 401
    )
    response = client.post("/api/security/pair", json={"code": code}, headers=headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    access = {"Authorization": "Bearer " + response.json()["token"], "Origin": ORIGIN}
    assert client.get("/api/clips", headers=access).status_code == 200
    assert (
        client.get(
            "/api/clips", headers={**access, "Origin": "http://localhost:8787"}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/security/pair", json={"code": code}, headers=headers
        ).status_code
        == 401
    )
    assert client.delete("/api/security/session", headers=access).status_code == 200
    assert client.get("/api/clips", headers=access).status_code == 401
    with security.connect() as connection:
        logged = json.dumps(
            [tuple(row) for row in connection.execute("SELECT * FROM audit")]
        )
        assert code not in logged and response.json()["token"] not in logged


def test_expired_pairing_link_fails_without_revealing_credentials(client):
    code = security.create_pairing(ORIGIN)
    with security.connect() as connection:
        connection.execute("UPDATE pairing SET expires_at=0")
    response = client.post(
        "/api/security/pair",
        json={"code": code},
        headers={**ANONYMOUS, "Origin": ORIGIN},
    )
    assert response.status_code == 401 and code not in response.text


def test_private_launch_file_keeps_the_code_out_of_process_arguments(client):
    path = security.launch_file()
    code = re.search(r"#connect=([A-Za-z0-9_-]{43})", path.read_text()).group(1)
    assert code not in path.as_uri()
    assert "#connect=" not in path.as_uri()
    if os.name != "nt":
        assert path.stat().st_mode & 0o777 == 0o600
        assert path.parent.stat().st_mode & 0o777 == 0o700
    response = client.post(
        "/api/security/pair",
        headers={**ANONYMOUS, "Origin": ORIGIN},
        json={"code": code},
    )
    assert response.status_code == 200
    assert not path.exists()


def test_scout_can_only_redeem_its_own_grant(client):
    web = security.local_client(ORIGIN)
    headers = {"Authorization": "Bearer " + web["token"], "Origin": ORIGIN}
    grant = client.post("/api/security/scout-grant", headers=headers).json()
    assert "chrome-extension://" + grant["extension_id"] == security.scout_origin()
    assert (
        client.post(
            "/api/security/pair",
            headers={**ANONYMOUS, "Origin": ORIGIN},
            json={"code": grant["code"]},
        ).status_code
        == 401
    )
    response = client.post(
        "/api/security/pair",
        headers={**ANONYMOUS, "Origin": security.scout_origin()},
        json={"code": grant["code"]},
    )
    assert response.status_code == 200
    extension = {
        "Authorization": "Bearer " + response.json()["token"],
        "Origin": security.scout_origin(),
    }
    assert client.get("/api/clips", headers=extension).status_code == 200
    assert (
        client.post("/api/security/scout-grant", headers=extension).status_code == 403
    )


def test_media_links_allow_one_file_only_and_expire_on_restart(client):
    _, asset, _ = saved_media(client)
    url = asset["url"]
    response = client.get(url, headers=ANONYMOUS)
    assert response.status_code == 200 and response.content == b"private-media-fixture"
    assert (
        client.get(
            url.replace(asset["id"], "another-file"), headers=ANONYMOUS
        ).status_code
        == 401
    )
    assert client.delete(url, headers=ANONYMOUS).status_code == 401
    security.start_session()
    assert client.get("/api/clips").status_code == 401
    assert client.get(url, headers=ANONYMOUS).status_code == 401
    client.headers["Authorization"] = "Bearer " + security.local_client()["token"]
    fresh = db.get_asset(asset["id"])["url"]
    assert client.get(fresh, headers=ANONYMOUS).status_code == 200


def test_reusing_a_completed_download_refreshes_its_media_link(client, monkeypatch):
    from engine.core.tests.test_core import playable_video

    clip, asset, path = saved_media(client)
    path.write_bytes(playable_video())
    job = db.new_job("download", clip["id"])
    db.update_job(job["id"], status="completed", progress=100, result={"asset": asset})
    monkeypatch.setattr(security, "_media_epoch", "a-new-engine-run")
    response = client.post(f"/api/clips/{clip['id']}/download")
    assert response.status_code == 200
    returned = response.json()
    assert returned["id"] == job["id"]
    assert returned["result"]["asset"]["url"] != asset["url"]
    assert (
        client.get(returned["result"]["asset"]["url"], headers=ANONYMOUS).status_code
        == 200
    )


@pytest.mark.parametrize(
    "content_type",
    [
        "application/json",
        "application/json; x=multipart/form-data",
        "application/json; boundary=multipart/form-data",
    ],
)
def test_json_size_limit_cannot_be_increased_with_header_parameters(
    client, content_type
):
    payload = b" " * (2 * 1024 * 1024) + b'{"niche":"oversized"}'
    assert (
        client.put(
            "/api/settings", content=payload, headers={"Content-Type": content_type}
        ).status_code
        == 413
    )
    assert db.get_settings()["niche"] != "oversized"


def test_dashboard_cannot_be_framed_and_has_no_external_script_permission(client):
    response = client.get("/")
    assert response.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
    assert "script-src 'self';" in response.headers["content-security-policy"]
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_settings_are_encrypted_and_reserved_prefix_is_treated_as_user_data(client):
    secret = PREFIX + "a-literal-user-key"
    assert (
        client.put("/api/settings", json={"gemini_api_key": secret}).status_code == 200
    )
    assert db.get_settings()["gemini_api_key"] == secret
    with db.connect() as connection:
        stored = json.loads(
            connection.execute(
                "SELECT value FROM settings WHERE key='gemini_api_key'"
            ).fetchone()[0]
        )
    assert stored.startswith(PREFIX) and secret not in stored
    assert not key_directory().resolve().is_relative_to(db.DATA_DIR.resolve())
    assert secret not in client.get("/api/settings").text


def test_legacy_secret_migration_preserves_values_and_clears_plaintext(client):
    youtube_auth.init_storage()
    with db.connect() as connection:
        connection.execute(
            "INSERT INTO settings VALUES(?,?)",
            ("gemini_api_key", json.dumps("legacy-private-key")),
        )
        connection.execute(
            "INSERT INTO youtube_channels VALUES(?,?,?,?,?,?,?,?,?)",
            (
                "channel",
                "Fixture",
                "",
                "legacy-access",
                "legacy-refresh",
                0,
                "",
                "",
                "now",
            ),
        )
    db.migrate_secrets()
    assert db.get_settings()["gemini_api_key"] == "legacy-private-key"
    with db.connect() as connection:
        access, refresh = connection.execute(
            "SELECT access_token,refresh_token FROM youtube_channels"
        ).fetchone()
    assert access.startswith(PREFIX) and refresh.startswith(PREFIX)
    assert db.reveal_secret(access) == "legacy-access"
    assert db.reveal_secret(refresh) == "legacy-refresh"
    assert b"legacy-private-key" not in (db.DATA_DIR / "shortforge.db").read_bytes()
    db.migrate_secrets()  # Migration is idempotent.
    assert db.reveal_secret(access) == "legacy-access"


@pytest.mark.parametrize(
    "version,supported",
    [("7.0.2", False), ("8.1.2", False), ("8.1.3", True), ("9.0", True)],
)
def test_media_version_floor_checks_the_executable(
    tmp_path, monkeypatch, version, supported
):
    path = tmp_path / "ffmpeg"
    path.touch()
    monkeypatch.setattr(
        media_runtime.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0, stdout=f"ffmpeg version {version}-fixture"
        ),
    )
    assert media_runtime.supported_binary(str(path)) is supported


def test_worker_environment_does_not_inherit_provider_or_unrelated_keys(monkeypatch):
    for key in (
        "GEMINI_API_KEY",
        "OPENAI_API_KEY",
        "AWS_SECRET_ACCESS_KEY",
        "HTTP_PROXY",
        "PYTHONPATH",
    ):
        monkeypatch.setenv(key, "private-fixture-value")
    assert "private-fixture-value" not in sandbox.clean_environment().values()
    assert (
        "private-fixture-value" not in sandbox.clean_environment(desktop=True).values()
    )


@pytest.mark.skipif(sys.platform != "linux", reason="Linux namespace isolation")
def test_real_worker_cannot_read_unmounted_files_or_connect_to_host(
    tmp_path, monkeypatch
):
    if not sandbox.network_isolation_available():
        pytest.skip("bubblewrap namespaces unavailable")
    allowed = tmp_path / "input.txt"
    allowed.write_text("allowed fixture")
    outside = tmp_path / "private.txt"
    outside.write_text("must remain private")
    output = tmp_path / "output"
    output.mkdir()
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    program = """
import json,os,socket,sys
from pathlib import Path
allowed,outside,output,port=sys.argv[1:]
result={'allowed':Path(allowed).read_text(),'secret_environment':os.getenv('GEMINI_API_KEY')}
try: Path(outside).read_bytes(); result['outside_read']=True
except OSError: result['outside_read']=False
try: Path(outside).write_text('changed'); result['outside_write']=True
except OSError: result['outside_write']=False
try: socket.create_connection(('127.0.0.1',int(port)),timeout=.2); result['network']=True
except OSError: result['network']=False
Path(output,'result.json').write_text(json.dumps(result))
"""
    monkeypatch.setenv("GEMINI_API_KEY", "private-fixture-value")
    command = sandbox.worker_command(
        [
            sys.executable,
            "-c",
            program,
            str(allowed),
            str(outside),
            str(output),
            str(listener.getsockname()[1]),
        ],
        reads=[allowed],
        writes=[output],
    )
    try:
        subprocess.run(
            command,
            env=sandbox.clean_environment(),
            capture_output=True,
            timeout=10,
            check=True,
        )
    finally:
        listener.close()
    result = json.loads((output / "result.json").read_text())
    assert result["allowed"] == "allowed fixture"
    assert result["secret_environment"] is None
    assert result["outside_read"] is False and result["network"] is False
    # A new file at this name inside the private /tmp is harmless: the real
    # host file must remain unreadable and unchanged.
    assert outside.read_text() == "must remain private"
