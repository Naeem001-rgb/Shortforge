"""Real stream preservation checks with small, generated fixtures."""

import subprocess

import pytest

from engine.studio.editor_media import (
    ffmpeg_binary,
    normalize_browser_video,
    probe_media,
)


def stream_hash(path, stream):
    return subprocess.check_output(
        [
            ffmpeg_binary(),
            "-v",
            "error",
            "-i",
            str(path),
            "-map",
            f"0:{stream}:0",
            "-c",
            "copy",
            "-f",
            "hash",
            "-hash",
            "sha256",
            "-",
        ]
    )


@pytest.mark.parametrize(
    "video,audio,preserved", [("libx264", "pcm_s16le", "v"), ("mpeg4", "aac", "a")]
)
def test_normalization_preserves_compatible_stream(tmp_path, video, audio, preserved):
    source = tmp_path / "source.mkv"
    subprocess.run(
        [
            ffmpeg_binary(),
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=64x96:r=10:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:v",
            video,
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            audio,
            str(source),
        ],
        check=True,
        capture_output=True,
    )
    original = source.read_bytes()
    output = normalize_browser_video(source)
    assert output != source and output.suffix == ".mp4"
    assert source.read_bytes() == original
    metadata = probe_media(output)
    assert metadata["has_audio"] and metadata["media_type"] == "video"
    assert abs(metadata["duration"] - 1) < 0.2
    assert stream_hash(source, preserved) == stream_hash(output, preserved)
    assert normalize_browser_video(output) == output


def test_ten_bit_h264_is_converted_to_browser_compatible_eight_bit(tmp_path):
    source = tmp_path / "ten-bit.mp4"
    subprocess.run(
        [
            ffmpeg_binary(),
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=64x96:r=10:d=0.3",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p10le",
            str(source),
        ],
        check=True,
        capture_output=True,
    )
    output = normalize_browser_video(source)
    assert output != source and source.exists()
    inspection = subprocess.run(
        [ffmpeg_binary(), "-hide_banner", "-i", str(output)],
        capture_output=True,
        text=True,
    )
    assert "yuv420p10le" not in inspection.stderr
    assert "yuv420p" in inspection.stderr
    assert probe_media(output)["media_type"] == "video"
