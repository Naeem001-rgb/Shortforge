"""Full-track speech checks never turn broken/partial audio into silence."""
import io
import json
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace

import pytest

from engine.studio import scout_speech as speech
from engine.studio import setup_scout_speech as setup
from engine.studio.media import ffmpeg_binary


@pytest.fixture(scope="module")
def media(tmp_path_factory):
    directory = tmp_path_factory.mktemp("scout-speech")
    try:
        ffmpeg = ffmpeg_binary()
    except ValueError:
        pytest.skip("FFmpeg is needed for generated audio/video fixtures")

    def create(name, audio=None, filters=()):
        path = directory / f"{name}.mp4"
        inputs = ["-f", "lavfi", "-i", "color=s=160x240:r=25:d=4"]
        if audio:
            inputs += ["-f", "lavfi", "-i", audio]
        subprocess.run([ffmpeg, "-v", "error", *inputs, "-t", "4", *filters,
                        "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", str(path)], check=True, timeout=15, capture_output=True)
        return path

    paths = {
        "no_audio": create("no-audio"),
        "silence": create("silence", "anullsrc=r=48000:cl=mono"),
        "tones": create("tones", "aevalsrc=0.08*sin(2*PI*220*t)+0.04*sin(2*PI*330*t)+0.03*sin(2*PI*440*t):s=48000"),
        "short_audio": create("short-audio", "sine=frequency=440:duration=2"),
        "late_audio": create("late-audio", "sine=frequency=440:duration=4", ("-af", "asetpts=PTS+0.5/TB")),
    }
    synth = shutil.which("espeak") or shutil.which("espeak-ng")
    if synth:
        wave = directory / "speech.wav"
        subprocess.run([synth, "-s", "175", "-w", str(wave),
                        "The narrator explains an ancient technique. Listen for these spoken words."],
                       check=True, timeout=15, capture_output=True)
        path = directory / "late-speech.mp4"
        # Leading silence ensures the detector cannot pass after an intro sample.
        subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=s=160x240:r=25:d=9",
                        "-i", str(wave), "-af", "adelay=3000,apad", "-t", "9",
                        "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path)],
                       check=True, timeout=15, capture_output=True)
        paths["speech"] = path
    return paths


@pytest.mark.parametrize("name", ["silence", "tones"])
def test_real_local_model_accepts_full_silence_and_music_like_tones(media, name):
    if not speech.speech_capability()["available"]:
        pytest.skip("Explicit local Scout speech setup has not been run")
    result = speech.inspect_speech(media[name], 4)
    assert result["speech_status"] == "absent", result
    assert result["speech_seconds"] == 0
    assert result["speech_analysis_duration"] == pytest.approx(4, abs=.04)
    assert "Silero" in result["speech_model"]


def test_real_local_model_finds_speech_after_silent_intro(media):
    if "speech" not in media or not speech.speech_capability()["available"]:
        pytest.skip("Local model and eSpeak are required for the real speech fixture")
    result = speech.inspect_speech(media["speech"], 9)
    assert result["speech_status"] == "present", result
    assert result["speech_seconds"] > 1
    assert result["speech_analysis_duration"] == pytest.approx(9, abs=.04)


def test_verified_no_audio_requires_full_video_but_no_model(media, monkeypatch):
    monkeypatch.setattr(speech, "speech_capability", lambda: {"available": False, "message": "not installed"})
    result = speech.inspect_speech(media["no_audio"], 4)
    assert result["speech_status"] == "absent", result
    assert result["speech_analysis_duration"] == 4
    assert speech.inspect_speech(media["no_audio"], 8)["speech_status"] == "unknown"


@pytest.mark.parametrize("name", ["short_audio", "late_audio"])
def test_real_missing_audio_coverage_is_unknown(media, monkeypatch, name):
    monkeypatch.setattr(speech, "speech_capability", lambda: {"available": True})
    monkeypatch.setattr(speech, "_speech_seconds", lambda audio: pytest.fail("Incomplete audio reached the model"))
    result = speech.inspect_speech(media[name], 4)
    assert result["speech_status"] == "unknown", result
    assert result["speech_seconds"] is None
    assert result["speech_analysis_duration"] == 0


