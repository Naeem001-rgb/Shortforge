"""Scout filtering must never pass an unreadable or only partially scanned clip."""
from pathlib import Path
from threading import BoundedSemaphore, Event
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from engine.core import db, scout_routes
from engine.core.scout_routes import router
from engine.studio import scout_captions as scout


@pytest.mark.parametrize("samples,duration,allowance,status,seconds", [
    ([False] * 20, 10, 3, "clear", 0),
    ([True] * 6 + [False] * 14, 10, 3, "brief", 3),
    ([False] * 14 + [True] * 6, 10, 3, "brief", 3),
    ([False] * 13 + [True] * 7, 10, 3, "persistent", 3.5),
    ([True] * 20, 10, 3, "persistent", 10),
    ([False, True], .7, .2, "brief", .2),
    ([True], .5, 0, "persistent", .5),
])
def test_total_caption_time_and_brief_allowance(samples, duration, allowance, status, seconds):
    result = scout.classify_samples(samples, duration, allowance)
    assert result["status"] == status
    assert result["caption_seconds"] == pytest.approx(seconds)
    assert result["coverage"] == pytest.approx(seconds / duration, abs=.0001)


@pytest.mark.parametrize("samples,duration", [([], 0), ([], 10), ([False] * 19, 10), ([False] * 21, 10)])
def test_missing_samples_never_count_as_clear(samples, duration):
    assert scout.classify_samples(samples, duration, 3)["status"] == "unknown"


def result(text, box, score=.95):
    return SimpleNamespace(txts=(text,), scores=(score,), boxes=(box,))


def test_full_picture_and_static_captions_count_but_obvious_corner_handle_does_not():
    assert scout.has_caption_text(result("TOP CAPTION", [[15, 15], [300, 15], [300, 55], [15, 55]]), 360, 640)
    assert scout.has_caption_text(result("SUBTITLE", [[100, 330], [300, 330], [300, 380], [100, 380]]), 360, 640)
    assert not scout.has_caption_text(result("@creator", [[5, 5], [100, 5], [100, 20], [5, 20]]), 360, 640)
    with pytest.raises(ValueError, match="readable"):
        scout.has_caption_text(None, 360, 640)
    with pytest.raises(ValueError, match="incomplete"):
        scout.has_caption_text(SimpleNamespace(txts=["broken"], scores=None, boxes=None), 360, 640)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    monkeypatch.setattr(scout, "SLOTS", BoundedSemaphore(1))
    monkeypatch.setattr(scout, "CANCEL_EVENTS", {})
    monkeypatch.setattr(scout, "caption_capability", lambda: {"available": True})
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as session:
        yield session


def test_caption_job_identity_and_no_library_side_effects(client, monkeypatch):
    directories = []
    def successful(config, directory, cancel, progress):
        directories.append(directory)
        (directory / "source.mp4").write_bytes(b"temporary")
        return scout.classify_samples([False] * 20, 10, config["max_caption_seconds"])
    monkeypatch.setattr(scout, "run_worker", successful)
    response = client.post("/api/scout/caption-check", json={"url": "https://instagram.com/reel/ABCdef123/?igsh=x"})
    assert response.status_code == 200, response.text
    job = db.get_job(response.json()["id"])
    assert job["status"] == "completed"
    assert job["clip_id"] is None
    assert job["result"]["video_id"] == "ig:ABCdef123"
    assert job["result"]["url"] == "https://www.instagram.com/reel/ABCdef123/"
    assert job["result"]["max_caption_seconds"] == 3
    assert job["result"]["status"] == "clear"
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM clips").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0] == 0
    assert all(not directory.exists() for directory in directories)


@pytest.mark.parametrize("failure", [ValueError("Download failed"), RuntimeError("OCR failed")])
def test_worker_failure_fails_closed_and_cleans_download(client, monkeypatch, failure):
    directories = []
    def broken(config, directory, cancel, progress):
        directories.append(directory)
        (directory / "source.mp4.part").write_bytes(b"partial download")
        raise failure
    monkeypatch.setattr(scout, "run_worker", broken)
    response = client.post("/api/scout/caption-check", json={"url": "https://youtu.be/tleaVXWF3YI"})
    job = db.get_job(response.json()["id"])
    assert job["status"] == "failed"
    assert job["result"]["status"] == "unknown"
    assert job["result"]["caption_seconds"] is None
    assert all(not directory.exists() for directory in directories)
    assert scout.SLOTS.acquire(blocking=False)
    scout.SLOTS.release()


