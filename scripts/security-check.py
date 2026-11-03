#!/usr/bin/env python3
"""Free, read-only checks. Only package names and versions go to advisory services."""

from concurrent.futures import ThreadPoolExecutor
from importlib import metadata
import json
from pathlib import Path
import subprocess
import sys
import tomllib
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def advisories(ecosystem: str, packages: list[tuple[str, str]]) -> list[dict]:
    found = []
    for offset in range(0, len(packages), 200):
        chunk = packages[offset : offset + 200]
        body = {
            "queries": [
                {"package": {"name": name, "ecosystem": ecosystem}, "version": version}
                for name, version in chunk
            ]
        }
        request = Request(
            "https://api.osv.dev/v1/querybatch",
            data=json.dumps(body).encode(),
            headers={
                "Content-Type": "application/json",
                "User-Agent": "ShortForge security check",
            },
        )
        with urlopen(request, timeout=30) as response:
            results = json.load(response)["results"]
        for (name, version), result in zip(chunk, results):
            if result.get("vulns"):
                found.append(
                    {
                        "package": name,
                        "version": version,
                        "advisories": [item["id"] for item in result["vulns"]],
                    }
                )
    return found


def npm_check(folder: str) -> dict:
    command = [
        "npm.cmd" if sys.platform == "win32" else "npm",
        "audit",
        "--json",
        "--ignore-scripts",
        "--package-lock-only",
    ]
    result = subprocess.run(
        command,
        cwd=ROOT / folder,
        capture_output=True,
        text=True,
        timeout=90,
        shell=sys.platform == "win32",
    )
    report = json.loads(result.stdout)
    if "metadata" not in report:
        raise RuntimeError(f"npm could not check {folder or 'root'} dependencies.")
    return {
        "project": folder or "root",
        "vulnerabilities": report["metadata"]["vulnerabilities"],
    }


def main() -> int:
    from engine.core.media import find_ffmpeg
    from engine.core.sandbox import network_isolation_available

    packages = sorted(
        {(item.metadata["Name"], item.version) for item in metadata.distributions()}
    )
    with ThreadPoolExecutor(max_workers=4) as pool:
        python = pool.submit(advisories, "PyPI", packages)
        javascript = list(pool.map(npm_check, ["", "dashboard", "extension"]))
        python = python.result()
    native = []
    cargo = ROOT / "vendor/concat/src/Cargo.lock"
    if cargo.exists():
        rows = tomllib.loads(cargo.read_text())["package"]
        native = advisories(
            "crates.io",
            sorted(
                {
                    (row["name"], row["version"])
                    for row in rows
                    if row.get("source", "").startswith("registry+")
                }
            ),
        )
    executable = find_ffmpeg()
    version = (
        subprocess.check_output(
            [executable, "-version"], text=True, timeout=10
        ).splitlines()[0]
        if executable
        else "No supported FFmpeg found"
    )
    result = {
        "python_distributions_checked": len(packages),
        "python_findings": python,
        "javascript": javascript,
        "ffmpeg": version,
        "concat_network_isolation_available": network_isolation_available(),
        "concat_source_findings": native,
        "limits": "A clean package scan is not a security certificate. Concat source findings can be platform/feature dependent and do not establish the contents of its downloaded binary. Offline isolation mitigates network exposure; it does not patch upstream code.",
    }
    print(json.dumps(result, indent=2))
    # Preserve actionable warnings; never label an unpatched upstream tree clean.
    return int(
        bool(
            python
            or native
            or not executable
            or any(row["vulnerabilities"]["total"] for row in javascript)
        )
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Security check could not finish: {error}", file=sys.stderr)
        raise SystemExit(2)
