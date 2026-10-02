"""Inspect owned local media and sample its real audio envelope."""
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

from fastapi import HTTPException
from engine.core import db
from engine.core.media import find_ffprobe
from .media import ffmpeg_binary

EDITOR_KINDS = {'source','video','image','voiceover','music','sfx','audio','vocals','instrumental'}
IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp'}

def probe_media(path: Path) -> dict:
    path = Path(path)
    stat = path.stat()
    return dict(_probe(str(path.resolve()), stat.st_mtime_ns, stat.st_size))

@lru_cache(maxsize=256)
def _probe(path: str, modified: int, size: int) -> dict:
    if size == 0:
        raise ValueError('The media file is empty.')
    if Path(path).suffix.lower() in IMAGE_SUFFIXES:
        from PIL import Image, ImageOps, UnidentifiedImageError
        try:
            with Image.open(path) as source:
                if source.format not in {'PNG', 'JPEG', 'WEBP'} or getattr(source, 'n_frames', 1) != 1:
                    raise ValueError('Choose a still PNG, JPEG, or WebP image.')
                if source.width > 8192 or source.height > 8192:
                    raise ValueError('Use an image no larger than 8K.')
                source.verify()
            with Image.open(path) as source:
                decoded = ImageOps.exif_transpose(source)
                decoded.load()
                width, height = decoded.size
        except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
            raise ValueError('This image could not be decoded. Try a different PNG, JPEG, or WebP.') from exc
        return {'duration':5.0, 'width':width, 'height':height, 'has_audio':False, 'media_type':'image'}
    ffprobe = find_ffprobe()
    info = None
    if ffprobe:
        process = subprocess.run([ffprobe,'-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',path], capture_output=True, text=True, timeout=30)
        if process.returncode == 0:
            info = json.loads(process.stdout)
    if info is not None:
        streams = info.get('streams', [])
        video = next((s for s in streams if s.get('codec_type') == 'video' and not s.get('disposition',{}).get('attached_pic')), None)
        audio = any(s.get('codec_type') == 'audio' for s in streams)
        durations = [info.get('format',{}).get('duration')] + [s.get('duration') for s in streams]
        duration = max((float(d) for d in durations if d not in {None,'N/A'}), default=0)
        width, height = (int(video.get('width',0)),int(video.get('height',0))) if video else (0,0)
        rotation = next((float(s.get('rotation',0)) for s in (video or {}).get('side_data_list',[]) if 'rotation' in s), 0)
        if abs(rotation) % 180 == 90:
            width, height = height, width
    else:
        result = subprocess.run([ffmpeg_binary(),'-hide_banner','-protocol_whitelist','file,pipe','-i',path], capture_output=True,text=True,timeout=30)
        log = result.stderr
        match = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)',log)
        duration = int(match[1])*3600 + int(match[2])*60 + float(match[3]) if match else 0
        video_line = next((line for line in log.splitlines() if 'Video:' in line and 'attached pic' not in line), '')
        dimensions = re.search(r'\b(\d{2,5})x(\d{2,5})\b',video_line)
        width, height = (int(dimensions[1]),int(dimensions[2])) if dimensions else (0,0)
        rotation = re.search(r'rotation of (-?\d+(?:\.\d+)?) degrees',log)
        if rotation and abs(float(rotation[1])) % 180 == 90:
            width, height = height, width
        video, audio = bool(video_line), 'Audio:' in log
    if not math.isfinite(duration) or duration <= 0 or not (video or audio):
        raise ValueError('This file is not readable audio or video with a known duration. Try MP4, WebM, WAV, or MP3.')
    if duration > 86400 or width > 8192 or height > 8192:
        raise ValueError('Use media shorter than 24 hours and no larger than 8K.')
    return {'duration':duration,'width':width,'height':height,'has_audio':audio,'media_type':'video' if video else 'audio'}

