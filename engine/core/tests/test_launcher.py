"""Background launch must retain access boundaries and existing connections."""

from io import BytesIO
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from urllib.parse import unquote, urlsplit

import pytest

from engine import __main__ as launcher


def test_reopening_running_engine_uses_private_handoff_and_keeps_clients(
    client, monkeypatch
):
    opened = []
    monkeypatch.setattr(launcher.shutil, "which", lambda name: None)
    monkeypatch.setattr(
        launcher.webbrowser, "open_new_tab", lambda url: opened.append(url) or True
    )
    launcher.open_connected_dashboard()

    path = Path(unquote(urlsplit(opened[0]).path))
    assert urlsplit(opened[0]).scheme == "file"
    assert "connect=" not in opened[0]
    content = path.read_text()
    code = content.split("#connect=", 1)[1].split('"', 1)[0]
    assert client.get("/api/clips").status_code == 200
    response = client.post(
        "/api/security/pair",
        json={"code": code},
        headers={"Authorization": "", "Origin": "http://127.0.0.1:8787"},
    )
    assert response.status_code == 200
    assert client.get("/api/clips").status_code == 200
    assert not path.exists()


@pytest.mark.parametrize(
    "health", [{"status": "ok"}, {"status": "ok", "version": "other"}, []]
)
def test_unrecognized_listener_never_opens_a_connection(monkeypatch, health):
    opener = SimpleNamespace(
        open=lambda *args, **kwargs: BytesIO(json.dumps(health).encode())
    )
    monkeypatch.setattr(launcher, "build_opener", lambda *args: opener)
    monkeypatch.setattr(sys, "argv", ["engine", "--open-existing"])
    monkeypatch.setattr(
        launcher,
        "open_connected_dashboard",
        lambda: pytest.fail("Unrecognized server received a connection"),
    )
    with pytest.raises(SystemExit, match="unrecognized server"):
        launcher.main()


def test_background_reopen_does_not_bind_another_server(monkeypatch):
    events = []
    monkeypatch.setattr(sys, "argv", ["engine", "--open-existing"])
    monkeypatch.setattr(launcher, "wait_for_engine", lambda: events.append("ready"))
    monkeypatch.setattr(
        launcher, "open_connected_dashboard", lambda: events.append("open")
    )
    monkeypatch.setattr(
        launcher.socket, "socket", lambda *args: pytest.fail("Duplicate listener")
    )
    launcher.main()
    assert events == ["ready", "open"]


# Added to an existing file by /ship test coverage audit.
# Value: protects=autostart writes correctly quoted launchers only after setup;
# fails_when=setup failure is ignored or service/desktop launch quoting changes;
# why_new=launcher tests covered reconnection but never the installer boundary;
# seam=none; no_claim=real desktop login/service execution (systemd calls mocked).
@pytest.mark.parametrize("scenario", ["installed", "setup-failed", "unsupported"])
def test_autostart_installation_preserves_setup_and_launcher_contracts(
    tmp_path, monkeypatch, scenario
):
    script = Path(__file__).resolve().parents[3] / "scripts/install-autostart.py"
    spec = importlib.util.spec_from_file_location("shortforge_autostart", script)
    assert spec is not None and spec.loader is not None
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    checkout = tmp_path / "checkout %literal $name"
    monkeypatch.setattr(installer, "ROOT", checkout)
    monkeypatch.setattr(installer.Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    monkeypatch.setattr(
        installer.sys, "platform", "darwin" if scenario == "unsupported" else "linux"
    )
    monkeypatch.setattr(installer.shutil, "which", lambda name: "/usr/bin/systemctl")
    unit = tmp_path / ".config/systemd/user/shortforge.service"
    shortcut = tmp_path / ".local/share/applications/shortforge.desktop"
    commands = []

    def run(command, **kwargs):
        assert kwargs["check"] is True
        commands.append(command)
        if command[0] == "/bin/bash" and scenario == "setup-failed":
            raise installer.subprocess.CalledProcessError(1, command)
        if command[0] == "systemd-analyze":
            assert unit.is_file() and shortcut.is_file()

    monkeypatch.setattr(installer.subprocess, "run", run)
    if scenario == "unsupported":
        with pytest.raises(SystemExit, match="requires Linux"):
            installer.main()
        assert commands == []
    elif scenario == "setup-failed":
        with pytest.raises(installer.subprocess.CalledProcessError):
            installer.main()
        assert commands[-1] == ["/bin/bash", str(checkout / "start.sh"), "--setup-only"]
    else:
        installer.main()
        assert commands[:2] == [
            ["systemctl", "--user", "show-environment"],
            ["/bin/bash", str(checkout / "start.sh"), "--setup-only"],
        ]
        assert (
            f'ExecStart=/bin/bash "{tmp_path}/checkout %%literal $$name/start.sh" --no-open'
            in unit.read_text()
        )
        assert (
            f'Exec=/bin/bash "{tmp_path}/checkout %%literal \\\\$name/start.sh"'
            in shortcut.read_text()
        )
        assert "PartOf=graphical-session.target" in unit.read_text()
        assert "Restart=on-failure" in unit.read_text()
        assert commands[-3:] == [
            ["systemd-analyze", "--user", "verify", str(unit)],
            ["systemctl", "--user", "daemon-reload"],
            ["systemctl", "--user", "enable", "--now", "shortforge.service"],
        ]
    if scenario != "installed":
        assert not unit.exists() and not shortcut.exists()
