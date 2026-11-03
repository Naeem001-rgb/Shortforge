#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
.venv/bin/python scripts/setup-python.py
.venv/bin/python scripts/setup-media.py
node scripts/setup-node.mjs
if ! .venv/bin/python scripts/setup-concat.py; then
  printf '\nConcat setup needs attention; Library and Scout will still start.\n'
fi
npm --prefix extension run build -- --if-needed
exec .venv/bin/python -m engine --open
