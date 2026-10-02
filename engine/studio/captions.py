"""ASS subtitles and approximate burned-in caption-region detection."""

import csv
import io
import json
from pathlib import Path
import re
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


CAPTION_DEFAULTS = {
    "case_style": "none",
    "line_height": 1.0,
    "emphasis": "none",
    "emphasis_scope": "all",
    "emphasis_words": "none",
    "emphasis_keywords": (),
    "emphasis_case": "none",
    "emphasis_bold": True,
    "emphasis_color": "#f9e54c",
    "color_ramp": "none",
    "ramp_color": "#ff2d55",
    "glow": 0.0,
    "glow_color": "#7c5cff",
    "shadow_color": "#000000",
    "shadow_opacity": 0.5,
    "shadow_soft": 0.0,
    "box_padding": 0.0,
    "chip": "none",
}

# libass renders DejaVu Sans with roughly 1.16em of natural leading, so the
# dashboard multiplies the CSS line box by this to land on the same leading
# that `\fsp` produces. Keep in step with textAppearance() in textPresets.ts.
FONT_LEADING = 1.16

# Motion length shared with EMPHASIS_MS on the dashboard side.
EMPHASIS_MS = 180

EMPHASIS_TAGS = {
    "pop": "\\fscx135\\fscy135\\t(0,180,\\fscx100\\fscy100)",
    "tilt": "\\frz-14\\t(0,180,\\frz0)",
    "flash": "\\alpha&H40&\\t(0,180,\\alpha&H00&)",
    "shake": "\\frz-7\\t(0,70,\\frz7)\\t(70,180,\\frz0)",
}


def caption_fields(style) -> dict:
    """New TextStyle fields with their TypeScript defaults.

    Read with getattr so a caption keeps rendering on an engine whose
    TextStyle has not gained the columns yet.
    """
    values = dict(CAPTION_DEFAULTS)
    for name in CAPTION_DEFAULTS:
        value = getattr(style, name, None)
        if value is not None:
            values[name] = value
    return values


def number(value) -> str:
    """Same formatting as editor_render.number(); captions must not import it."""
    return format(float(value), ".10g")


def ass_escape(value: str) -> str:
    """Override tags are never accepted from a transcript or a narration."""
    return (
        value.replace("\\", "＼")
        .replace("{", "｛")
        .replace("}", "｝")
        .replace("\r", "")
        .replace("\n", "\\N")
    )


def ass_color_alpha(color: str, alpha: float) -> str:
    """`&HAABBGGRR` with alpha 0 (opaque) to 1 (invisible)."""
    value = color.lstrip("#")
    if len(value) != 6:
        value = "000000"
    byte = max(0, min(255, int((1 - max(0.0, min(1.0, alpha))) * 255 + 0.5)))
    return f"&H{byte:02X}{value[4:6]}{value[2:4]}{value[0:2]}".upper()


def mix_color(first: str, second: str, amount: float) -> str:
    """sRGB blend, rounded exactly like Math.round on the dashboard."""
    amount = max(0.0, min(1.0, amount))

    def channel(offset: int) -> int:
        try:
            a = int(first.lstrip("#")[offset:offset + 2], 16)
            b = int(second.lstrip("#")[offset:offset + 2], 16)
        except ValueError:
            return 255
        return max(0, min(255, int(a * (1 - amount) + b * amount + 0.5)))

    return "#%02X%02X%02X" % (channel(0), channel(2), channel(4))


def fold_case(value: str, mode: str) -> str:
    """Mirror of foldCase() in textPresets.ts, character for character."""
    if mode == "upper":
        return value.upper()
    if mode == "lower":
        return value.lower()
    if mode == "title":
        return re.sub(r"\S+", lambda m: m.group(0)[:1].upper() + m.group(0)[1:], value)
    if mode == "sentence":
        lower = value.lower()
        found = re.search(r"[a-z]", lower)
        if not found:
            return lower
        return lower[:found.start()] + lower[found.start()].upper() + lower[found.start() + 1:]
    return value


def caption_source(item, style) -> str:
    """The caption string after `uppercase` and `case_style`."""
    value = item.text.upper() if style.uppercase else item.text
    return fold_case(value, caption_fields(style)["case_style"])


def split_words(text: str) -> list[str]:
    """Keep the trailing space, exactly like /\\S+\\s*/g in the dashboard."""
    return re.findall(r"\S+\s*", text)


def _bare(word: str) -> str:
    return re.sub(r"[^a-z0-9]", "", word.lower())


