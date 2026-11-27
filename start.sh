#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
case "${1:-}" in
  "")
    if command -v systemctl >/dev/null 2>&1 &&
       { systemctl --user is-active --quiet shortforge.service ||
         systemctl --user is-enabled --quiet shortforge.service; }; then
      systemctl --user start shortforge.service
      exec .venv/bin/python -m engine --open-existing
    fi
    ;;
  --no-open|--setup-only) ;;
  *) printf 'Usage: %s [--no-open|--setup-only]\n' "$0" >&2; exit 2 ;;
esac
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
.venv/bin/python scripts/setup-python.py
.venv/bin/python scripts/setup-media.py
node scripts/setup-node.mjs
if ! .venv/bin/python scripts/setup-concat.py; then
  printf '\nConcat setup needs attention; Library and Scout will still start.\n'
fi
npm --prefix extension run build -- --if-needed
.venv/bin/python -m engine.scout_host --install
if [ "${1:-}" = "--setup-only" ]; then exit 0; fi
if [ "${1:-}" = "--no-open" ]; then
  exec .venv/bin/python -m engine
fi
exec .venv/bin/python -m engine --open
