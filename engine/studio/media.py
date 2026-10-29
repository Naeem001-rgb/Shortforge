"""Media utilities with no mandatory model or network dependencies."""

import json
from pathlib import Path
import re
import subprocess
import wave

from engine.core.media import find_ffmpeg, find_ffprobe

LOCAL_MEDIA_FORMATS = "wav,mp3,mov,ogg,flac,matroska,avi"


def ffmpeg_binary() -> str:
    executable = find_ffmpeg()
    if executable:
        return executable
    raise ValueError(
        "FFmpeg is missing. Run the ShortForge setup command or install FFmpeg, then restart the app."
    )


def probe_media(path: Path, *, input_format: str | None = None) -> dict:
    # Some manifest demuxers do not propagate protocol restrictions to nested
    # requests. Admit ordinary media containers as well as local protocols.
    input_options = [
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        LOCAL_MEDIA_FORMATS,
    ]
    if input_format:
        input_options.extend(["-f", input_format])
    ffprobe = find_ffprobe()
    if ffprobe:
        process = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                *input_options,
                "-show_format",
                "-show_streams",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if process.returncode == 0:
            info = json.loads(process.stdout)
            return {
                "duration": float(info.get("format", {}).get("duration", 0)),
                "audio": any(
                    s.get("codec_type") == "audio" for s in info.get("streams", [])
                ),
                "video": any(
                    s.get("codec_type") == "video" for s in info.get("streams", [])
                ),
            }
    # The small packaged FFmpeg binary does not ship ffprobe.
    process = subprocess.run(
        [ffmpeg_binary(), "-hide_banner", *input_options, "-i", str(path)],
        capture_output=True,
        text=True,
        timeout=30,
    )
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", process.stderr)
    if not match:
        raise ValueError(
            "This file could not be read as audio or video. Try an ordinary MP4, WAV or MP3 file."
        )
    duration = int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])
    return {
        "duration": duration,
        "audio": "Audio:" in process.stderr,
        "video": "Video:" in process.stderr,
    }


def audio_duration(path: Path) -> float:
    try:
        with wave.open(str(path)) as audio:
            return audio.getnframes() / audio.getframerate()
    except (wave.Error, EOFError):
        return probe_media(path)["duration"]


def approximate_words(text: str, duration: float) -> list[dict]:
    """Explicit fallback: distribute by word length, never claim alignment."""
    tokens = text.split()
    total = sum(max(2, len(token)) for token in tokens)
    cursor = 0.0
    result = []
    for token in tokens:
        end = cursor + duration * max(2, len(token)) / max(1, total)
        result.append({"word": token, "start": round(cursor, 3), "end": round(end, 3)})
        cursor = end
    return result


def resolve_data_path(data_dir: Path, relative: str) -> Path:
    path = (data_dir / relative).resolve()
    if not path.is_relative_to(data_dir.resolve()) or not path.is_file():
        raise ValueError(
            "The saved media file is missing or outside the local data folder. Add it again."
        )
    return path


def audio_fit_note(
    duration: float,
    voice_duration: float | None,
    audio_mode: str,
    source_has_audio: bool,
    original_volume: float = 1,
    voice_volume: float = 1,
    completed: bool = False,
) -> str:
    """Describe the actual chosen audio behavior before and after rendering."""
    if audio_mode == "original":
        return (
            "This source has no audio; the exported video is silent."
            if not source_has_audio
            else ""
        )
    if voice_duration is None:
        return ""
    notes = []
    if voice_volume == 0:
        notes.append("Voice volume is 0%, so the generated narration is muted.")
    difference = voice_duration - duration
    if difference > 0.05:
        action = "was cut" if completed else "will be cut"
        notes.append(
            f"Voiceover is {voice_duration:.2f}s; selected video is {duration:.2f}s. The last {difference:.2f}s of narration {action}. Shorten the script, adjust voice speed, or select more footage to keep the full narration."
        )
    elif difference < -0.05:
        remaining = (
            "original audio"
            if audio_mode == "mix" and source_has_audio and original_volume > 0
            else "silence"
        )
        action = "contains" if completed else "will contain"
        notes.append(
            f"Voiceover is {voice_duration:.2f}s; selected video is {duration:.2f}s. The remaining {-difference:.2f}s {action} {remaining}. Trim the video end to match if desired."
        )
    return " ".join(notes)
