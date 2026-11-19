#!/usr/bin/env python3
"""Install ShortForge's Linux login service and application shortcut."""

import os
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def unit_quote(value):
    return (
        '"'
        + str(value)
        .replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("%", "%%")
        .replace("$", "$$")
        + '"'
    )


def desktop_quote(value):
    escaped = (
        str(value)
        .replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("`", "\\`")
        .replace("$", "\\$")
    )
    return '"' + escaped.replace("\\", "\\\\").replace("%", "%%") + '"'


def main():
    if sys.platform != "linux" or not shutil.which("systemctl"):
        raise SystemExit(
            "Automatic startup requires Linux with a systemd user session."
        )
    subprocess.run(
        ["systemctl", "--user", "show-environment"],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    # Finish first-run setup before the shortcut can try to import the engine.
    subprocess.run(["/bin/bash", str(ROOT / "start.sh"), "--setup-only"], check=True)
    config = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    user_data = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    unit = config / "systemd/user/shortforge.service"
    shortcut = user_data / "applications/shortforge.desktop"
    unit.parent.mkdir(parents=True, exist_ok=True)
    shortcut.parent.mkdir(parents=True, exist_ok=True)
    unit.write_text(
        "[Unit]\n"
        "Description=ShortForge local video workspace\n"
        "After=graphical-session.target\n"
        "PartOf=graphical-session.target\n\n"
        "[Service]\n"
        "Type=simple\n"
        f"ExecStart=/bin/bash {unit_quote(ROOT / 'start.sh')} --no-open\n"
        "Environment=PYTHONUNBUFFERED=1\n"
        "Restart=on-failure\n"
        "RestartSec=5\n"
        "TimeoutStopSec=30\n\n"
        "[Install]\n"
        "WantedBy=graphical-session.target\n"
    )
    shortcut.write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=ShortForge\n"
        "Comment=Open your local video workspace\n"
        f"Exec=/bin/bash {desktop_quote(ROOT / 'start.sh')}\n"
        "Icon=video-x-generic\n"
        "Terminal=false\n"
        "Categories=AudioVideo;Video;\n"
    )
    session_vars = [
        name
        for name in (
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "XAUTHORITY",
            "XDG_CURRENT_DESKTOP",
            "PATH",
        )
        if name in os.environ
    ]
    if session_vars:
        subprocess.run(
            ["systemctl", "--user", "import-environment", *session_vars], check=True
        )
    subprocess.run(["systemd-analyze", "--user", "verify", str(unit)], check=True)
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(
        ["systemctl", "--user", "enable", "--now", "shortforge.service"], check=True
    )
    print("ShortForge now starts at desktop login and restarts after crashes.")
    print("Open ShortForge from your application menu or run ./start.sh.")
    print("Disable: systemctl --user disable --now shortforge.service")


if __name__ == "__main__":
    main()
