"""Persistent manual timeline editing, media import, and validated render jobs."""
import json
from pathlib import Path
import subprocess
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from engine.core import db
from engine.core.routes import prevent_duplicate_job, video_header_valid
from .editor_media import editor_media, project_media, probe_media, validate_project_media, normalize_browser_video
from .editor_models import EditorExport, Project, TimelineItem
from .editor_render import render_project
from .media import ffmpeg_binary
from .routes import RENDER_LOCK

router=APIRouter(prefix='/api/editor')
MAX_UPLOAD=500*1024*1024


def editor_response(clip_id, project=None, saved_at=None):
    clip=db.get_clip(clip_id)
    media=project_media(clip_id)
    if project is None:
        with db.connect() as connection:
            row=connection.execute('SELECT project,saved_at FROM editor_projects WHERE clip_id=?',(clip_id,)).fetchone()
        if row:
            project=Project.model_validate_json(row['project'])
            saved_at=row['saved_at']
        else:
            project=Project()
            source=next((asset for asset in reversed(media) if asset['kind']=='source' and asset['media_type']=='video'),None)
            if source and clip['license_status']!='unknown':
                project.items=[TimelineItem(id='source-'+source['id'],kind='video',asset_id=source['id'],name=clip['title'] or source['name'],duration=min(600,source['duration']))]
    return {'project':project.model_dump(),'media':media,'saved_at':saved_at}


@router.get('/{clip_id}')
def load_project(clip_id: str):
    return editor_response(clip_id)


@router.put('/{clip_id}')
def save_project(clip_id: str, project: Project):
    db.get_clip(clip_id)
    try: validate_project_media(clip_id,project)
    except (ValueError,OSError,subprocess.SubprocessError) as exc:
        raise HTTPException(400,str(exc) if isinstance(exc,ValueError) else 'The project media could not be inspected.') from None
    saved_at=db.now()
    with db.connect() as connection:
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
    else:
        valid = False
    if not valid:
        raise ValueError('The file contents do not match supported media. Choose a real video or audio recording.')
    metadata=probe_media(path)
    if role=='video' and metadata['media_type']!='video':
        raise ValueError('Choose a video file for the video track.')
    if role!='video' and not metadata['has_audio']:
        raise ValueError('This file contains no audio. Choose a voiceover or music recording.')
    if role=='video':
        converted=normalize_browser_video(path)
        if converted != path:
            path.unlink(missing_ok=True)
            path=converted
    else:
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
    if role not in {'video','voiceover','music'}:
        await file.close()
        raise HTTPException(422,'Choose video, voiceover, or music.')
    suffix=Path(file.filename or '').suffix.lower()
    if suffix not in {'.mp4','.mov','.m4v','.webm','.mkv','.avi','.wav','.mp3','.m4a','.aac','.flac','.ogg','.opus'}:
        await file.close()
        raise HTTPException(422,'Choose a common video or audio file such as MP4, WAV, or MP3.')
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
    try:
        validate_project_media(clip_id,payload.project)
        ffmpeg_binary()
    except (ValueError,OSError,subprocess.SubprocessError) as exc:
        raise HTTPException(400,str(exc) if isinstance(exc,ValueError) else 'The project media could not be inspected.') from None
    prevent_duplicate_job(clip_id,'editor_export')
    job=db.new_job('editor_export',clip_id)
    background.add_task(render_job,job['id'],clip_id,payload)
    return job
