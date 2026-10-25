"""Library-to-Concat handoff, with a real native interoperability check on opt-in."""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import subprocess
from threading import Event

from fastapi import HTTPException
import pytest

from engine.core import concat, db
from engine.core.concat_rpc import ConcatRPC
from engine.core.tests.test_core import playable_video


def import_clip(client):
    response = client.post(
        "/api/clips",
        json={
            "clips": [
                {
                    "url": "https://youtube.com/shorts/abcdefghijk",
                    "title": "My saved video",
                }
            ]
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["clips"][0]


@pytest.fixture
def ready(monkeypatch):
    monkeypatch.setattr(
        concat,
        "capability",
        lambda: {"available": True, "editor": "Concat", "version": "0.2.8"},
    )
    monkeypatch.setattr(concat, "find_binary", lambda: Path("/test/concat"))
    launched = []

    def launch(binary, project):
        launched.append(project)

    monkeypatch.setattr(concat, "launch_desktop", launch)
    return launched


def test_studio_launches_independently_without_creating_a_clip(
    client, ready, monkeypatch
):
    job = client.post("/api/studio/open", json={}).json()
    finished = client.get(f"/api/jobs/{job['id']}").json()
    assert finished["status"] == "completed"
    assert finished["result"]["clip_id"] is None
    assert ready == [None]
    assert finished["result"]["opened"] is True
    assert finished["result"]["project_path"] is None
    assert "stream_url" not in finished["result"]
    assert client.get("/api/clips").json()["clips"] == []


def test_missing_editor_is_explained_before_any_media_download(client, monkeypatch):
    clip = import_clip(client)
    monkeypatch.setattr(
        concat,
        "capability",
        lambda: {"available": False, "message": "Set up Concat first."},
    )
    response = client.post("/api/studio/open", json={"clip_id": clip["id"]})
    assert response.status_code == 503
    assert response.json()["detail"] == "Set up Concat first."
    with db.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0


def test_browser_cannot_choose_a_program_or_arbitrary_file(client, ready):
    assert (
        client.post("/api/studio/open", json={"path": "/other/file.mp4"}).status_code
        == 422
    )
    assert (
        client.post("/api/studio/open", json={"binary": "/other/program"}).status_code
        == 422
    )
    assert (
        client.post(
            "/api/studio/open", json={"clip_id": "not-a-library-video"}
        ).status_code
        == 404
    )
    assert client.post("/api/studio/open", json={"clip_id": ""}).status_code == 422


def test_reopening_preserves_an_existing_edit_without_fetching_the_source(
    client, ready, monkeypatch
):
    clip = import_clip(client)
    project = concat.project_folder(clip["id"])
    project.mkdir(parents=True)
    manifest = project / "concat.json"
    manifest.write_text(
        '{"name":"My existing cuts","timelines":[{"clips":["edited"]}]}'
    )
    before = manifest.read_bytes()
    monkeypatch.setattr(
        concat,
        "source_for_clip",
        lambda *_: pytest.fail(
            "A saved edit must not download or import its source again"
        ),
    )
    for _ in range(2):
        job = client.post("/api/studio/open", json={"clip_id": clip["id"]}).json()
        finished = db.get_job(job["id"])
        assert finished["status"] == "completed"
        assert finished["result"]["project_created"] is False
    assert manifest.read_bytes() == before
    assert ready == [project, project]
    assert finished["result"]["project_path"] == str(project)
    assert db.get_clip(clip["id"])["license_status"] == "unknown"


def test_inflight_studio_requests_are_deduplicated(client, ready, monkeypatch):
    clip = import_clip(client)
    started, release = Event(), Event()
    executed = []

    def open_job(job_id, clip_id):
        executed.append(job_id)
        db.update_job(job_id, status="running")
        started.set()
        assert release.wait(10)
        db.update_job(job_id, status="completed", progress=100)

    monkeypatch.setattr(concat, "open_job", open_job)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(
            client.post, "/api/studio/open", json={"clip_id": clip["id"]}
        )
        try:
            assert started.wait(10)
            second = client.post(
                "/api/studio/open", json={"clip_id": clip["id"]}
            ).json()
        finally:
            release.set()
        assert first.result().json()["id"] == second["id"]
    assert executed == [second["id"]]


def test_failed_launch_leaves_library_and_saved_edit_available(
    client, ready, monkeypatch
):
    clip = import_clip(client)
    project = concat.project_folder(clip["id"])
    project.mkdir(parents=True)
    (project / "concat.json").write_text('{"name":"Kept edit"}')

    def unavailable(*_):
        raise RuntimeError("Concat could not open its desktop window.")

    monkeypatch.setattr(concat, "launch_desktop", unavailable)
    job = client.post("/api/studio/open", json={"clip_id": clip["id"]}).json()
    finished = db.get_job(job["id"])
    assert finished["status"] == "failed"
    assert "desktop window" in finished["error"]
    assert (project / "concat.json").read_text() == '{"name":"Kept edit"}'
    assert client.get(f"/api/clips/{clip['id']}").status_code == 200


def test_source_acquisition_keeps_unknown_rights_as_metadata(client, monkeypatch):
    clip = import_clip(client)
    path = db.DATA_DIR / "source.mp4"
    path.write_bytes(playable_video())
    downloads = []

    def download(job_id, clip_id):
        downloads.append(clip_id)
        asset = db.add_asset(clip_id, "source", path)
        db.update_job(job_id, status="completed", progress=100, result={"asset": asset})

    monkeypatch.setattr(concat.media, "download_job", download)
    assert concat.source_for_clip(clip["id"], lambda _: None) == path
    assert concat.source_for_clip(clip["id"], lambda _: None) == path
    assert downloads == [clip["id"]]
    assert db.get_clip(clip["id"])["license_status"] == "unknown"


def test_native_environment_does_not_receive_provider_keys(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "private-gemini")
    monkeypatch.setenv("YOUTUBE_CLIENT_SECRET", "private-oauth")
    env = concat.runtime_env()
    assert "GEMINI_API_KEY" not in env
    assert "YOUTUBE_CLIENT_SECRET" not in env
    assert concat.rpc_env()["CONCAT_MCP_ROOTS"] == str(db.DATA_DIR.resolve())


def test_project_paths_cannot_escape_the_data_folder():
    with pytest.raises(HTTPException):
        concat.project_folder("../outside")


@pytest.mark.parametrize(
    ("system", "relative"),
    [
        ("Linux", "squashfs-root/usr/bin/concat"),
        ("Windows", "windows/concat.exe"),
        ("Darwin", "Concat.app/Contents/MacOS/concat"),
    ],
)
def test_managed_binary_matches_the_host_platform(
    monkeypatch, tmp_path, system, relative
):
    monkeypatch.delenv("CONCAT_PATH", raising=False)
    monkeypatch.setattr(concat, "ROOT", tmp_path)
    monkeypatch.setattr(concat.platform, "system", lambda: system)
    for name in (
        "squashfs-root/usr/bin/concat",
        "windows/concat.exe",
        "Concat.app/Contents/MacOS/concat",
    ):
        path = tmp_path / f"data/runtime/concat/v{concat.VERSION}" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
    assert (
        concat.find_binary()
        == tmp_path / f"data/runtime/concat/v{concat.VERSION}" / relative
    )


def test_desktop_capability_has_no_streaming_dependency(client, ready):
    assert client.get("/api/studio/capabilities").json()["available"] is True
    path = "/api/studio/browser/" + "a" * 32 + "/index.html"
    assert client.get(path).status_code == 404
    assert (
        client.get(
            path,
            headers={
                "Sec-Fetch-Site": "cross-site",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Dest": "document",
            },
        ).status_code
        == 403
    )


def test_native_launch_uses_literal_project_path_and_desktop_environment(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("DISPLAY", ":2")
    monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")
    monkeypatch.setenv("GEMINI_API_KEY", "secret")
    reaped = Event()
    calls = []

    class Process:
        def wait(self, timeout=None):
            if timeout is not None:
                raise subprocess.TimeoutExpired("concat", timeout)
            reaped.set()
            return 0

    def spawn(command, **kwargs):
        calls.append((command, kwargs))
        return Process()

    monkeypatch.setattr(concat.subprocess, "Popen", spawn)
    binary = tmp_path / "Concat app/concat"
    project = tmp_path / "Saved edit $(literal)"
    concat.launch_desktop(binary, project)
    assert reaped.wait(2)
    command, options = calls[0]
    assert command == [str(binary), "--project", str(project)]
    assert options.get("shell", False) is False
    assert options["start_new_session"] is True
    assert options["env"]["DISPLAY"] == ":2"
    assert options["env"]["WAYLAND_DISPLAY"] == "wayland-0"
    assert "GEMINI_API_KEY" not in options["env"]


def test_native_launch_reports_startup_failure(monkeypatch, tmp_path):
    class Process:
        def wait(self, timeout):
            return 1

    monkeypatch.setattr(concat.subprocess, "Popen", lambda *a, **kw: Process())
    with pytest.raises(RuntimeError, match="Concat could not start.*desktop.log"):
        concat.launch_desktop(tmp_path / "concat", None)


def test_failed_preparation_never_publishes_a_partial_edit(client, ready, monkeypatch):
    clip = import_clip(client)
    source = db.DATA_DIR / "source.mp4"
    source.write_bytes(playable_video())
    monkeypatch.setattr(concat, "source_for_clip", lambda *_: source)

    class FailingRPC:
        def __init__(self, *_):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def call(self, name, arguments):
            if name == "project_create":
                stage = Path(arguments["location"]) / "edit"
                stage.mkdir()
                (stage / "concat.json").write_text("initial manifest")
                return {}
            raise RuntimeError("Video import failed")

    monkeypatch.setattr(concat, "ConcatRPC", FailingRPC)
    with pytest.raises(RuntimeError, match="Video import failed"):
        concat.prepare_project(Path("/test/concat"), clip)
    project = concat.project_folder(clip["id"])
    assert not project.exists()
    assert list(project.parent.glob(".prepare-*")) == []
    assert source.is_file()


@pytest.mark.skipif(
    os.getenv("SHORTFORGE_TEST_CONCAT") != "1",
    reason="Opt-in check against the installed native Concat runtime",
)
def test_real_concat_imports_video_and_reopens_saved_cuts(
    client, monkeypatch, tmp_path
):
    binary = concat.find_binary()
    assert binary is not None, "Run scripts/setup-concat.py first"
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "native-config"))
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "native-data"))
    clip = import_clip(client)
    source = db.DATA_DIR / "source.mp4"
    source.write_bytes(playable_video())
    db.add_asset(clip["id"], "source", source)
    project, created = concat.prepare_project(binary, clip)
    assert created
    with ConcatRPC(binary, concat.rpc_env()) as native:
        native.call("project_open", {"path": str(project)})
        summary = native.call("timeline_read", {"path": str(project)})
        assert summary["project"]["width"] == 1080
        assert summary["project"]["height"] == 1920
        assert len(summary["media"]) == 1
        assert len(summary["timeline"]["clips"]) == 1
        placed = summary["timeline"]["clips"][0]
        assert placed["duration"] > 0
        native.call(
            "clip_update",
            {
                "path": str(project),
                "clipId": placed["id"],
                "patch": {"name": "Saved user edit"},
            },
        )
        native.call("project_save", {"path": str(project)})
        native.call("project_close", {"path": str(project), "save": True})
    before = hashlib.sha256((project / "concat.json").read_bytes()).hexdigest()
    assert concat.prepare_project(binary, clip) == (project, False)
    assert hashlib.sha256((project / "concat.json").read_bytes()).hexdigest() == before
    copied_source = project.parent / "media/source.mp4"
    assert copied_source.read_bytes() == source.read_bytes()
    assert client.delete(f"/api/clips/{clip['id']}").status_code == 200
    assert not source.exists()
    assert copied_source.is_file()
    assert (project / "concat.json").is_file()


