#!/usr/bin/env bash
# Downloads Leaflet 1.9.4 from the npm registry and copies the two files the portals load. No CDN is used at runtime.
set -euo pipefail
dest="$(cd "$(dirname "$0")/.." && pwd)/frontend/public/vendor/leaflet"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
(cd "$tmp" && npm pack leaflet@1.9.4 --silent >/dev/null && tar -xzf leaflet-1.9.4.tgz)
cp "$tmp/package/dist/leaflet.js" "$tmp/package/dist/leaflet.css" "$dest/"
grep -q 'version="1.9.4"\|version = "1.9.4"\|1\.9\.4' "$dest/leaflet.js" || { echo "Downloaded file does not look like Leaflet 1.9.4" >&2; exit 1; }
echo "Leaflet 1.9.4 copied to $dest (commit these two files so later deployments need no download)"
