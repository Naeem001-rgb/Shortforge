#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install -q -r engine/requirements.txt
if ! .venv/bin/python -m pip install -q --upgrade yt-dlp; then
  echo 'Could not check for a yt-dlp update. Continuing with installed version.'
fi
if [ ! -d dashboard/node_modules ]; then npm --prefix dashboard ci; fi
if [ ! -d extension/node_modules ]; then npm --prefix extension ci; fi
npm --prefix extension run build
.venv/bin/python -m engine &
ENGINE_PID=$!
trap 'kill "$ENGINE_PID" 2>/dev/null || true' EXIT INT TERM
printf '\nShortForge: open http://127.0.0.1:5173\nPress Ctrl+C to stop.\n\n'
npm --prefix dashboard run dev
