"""Explicit installer: python3.12 engine/studio/setup_transcription.py --download-model.

Whisper code/weights: MIT. faster-whisper: MIT. Installed only into local data.
The API never calls this installer or silently fetches a model.
"""
import argparse
from pathlib import Path
import subprocess
import sys
import venv


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=Path,default=Path(__file__).resolve().parents[2]/'data')
    parser.add_argument('--download-model',action='store_true')
    parser.add_argument('--model',choices=['tiny.en','base','small'],default='tiny.en')
    args=parser.parse_args()
    if sys.version_info[:2] not in {(3,11),(3,12),(3,13)}:
        parser.error('Run this installer with Python 3.11, 3.12, or 3.13 for compatible model wheels.')
    runtime=args.data_dir/'runtime'/'transcription'
    venv.EnvBuilder(with_pip=True).create(runtime)
    python=runtime/('Scripts/python.exe' if sys.platform=='win32' else 'bin/python')
    # PyAV 19 removed metadata_errors, which faster-whisper 1.2 still passes.
    subprocess.run([str(python),'-m','pip','install','faster-whisper==1.2.1','av==15.1.0'],check=True)
    if args.download_model:
        target=args.data_dir/'models'/'whisper'/args.model
        subprocess.run([str(python),'-c','from faster_whisper.utils import download_model; import sys; download_model(sys.argv[1],output_dir=sys.argv[2])',args.model,str(target)],check=True)
    print('Runtime installed. Restart ShortForge to refresh local capabilities.')


if __name__=='__main__': main()
