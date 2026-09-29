"""Construct a CPU FFmpeg render command from validated editor settings."""

from pathlib import Path


def pixel_region(region: dict) -> tuple[int, int, int, int]:
    x = max(0, min(1078, int(region["x"] * 1080) // 2 * 2))
    y = max(0, min(1918, int(region["y"] * 1920) // 2 * 2))
    width = max(2, min(1080 - x, int(region["width"] * 1080) // 2 * 2))
    height = max(2, min(1920 - y, int(region["height"] * 1920) // 2 * 2))
    return x, y, width, height


def build_export_command(ffmpeg: str, source: Path, output: Path, options: dict, duration: float, has_audio: bool, voiceover: Path | None = None, ass_name: str | None = None) -> list[str]:
    command = [ffmpeg, "-hide_banner", "-y", "-nostdin", "-ss", str(options["trim_start"]), "-i", str(source)]
    if voiceover:
        command += ["-i", str(voiceover)]
    # Scale and crop before the caption band, matching the editor's vertical preview.
    zoom = options["crop_zoom"]
    width, height = int(1080 * zoom) // 2 * 2, int(1920 * zoom) // 2 * 2
    filters = [f"[0:v]setpts=PTS-STARTPTS,scale={width}:{height}:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[base]"]
    current = "base"
    x, y, region_width, region_height = pixel_region(options["caption_region"])
    mode = options["caption_mode"]
    if mode == "cover":
        filters.append(f"[base]drawbox=x={x}:y={y}:w={region_width}:h={region_height}:color=black:t=fill[treated]")
        current = "treated"
    elif mode == "blur":
        radius = max(1, min(24, region_width // 4, region_height // 4))
        filters += ["[base]split[clean][band]", f"[band]crop={region_width}:{region_height}:{x}:{y},boxblur=luma_radius={radius}:luma_power=2:chroma_radius={max(1, radius//2)}[blurred]", f"[clean][blurred]overlay={x}:{y}[treated]"]
        current = "treated"
    elif mode == "crop":
        above, below = y, 1920 - (y + region_height)
        keep_height = max(above, below)
        if keep_height < 192:
            raise ValueError("The caption band leaves too little video to crop. Use blur or cover, or reduce the band height.")
        top = 0 if above >= below else y + region_height
        filters.append(f"[base]crop=1080:{keep_height}:0:{top},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[treated]")
        current = "treated"
    if ass_name:
        # ass_name is a generated UUID filename in the process working directory.
        if Path(ass_name).name != ass_name or not ass_name.endswith(".ass") or any(ch not in "0123456789abcdef-" for ch in Path(ass_name).stem):
            raise ValueError("Invalid generated subtitle filename.")
        filters.append(f"[{current}]ass={ass_name}:fontsdir=fonts[video]")
    else:
        filters.append(f"[{current}]null[video]")
    audio_mode = options["audio_mode"]
    audio_output = False
    if audio_mode in {"replace", "mix"} and voiceover:
        filters.append(f"[1:a]asetpts=PTS-STARTPTS,volume={options['voice_volume']},apad[voice]")
        if audio_mode == "mix" and has_audio:
            filters.append(f"[0:a]asetpts=PTS-STARTPTS,volume={options['original_volume']}[original]")
            filters.append("[original][voice]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[audio]")
        else:
            filters.append("[voice]anull[audio]")
        audio_output = True
    elif has_audio:
        filters.append(f"[0:a]asetpts=PTS-STARTPTS,volume={options['original_volume']}[audio]")
        audio_output = True
    command += ["-filter_complex_threads", "2", "-filter_complex", ";".join(filters), "-map", "[video]"]
    command += ["-map", "[audio]", "-c:a", "aac", "-b:a", "192k"] if audio_output else ["-an"]
    command += ["-t", str(duration), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "30", "-threads", "2", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(output)]
    return command
