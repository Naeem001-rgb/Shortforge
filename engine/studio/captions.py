"""ASS subtitles and approximate burned-in caption-region detection."""

import csv
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from .media import ffmpeg_binary, probe_media

PRESET_DIR = Path(__file__).with_name("presets")
FONT_DIR = Path(__file__).with_name("fonts")
ORDER = ["bold-pop", "karaoke-highlight", "clean-minimal", "neon-glow", "typewriter", "boxed-label", "outline-comic", "gradient-pop", "lower-third", "classic-subtitle"]


def prepare_fonts(export_directory: Path) -> None:
    """Use a simple relative filter path even for Windows or apostrophe paths."""
    destination = export_directory / "fonts"
    destination.mkdir(parents=True, exist_ok=True)
    for filename in ("DejaVuSans.ttf", "LICENSE"):
        shutil.copyfile(FONT_DIR / filename, destination / filename)


def all_presets() -> list[dict]:
    return [json.loads((PRESET_DIR / f"{name}.json").read_text(encoding="utf-8")) for name in ORDER]


def get_preset(name: str) -> dict:
    if name not in ORDER:
        raise ValueError("Choose one of the ten available caption presets.")
    return json.loads((PRESET_DIR / f"{name}.json").read_text(encoding="utf-8"))


def ass_color(color: str) -> str:
    color = color.lstrip("#")
    return f"&H00{color[4:6]}{color[2:4]}{color[0:2]}".upper()


def ass_time(seconds: float) -> str:
    centiseconds = max(0, round(seconds * 100))
    hours, rest = divmod(centiseconds, 360000)
    minutes, rest = divmod(rest, 6000)
    seconds, fraction = divmod(rest, 100)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{fraction:02d}"


def ass_text(text: str) -> str:
    # Override tags are never accepted from a narration or transcript.
    return text.replace("\\", "＼").replace("{", "｛").replace("}", "｝").replace("\r", " ").replace("\n", " ")


def shifted_words(words: list[dict], offset: float, duration: float) -> list[dict]:
    result = []
    for word in words:
        start, end = float(word["start"]) - offset, float(word["end"]) - offset
        if end <= 0 or start >= duration or end <= start:
            continue
        result.append({"word": str(word["word"]), "start": max(0, start), "end": min(duration, end)})
    return result


def make_ass(words: list[dict], preset: dict, font_size: int, position: float, words_per_line: int, color: str, highlight: str) -> str:
    border_style = 3 if preset.get("box") else 1
    outline = ass_color(highlight) if preset["animation"] == "glow" else "&H00000000"
    primary = ass_color(highlight if preset["animation"] == "karaoke" else color)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{preset['font']},{font_size},{primary},{ass_color(color)},{outline},&H80000000,{-1 if preset['weight'] >= 600 else 0},0,0,0,100,100,0,0,{border_style},{preset['stroke']},{preset['shadow']},5,70,70,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    y = round(position * 1920)
    for index in range(0, len(words), words_per_line):
        group = words[index:index + words_per_line]
        if not group:
            continue
        start, end = float(group[0]["start"]), float(group[-1]["end"])
        if end <= start:
            continue
        base_tags = f"\\an5\\pos(540,{y})"
        animation = preset["animation"]
        if animation == "pop":
            base_tags += "\\fscx85\\fscy85\\t(0,100,\\fscx100\\fscy100)"
        elif animation == "fade":
            base_tags += "\\fad(80,80)"
        elif animation == "glow":
            base_tags += "\\blur3"
        elif animation == "slide":
            base_tags = f"\\an5\\move(540,{y+24},540,{y},0,150)\\fad(80,80)"
        tokens = []
        for number, word in enumerate(group):
            token = ass_text(word["word"])
            if animation == "karaoke":
                # Include silence between words, so later syllables do not drift.
                next_start = float(group[number + 1]["start"]) if number + 1 < len(group) else float(word["end"])
                token = "{\\kf" + str(max(1, round((next_start - float(word["start"])) * 100))) + "}" + token
            elif animation == "gradient":
                ratio = number / max(1, len(group) - 1)
                mixed = "#" + "".join(f"{round(int(color[i:i+2],16)*(1-ratio)+int(highlight[i:i+2],16)*ratio):02X}" for i in (1, 3, 5))
                token = "{\\c" + ass_color(mixed) + "&}" + token
            tokens.append(token)
        if animation == "typewriter":
            for number, word in enumerate(group):
                event_end = float(group[number + 1]["start"]) if number + 1 < len(group) else end
                if event_end > float(word["start"]):
                    lines.append(f"Dialogue: 0,{ass_time(float(word['start']))},{ass_time(event_end)},Default,,0,0,0,,{{{base_tags}}}" + " ".join(tokens[:number + 1]))
        else:
            lines.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{{{base_tags}}}" + " ".join(tokens))
    return header + "\n".join(lines) + "\n"


def detect_caption_region(source: Path) -> dict:
    fallback = {"x": 0.05, "y": 0.60, "width": 0.90, "height": 0.18, "detected": False, "method": "suggested-region", "message": "Suggested region only. Adjust it over the old captions; blur and cover are approximate, not AI inpainting."}
    if not shutil.which("tesseract"):
        return {**fallback, "message": "OCR is not installed. A suggested caption band is shown; adjust it over the old text. Install Tesseract to enable frame sampling."}
    duration = probe_media(source)["duration"]
    boxes = []
    successful_frames = 0
    with tempfile.TemporaryDirectory(prefix="shortforge-ocr-") as temporary:
        for sample in range(8):
            frame = Path(temporary) / f"frame-{sample}.png"
            command = [ffmpeg_binary(), "-v", "error", "-ss", str(duration * (sample + 0.5) / 8), "-i", str(source), "-frames:v", "1", "-vf", "scale=360:640:force_original_aspect_ratio=increase,crop=360:640", "-y", str(frame)]
            process = subprocess.run(command, capture_output=True, timeout=30)
            if process.returncode:
                continue
            ocr = subprocess.run(["tesseract", str(frame), "stdout", "--psm", "11", "tsv"], capture_output=True, text=True, timeout=30)
            if ocr.returncode:
                continue
            successful_frames += 1
            for row in csv.DictReader(io.StringIO(ocr.stdout), delimiter="\t"):
                try:
                    if float(row["conf"]) < 50 or not row["text"].strip():
                        continue
                    x, y, width, height = (int(row[key]) for key in ("left", "top", "width", "height"))
                    if 0.25 < y / 640 < 0.92 and height > 5:
                        boxes.append((x, y, x + width, y + height))
                except (KeyError, TypeError, ValueError):
                    continue
    if not boxes:
        return {**fallback, "message": f"No reliable caption text was found in {successful_frames} sampled frames. Adjust the suggested band manually."}
    x1 = max(0, min(box[0] for box in boxes) - 8) / 360
    y1 = max(0, min(box[1] for box in boxes) - 8) / 640
    x2 = min(360, max(box[2] for box in boxes) + 8) / 360
    y2 = min(640, max(box[3] for box in boxes) + 8) / 640
    return {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1, "detected": True, "method": "tesseract-eight-frames", "message": "Text found in sampled frames. Check the box: scene text may also be included. Removal is approximate."}