def test_cancellation_during_scan_is_failed_and_cleans_download(client, monkeypatch):
    directories = []
    def cancelled(config, directory, cancel, progress):
        directories.append(directory)
        (directory / "source.mp4").write_bytes(b"video")
        cancel.set()
        return scout.classify_samples([False] * 20, 10, 3)
    monkeypatch.setattr(scout, "run_worker", cancelled)
    response = client.post("/api/scout/caption-check", json={"url": "https://youtu.be/tleaVXWF3YI"})
    job = db.get_job(response.json()["id"])
    assert job["status"] == "failed"
    assert "cancelled" in job["error"]
    assert job["result"]["status"] == "unknown"
    assert all(not directory.exists() for directory in directories)


def test_missing_dependency_busy_invalid_url_and_threshold_are_rejected(client, monkeypatch):
    monkeypatch.setattr(scout, "caption_capability", lambda: {"available": False, "message": "Install local OCR"})
    response = client.post("/api/scout/caption-check", json={"url": "https://youtu.be/tleaVXWF3YI"})
    assert response.status_code == 503
    assert response.json()["detail"] == "Install local OCR"
    monkeypatch.setattr(scout, "caption_capability", lambda: {"available": True})
    scout.SLOTS.acquire()
    try:
        assert client.post("/api/scout/caption-check", json={"url": "https://youtu.be/tleaVXWF3YI"}).status_code == 409
    finally:
        scout.SLOTS.release()
    for payload in [{"url": "http://127.0.0.1/private"},
                    {"url": "https://youtu.be/tleaVXWF3YI", "max_caption_seconds": 11}]:
        assert client.post("/api/scout/caption-check", json=payload).status_code == 422
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0


def test_cancel_is_scoped_and_signals_worker(client, monkeypatch):
    monkeypatch.setattr(scout_routes, "CANCEL_WAIT_SECONDS", .03)
    unrelated = db.new_job("download", None)
    assert client.post(f"/api/scout/caption-check/{unrelated['id']}/cancel").status_code == 404
    job = db.new_job("scout_caption_check", None)
    cancelled = Event()
    db.update_job(job["id"], status="running")
    scout.CANCEL_EVENTS[job["id"]] = cancelled
    response = client.post(f"/api/scout/caption-check/{job['id']}/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "running"
    assert cancelled.is_set()


def test_failed_download_never_reaches_ocr(tmp_path, monkeypatch):
    scan = Mock()
    monkeypatch.setattr(scout, "scan_video", scan)
    monkeypatch.setattr(scout, "download_source", Mock(side_effect=ValueError("Download failed")))
    with pytest.raises(ValueError, match="Download failed"):
        scout.check_in_worker({"url": "https://youtu.be/tleaVXWF3YI", "max_caption_seconds": 3}, tmp_path)
    scan.assert_not_called()


def test_missing_frame_and_ocr_errors_fail_closed(tmp_path, monkeypatch):
    cv2 = pytest.importorskip("cv2")
    capture = Mock()
    capture.get.side_effect = lambda key: {cv2.CAP_PROP_FPS: 10, cv2.CAP_PROP_FRAME_COUNT: 100}.get(key, 0)
    capture.read.return_value = (False, None)
    monkeypatch.setattr(cv2, "VideoCapture", lambda _: capture)
    with pytest.raises(ValueError, match="could not be read"):
        scout.scan_video(tmp_path / "bad.mp4", 10, 3, reader=Mock())
    capture.release.assert_called_once()


def test_real_local_ocr_detects_late_captions_anywhere_in_full_frame(tmp_path):
    """Real model and video decoding: blank opening, three seconds at the top."""
    if not scout.caption_capability()["available"]:
        pytest.skip("Local OCR models are not installed; no downloads in tests")
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")
    path = tmp_path / "caption-test.mp4"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (360, 640))
    if not writer.isOpened():
        pytest.skip("No MP4 encoder in installed OpenCV")
    try:
        for index in range(60):
            frame = np.zeros((640, 360, 3), dtype=np.uint8)
            if index >= 30:
                cv2.putText(frame, "HELLO THERE", (20, 110), cv2.FONT_HERSHEY_SIMPLEX, .9, (255, 255, 255), 2)
            writer.write(frame)
    finally:
        writer.release()
    result = scout.scan_video(path, 6, 3)
    assert result["frames_scanned"] == 12
    assert result["status"] == "brief", result
    assert result["caption_seconds"] == 3
    assert result["coverage"] == .5


