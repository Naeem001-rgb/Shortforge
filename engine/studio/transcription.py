"""Word-timed local recognition with an optional isolated Python runtime.

The web process never imports model libraries or downloads model weights.
"""
from functools import lru_cache
import json
import os
from pathlib import Path
import subprocess
from threading import Lock

from engine.core import db, media

TRANSCRIPTION_LOCK = Lock()


def runtime_python() -> Path:
    default=db.DATA_DIR/'runtime'/'transcription'/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
    return Path(os.environ.get('SHORTFORGE_TRANSCRIPTION_PYTHON',default)).expanduser().absolute()


def model_path(model: str | None = None) -> str:
    configured=model or os.environ.get('SHORTFORGE_WHISPER_MODEL') or db.get_settings().get('whisper_model') or 'base'
    local=Path(configured).expanduser()
    if local.is_dir(): return str(local.resolve())
    installed=db.DATA_DIR/'models'/'whisper'/configured
    if installed.is_dir(): return str(installed.resolve())
    # A separately installed tiny.en is a useful default when Settings still
    # holds the factory base value. An explicitly selected model stays exact.
    tiny=db.DATA_DIR/'models'/'whisper'/'tiny.en'
    if not model and configured=='base' and (tiny/'model.bin').is_file(): return str(tiny.resolve())
    return configured


@lru_cache(maxsize=4)
def _runtime_ready(path: str, modified: int) -> bool:
    try:
        result=subprocess.run([path,'-c',"from importlib.metadata import version; version('faster-whisper')"],capture_output=True,timeout=10)
        return result.returncode==0
    except (OSError,subprocess.SubprocessError):
        return False


def transcription_capability() -> dict:
    python=runtime_python()
    isolated=python.is_file() and _runtime_ready(str(python),python.stat().st_mtime_ns)
    runtime=bool(isolated or media.tool_available('faster_whisper'))
    path=Path(model_path())
    ready=all((path/name).is_file() for name in ('config.json','model.bin','tokenizer.json'))
    message=('Local word-timed transcription is ready (CPU).' if runtime and ready else
             'Install the isolated transcription runtime and a local Whisper model with engine/studio/setup_transcription.py. No model is downloaded by transcription requests.')
    return {'available':runtime and ready,'runtime_ready':runtime,'model_ready':ready,
            'model':path.name,'message':message}


def transcribe_asset(path: Path, model: str | None = None) -> dict:
    python=runtime_python()
    if not python.is_file():
        result=media.transcribe_file(path,model_path(model))
    else:
        command=[str(python),str(Path(__file__).with_name('transcription_worker.py')),
                 '--input',str(path),'--model',model_path(model),'--cache',str(db.DATA_DIR/'models'/'whisper')]
        try:
            process=subprocess.run(command,capture_output=True,text=True,timeout=1800,
                                   env={**os.environ,'HF_HUB_OFFLINE':'1','OMP_NUM_THREADS':'4','CUDA_VISIBLE_DEVICES':''})
        except subprocess.TimeoutExpired:
            raise ValueError('Local transcription exceeded thirty minutes. Try a shorter recording.') from None
        if process.returncode:
            raise ValueError('Local transcription could not load the recording or model. Check the transcription runtime and installed Whisper model, then retry.')
        try:
            result=json.loads(process.stdout)
        except ValueError:
            raise ValueError('The local transcription worker returned an invalid result.') from None
    words=result.get('words',[])
    if result.get('text') and not words:
        raise ValueError('Recognition returned text without word timestamps. Try a different local Whisper model.')
    return {**result,'source':'local-whisper','timing':'word','estimated':False}


def transcription_job(job_id: str, clip_id: str, asset_id: str, model: str | None):
    from .editor_media import get_editor_asset
    try:
        with TRANSCRIPTION_LOCK:
            _,path,metadata=get_editor_asset(clip_id,asset_id)
            if not metadata['has_audio']: raise ValueError('Choose media with an audio track.')
            db.update_job(job_id,status='running',progress=5)
            result=transcribe_asset(path,model)
            db.update_job(job_id,status='completed',progress=100,result={**result,'asset_id':asset_id})
    except Exception as exc:
        db.update_job(job_id,status='failed',error=str(exc) if isinstance(exc,(ValueError,RuntimeError)) else 'Local transcription failed. Check the recording and retry.')
