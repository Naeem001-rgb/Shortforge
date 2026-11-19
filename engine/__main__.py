"""Run ShortForge locally; the launcher opens a one-use private connection."""

import argparse
import asyncio
import json
import os
from pathlib import Path
import socket
import shutil
from threading import Thread
import time
import webbrowser
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

from dotenv import load_dotenv

environment_file = Path(__file__).resolve().parent.parent / ".env"
if environment_file.is_file() and not environment_file.is_symlink() and os.name != "nt":
    environment_file.chmod(0o600)
load_dotenv(environment_file)


def open_connected_dashboard():
    from engine.core import security

    url = security.launch_file().as_uri()
    browser = webbrowser
    for name in ("google-chrome", "chromium", "chromium-browser"):
        if shutil.which(name):
            try:
                browser = webbrowser.get(name)
                break
            except webbrowser.Error:
                pass
    if not browser.open_new_tab(url):
        print(
            "Open this private, one-use link within five minutes:\n" + url, flush=True
        )


def wait_for_engine(timeout=120):
    # Ignore proxy settings: this check must reach the loopback listener directly.
    opener = build_opener(ProxyHandler({}))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with opener.open("http://127.0.0.1:8787/api/health", timeout=2) as response:
                health = json.load(response)
            if (
                isinstance(health, dict)
                and health.get("status") == "ok"
                and health.get("version") == "0.2.0"
                and isinstance(health.get("runtime"), dict)
                and health["runtime"].get("started_at")
            ):
                return
            raise SystemExit("Port 8787 is occupied by an unrecognized server.")
        except (URLError, OSError, ValueError):
            time.sleep(0.25)
    raise SystemExit(
        "ShortForge did not become ready. Check: journalctl --user -u shortforge.service -n 50"
    )


def main():
    import uvicorn

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--open", action="store_true", help="Open a connected dashboard."
    )
    parser.add_argument(
        "--open-existing",
        action="store_true",
        help="Open a fresh connection to the running background engine.",
    )
    args = parser.parse_args()
    if args.open_existing:
        wait_for_engine()
        open_connected_dashboard()
        return
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        listener.bind(("127.0.0.1", 8787))
    except OSError:
        listener.close()
        raise SystemExit(
            "Port 8787 is already in use. Close the previous ShortForge engine before starting again."
        )
    listener.listen(128)
    listener.setblocking(False)
    server = uvicorn.Server(
        uvicorn.Config(
            "engine.core.app:app",
            host="127.0.0.1",
            port=8787,
            access_log=False,
            proxy_headers=False,
            limit_concurrency=64,
            timeout_keep_alive=5,
            h11_max_incomplete_event_size=16384,
        )
    )

    def open_dashboard():
        for _ in range(120):
            if server.started:
                print(
                    "ShortForge: opening your connected workspace. Press Ctrl+C to stop.",
                    flush=True,
                )
                open_connected_dashboard()
                return
            if server.should_exit:
                return
            time.sleep(0.25)

    if args.open:
        Thread(target=open_dashboard, daemon=True).start()
    try:
        asyncio.run(server.serve(sockets=[listener]))
    finally:
        listener.close()


if __name__ == "__main__":
    main()
