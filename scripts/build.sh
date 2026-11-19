#!/usr/bin/env bash
# Rebuilds everything in ./data from ./raw. Needs Python 3 with numpy, Pillow and netCDF4.
set -euo pipefail
RAW="$(cd "${1:-raw}" && pwd)"
OUT="$(mkdir -p data && cd data && pwd)"
cd "$(dirname "$0")"
python3 prep_basemap.py "$RAW" "$OUT"
python3 prep_map01.py "$RAW" "$OUT"
python3 prep_map02.py "$RAW" "$OUT"
python3 prep_map03.py "$RAW" "$OUT"