def test_truncated_or_missing_file_never_counts_as_silent(media, tmp_path):
    incomplete = tmp_path / "truncated.mp4"
    complete = media["silence"].read_bytes()
    incomplete.write_bytes(complete[:len(complete) // 2])
    assert speech.inspect_speech(incomplete, 4)["speech_status"] == "unknown"
    assert speech.inspect_speech(tmp_path / "missing.mp4", 4)["speech_status"] == "unknown"


def test_missing_model_is_unknown_and_never_downloads(media, monkeypatch, tmp_path):
    monkeypatch.setattr(speech, "model_path", lambda: tmp_path / "missing.onnx")
    monkeypatch.setattr(setup.urllib.request, "urlopen", lambda *a, **k: pytest.fail("Scouting attempted a download"))
    result = speech.inspect_speech(media["silence"], 4)
    assert result["speech_status"] == "unknown", result
    assert "setup_scout_speech" in result["reason"]


@pytest.mark.parametrize("stage,error", [
    ("_probe_source", subprocess.TimeoutExpired("ffmpeg", 90)),
    ("_probe_source", json.JSONDecodeError("bad json", "broken", 0)),
    ("_decode_audio", ValueError("Audio decoding failed")),
    ("_speech_seconds", RuntimeError("ONNX failed")),
])
def test_failed_analysis_is_never_absent(monkeypatch, stage, error):
    monkeypatch.setattr(speech, "_probe_source", lambda *args: (4, {"codec_type": "audio"}))
    monkeypatch.setattr(speech, "_decode_audio", lambda *args: [0] * 64000)
    monkeypatch.setattr(speech, "speech_capability", lambda: {"available": True})
    monkeypatch.setattr(speech, "_speech_seconds", lambda *args: 0)
    def broken(*args):
        raise error
    monkeypatch.setattr(speech, stage, broken)
    result = speech.inspect_speech(Path("unused"), 4)
    assert result["speech_status"] == "unknown"
    assert result["speech_seconds"] is None


@pytest.mark.parametrize("kind", ["missing_frames", "multiple_audio", "short_audio", "late_audio", "decode_error"])
def test_ffprobe_verification_rejects_incomplete_or_ambiguous_tracks(monkeypatch, kind):
    video = {"codec_type": "video", "duration": "4", "start_time": "0", "nb_read_frames": "100", "nb_frames": "100", "avg_frame_rate": "25/1"}
    audio = {"codec_type": "audio", "duration": "4", "start_time": "0", "nb_read_frames": "190"}
    streams = [video, audio]
    if kind == "missing_frames":
        video["nb_read_frames"] = "30"
    if kind == "multiple_audio":
        streams.append(dict(audio))
    if kind == "short_audio":
        audio["duration"] = "2"
    if kind == "late_audio":
        audio["start_time"] = "1"
    monkeypatch.setattr(speech, "ffprobe_binary", lambda: "ffprobe")
    monkeypatch.setattr(speech.subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=0,
        stdout=json.dumps({"streams": streams}), stderr="decode error" if kind == "decode_error" else ""))
    assert speech.inspect_speech(Path("unused"), 4)["speech_status"] == "unknown"


def test_setup_rejects_wrong_checksum_preserving_existing_model(tmp_path, monkeypatch):
    target = tmp_path / "model.onnx"
    target.write_bytes(b"existing incomplete model")
    monkeypatch.setattr(setup, "model_path", lambda: target)
    monkeypatch.setattr(setup.urllib.request, "urlopen", lambda *a, **k: io.BytesIO(b"wrong download"))
    with pytest.raises(ValueError, match="checksum"):
        setup.install_model()
    assert target.read_bytes() == b"existing incomplete model"
    assert list(tmp_path.iterdir()) == [target]


def test_setup_check_does_not_install(monkeypatch):
    monkeypatch.setattr(setup.sys, "argv", ["setup_scout_speech", "--check"])
    monkeypatch.setattr(setup, "install_model", lambda: pytest.fail("Read-only check tried to install"))
    monkeypatch.setattr(setup, "speech_capability", lambda: {"available": False, "message": "Missing local model"})
    assert setup.main() == 1