@lru_cache(maxsize=128)
def _waveform(path: str, modified: int, size: int, duration: float) -> tuple:
    # Compute full-band audio peaks in FFmpeg before reducing to 96 points.
    # Decimating raw audio first would erase speech/music above Nyquist.
    block = max(32, min(48000, math.ceil(duration * 48000 / 96)))
    filters = (f"aresample=48000,asetnsamples=n={block}:p=0,"
               "astats=metadata=1:reset=1,"
               r"ametadata=print:key=lavfi.astats.Overall.Peak_level:file='pipe\:1'")
    process = subprocess.Popen(
        [ffmpeg_binary(), '-v', 'error', '-nostdin', '-protocol_whitelist',
         'file,pipe', '-i', path, '-vn', '-af', filters, '-f', 'null', '-'],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    peaks = [0.0] * 96
    current_time = 0.0
    samples = 0
    try:
        for line in process.stdout:
            if 'pts_time:' in line:
                current_time = float(line.rsplit('pts_time:', 1)[1])
            elif line.startswith('lavfi.astats.Overall.Peak_level='):
                decibels = float(line.split('=', 1)[1])
                amplitude = 10 ** (decibels / 20) if math.isfinite(decibels) else 0
                index = min(95, max(0, int(current_time / duration * 96)))
                peaks[index] = max(peaks[index], amplitude)
                samples += 1
        if process.wait(timeout=10) != 0:
            return ()
        return tuple(round(min(1, p), 4) for p in peaks) if samples else ()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        process.stdout.close()

def normalize_browser_video(path: Path) -> Path:
    """Return browser-playable MP4, keeping external originals untouched."""
    inspection = subprocess.run(
        [ffmpeg_binary(), '-hide_banner', '-protocol_whitelist', 'file,pipe', '-i', str(path)],
        capture_output=True, text=True, timeout=30)
    video_line = next((line for line in inspection.stderr.splitlines() if 'Video:' in line), '')
    audio_line = next((line for line in inspection.stderr.splitlines() if 'Audio:' in line), '')
    compatible = ('Video: h264' in video_line and 'yuv420p' in video_line
                  and (not audio_line or 'Audio: aac' in audio_line))
    if path.suffix.lower() == '.mp4' and compatible:
        return path
    output = path.with_name(path.stem + '-playable.mp4')
    command = [ffmpeg_binary(), '-v', 'error', '-nostdin', '-y', '-protocol_whitelist',
               'file,pipe', '-i', str(path), '-map', '0:v:0', '-map', '0:a:0?']
    if compatible:
        command += ['-c', 'copy']
    else:
        command += ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264',
                    '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
                    '-threads', '2', '-c:a', 'aac', '-b:a', '192k']
    command += ['-movflags', '+faststart', str(output)]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=1800)
        if result.returncode:
            raise ValueError('This video could not be converted for playback. Try a different MP4 file.')
        probe_media(output)
        return output
    except BaseException:
        output.unlink(missing_ok=True)
        raise


def normalize_browser_audio(path: Path) -> Path:
    """Decode streamed recordings before requiring seekable duration metadata."""
    output=path.with_name(path.stem+'-playable.wav')
    try:
        process=subprocess.run([ffmpeg_binary(),'-v','error','-nostdin','-y','-protocol_whitelist','file,pipe',
                                '-i',str(path),'-vn','-map','0:a:0','-ac','2','-ar','48000',
                                '-c:a','pcm_s16le',str(output)],
                               capture_output=True,text=True,timeout=1200)
        if process.returncode:
            raise ValueError('This audio could not be decoded. Try another recording, WAV, or MP3.')
        probe_media(output)
        return output
    except BaseException:
        output.unlink(missing_ok=True)
        raise


