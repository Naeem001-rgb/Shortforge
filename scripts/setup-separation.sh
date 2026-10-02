#!/usr/bin/env bash
# Explicit one-time download/install. Opening Studio never runs this script.
set -euo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
ENGINE_PYTHON="${SHORTFORGE_ENGINE_PYTHON:-$ROOT_DIR/.venv/bin/python}"
SEPARATION_PYTHON="${SHORTFORGE_SEPARATION_PYTHON:-$ROOT_DIR/data/runtime/separation/bin/python}"
export SHORTFORGE_SEPARATION_MODEL_DIR="${SHORTFORGE_SEPARATION_MODEL_DIR:-$ROOT_DIR/data/models/demucs}"
export UV_PYTHON_INSTALL_DIR="$ROOT_DIR/data/runtime/python"
if [[ ! -x "$ENGINE_PYTHON" ]]; then
  echo "Set up the ShortForge engine .venv first, or set SHORTFORGE_ENGINE_PYTHON."
  exit 1
fi
"$ENGINE_PYTHON" -m pip install 'uv==0.12.21'
if [[ ! -x "$SEPARATION_PYTHON" ]]; then
  "$ENGINE_PYTHON" -m uv venv --python 3.12 "$(dirname "$(dirname "$SEPARATION_PYTHON")")"
fi
"$ENGINE_PYTHON" -m uv pip install --python "$SEPARATION_PYTHON" 'torch==2.5.1+cpu' 'torchaudio==2.5.1+cpu' --index-url https://download.pytorch.org/whl/cpu
"$ENGINE_PYTHON" -m uv pip install --python "$SEPARATION_PYTHON" -r engine/requirements-separation.txt
"$ENGINE_PYTHON" - <<'PY'
import hashlib
import os
from pathlib import Path
from urllib.request import urlopen

directory = Path(os.environ['SHORTFORGE_SEPARATION_MODEL_DIR']).expanduser()
directory.mkdir(parents=True, exist_ok=True)
target = directory / '955717e8-8726e21a.th'
expected = '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4'
def valid(path):
    if not path.is_file(): return False
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest() == expected
if not valid(target):
    print('Downloading official htdemucs checkpoint (84.1 MB)...', flush=True)
    partial = target.with_suffix('.part')
    try:
        with urlopen('https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th', timeout=60) as source, partial.open('wb') as output:
            while block := source.read(1024 * 1024): output.write(block)
        if not valid(partial): raise RuntimeError('Model checksum failed; incomplete download removed.')
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)
print('Verified htdemucs checkpoint:', target)
PY
"$SEPARATION_PYTHON" - <<'PY'
from pathlib import Path
import os
import torch
from demucs.pretrained import get_model
assert not torch.cuda.is_available()
model = get_model('955717e8', repo=Path(os.environ['SHORTFORGE_SEPARATION_MODEL_DIR']))
assert 'vocals' in model.sources
print('CPU vocal separation is installed. Restart ShortForge if it is already running.')
PY
