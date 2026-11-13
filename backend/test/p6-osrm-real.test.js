// REAL ROUTING (not mocked): runs only when OSRM_TEST_URL points at a running OSRM engine with OpenStreetMap data for the
// delivery area, e.g.  OSRM_TEST_URL=http://127.0.0.1:5000 node --test test/p6-osrm-real.test.js
// Skipped otherwise, so the normal test run never needs the internet or a routing engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { config } from '../src/config.js';
import { roadDistance, setRouter } from '../src/services/routing.js';

const URL_ = process.env.OSRM_TEST_URL;
const skip = !URL_ && 'set OSRM_TEST_URL to run against a real OSRM engine';
const R = 6371000, rad = (d) => (d * Math.PI) / 180;
const straight = (a, b) => { const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
// a TEST pickup point and places from the owner's sheet (coordinates as supplied in the sheet)
const PICKUP = { lat: 17.3380, lng: 78.3000 };
const PLACES = { 'Stanza Living Launceston House': { lat: 17.3422, lng: 78.3295 }, 'JBIET': { lat: 17.3303, lng: 78.2984 }, 'VJIT': { lat: 17.3459, lng: 78.3236 },
  'Global Institute of Engineering & Technology': { lat: 17.3354, lng: 78.2922 }, 'Vivekananda Boys Hostel': { lat: 17.3395, lng: 78.3082 } };

test('real OSRM: road distances are real, plausible and cached', { skip }, async (t) => {
  const db = openDb(':memory:'); const old = { ...config.routing }; config.routing.osrmUrl = URL_; config.routing.timeoutMs = 5000; setRouter(null);
  try {
    for (const [name, p] of Object.entries(PLACES)) {
      const r = await roadDistance(db, PICKUP, p), s = straight(PICKUP, p);
      t.diagnostic(`${name}: road ${(r.distance_m / 1000).toFixed(2)} km, straight line ${(s / 1000).toFixed(2)} km, ratio ${(r.distance_m / s).toFixed(2)} (${r.source})`);
      assert.equal(r.source, 'osrm'); assert.ok(Number.isFinite(r.distance_m));
      assert.ok(r.distance_m >= s * 0.95, `${name}: a road route cannot be much shorter than the straight line`);   // small tolerance: OSRM snaps points to the nearest road
      assert.ok(r.distance_m <= s * 4 + 1500, `${name}: road distance implausibly long`);
      assert.equal((await roadDistance(db, PICKUP, p)).source, 'cache');
      assert.equal((await roadDistance(db, PICKUP, p)).distance_m, r.distance_m);
    }
    // the reverse direction is a separate lookup (one-way streets can differ)
    const back = await roadDistance(db, PLACES.JBIET, PICKUP); assert.equal(back.source, 'osrm');
  } finally { Object.assign(config.routing, old); }
});

test('real OSRM: a point far outside the downloaded area has no usable route or a very long one', { skip }, async () => {
  const db = openDb(':memory:'); const old = { ...config.routing }; config.routing.osrmUrl = URL_; config.routing.timeoutMs = 5000; setRouter(null);
  try {
    const r = await roadDistance(db, PICKUP, { lat: 28.6139, lng: 77.2090 });       // New Delhi: not in the clipped map
    assert.ok(r.distance_m == null || r.distance_m < 100_000, 'outside the map the engine snaps to the nearest road it knows or finds no route; it never returns a Delhi-length route');
  } finally { Object.assign(config.routing, old); }
});
