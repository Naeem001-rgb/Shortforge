"""Automatic runtime setup, integrity failures, and retry without real downloads."""

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess

import pytest


@pytest.fixture
def setup(tmp_path, monkeypatch):
    script = Path(__file__).resolve().parents[3] / "scripts/setup-concat.py"
    spec = importlib.util.spec_from_file_location("concat_setup", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module.sys, "argv", [str(script)])
    monkeypatch.delenv("CONCAT_PATH", raising=False)
    monkeypatch.setattr(module.platform, "system", lambda: "Linux")
    monkeypatch.setattr(module.platform, "machine", lambda: "x86_64")
    payload = b"verified runtime fixture"
    checksum = hashlib.sha256(payload).hexdigest()
    pin = {"version": "0.2.8"}
    for system, suffix, machines in (
        ("linux", "AppImage", ["x86_64", "aarch64"]),
        ("windows", "exe", ["x86_64"]),
        ("macos", "dmg", ["x86_64", "aarch64"]),
    ):
        pin[system] = {
            machine: {
                "url": f"https://example.test/{system}-{machine}.{suffix}",
                "sha256": checksum,
            }
            for machine in machines
        }
    (tmp_path / "vendor").mkdir()
    (tmp_path / "vendor/concat-release.json").write_text(json.dumps(pin))
    monkeypatch.setattr(module, "urlopen", lambda *_, **__: io.BytesIO(payload))
    binary = tmp_path / "data/runtime/concat/v0.2.8/squashfs-root/usr/bin/concat"
    monkeypatch.setattr(
        module,
        "capability",
        lambda: {
            "available": binary.is_file(),
            "message": "Concat is missing",
            "version": "0.2.8",
        },
    )

    def extract(command, **kwargs):
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_bytes(b"native program")
        return subprocess.CompletedProcess(command, 0, stderr="")

    monkeypatch.setattr(module.subprocess, "run", extract)
    return module, pin, binary, payload


def test_first_normal_start_installs_and_next_start_reuses_it(setup, monkeypatch):
    module, _, binary, _ = setup
    assert module.main() == 0
    assert binary.is_file()
    monkeypatch.setattr(
        module, "install", lambda _: pytest.fail("A working install must be reused")
    )
    assert module.main() == 0


def test_check_mode_never_downloads_a_missing_runtime(setup, monkeypatch):
    module, _, binary, _ = setup
    monkeypatch.setattr(module.sys, "argv", ["setup-concat.py", "--check"])
    monkeypatch.setattr(
        module, "urlopen", lambda *_, **__: pytest.fail("Check mode must not download")
    )
    assert module.main() == 1
    assert not binary.exists()


def test_checksum_failure_cleans_partial_download_and_next_start_retries(
    setup, monkeypatch
):
    module, _, binary, payload = setup
    monkeypatch.setattr(
        module, "urlopen", lambda *_, **__: io.BytesIO(b"corrupt download")
    )
    with pytest.raises(RuntimeError, match="SHA-256"):
        module.main()
    assert not binary.exists()
    assert list((module.ROOT / "data/runtime/concat").glob("*.part")) == []
    monkeypatch.setattr(module, "urlopen", lambda *_, **__: io.BytesIO(payload))
    assert module.main() == 0


def test_failed_extraction_retries_from_verified_cache(setup, monkeypatch):
    module, pin, binary, _ = setup
    working_extract = module.subprocess.run

    def partial_extract(command, **kwargs):
        working_extract(command, **kwargs)
        return subprocess.CompletedProcess(command, 1, stderr="Disk was full")

    monkeypatch.setattr(module.subprocess, "run", partial_extract)
    with pytest.raises(RuntimeError, match="Disk was full"):
        module.install(pin)
    assert binary.exists()
    retried = []

    def retry(command, **kwargs):
        retried.append(command)
        return working_extract(command, **kwargs)

    monkeypatch.setattr(module.subprocess, "run", retry)
    monkeypatch.setattr(
        module,
        "urlopen",
        lambda *_, **__: pytest.fail("Retry should use the verified archive"),
    )
    assert module.main() == 0
    assert len(retried) == 1
    assert not (module.ROOT / "data/runtime/concat/v0.2.8.installing").exists()


