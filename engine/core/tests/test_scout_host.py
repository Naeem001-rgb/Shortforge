import io
import json
from pathlib import Path
import stat

import pytest

from engine import scout_host
from engine.core import db, security


def message(origin, raw):
    out = io.BytesIO()
    scout_host.serve(origin, io.BytesIO(raw), out)
    raw = out.getvalue()
    assert scout_host.FRAME.unpack(raw[:4]) == (len(raw) - 4,)
    return json.loads(raw[4:])


def test_host_only_issues_origin_bound_access_for_the_installed_scout(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    starts = []
    monkeypatch.setattr(scout_host, "ensure_engine", lambda: starts.append(1))
    origin = security.scout_origin()
    payload = b'{"action":"open-library"}'
    frame = scout_host.FRAME.pack(len(payload)) + payload
    for caller in ("", "https://example.org", "chrome-extension://" + "a" * 32 + "/"):
        assert "token" not in message(caller, frame)
    for invalid in (
        b"",
        b"\x00" * 4,
        scout_host.FRAME.pack(999),
        frame[:-1],
        scout_host.FRAME.pack(2) + b"{}",
        scout_host.FRAME.pack(3) + b"???",
    ):
        assert "token" not in message(origin + "/", invalid)
    assert not starts
    clients = [message(origin + "/", frame) for _ in range(2)]
    assert len(starts) == 2
    for client in clients:
        assert security.authenticate(client["token"], origin)
        assert not security.authenticate(client["token"], "http://127.0.0.1:8787")


def test_engine_starts_only_when_offline(monkeypatch):
    statuses = iter([True, False, True])
    monkeypatch.setattr(scout_host, "engine_ready", lambda: next(statuses))
    launches = []
    monkeypatch.setattr(
        scout_host.subprocess, "Popen", lambda cmd, **opts: launches.append((cmd, opts))
    )
    scout_host.ensure_engine()
    assert launches == []
    scout_host.ensure_engine()
    ((cmd, options),) = launches
    assert cmd == [scout_host.sys.executable, "-m", "engine"]
    assert options["cwd"] == scout_host.ROOT


@pytest.mark.skipif(
    not scout_host.sys.platform.startswith("linux"),
    reason="Linux browser registration paths",
)
def test_install_is_repeatable_and_scoped_to_the_scout_id(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    scout_host.install()
    scout_host.install()
    for browser in ("google-chrome", "chromium"):
        path = tmp_path / browser / "NativeMessagingHosts" / (scout_host.NAME + ".json")
        manifest = json.loads(path.read_text())
        assert manifest["allowed_origins"] == [security.scout_origin() + "/"]
        assert manifest["type"] == "stdio"
        assert stat.S_IMODE(Path(manifest["path"]).stat().st_mode) == 0o700
