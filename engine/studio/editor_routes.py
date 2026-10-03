"""Persistent manual timeline editing, media import, and validated render jobs."""
import json
from pathlib import Path
import subprocess
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from engine.core import db
from engine.core.routes import prevent_duplicate_job, video_header_valid
from .editor_media import editor_media, project_media, probe_media, validate_project_media, normalize_browser_video, normalize_browser_audio, get_editor_asset, media_thumbnail, IMAGE_SUFFIXES
from .editor_models import EditorExport, Project, TimelineItem, StrictModel
from pydantic import Field
from .editor_render import render_project, compatibility_issues
from .media import ffmpeg_binary
from .routes import RENDER_LOCK

router=APIRouter(prefix='/api/editor')
MAX_UPLOAD=500*1024*1024


class TranscriptionRequest(StrictModel):
    asset_id: str = Field(min_length=1,max_length=120)
    model: str | None = Field(None,max_length=500)


@router.post('/{clip_id}/transcribe')
def transcribe(clip_id: str, payload: TranscriptionRequest, background: BackgroundTasks):
    from .transcription import transcription_job, transcription_capability
    db.get_clip(clip_id)
    _,_,metadata=get_editor_asset(clip_id,payload.asset_id)
    if not metadata['has_audio']:
        raise HTTPException(400,'Choose video or audio with a soundtrack to transcribe.')
    capability=transcription_capability()
    if not capability['runtime_ready']:
        raise HTTPException(503,capability['message'])
    prevent_duplicate_job(clip_id,'editor_transcribe')
    job=db.new_job('editor_transcribe',clip_id)
    background.add_task(transcription_job,job['id'],clip_id,payload.asset_id,payload.model)
    return job


def editor_response(clip_id, project=None, saved_at=None):
    clip=db.get_clip(clip_id)
    media=project_media(clip_id)
    if project is None:
        # Serialize the read/seed/write so simultaneous opening tabs seed once.
        with db.connect() as connection:
            connection.execute('BEGIN IMMEDIATE')
            row=connection.execute('SELECT project,saved_at FROM editor_projects WHERE clip_id=?',(clip_id,)).fetchone()
            project=Project.model_validate_json(row['project']) if row else Project()
            saved_at=row['saved_at'] if row else None
            source=next((asset for asset in reversed(media) if asset['kind']=='source' and asset['media_type']=='video'),None)
            if not project.source_seeded:
                source_ids=source_asset_ids(connection,clip_id)
                if source_items(project,source_ids):
                    # Migrate a document that already used its source, including
                    # a missing file awaiting relink, without duplicating it.
                    project.source_seeded=True
                elif source:
                    # Titles and other edits made during download are unrelated
                    # to whether the initial source has reached the timeline.
                    item=TimelineItem(id='source-'+source['id'],kind='video',asset_id=source['id'],name=clip['title'] or source['name'],duration=min(600,source['duration']))
                    project.source_seeded=append_source_items(project,[item])
                if project.source_seeded:
                    saved_at=db.now()
                    connection.execute('INSERT INTO editor_projects (clip_id,project,saved_at) VALUES (?,?,?) ON CONFLICT(clip_id) DO UPDATE SET project=excluded.project,saved_at=excluded.saved_at',
                                       (clip_id,project.model_dump_json(),saved_at))
    return {'project':project.model_dump(),'media':media,'saved_at':saved_at,'compatibility_issues':compatibility_issues(project)}


def source_asset_ids(connection,clip_id):
    return {row['id'] for row in connection.execute("SELECT id FROM assets WHERE clip_id=? AND kind='source'",(clip_id,))}


def source_items(project,source_ids):
    return [item for item in project.items if item.kind=='video' and item.asset_id in source_ids]


def append_source_items(project,items):
    existing_ids={item.id for item in project.items}
    additions=[]
    for item in items:
        if item.id in existing_ids:
            item=item.model_copy(update={'id':'source-'+str(uuid4())})
        existing_ids.add(item.id)
        additions.append(item)
    try:
        # Keep the document within its normal limits even when a source arrives
        # after a large imported project or during another timeline operation.
        combined=Project.model_validate({**project.model_dump(),'items':[*project.items,*additions]})
    except ValueError:
        return False
    project.items=combined.items
    return True


@router.get('/{clip_id}')
def load_project(clip_id: str):
    return editor_response(clip_id)


