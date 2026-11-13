Leaflet 1.9.4 (BSD-2-Clause, see LICENSE), served from this folder. Nothing is downloaded when the app runs.

Files: leaflet.js, leaflet.js.map, leaflet.css, images/ (marker and layer icons), LICENSE.

To refresh them (needs internet once, at build time): `node scripts/vendor-leaflet.mjs` from the project root,
or `npm run vendor:leaflet` from `backend/`. Commit the result.

The map background (tiles) is NOT part of Leaflet. It comes from the provider set in `MAP_TILE_URL`.