@pytest.mark.parametrize("cancel_first", [False, True])
def test_worker_process_is_terminated_on_timeout_or_cancel(tmp_path, monkeypatch, cancel_first):
    import subprocess
    import sys
    processes = []
    real_popen = subprocess.Popen
    def sleeper(command, **kwargs):
        process = real_popen([sys.executable, "-c", "import time; time.sleep(30)"], **kwargs)
        processes.append(process)
        return process
    monkeypatch.setattr(scout.subprocess, "Popen", sleeper)
    monkeypatch.setattr(scout, "JOB_TIMEOUT", .01)
    cancelled = Event()
    if cancel_first:
        cancelled.set()
    with pytest.raises(ValueError, match="cancelled" if cancel_first else "limit"):
        scout.run_worker({"url": "unused", "max_caption_seconds": 3}, tmp_path, cancelled)
    assert processes[0].poll() is not None


@pytest.mark.parametrize("duration", [0, 181, float("inf")])
def test_long_or_unknown_duration_is_rejected_before_download(tmp_path, monkeypatch, duration):
    yt_dlp = pytest.importorskip("yt_dlp")
    downloader = Mock()
    downloader.__enter__ = Mock(return_value=downloader)
    downloader.__exit__ = Mock(return_value=False)
    downloader.extract_info.return_value = {"duration": duration}
    constructor = Mock(return_value=downloader)
    monkeypatch.setattr(yt_dlp, "YoutubeDL", constructor)
    with pytest.raises(ValueError, match="known duration"):
        scout.download_source("https://youtu.be/tleaVXWF3YI", tmp_path)
    downloader.process_info.assert_not_called()
    options = constructor.call_args.args[0]
    assert options["noplaylist"] is True
    assert options["max_filesize"] == 80 * 1024 * 1024
    assert not any(key in options for key in ("cookiefile", "cookiesfrombrowser", "username", "password"))



def test_cancel_returns_after_temporary_cleanup_and_slot_release(client, monkeypatch):
    from threading import Thread
    import time
    started = Event()
    directories = []
    def delayed_cleanup(config, directory, cancel, progress):
        directories.append(directory)
        (directory / "source.mp4").write_bytes(b"temporary video")
        started.set()
        assert cancel.wait(2)
        time.sleep(.08)  # Model the delay while a worker exits and files close.
        raise ValueError("Caption check cancelled. This clip was skipped.")
    monkeypatch.setattr(scout, "run_worker", delayed_cleanup)
    scout.SLOTS.acquire()
    job = db.new_job("scout_caption_check", None)
    cancelled = Event()
    scout.CANCEL_EVENTS[job["id"]] = cancelled
    worker = Thread(target=scout.caption_check_job, args=(
        job["id"], "tleaVXWF3YI", "https://www.youtube.com/shorts/tleaVXWF3YI", 3, cancelled))
    worker.start()
    try:
        assert started.wait(2)
        response = client.post(f"/api/scout/caption-check/{job['id']}/cancel")
        assert response.status_code == 200
        assert response.json()["status"] == "failed"
        assert "cancelled" in response.json()["error"]
        assert all(not directory.exists() for directory in directories)
        assert scout.SLOTS.acquire(blocking=False)
        scout.SLOTS.release()
        assert job["id"] not in scout.CANCEL_EVENTS
    finally:
        cancelled.set()
        worker.join(timeout=3)
    assert not worker.is_alive()


