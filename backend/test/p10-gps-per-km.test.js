// GPS addresses not on the list: charge per km from the restaurant, counted to the metre (no fixed values, no rounding to whole km).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';
import { FIX } from './helpers/address.js';

const W = await makeWorld('9490');
test.after(() => W.close());
const R = { lat: 17.385, lng: 78.4867 };                                     // the test restaurant's saved location
const metres = (a, b) => { const r = (x) => (x * Math.PI) / 180, h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
const set = (s) => W.call('PUT', '/api/admin/settings', { settings: s }, W.admin);
const gpsAddr = async (lat, lng) => (await W.call('POST', '/api/customer/addresses', FIX({ lat, lng }), W.cust)).body.address.id;
const quote = (id) => W.call('POST', '/api/customer/quote', { restaurant_id: W.rest, items: [{ id: W.item, qty: 1 }], address_id: id, confirm_destination: true }, W.cust);

test('off by default: GPS addresses keep the fixed charge', async () => {
  const q = (await quote(await gpsAddr(17.395, 78.4867))).body;
  assert.deepEqual([q.delivery_pricing, q.delivery_paise], ['gps_fixed', 4000]);
});

test('₹10 per km: charged on the exact distance, every metre counted', async () => {
  assert.equal((await set({ gps_per_km_paise: '1000' })).status, 200);
  for (const p of [{ lat: 17.394, lng: 78.4867 }, { lat: 17.4300, lng: 78.4867 }, { lat: 17.3901, lng: 78.4911 }]) {
    const m = Math.round(metres(R, p)), q = (await quote(await gpsAddr(p.lat, p.lng))).body;
    assert.equal(q.delivery_pricing, 'gps_per_km');
    assert.equal(q.delivery_paise, Math.round(m * 1000 / 1000), `${m} m at ₹10/km = ${m} paise`);       // ₹10/km = 1 paisa per metre
    assert.match(q.delivery_band, /km × ₹10\/km \(straight distance\)/);
  }
  // about 5 km -> about ₹50 (not a band, not a fixed value)
  const five = { lat: R.lat + 5000 / 111195, lng: R.lng }, q5 = (await quote(await gpsAddr(five.lat, five.lng))).body;
  assert.ok(Math.abs(q5.delivery_paise - 5000) <= 2, `5 km ≈ ₹50, got ${q5.delivery_paise}`);
});

test('listed places keep their own charge', async () => {
  const q = (await W.call('POST', '/api/customer/quote', W.cart(), W.cust)).body;
  assert.deepEqual([q.delivery_pricing, q.delivery_paise], ['listed', 4000]);
});

test('optional minimum charge and maximum distance; order stores the distance and how it was charged', async () => {
  await set({ gps_min_fee_paise: '1500', gps_max_km: '8' });
  const near = (await quote(await gpsAddr(17.3855, 78.4867))).body; assert.equal(near.delivery_paise, 1500, 'about 56 m -> minimum ₹15');
  const far = await quote(await gpsAddr(17.385 + 9000 / 111195, 78.4867)); assert.equal(far.status, 409); assert.equal(far.body.code, 'OUT_OF_RANGE');
  const id = await gpsAddr(17.394, 78.4867), o = await W.call('POST', '/api/customer/orders', { restaurant_id: W.rest, items: [{ id: W.item, qty: 1 }], address_id: id, confirm_destination: true }, W.cust);
  assert.equal(o.status, 201);
  const row = W.db.prepare('SELECT delivery_pricing, delivery_paise, delivery_distance_m, delivery_route_source FROM orders WHERE order_code=?').get(o.body.order_code);
  assert.deepEqual([row.delivery_pricing, row.delivery_route_source], ['gps_per_km', 'gps_straight']); assert.equal(row.delivery_distance_m, Math.round(metres(R, { lat: 17.394, lng: 78.4867 })));
  assert.equal(row.delivery_paise, Math.max(1500, row.delivery_distance_m));
});

test('settings are validated, audited, and empty switches back to the fixed charge', async () => {
  assert.equal((await set({ gps_per_km_paise: '-5' })).status, 400);
  assert.equal((await set({ gps_max_km: '500' })).status, 400);
  assert.ok(W.db.prepare("SELECT 1 FROM audit_logs WHERE action='settings.gps_fee_change'").get());
  await set({ gps_per_km_paise: '', gps_min_fee_paise: '', gps_max_km: '' });
  assert.equal((await quote(await gpsAddr(17.394, 78.4867))).body.delivery_pricing, 'gps_fixed');
  assert.equal((await W.call('PUT', '/api/admin/settings', { settings: { gps_per_km_paise: '1000' } }, W.owner)).status, 403);
});