@router.put('/{clip_id}')
def save_project(clip_id: str, project: Project):
    db.get_clip(clip_id)
    try: validate_project_media(clip_id,project)
    except (ValueError,OSError,subprocess.SubprocessError) as exc:
        raise HTTPException(400,str(exc) if isinstance(exc,ValueError) else 'The project media could not be inspected.') from None
    with db.connect() as connection:
        # Read and update the durable marker in the same transaction as seeding.
        # It must never be reset by concurrent tabs or an older client.
        connection.execute('BEGIN IMMEDIATE')
        row=connection.execute('SELECT project FROM editor_projects WHERE clip_id=?',(clip_id,)).fetchone()
        stored=Project.model_validate_json(row['project']) if row else Project()
        source_ids=source_asset_ids(connection,clip_id)
        previous_source=source_items(stored,source_ids)
        current_source=source_items(project,source_ids)
        if ('source_seeded' in project.model_fields_set and not project.source_seeded
                and not current_source and previous_source):
            # This snapshot predates the first seed. Preserve a source appended
            # by a concurrent GET, along with the snapshot's newer text edits.
            # A client that has seen the source sends true when deleting it;
            # legacy clients omitting the field can still deliberately clear.
            if not append_source_items(project,previous_source):
                raise HTTPException(409,'The source is ready in Media, but could not be added to this timeline. Adjust the timeline and retry.')
        if stored.source_seeded or previous_source or current_source:
            project.source_seeded=True
        saved_at=db.now()
        connection.execute('INSERT INTO editor_projects (clip_id,project,saved_at) VALUES (?,?,?) ON CONFLICT(clip_id) DO UPDATE SET project=excluded.project,saved_at=excluded.saved_at',(clip_id,project.model_dump_json(),saved_at))
        connection.execute("UPDATE clips SET workflow_status='editing' WHERE id=? AND workflow_status!='archived'",(clip_id,))
    return editor_response(clip_id,project,saved_at)


def finish_upload(clip_id,path,role,name):
    suffix=path.suffix.lower()
    with path.open('rb') as stream: header=stream.read(32)
    if suffix in {'.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'}:
        valid = video_header_valid(header, suffix)
    elif suffix == '.wav':
        valid = header[:4] == b'RIFF' and header[8:12] == b'WAVE'
    elif suffix in {'.mp3', '.aac'}:
        valid = header[:3] == b'ID3' or (len(header) >= 2 and header[0] == 255 and header[1] & 224 == 224)
    elif suffix == '.m4a':
        valid = header[4:8] == b'ftyp'
    elif suffix == '.flac':
        valid = header[:4] == b'fLaC'
    elif suffix in {'.ogg', '.opus'}:
        valid = header[:4] == b'OggS'
    elif suffix == '.png':
        valid = header[:8] == b'\x89PNG\r\n\x1a\n'
    elif suffix in {'.jpg', '.jpeg'}:
        valid = header[:3] == b'\xff\xd8\xff'
    elif suffix == '.webp':
        valid = header[:4] == b'RIFF' and header[8:12] == b'WEBP'
    else:
        valid = False
    if not valid:
        raise ValueError('The file contents do not match supported media. Choose a real video, image, or audio recording.')
    normalized_audio=False
    if suffix=='.webm' and role not in {'video','image'}:
        # MediaRecorder's streamed WebM has no duration header. Decode first;
        # FFmpeg verifies a real audio stream and the WAV has exact duration.
        converted=normalize_browser_audio(path)
        path.unlink(missing_ok=True); path=converted; normalized_audio=True
    metadata=probe_media(path)
    if role in {'video','image'} and metadata['media_type'] not in {'video','image'}:
        raise ValueError('Choose a video or image file for the visual track.')
    if role=='image' and metadata['media_type']!='image':
        raise ValueError('Choose a still PNG, JPEG, or WebP image.')
    if role not in {'video','image'} and not metadata['has_audio']:
        raise ValueError('This file contains no audio. Choose a voiceover or music recording.')
    if metadata['media_type']=='image':
        role='image'
        # Normalize orientation and strip metadata so browser and FFmpeg agree.
        from PIL import Image, ImageOps
        converted=path.with_name(path.stem+'-playable.png')
        with Image.open(path) as image:
            ImageOps.exif_transpose(image).convert('RGBA').save(converted)
        path.unlink(missing_ok=True)
        path=converted
    elif role=='video':
        converted=normalize_browser_video(path)
        if converted != path:
            path.unlink(missing_ok=True)
            path=converted
    elif not normalized_audio:
        converted=path.with_suffix('.wav')
        if converted==path: converted=path.with_name(path.stem+'-playable.wav')
        process=subprocess.run([ffmpeg_binary(),'-v','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',str(path),'-vn','-map','0:a:0','-ac','2','-ar','48000','-c:a','pcm_s16le',str(converted)],capture_output=True,text=True,timeout=1200)
        if process.returncode:
            converted.unlink(missing_ok=True)
            raise ValueError('This audio could not be converted for playback. Try WAV or MP3.')
        path.unlink(missing_ok=True)
        path=converted
    try:
        db.require_editable(clip_id)
        path.with_suffix(path.suffix+'.name.json').write_text(json.dumps({'name':name}),encoding='utf-8')
        asset=db.add_asset(clip_id,role,path)
        return editor_media(asset)
    except BaseException:
        path.unlink(missing_ok=True)
        path.with_suffix(path.suffix+'.name.json').unlink(missing_ok=True)
        raise