def test_worker_normalizes_av1_before_scanning_every_bin(tmp_path, monkeypatch):
    import subprocess
    pytest.importorskip("cv2")
    source = tmp_path / "source.mp4"
    encoder = subprocess.run([
        scout.ffmpeg_binary(), "-v", "error", "-f", "lavfi", "-i", "color=black:s=320x480:d=2:r=10",
        "-c:v", "libaom-av1", "-cpu-used", "8", "-crf", "45", "-threads", "2", str(source),
    ], capture_output=True, timeout=30)
    if b"Unknown encoder" in encoder.stderr:
        pytest.skip("Installed FFmpeg cannot create an AV1 regression fixture")
    assert encoder.returncode == 0, encoder.stderr.decode()
    monkeypatch.setattr(scout, "download_source", lambda *args: (source, 2.0))
    reader = Mock(return_value=SimpleNamespace(txts=None))
    monkeypatch.setattr(scout, "make_ocr", lambda: reader)
    outcome = scout.check_in_worker({"url": "unused", "max_caption_seconds": 3}, tmp_path)
    assert outcome["status"] == "clear"
    assert outcome["frames_scanned"] == 4
    assert reader.call_count == 4
    assert outcome["duration"] == 2
    assert not source.exists()
    assert (tmp_path / "ocr-proxy.mp4").is_file()


def test_invalid_video_normalization_never_reaches_ocr(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"not a video")
    monkeypatch.setattr(scout, "download_source", lambda *args: (source, 2.0))
    scan = Mock()
    monkeypatch.setattr(scout, "scan_video", scan)
    with pytest.raises(ValueError, match="decode the complete video"):
        scout.check_in_worker({"url": "unused", "max_caption_seconds": 3}, tmp_path)
    scan.assert_not_called()


def readings(*items):
    return SimpleNamespace(txts=[item[0] for item in items], scores=[item[2] if len(item) > 2 else .95 for item in items],
                           boxes=[item[1] for item in items])


SMALL_BOX = [[120, 500], [204, 500], [204, 520], [120, 520]]
SECOND_BOX = [[130, 540], [214, 540], [214, 560], [130, 560]]


@pytest.mark.parametrize("reading,expected", [
    (result("竹筒饭", SMALL_BOX), (False, True)),
    (readings(("竹筒饭", SMALL_BOX), ("慢火", SECOND_BOX)), (False, True)),
    (result("竹", SMALL_BOX), (False, True)),
    (result("传统手工竹筒饭制作慢慢来", SMALL_BOX), (False, True)),  # Exactly 12 Han characters.
    (result("传统手工竹筒饭制作慢慢来吧", SMALL_BOX), (True, False)),
    (result("竹筒饭", [[50, 500], [300, 500], [300, 520], [50, 520]]), (True, False)),
    (result("竹筒饭", [[120, 500], [204, 500], [204, 550], [120, 550]]), (True, False)),
    (result("COOKING", SMALL_BOX), (True, False)),
    (result("竹筒饭abc", SMALL_BOX), (True, False)),
    (result("竹筒饭", SMALL_BOX, .4), (True, False)),
    (readings(("竹筒饭", SMALL_BOX), ("字幕", SECOND_BOX), ("小字", SMALL_BOX)), (True, False)),
    (readings(("竹筒饭", SMALL_BOX), ("FULL SENTENCE SUBTITLE", SECOND_BOX)), (True, False)),
    (SimpleNamespace(txts=None), (False, False)),
])
def test_only_short_small_han_annotations_are_exempt(reading, expected):
    assert scout.small_text_sample(reading, 360, 640) == expected


def test_combined_annotation_area_is_bounded():
    # Each box is within width/height limits, but together cover >3%.
    box = [[10, 400], [150, 400], [150, 435], [10, 435]]
    assert scout.small_text_sample(readings(("竹筒", box), ("小火", box)), 360, 640) == (True, False)


@pytest.mark.parametrize("reading", [
    result("竹筒饭", SMALL_BOX, float("nan")),
    result("竹筒饭", SMALL_BOX, 1.1),
    result("竹筒饭", [[1, 1], [2, 2]]),
    result("竹筒饭", [[-1, 1], [20, 1], [20, 20], [-1, 20]]),
    result("竹筒饭", [[1, 1], [20, 1], [20, float("nan")], [1, 20]]),
    result(None, SMALL_BOX),
    result("", SMALL_BOX),
    SimpleNamespace(txts=""),
    SimpleNamespace(txts=[], scores=[.9], boxes=[SMALL_BOX]),
    readings(("FIRST SUBTITLE", SMALL_BOX), ("BROKEN", [])),
])
def test_malformed_ocr_never_passes_either_policy(reading):
    with pytest.raises(ValueError, match="readings"):
        scout.small_text_sample(reading, 360, 640)
    with pytest.raises(ValueError, match="readings"):
        scout.has_caption_text(reading, 360, 640)


