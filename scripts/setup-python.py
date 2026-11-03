#!/usr/bin/env python3
"""Reuse the reviewed Python lock; never upgrade packages during routine startup."""

from importlib import metadata
from pathlib import Path
import subprocess
import sys

LOCK = Path(__file__).resolve().parents[1] / "engine/requirements-lock.txt"


def current() -> bool:
    from pip._vendor.packaging.requirements import Requirement

    for line in LOCK.read_text().splitlines():
        if not line or line[0].isspace() or line.startswith("#"):
            continue
        requirement = Requirement(line.removesuffix("\\").strip())
        if requirement.marker and not requirement.marker.evaluate():
            continue
        try:
            version = metadata.version(requirement.name)
        except metadata.PackageNotFoundError:
            return False
        if version not in requirement.specifier:
            return False
    return True


def main() -> int:
    if not current():
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--require-hashes",
                "--only-binary=:all:",
                "--no-deps",
                "--index-url",
                "https://pypi.org/simple",
                "-r",
                str(LOCK),
            ],
            check=True,
        )
        if not current():
            raise RuntimeError("Python dependencies do not match the reviewed lock.")
    print("Python dependencies match the reviewed lock.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