@router.post('/{clip_id}/media')
async def import_media(clip_id: str, file: UploadFile=File(...), role: str=Form(...)):
    db.require_editable(clip_id)
    if role not in {'video','image','audio','voiceover','music','sfx'}:
        await file.close()
        raise HTTPException(422,'Choose video, image, audio, voiceover, music, or sfx.')
    suffix=Path(file.filename or '').suffix.lower()
    if suffix not in {'.mp4','.mov','.m4v','.webm','.mkv','.avi','.wav','.mp3','.m4a','.aac','.flac','.ogg','.opus'} | IMAGE_SUFFIXES:
        await file.close()
        raise HTTPException(422,'Choose MP4, WebM, PNG, JPEG, WebP, WAV, MP3, or another supported media file.')
    path=db.DATA_DIR/'editor-media'/clip_id/(str(uuid4())+suffix)
    path.parent.mkdir(parents=True,exist_ok=True)
    try:
        total=0
        with path.open('wb') as destination:
            while chunk:=await file.read(1024*1024):
                total+=len(chunk)
                if total>MAX_UPLOAD: raise HTTPException(413,'Choose a file smaller than 500 MB.')
                destination.write(chunk)
        return await run_in_threadpool(finish_upload,clip_id,path,role,Path(file.filename or 'Imported media').stem[:500])
    except (ValueError,OSError,subprocess.SubprocessError) as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(400,str(exc) if isinstance(exc,ValueError) else 'This media could not be imported. Try another file.') from None
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    finally: await file.close()


@router.get('/{clip_id}/media/{asset_id}/thumbnail')
def thumbnail(clip_id: str, asset_id: str):
    db.get_clip(clip_id)
    _, path, metadata=get_editor_asset(clip_id,asset_id)
    if metadata['media_type'] not in {'image','video'}:
        raise HTTPException(400,'Audio files have waveforms rather than preview images.')
    try:
        target=media_thumbnail(path,metadata)
    except (ValueError,OSError,subprocess.SubprocessError) as exc:
        raise HTTPException(400,str(exc) if isinstance(exc,ValueError) else 'Preview generation failed. Retry this media.') from None
    return FileResponse(target,media_type='image/jpeg',headers={'Cache-Control':'private, max-age=86400'})


def render_job(job_id,clip_id,payload):
    output=None
    try:
        with RENDER_LOCK:
            db.require_editable(clip_id)
            assets=validate_project_media(clip_id,payload.project)
            db.update_job(job_id,status='running',progress=3)
            output=db.DATA_DIR/'exports'/(job_id+'.mp4')
            output.parent.mkdir(parents=True,exist_ok=True)
            last_progress=3
            def progress(value):
                nonlocal last_progress
                if value>last_progress+1:
                    db.update_job(job_id,progress=value); last_progress=value
            result=render_project(payload.project,assets,output,payload.resolution,progress)
            db.require_editable(clip_id)
            asset=db.add_asset(clip_id,'export',output)
            with db.connect() as connection:
                connection.execute("UPDATE clips SET workflow_status='exported' WHERE id=?",(clip_id,))
            db.update_job(job_id,status='completed',progress=100,result={'asset':asset,**result})
    except Exception as exc:
        if output: output.unlink(missing_ok=True)
        message=exc.detail if isinstance(exc,HTTPException) else str(exc) if isinstance(exc,ValueError) else 'The export failed. Check your media files and available disk space, then retry.'
        db.update_job(job_id,status='failed',error=message)


@router.post('/{clip_id}/export')
def export_project(clip_id: str, payload: EditorExport, background: BackgroundTasks):
    db.require_editable(clip_id)
    if payload.project.duration<=0:
        raise HTTPException(400,'Add a video, text, or audio item before exporting.')
    issues=compatibility_issues(payload.project)
    if issues:
        features=sorted({feature for issue in issues for feature in issue['features']})
        raise HTTPException(400,'FFmpeg compatibility export does not support '+ '; '.join(features)+'. Use browser export or remove these treatments.')
    try:
        validate_project_media(clip_id,payload.project)
        ffmpeg_binary()
    except (ValueError,OSError,subprocess.SubprocessError) as exc:
        raise HTTPException(400,str(exc) if isinstance(exc,ValueError) else 'The project media could not be inspected.') from None
    prevent_duplicate_job(clip_id,'editor_export')
    job=db.new_job('editor_export',clip_id)
    background.add_task(render_job,job['id'],clip_id,payload)
    return job