def speech_result(status="absent", seconds=0, duration=10):
    return {"speech_status": status, "speech_seconds": seconds, "speech_analysis_duration": duration,
            "speech_model": "test-local-vad", "reason": "Speech analysis completed."}


@pytest.mark.parametrize("speech,status", [
    (speech_result(), "clear"),
    (speech_result("present", .5), "speech"),
    (speech_result("unknown", None), "unknown"),
    (speech_result(duration=7), "unknown"),
    (speech_result(duration=100), "unknown"),
    (speech_result("present", 0), "unknown"),
    (speech_result(seconds=.1), "unknown"),
    ({**speech_result(), "speech_model": ""}, "unknown"),
    ({**speech_result(), "speech_seconds": float("nan")}, "unknown"),
    ({**speech_result(), "speech_analysis_duration": True}, "unknown"),
])
def test_text_exception_requires_complete_valid_speech_absence(speech, status):
    text = {**scout.classify_samples([False] * 20, 10, 3), "small_text_seconds": 10,
            "policy": scout.SMALL_TEXT_POLICY}
    assert scout.combine_speech(text, speech)["status"] == status


def test_absent_speech_does_not_waive_other_persistent_captions():
    text = scout.classify_samples([True] * 20, 10, 3)
    assert scout.combine_speech(text, speech_result())["status"] == "persistent"


def test_optional_policy_job_identity_and_failed_fields(client, monkeypatch):
    from engine.studio import scout_speech
    monkeypatch.setattr(scout_speech, "speech_capability", lambda: {"available": True})
    configs = []
    def successful(config, directory, cancel, progress):
        configs.append(config)
        text = {**scout.classify_samples([False] * 20, 10, 3), "small_text_seconds": 10}
        return scout.combine_speech(text, speech_result())
    monkeypatch.setattr(scout, "run_worker", successful)
    payload = {"url": "https://instagram.com/reel/ABCdef123/", "policy": scout.SMALL_TEXT_POLICY}
    response = client.post("/api/scout/caption-check", json=payload)
    assert response.status_code == 200, response.text
    outcome = db.get_job(response.json()["id"])["result"]
    assert response.json()["result"]["policy"] == scout.SMALL_TEXT_POLICY
    assert configs[0]["policy"] == scout.SMALL_TEXT_POLICY
    assert outcome["policy"] == scout.SMALL_TEXT_POLICY
    assert outcome["speech_status"] == "absent"
    assert outcome["small_text_seconds"] == 10
    monkeypatch.setattr(scout, "run_worker", Mock(side_effect=ValueError("Unreadable audio")))
    response = client.post("/api/scout/caption-check", json=payload)
    job = db.get_job(response.json()["id"])
    assert job["status"] == "failed"
    assert job["result"]["policy"] == scout.SMALL_TEXT_POLICY
    assert job["result"]["status"] == "unknown"
    assert job["result"]["speech_status"] == "unknown"
    assert job["result"]["speech_analysis_duration"] is None
    assert job["result"]["small_text_seconds"] is None


def test_optional_policy_requires_local_speech_and_rejects_unknown_policy(client, monkeypatch):
    from engine.studio import scout_speech
    monkeypatch.setattr(scout_speech, "speech_capability", lambda: {"available": False, "message": "Install local speech model"})
    payload = {"url": "https://youtu.be/tleaVXWF3YI", "policy": scout.SMALL_TEXT_POLICY}
    response = client.post("/api/scout/caption-check", json=payload)
    assert response.status_code == 503
    assert response.json()["detail"] == "Install local speech model"
    for value in ("modern", "", None, True):
        assert client.post("/api/scout/caption-check", json={**payload, "policy": value}).status_code == 422
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0


