#!/usr/bin/env bash
# Kept for existing instructions; the real work is in vendor-leaflet.mjs (also runs on Windows).
set -euo pipefail
exec node "$(cd "$(dirname "$0")" && pwd)/vendor-leaflet.mjs"