def test_broken_explicit_runtime_is_not_silently_replaced(setup, monkeypatch):
    module, _, _, _ = setup
    monkeypatch.setenv("CONCAT_PATH", "/chosen/concat")
    monkeypatch.setattr(
        module, "install", lambda _: pytest.fail("Respect the configured runtime")
    )
    with pytest.raises(RuntimeError, match="Check CONCAT_PATH"):
        module.main()


def test_working_explicit_runtime_bypasses_an_old_interrupted_install(
    setup, monkeypatch
):
    module, _, _, _ = setup
    unfinished = module.ROOT / "data/runtime/concat/v0.2.8.installing"
    unfinished.parent.mkdir(parents=True)
    unfinished.touch()
    monkeypatch.setenv("CONCAT_PATH", "/chosen/concat")
    monkeypatch.setattr(
        module, "capability", lambda: {"available": True, "version": "0.2.8"}
    )
    monkeypatch.setattr(
        module,
        "install",
        lambda _: pytest.fail("Respect the working configured runtime"),
    )
    assert module.main() == 0


@pytest.mark.parametrize("machine", ["AMD64", "ARM64"])
def test_windows_installs_to_project_without_reboot_or_launch(
    setup, monkeypatch, machine
):
    module, pin, _, _ = setup
    monkeypatch.setattr(module.platform, "system", lambda: "Windows")
    monkeypatch.setattr(module.platform, "machine", lambda: machine)
    binary = module.ROOT / "data/runtime/concat/v0.2.8/windows/concat.exe"
    commands = []

    def install(command, **kwargs):
        commands.append(command)
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b"Windows program")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(module.subprocess, "run", install)
    module.install(pin)
    assert binary.is_file()
    assert commands[0][0].endswith("windows-x86_64.exe")
    assert {
        "/VERYSILENT",
        "/NORESTART",
        "/NOCLOSEAPPLICATIONS",
        "/NORESTARTAPPLICATIONS",
        "/NOICONS",
        "/TASKS=",
    }.issubset(commands[0])
    assert "/DIR=" + str(binary.parent) in commands[0]


@pytest.mark.parametrize("nested", [False, True])
@pytest.mark.parametrize("copy_fails", [False, True])
def test_macos_mounts_read_only_copies_bundle_and_always_detaches(
    setup, monkeypatch, nested, copy_fails
):
    module, pin, _, _ = setup
    monkeypatch.setattr(module.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(module.platform, "machine", lambda: "arm64")
    commands = []

    def install(command, **kwargs):
        commands.append(command)
        if command[:2] == ["hdiutil", "attach"]:
            mount = Path(command[command.index("-mountpoint") + 1])
            bundle = mount / "Concat.app" if nested else mount
            binary = bundle / "Contents/MacOS/concat"
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b"Mac program")
        elif command[0] == "ditto":
            if copy_fails:
                raise subprocess.CalledProcessError(1, command)
            shutil.copytree(command[1], command[2])
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(module.subprocess, "run", install)
    if copy_fails:
        with pytest.raises(subprocess.CalledProcessError):
            module.install(pin)
    else:
        module.install(pin)
        assert (
            module.ROOT / "data/runtime/concat/v0.2.8/Concat.app/Contents/MacOS/concat"
        ).is_file()
    assert "-readonly" in commands[0] and "-nobrowse" in commands[0]
    assert commands[-1][:2] == ["hdiutil", "detach"]


def test_unsupported_platform_fails_before_downloading(setup, monkeypatch):
    module, pin, _, _ = setup
    monkeypatch.setattr(module.platform, "machine", lambda: "riscv64")
    monkeypatch.setattr(
        module,
        "urlopen",
        lambda *_, **__: pytest.fail("Unsupported architecture must not download"),
    )
    with pytest.raises(RuntimeError, match="does not support Linux riscv64"):
        module.install(pin)
