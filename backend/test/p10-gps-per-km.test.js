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
// keeps the test customer under the 10-saved-addresses limit (older test addresses are switched off, as when a customer removes them)
const gpsAddr = async (lat, lng) => { W.db.prepare("UPDATE customer_addresses SET active=0 WHERE customer_id=? AND kind='gps'").run(W.custId); return (await W.call('POST', '/api/customer/addresses', FIX({ lat, lng }), W.cust)).body.address.id; };
const quote = (id) => W.call('POST', '/api/customer/quote', { restaurant_id: W.rest, items: [{ id: W.item, qty: 1 }], address_id: id, confirm_destination: true }, W.cust);

test('by default every address is charged by distance at ₹10 per km (no fixed charge)', async () => {
  const p = { lat: 17.395, lng: 78.4867 }, q = (await quote(await gpsAddr(p.lat, p.lng))).body;
  assert.equal(q.delivery_pricing, 'gps_per_km'); assert.equal(q.delivery_paise, Math.round(metres(R, p) / 100) * 100);
});

test('₹10 per km: charged on the exact distance, every metre counted, rounded off to the nearest rupee', async () => {
  assert.equal((await set({ gps_per_km_paise: '1000' })).status, 200);
  for (const p of [{ lat: 17.394, lng: 78.4867 }, { lat: 17.4300, lng: 78.4867 }, { lat: 17.3901, lng: 78.4911 }]) {
    const m = Math.round(metres(R, p)), q = (await quote(await gpsAddr(p.lat, p.lng))).body;
    assert.equal(q.delivery_pricing, 'gps_per_km');
    assert.equal(q.delivery_paise, Math.max(1000, Math.round(m / 100) * 100), `${m} m at ₹10/km (first km ₹10) -> ₹${Math.max(10, Math.round(m / 100))}`);
    assert.equal(q.delivery_paise % 100, 0, 'whole rupees only');
    assert.match(q.delivery_band, /km × ₹10\/km \(straight distance\)/);
  }
  // about 5 km -> about ₹50 (not a band, not a fixed value)
  const five = { lat: R.lat + 5000 / 111195, lng: R.lng }, q5 = (await quote(await gpsAddr(five.lat, five.lng))).body;
  assert.equal(q5.delivery_paise, 5000, `5 km = ₹50, got ${q5.delivery_paise}`);
});

test('PGs, hostels and colleges from the list are charged by distance too (their saved price is not used)', async () => {
  const pt = W.db.prepare('SELECT lat, lng FROM delivery_locations WHERE id=?').get(W.loc);
  if (pt.lat == null) W.db.prepare('UPDATE delivery_locations SET lat=17.40, lng=78.50 WHERE id=?').run(W.loc);
  const pl = W.db.prepare('SELECT lat, lng FROM delivery_locations WHERE id=?').get(W.loc);
  const q = (await W.call('POST', '/api/customer/quote', W.cart(), W.cust)).body;
  assert.equal(q.delivery_pricing, 'gps_per_km'); assert.notEqual(q.delivery_paise, 4000, 'not the place’s fixed ₹40');
  assert.ok(q.delivery_paise > 0 && q.delivery_paise % 100 === 0);
  void pl;
});

test('optional minimum charge and maximum distance; order stores the distance and how it was charged', async () => {
  await set({ gps_min_fee_paise: '1500', gps_max_km: '8' });
  const near = (await quote(await gpsAddr(17.3855, 78.4867))).body; assert.equal(near.delivery_paise, 1500, 'about 56 m -> minimum ₹15');
  const far = await quote(await gpsAddr(17.385 + 9000 / 111195, 78.4867)); assert.equal(far.status, 409); assert.equal(far.body.code, 'OUT_OF_RANGE');
  const id = await gpsAddr(17.394, 78.4867), o = await W.call('POST', '/api/customer/orders', { restaurant_id: W.rest, items: [{ id: W.item, qty: 1 }], address_id: id, confirm_destination: true }, W.cust);
  assert.equal(o.status, 201);
  const row = W.db.prepare('SELECT delivery_pricing, delivery_paise, delivery_distance_m, delivery_route_source FROM orders WHERE order_code=?').get(o.body.order_code);
  assert.deepEqual([row.delivery_pricing, row.delivery_route_source], ['gps_per_km', 'gps_straight']); assert.equal(row.delivery_distance_m, Math.round(metres(R, { lat: 17.394, lng: 78.4867 })));
  assert.equal(row.delivery_paise, Math.max(1500, Math.round(row.delivery_distance_m / 100) * 100));
});

test('settings are validated and audited; an empty rate means the default ₹10 per km', async () => {
  assert.equal((await set({ gps_per_km_paise: '-5' })).status, 400);
  assert.equal((await set({ gps_max_km: '500' })).status, 400);
  assert.ok(W.db.prepare("SELECT 1 FROM audit_logs WHERE action='settings.gps_fee_change'").get());
  await set({ gps_per_km_paise: '', gps_min_fee_paise: '', gps_max_km: '' });
  const p = { lat: 17.394, lng: 78.4867 }, q = (await quote(await gpsAddr(p.lat, p.lng))).body;
  assert.deepEqual([q.delivery_pricing, q.delivery_paise], ['gps_per_km', Math.round(metres(R, p) / 100) * 100]);
  await set({ fixed_place_fees: '1' }); assert.equal((await quote(await gpsAddr(17.394, 78.4867))).body.delivery_pricing, 'gps_fixed', 'the older fixed prices only if switched back on');
  await set({ fixed_place_fees: '0' });
  assert.equal((await W.call('PUT', '/api/admin/settings', { settings: { gps_per_km_paise: '1000' } }, W.owner)).status, 403);
});

test('the first km is always charged in full: 100 m, 300 m and 1 km all cost ₹10; beyond 1 km it grows; the rider gets the same', async () => {
  await set({ gps_per_km_paise: '', gps_min_fee_paise: '', gps_max_km: '', rider_per_km_paise: '', rider_min_payout_paise: '' });
  for (const [dm, want] of [[100, 1000], [300, 1000], [999, 1000], [1500, 1500], [2340, 2300]]) {
    const p = { lat: R.lat + dm / 111195, lng: R.lng }, q = (await quote(await gpsAddr(p.lat, p.lng))).body;
    assert.equal(q.delivery_paise, Math.max(1000, Math.round(metres(R, p) / 100) * 100), `${dm} m`); assert.ok(Math.abs(q.delivery_paise - want) <= 100, `${dm} m ≈ ₹${want / 100}`);
  }
  const near = await W.call('POST', '/api/customer/orders', { restaurant_id: W.rest, items: [{ id: W.item, qty: 1 }], address_id: await gpsAddr(R.lat + 100 / 111195, R.lng), confirm_destination: true }, W.cust);
  const row = W.db.prepare('SELECT delivery_paise, rider_payout_paise, delivery_band FROM orders WHERE order_code=?').get(near.body.order_code);
  assert.deepEqual([row.delivery_paise, row.rider_payout_paise], [1000, 1000]); assert.match(row.delivery_band, /minimum ₹10 \(first km\)/);
});