def key_word_indexes(words: list[str], style) -> set[int]:
    """Mirror of keyWordIndexes(); ties go to the earliest word."""
    fields = caption_fields(style)
    mode = fields["emphasis_words"]
    keys: set[int] = set()
    if mode == "none" or not words:
        return keys
    if mode == "all":
        return set(range(len(words)))
    if mode == "keyword":
        wanted = {_bare(word) for word in fields["emphasis_keywords"]}
        wanted.discard("")
        return {index for index, word in enumerate(words) if _bare(word) in wanted}
    if mode == "last":
        return {len(words) - 1}
    if mode == "first":
        return {0}
    best = 0
    for index, word in enumerate(words):
        if len(word.strip()) > len(words[best].strip()):
            best = index
    return {best}


def word_color(index: int, total: int, base: str, fields: dict, is_key: bool) -> str:
    if fields["color_ramp"] == "words" and total > 1:
        return mix_color(base, fields["ramp_color"], index / (total - 1))
    return fields["emphasis_color"] if is_key else base


def box_padding(fields: dict, font_size: float, has_background: bool) -> float:
    if fields["box_padding"] > 0:
        return fields["box_padding"]
    return max(2, font_size * 0.14) if has_background else 0


def _word_body(index, word, words, item, fields, keys, pop, active=None):
    """One word of a caption line, wrapped in its own override block.

    A block per word stops overrides leaking sideways, which is what lets the
    colour and weight of a highlighted word end cleanly on the next one.
    """
    style = item.text_style
    total = len(words)
    is_key = index in keys
    body = word
    if is_key and fields["emphasis_case"] != "none":
        body = fold_case(word, fields["emphasis_case"])
    tags = []
    if style.reveal == "karaoke" and total and active is None:
        # `\k`, not `\kf`: the canvas flips a whole word to the highlight colour
        # the moment it becomes current, and a within-word sweep would disagree.
        tags.append("\\k" + str(max(1, round(item.duration * 100 / total))))
    elif style.reveal == 'karaoke' and active is not None:
        tags.append('\\1c' + ass_color(style.highlight if index == active else item.color) + '&')
    if fields["color_ramp"] == "words" or is_key:
        tags.append("\\1c" + ass_color(word_color(index, total, item.color, fields, is_key)) + "&")
    if is_key and fields["emphasis_bold"]:
        tags.append("\\b1")
    if pop == index:
        tags.append(EMPHASIS_TAGS.get(fields["emphasis"], ""))
    prefix = "".join(tags)
    return "{" + prefix + "}" + ass_escape(body) if prefix else ass_escape(body)


def caption_line(words, item, fields, keys, pop=-1, count=0, active=None):
    """A whole caption line, word by word, in reading order."""
    shown = words[:count] if count else words
    return "".join(_word_body(index, word, words, item, fields, keys, pop, active) for index, word in enumerate(shown))


STYLE_FORMAT = (
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
    "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
    "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
)


