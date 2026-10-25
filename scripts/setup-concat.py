#!/usr/bin/env python3
"""Set up the pinned Concat runtime automatically inside this project.

Run with ShortForge's Python. --check never installs or downloads anything.
--source also recreates the pinned upstream Git checkout when it is missing.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # noqa: E402
from engine.core.concat import capability  # noqa: E402


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def source_checkout(pin: dict):
    checkout = ROOT / "vendor/concat"
    if checkout.is_dir():
        print(f"Concat source is already at {checkout}.")
        return
    checkout.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "git",
            "clone",
            "--no-checkout",
            "--depth",
            "1",
            pin["repository"],
            str(checkout),
        ],
        check=True,
    )
    subprocess.run(
        [
            "git",
            "-C",
            str(checkout),
            "fetch",
            "--depth",
            "1",
            "origin",
            pin["revision"],
        ],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(checkout), "checkout", "--detach", pin["revision"]],
        check=True,
    )


def install(pin: dict):
    system = platform.system()
    machine = platform.machine().lower()
    machine = {"amd64": "x86_64", "arm64": "aarch64"}.get(machine, machine)
    if system == "Windows" and machine == "aarch64":
        machine = "x86_64"  # Upstream's x64compatible installer supports ARM emulation.
    platform_key = {"Linux": "linux", "Windows": "windows", "Darwin": "macos"}.get(
        system
    )
    asset = pin.get(platform_key, {}).get(machine)
    if asset is None:
        raise RuntimeError(
            f"Automatic Concat setup does not support {system} {machine}."
        )
    directory = ROOT / "data/runtime/concat"
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / asset["url"].rsplit("/", 1)[-1]
    if not archive.is_file() or digest(archive) != asset["sha256"]:
        partial = archive.with_suffix(archive.suffix + ".part")
        print(
            f"Downloading Concat {pin['version']} for {system} {machine}...",
            flush=True,
        )
        try:
            request = Request(asset["url"], headers={"User-Agent": "ShortForge"})
            with urlopen(request, timeout=45) as remote, partial.open("wb") as output:
                total = 0
                while block := remote.read(1024 * 1024):
                    total += len(block)
                    if total > 512 * 1024 * 1024:
                        raise RuntimeError(
                            "The Concat download exceeded its expected size."
                        )
                    output.write(block)
            if digest(partial) != asset["sha256"]:
                raise RuntimeError(
                    "The Concat download did not match the official SHA-256 checksum."
                )
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
    unpacked = directory / f"v{pin['version']}"
    unpacked.mkdir(exist_ok=True)
    unfinished = directory / f"v{pin['version']}.installing"
    unfinished.touch()
    if system == "Linux":
        archive.chmod(0o755)
        binary = unpacked / "squashfs-root/usr/bin/concat"
        print("Extracting the verified portable runtime...", flush=True)
        result = subprocess.run(
            [str(archive), "--appimage-extract"],
            cwd=unpacked,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            timeout=120,
        )
        if result.returncode:
            raise RuntimeError("Concat extraction failed: " + result.stderr[-1000:])
    elif system == "Windows":
        binary = unpacked / "windows/concat.exe"
        # Upstream's concat.iss uses lowest privileges and skipifsilent for launching.
        subprocess.run(
            [
                str(archive),
                "/CURRENTUSER",
                "/VERYSILENT",
                "/SUPPRESSMSGBOXES",
                "/SP-",
                "/NORESTART",
                "/NOCLOSEAPPLICATIONS",
                "/NORESTARTAPPLICATIONS",
                "/NOICONS",
                "/TASKS=",
                "/DIR=" + str(binary.parent),
            ],
            check=True,
            timeout=300,
        )
    else:
        mount = unpacked / ".mount"
        mount.mkdir(exist_ok=True)
        subprocess.run(
            [
                "hdiutil",
                "attach",
                str(archive),
                "-readonly",
                "-nobrowse",
                "-quiet",
                "-mountpoint",
                str(mount),
            ],
            check=True,
            timeout=120,
        )
        try:
            bundle = mount / "Concat.app"
            if not bundle.is_dir():
                bundle = mount
            if not (bundle / "Contents/MacOS/concat").is_file():
                raise RuntimeError(
                    "The verified Concat disk image is missing its application."
                )
            subprocess.run(
                ["ditto", str(bundle), str(unpacked / "Concat.app")],
                check=True,
                timeout=120,
            )
        finally:
            subprocess.run(
                ["hdiutil", "detach", str(mount), "-quiet"], check=True, timeout=30
            )
        binary = unpacked / "Concat.app/Contents/MacOS/concat"
    if not binary.is_file():
        raise RuntimeError(
            "Concat setup did not produce its executable. Start ShortForge again to retry."
        )
    unfinished.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--source", action="store_true")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env")
    pin = json.loads((ROOT / "vendor/concat-release.json").read_text())
    if args.source and not args.check:
        source_checkout(pin)
    ready = capability()
    if (
        not os.getenv("CONCAT_PATH")
        and (ROOT / f"data/runtime/concat/v{pin['version']}.installing").is_file()
    ):
        ready = {
            "available": False,
            "message": "Concat setup was interrupted. Start ShortForge again to retry.",
        }
    if not ready["available"] and not args.check:
        if os.getenv("CONCAT_PATH"):
            raise RuntimeError(ready["message"] + " Check CONCAT_PATH in .env.")
        install(pin)
        ready = capability()
    if not ready["available"]:
        print(ready["message"])
        return 1
    print(
        f"Concat {ready['version']} is ready. Library videos can open in its desktop editor."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f"Concat setup could not finish: {exc}", file=sys.stderr)
        raise SystemExit(1)
