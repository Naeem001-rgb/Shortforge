"""Run using python -m engine from the project directory."""
import os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / '.env')
if not os.environ.get('FFMPEG_PATH'):
    try:
        import imageio_ffmpeg
        os.environ['FFMPEG_PATH'] = imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        pass
if __name__ == '__main__':
    import uvicorn
    uvicorn.run('engine.core.app:app', host='127.0.0.1', port=8787)
