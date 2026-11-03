"""Run ShortForge locally; the launcher opens a one-use private connection."""

import argparse
import asyncio
import os
from pathlib import Path
import socket
import shutil
from threading import Thread
import time
import webbrowser

from dotenv import load_dotenv

environment_file = Path(__file__).resolve().parent.parent / ".env"
if environment_file.is_file() and not environment_file.is_symlink() and os.name != "nt":
    environment_file.chmod(0o600)
load_dotenv(environment_file)


def main():
    import uvicorn
    from engine.core import security

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--open", action="store_true", help="Open a connected dashboard."
    )
    args = parser.parse_args()
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
                url = security.launch_file().as_uri()
                print(
                    "ShortForge: opening your connected workspace. Press Ctrl+C to stop.",
                    flush=True,
                )
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
                        "Open this private, one-use link within five minutes:\n" + url,
                        flush=True,
                    )
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