@pytest.mark.parametrize("source_codecs,selected_codec,actual_audio,accepted", [
    (["aac", "none"], "aac", True, True),
    (["none"], "none", False, True),
    (["aac", "none"], "none", False, False),  # An audio track existed but was not selected.
    (["aac"], "aac", False, False),  # The selected audio disappeared in the download.
    (["none"], "none", True, False),
    ([None], "none", False, False),
    (["none", None], "none", False, False),
    ([None], None, True, True),  # Instagram direct MP4 omits acodec; actual audio is present.
    (["aac"], None, True, True),
])
def test_optional_download_verifies_source_audio_not_just_local_silence(tmp_path, monkeypatch,
        source_codecs, selected_codec, actual_audio, accepted):
    yt_dlp = pytest.importorskip("yt_dlp")
    downloader = Mock()
    downloader.__enter__ = Mock(return_value=downloader)
    downloader.__exit__ = Mock(return_value=False)
    downloader.extract_info.return_value = {"duration": 10, "acodec": selected_codec,
        "formats": [{"acodec": codec} for codec in source_codecs]}
    downloader.process_info.side_effect = lambda _: (tmp_path / "source.mp4").write_bytes(b"video")
    constructor = Mock(return_value=downloader)
    monkeypatch.setattr(yt_dlp, "YoutubeDL", constructor)
    monkeypatch.setattr(scout, "probe_media", lambda _: {"audio": actual_audio, "video": True, "duration": 10})
    if accepted:
        path, duration = scout.download_source("https://youtu.be/tleaVXWF3YI", tmp_path, require_audio=True)
        assert path.name == "source.mp4" and duration == 10
    else:
        with pytest.raises(ValueError, match="audio"):
            scout.download_source("https://youtu.be/tleaVXWF3YI", tmp_path, require_audio=True)
    options = constructor.call_args.args[0]
    assert "+ba/" in options["format"]
    assert not any(key in options for key in ("cookiefile", "cookiesfrombrowser", "username", "password"))


def test_optional_worker_checks_original_audio_before_discarding_it(tmp_path, monkeypatch):
    from engine.studio import scout_speech
    source = tmp_path / "source.mp4"
    source.write_bytes(b"original with audio")
    proxy = tmp_path / "ocr-proxy.mp4"
    proxy.write_bytes(b"video without audio")
    download = Mock(return_value=(source, 10))
    monkeypatch.setattr(scout, "download_source", download)
    monkeypatch.setattr(scout, "normalize_source", lambda path: proxy)
    def inspect(path, duration):
        assert path == source and path.read_bytes() == b"original with audio"
        return speech_result()
    monkeypatch.setattr(scout_speech, "inspect_speech", inspect)
    def scan(path, duration, allowance, **kwargs):
        assert path == proxy
        assert not source.exists()
        assert kwargs["policy"] == scout.SMALL_TEXT_POLICY
        return {**scout.classify_samples([False] * 20, 10, allowance), "small_text_seconds": 10,
                "policy": kwargs["policy"]}
    monkeypatch.setattr(scout, "scan_video", scan)
    outcome = scout.check_in_worker({"url": "unused", "max_caption_seconds": 3,
                                     "policy": scout.SMALL_TEXT_POLICY}, tmp_path)
    assert outcome["status"] == "clear" and outcome["speech_status"] == "absent"
    download.assert_called_once_with("unused", tmp_path, require_audio=True)


def test_real_chinese_annotations_are_allowed_but_large_captions_count(tmp_path):
    if not scout.caption_capability()["available"]:
        pytest.skip("Local OCR models are not installed; no downloads in tests")
    font_path = Path("/usr/share/fonts/google-droid-sans-fonts/DroidSansFallbackFull.ttf")
    if not font_path.is_file():
        pytest.skip("No installed Chinese font for the real OCR fixture")
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")
    Image = pytest.importorskip("PIL.Image")
    ImageDraw = pytest.importorskip("PIL.ImageDraw")
    ImageFont = pytest.importorskip("PIL.ImageFont")
    path = tmp_path / "small-chinese.mp4"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (360, 640))
    if not writer.isOpened():
        pytest.skip("No MP4 encoder in installed OpenCV")
    try:
        for index in range(20):
            frame = Image.new("RGB", (360, 640), "black")
            font = ImageFont.truetype(str(font_path), 20 if index < 10 else 52)
            ImageDraw.Draw(frame).text((30, 500), "竹筒饭", font=font, fill="white")
            writer.write(cv2.cvtColor(np.array(frame), cv2.COLOR_RGB2BGR))
    finally:
        writer.release()
    outcome = scout.scan_video(path, 2, .5, policy=scout.SMALL_TEXT_POLICY)
    assert outcome["frames_scanned"] == 4
    assert outcome["small_text_seconds"] == 1, outcome
    assert outcome["caption_seconds"] == 1, outcome
    assert outcome["status"] == "persistent", outcome