def editor_media(asset: dict) -> dict:
    path = db.resolve_data_path(asset['path'])
    if not path.is_file():
        raise ValueError('The saved media is missing. Import it again.')
    metadata = probe_media(path)
    stat = path.stat()
    wave = []
    if metadata['has_audio']:
        try: wave = list(_waveform(str(path),stat.st_mtime_ns,stat.st_size,metadata['duration']))
        except (OSError,subprocess.SubprocessError): pass
    # Persisted upload name is held in a small local sidecar, not a user path.
    name = path.stem
    if asset.get('kind') == 'source' and asset.get('clip_id'):
        name = db.get_clip(asset['clip_id'])['title'] or name
    elif re.fullmatch(r'[a-f0-9-]{32,36}', name):
        name = {'voiceover':'Voiceover', 'vocals':'Isolated voice', 'instrumental':'Background audio', 'audio':'Extracted audio'}.get(asset.get('kind'), 'Imported media')
    sidecar = path.with_suffix(path.suffix + '.name.json')
    if sidecar.is_file():
        try: name = str(json.loads(sidecar.read_text())['name'])[:500]
        except (ValueError,KeyError,OSError): pass
    thumbnail_url = (f"/api/editor/{asset['clip_id']}/media/{asset['id']}/thumbnail"
                     if metadata['media_type'] in {'image','video'} else None)
    return {**asset, 'url':f"/api/assets/{asset['id']}", 'name':name, **metadata,'waveform':wave,
            'thumbnail_url':thumbnail_url}


def media_thumbnail(path: Path, metadata: dict) -> Path:
    """Content-versioned local preview; never register it as editable media."""
    stat = path.stat()
    version = hashlib.sha256(f'{path.resolve()}:{stat.st_mtime_ns}:{stat.st_size}'.encode()).hexdigest()[:24]
    target = db.DATA_DIR / 'editor-thumbnails' / (version + '.jpg')
    if target.is_file():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    import tempfile
    with tempfile.TemporaryDirectory(dir=target.parent) as directory:
        output = Path(directory) / 'thumbnail.jpg'
        if metadata['media_type'] == 'image':
            from PIL import Image, ImageOps
            with Image.open(path) as source:
                decoded = ImageOps.exif_transpose(source).convert('RGB')
                decoded.thumbnail((320,320))
                decoded.save(output, quality=85)
        else:
            command = [ffmpeg_binary(), '-v','error','-nostdin','-y','-ss',str(min(.5,metadata['duration']/2)),
                       '-protocol_whitelist','file,pipe','-i',str(path),'-frames:v','1','-vf',
                       'scale=320:320:force_original_aspect_ratio=decrease','-q:v','3',str(output)]
            result = subprocess.run(command, capture_output=True, timeout=30)
            if result.returncode or not output.is_file():
                raise ValueError('A preview frame could not be generated. The media is still available.')
        output.replace(target)
    return target

def get_editor_asset(clip_id: str, asset_id: str) -> tuple[dict,Path,dict]:
    asset = db.get_asset(asset_id)
    if asset['clip_id'] != clip_id or asset['kind'] not in EDITOR_KINDS:
        raise HTTPException(400,'Use media belonging to this project.')
    path = db.resolve_data_path(asset['path'])
    if not path.is_file():
        raise HTTPException(404,'This media file is missing. Import it again.')
    return asset,path,probe_media(path)

def project_media(clip_id: str) -> list[dict]:
    with db.connect() as connection:
        rows = connection.execute('SELECT * FROM assets WHERE clip_id=? ORDER BY created_at',(clip_id,)).fetchall()
    media = []
    for row in rows:
        if row['kind'] not in EDITOR_KINDS: continue
        try: media.append(editor_media(db.asset_dict(row)))
        except (HTTPException,ValueError,OSError,subprocess.SubprocessError): continue
    return media

def validate_project_media(clip_id,project):
    assets = {}
    for item in project.items:
        if item.kind == 'text': continue
        if item.asset_id not in assets:
            assets[item.asset_id] = get_editor_asset(clip_id,item.asset_id)
        metadata = assets[item.asset_id][2]
        if item.kind == 'video' and metadata['media_type'] not in {'video','image'}:
            raise ValueError('A visual item must use a video or image file.')
        if item.kind == 'audio' and not metadata['has_audio']:
            raise ValueError('This media has no audio track.')
        # ffmpeg's fallback reports duration to 10 ms; tolerate only rounding.
        if metadata['media_type'] == 'image':
            continue
        if item.freeze_at is not None:
            if item.kind != 'video' or item.freeze_at >= metadata['duration']:
                raise ValueError('Choose a freeze frame inside the source video.')
            continue
        if item.source_in + item.duration * item.speed > metadata['duration'] + .021:
            raise ValueError(f'“{item.name or "Media"}” extends beyond its source. Reduce its duration or speed.')
    return assets