def caption_ass(item, width: int, height: int, ratio: float) -> str:
    """The whole ASS document for one text item.

    Layer order bottom to top: outer glow, soft shadow, background box, text.
    Every colour, weight and motion comes from the item's own text_style, so
    the export cannot drift from the dashboard's captionWords().
    """
    style = item.text_style
    fields = caption_fields(style)
    font_size = item.font_size * ratio
    margin = round(width * 0.05)
    alignment = {"left": 4, "center": 5, "right": 6}[style.align]
    words = split_words(caption_source(item, style))
    keys = key_word_indexes(words, style)
    has_background = item.text_background != "transparent"
    padding = box_padding(fields, font_size, has_background) * ratio
    karaoke = style.reveal == "karaoke"
    primary = ass_color(style.highlight if karaoke and fields["color_ramp"] == "none" else item.color)
    secondary = ass_color(item.color)
    shadow_byte = ass_color_alpha(fields["shadow_color"], fields["shadow_opacity"])
    common = "%d,%d,0,0,100,100,%s,0" % (
        -1 if style.bold else 0,
        -1 if style.italic else 0,
        number(style.letter_spacing * ratio),
    )
    # Line spacing is an override, not a style field: the eighth numeric slot
    # in a V4+ style line is the baseline angle, which stays at zero.
    leading = "\\fsp" + number(round(font_size * (fields["line_height"] - 1), 2))
    tail = "%d,%d,%d,0,1" % (alignment, margin, margin)
    styles = "Style: Default,DejaVu Sans,%s,%s,%s,%s,%s,%s,1,%s,%s,%s\n" % (
        number(font_size), primary, secondary, ass_color(style.stroke_color), shadow_byte,
        common, number(style.stroke * ratio), number(style.shadow * ratio), tail,
    )
    if has_background:
        background = ass_color(item.text_background)
        styles += "Style: Box,DejaVu Sans,%s,%s,%s,%s,%s,%s,3,%s,0,%s\n" % (
            number(font_size), secondary, secondary, background, background,
            common, number(max(2, padding)), tail,
        )
    if fields["glow"] > 0:
        glow = ass_color(fields["glow_color"])
        styles += "Style: Glow,DejaVu Sans,%s,%s,%s,%s,%s,%s,1,0,0,%s\n" % (
            number(font_size), glow, glow, glow, glow, common, tail,
        )
    if fields["shadow_soft"] > 0:
        styles += "Style: Soft,DejaVu Sans,%s,%s,%s,%s,%s,%s,1,0,0,%s\n" % (
            number(font_size), ass_color(fields["shadow_color"]), secondary,
            ass_color(fields["shadow_color"]), shadow_byte, common, tail,
        )
    styles=styles.replace(',DejaVu Sans,', ',' + item.font_family + ',')
    body = "".join(ass_escape(word) for word in words)
    duration = item.duration
    events = []

    def dialogue(layer, start, end, name, text):
        events.append("Dialogue: %d,%s,%s,%s,,0,0,0,,{%s}%s" % (
            layer, ass_time(start), ass_time(end), name, leading, text))

    # `\alpha` swallows hex digits greedily, so the value has to be closed with
    # the &H..& wrapper or the rest of the colour ends up on screen as text.
    def alpha_tag(color: str, alpha: float) -> str:
        return "\\alpha" + ass_color_alpha(color, alpha)

    # The word the preview calls current is the only one that moves, and it
    # moves for the whole of its slice of the caption duration. A typewriter
    # reveal takes precedence and hides the motion, exactly as it does on the
    # canvas, but the decorative layers still have to grow with it.
    slices = max(1, len(words))
    motion = fields["emphasis"] if fields["emphasis"] in EMPHASIS_TAGS else "none"
    if motion != "none" and fields["emphasis_scope"] == "key" and not keys:
        motion = "none"
    timed=bool(item.caption_words)
    if timed:
        # Timed captions use recognition/edit timestamps, including silence.
        # Never replace real timing with evenly spaced estimated word slices.
        boundaries=sorted({0,duration,*[w.start for w in item.caption_words],*[w.end for w in item.caption_words]})
        segments=[]
        for start,end in zip(boundaries,boundaries[1:]):
            active=next((i for i,w in enumerate(item.caption_words) if w.start<=start<w.end),-1)
            count=sum(w.start<=start for w in item.caption_words) if style.reveal=='typewriter' else 0
            if style.reveal=='typewriter' and not count:
                continue
            moving=active if motion!='none' and (fields['emphasis_scope']!='key' or active in keys) else -1
            segments.append((start,end,count,moving,active))
    elif style.reveal == "typewriter":
        segments = [(index * duration / slices, (index + 1) * duration / slices, index + 1, -1) for index in range(len(words))]
    elif motion != "none" and words:
        segments = []
        for index in range(len(words)):
            moving = index if fields["emphasis_scope"] != "key" or index in keys else -1
            segments.append((index * duration / slices, (index + 1) * duration / slices, 0, moving))
    else:
        segments = [(0, duration, 0, -1)]

    for segment in segments:
        start,end,count,pop=segment[:4]
        active=segment[4] if timed else None
        shown = body if not count else "".join(ass_escape(word) for word in words[:count])
        if not shown:
            continue
        # Glow is two stacked outlines, the outer one wider and fainter. ASS
        # cannot blur a copy of the text, so the halo is repeated strokes.
        if fields["glow"] > 0:
            for spread, alpha, blur in ((0.55, 0.9, 0.15), (1.0, 0.45, 0.3)):
                dialogue(0, start, end, "Glow", "{\\bord%s\\shad0\\blur%s%s}%s" % (
                    number(fields["glow"] * ratio * spread),
                    number(fields["glow"] * ratio * blur),
                    alpha_tag(fields["glow_color"], alpha),
                    shown,
                ))
        if fields["shadow_soft"] > 0:
            dialogue(1, start, end, "Soft", "{\\shad%s\\blur%s%s}%s" % (
                number(fields["shadow_soft"] * ratio * 0.4),
                number(fields["shadow_soft"] * ratio * 0.5),
                alpha_tag(fields["shadow_color"], fields["shadow_opacity"]),
                shown,
            ))
        if has_background:
            dialogue(2, start, end, "Box", shown)
        dialogue(3, start, end, "Default", caption_line(words, item, fields, keys, pop=pop, count=count, active=active))

    dropped = [name for name in ("chip",) if fields[name] != "none"]
    notice = ""
    if dropped:
        # Never let a preview-only effect pass for something that exported.
        notice = "Comment: 0,0:00:00.00,0:10:00.00,Default,,0,0,0,,preview-only, not rendered: %s\n" % ", ".join(dropped)
    header = (
        "[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\n"
        "WrapStyle: 0\nScaledBorderAndShadow: yes\n" % (width, height)
    )
    return (
        header
        + "[V4+ Styles]\n"
        + STYLE_FORMAT
        + styles
        + "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        + notice
        + "\n".join(events)
        + "\n"
    )


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