@pytest.mark.skipif(
    os.getenv("SHORTFORGE_TEST_CONCAT_DESKTOP") != "1",
    reason="Opt-in check that opens and closes an isolated real desktop window",
)
def test_real_library_video_opens_in_desktop_concat(client, monkeypatch, tmp_path):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "native-config"))
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "native-data"))
    clip = import_clip(client)
    source = db.DATA_DIR / "source.mp4"
    source.write_bytes(playable_video())
    db.add_asset(clip["id"], "source", source)
    processes = []
    popen = concat.subprocess.Popen

    def spawn(command, *args, **kwargs):
        process = popen(command, *args, **kwargs)
        if "--project" in command:
            processes.append(process)
        return process

    monkeypatch.setattr(concat.subprocess, "Popen", spawn)
    try:
        job = client.post("/api/studio/open", json={"clip_id": clip["id"]}).json()
        finished = db.get_job(job["id"])
        assert finished["status"] == "completed", finished
        assert finished["result"]["opened"] is True
        assert finished["result"]["project_path"] == str(
            concat.project_folder(clip["id"])
        )
        assert len(processes) == 1
        assert processes[0].poll() is None
        assert processes[0].args == [
            str(concat.find_binary()),
            "--project",
            finished["result"]["project_path"],
        ]
    finally:
        for process in processes:
            process.terminate()
            process.wait(timeout=15)
