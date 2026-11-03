#!/usr/bin/env python3
"""Install only pinned, hash-verified FFmpeg/ffprobe executables, without admin rights."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import tempfile
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engine.core import media_runtime  # noqa: E402


def extract(archive: Path, directory: Path) -> dict[str, str]:
    names = {"ffmpeg.exe", "ffprobe.exe"} if os.name == "nt" else {"ffmpeg", "ffprobe"}
    found = {}

    def save(name: str, size: int, stream):
        if name in found or not 0 < size <= 512 * 1024 * 1024:
            raise ValueError("The verified media package has an unexpected executable.")
        target = directory / name
        digest = hashlib.sha256()
        written = 0
        with target.open("xb") as output:
            while block := stream.read(1024 * 1024):
                written += len(block)
                if written > size:
                    raise ValueError("The media package exceeded its declared size.")
                output.write(block)
                digest.update(block)
        if written != size:
            raise ValueError("The media package is incomplete.")
        target.chmod(0o755)
        found[name] = digest.hexdigest()

    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as package:
            for member in package.infolist():
                parts = PurePosixPath(member.filename).parts
                if len(parts) >= 2 and parts[-2] == "bin" and parts[-1] in names:
                    with package.open(member) as stream:
                        save(parts[-1], member.file_size, stream)
    else:
        with tarfile.open(archive, "r:xz") as package:
            for member in package:
                parts = PurePosixPath(member.name).parts
                if (
                    member.isfile()
                    and len(parts) >= 2
                    and parts[-2] == "bin"
                    and parts[-1] in names
                ):
                    with package.extractfile(member) as stream:
                        save(parts[-1], member.size, stream)
    if set(found) != names:
        raise ValueError("The media package is missing FFmpeg or ffprobe.")
    return found


def install() -> None:
    manifest = media_runtime.pin()
    asset = manifest["platforms"].get(media_runtime.platform_key())
    if not asset:
        raise RuntimeError(
            "Install FFmpeg 8.1.3 or newer for this platform, then restart ShortForge. The outdated bundled binary is disabled."
        )
    directory = ROOT / "data/runtime/ffmpeg"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / manifest["release"]
    with tempfile.TemporaryDirectory(prefix=".install-", dir=directory) as temporary:
        temporary = Path(temporary)
        archive = temporary / asset["url"].rsplit("/", 1)[-1]
        digest = hashlib.sha256()
        total = 0
        print(
            f"Downloading verified FFmpeg {manifest['version']} (free, first setup only)…",
            flush=True,
        )
        with (
            urlopen(
                Request(asset["url"], headers={"User-Agent": "ShortForge"}), timeout=45
            ) as source,
            archive.open("wb") as output,
        ):
            while block := source.read(1024 * 1024):
                total += len(block)
                if total > asset["bytes"]:
                    raise ValueError("The media download exceeded its pinned size.")
                digest.update(block)
                output.write(block)
        if total != asset["bytes"] or digest.hexdigest() != asset["sha256"]:
            raise ValueError(
                "The media download failed its pinned checksum. Nothing was installed."
            )
        staged = temporary / "ready"
        staged.mkdir()
        binaries = extract(archive, staged)
        for name in binaries:
            if not media_runtime.supported_binary(str(staged / name)):
                raise RuntimeError(
                    "The verified media tools cannot run on this machine."
                )
        (staged / "verified.json").write_text(
            json.dumps({"archive_sha256": asset["sha256"], "binaries": binaries})
        )
        # A complete staged install replaces only this managed release directory.
        if target.exists():
            shutil.rmtree(target)
        staged.rename(target)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    from dotenv import load_dotenv
    from engine.core.media import find_ffmpeg, find_ffprobe

    load_dotenv(ROOT / ".env")
    if not find_ffmpeg() or not find_ffprobe():
        if arguments.check:
            print("Patched media tools are missing. Start ShortForge to finish setup.")
            return 1
        install()
    if not find_ffmpeg() or not find_ffprobe():
        raise RuntimeError(
            "Patched media tools are unavailable. Check FFMPEG_PATH and FFPROBE_PATH if you configured them."
        )
    print("Patched FFmpeg and ffprobe are ready.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Media setup could not finish: {error}", file=sys.stderr)
        raise SystemExit(1)
