// Rider pay follows the delivery distance (not a fixed amount), and a busy rider can add only orders that are on their way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, PW } from './helpers/world.js';
import { FIX } from './helpers/address.js';

const W = await makeWorld('9510');
test.after(() => W.close());
const R = { lat: 17.385, lng: 78.4867 };
const metres = (a, b) => { const r = (x) => (x * Math.PI) / 180, h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };
const set = (s) => W.call('PUT', '/api/admin/settings', { settings: s }, W.admin);
const addr = async (lat, lng, tok = W.cust) => (await W.call('POST', '/api/customer/addresses', FIX({ lat, lng }), tok)).body.address.id;
const order = async (id, rest = W.rest, item = W.item) => { const r = await W.call('POST', '/api/customer/orders', { restaurant_id: rest, items: [{ id: item, qty: 1 }], address_id: id, confirm_destination: true }, W.cust);
  assert.equal(r.status, 201, JSON.stringify(r.body)); await W.call('POST', `/api/customer/payments/sandbox/${r.body.order_code}/complete`, { outcome: 'success' }, W.cust);
  return W.db.prepare('SELECT * FROM orders WHERE order_code=?').get(r.body.order_code); };
const accept = async (o, owner = W.owner) => { await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, owner); };

// Model A (Nov 2026 partner plan): higher of ₹20 or ₹9.50 × km (₹7 base + ₹2.50 SRSA/ERA), rounded up to the rupee
const modelA = (m) => Math.max(2000, Math.ceil((2000 + Math.max(0, m / 1000 - 1) * 400) / 100) * 100, Math.ceil((950 * m / 1000) / 100) * 100);
test('no rate set: the rider is paid by Model A (₹20 minimum, ₹9.50/km rounded up); the customer pays the per-km charge', async () => {
  const p = { lat: 17.394, lng: 78.4867 }, o = await order(await addr(p.lat, p.lng)), rupees = Math.round(metres(R, p) / 100);
  assert.equal(o.rider_payout_paise, modelA(metres(R, p))); assert.equal(o.delivery_paise, rupees * 100);
});

test('with ₹10/km for customers: the rider is still paid by Model A on the same distance', async () => {
  await set({ gps_per_km_paise: '1000' });
  const p = { lat: 17.394, lng: 78.4867 }, o = await order(await addr(p.lat, p.lng)), rupees = Math.round(metres(R, p) / 100);
  assert.equal(o.delivery_paise, rupees * 100); assert.equal(o.rider_payout_paise, modelA(metres(R, p)), 'rider pay = Model A on the same distance');
  // listed places: the customer pays the place's own charge, the rider is still paid by the distance to that place's point
  const l = (await W.call('POST', '/api/customer/orders', W.cart(), W.cust)).body; const lo = W.db.prepare('SELECT * FROM orders WHERE order_code=?').get(l.order_code);
  assert.equal(lo.rider_payout_paise % 100, 0); assert.ok(lo.rider_payout_paise > 0);
});

test('own rider rate and minimum; old orders keep their pay', async () => {
  const before = W.db.prepare('SELECT id, rider_payout_paise FROM orders ORDER BY id').all();
  await set({ rider_per_km_paise: '800', rider_min_payout_paise: '2000' });
  const near = await order(await addr(17.3855, 78.4867)); assert.equal(near.rider_payout_paise, 2000, 'minimum');
  const p = { lat: 17.43, lng: 78.4867 }, far = await order(await addr(p.lat, p.lng)); assert.equal(far.rider_payout_paise, Math.round(metres(R, p) * 800 / 100000) * 100);
  for (const b of before) assert.equal(W.db.prepare('SELECT rider_payout_paise FROM orders WHERE id=?').pluck().get(b.id), b.rider_payout_paise);
  assert.equal((await set({ rider_per_km_paise: '-1' })).status, 400); assert.equal((await set({ batch_radius_km: '0' })).status, 400);
  await set({ rider_per_km_paise: '', rider_min_payout_paise: '' });
});

test('a rider carrying a delivery is offered and can accept only orders on their way; far ones wait for others', async () => {
  W.db.prepare("UPDATE orders SET status='CANCELLED' WHERE status NOT IN ('DELIVERED','CANCELLED','REJECTED')").run();
  const first = await order(await addr(17.394, 78.4867)); await accept(first);
  assert.equal((await W.call('POST', `/api/rider/orders/${first.id}/accept`, {}, W.rider)).status, 200);
  // same restaurant, drop-off 300 m from the first: on the way
  const near = await order(await addr(17.3967, 78.4867)); await accept(near);
  // a second restaurant 6 km away: not on the way
  const far = (await W.call('POST', '/api/admin/restaurants', { name: 'Far Kitchen', commission_bps: 1000, markup_paise: 0, admin_visible: true, approved: true }, W.admin)).body.id;
  await W.call('POST', '/api/admin/users', { role: 'restaurant', name: 'Far Owner', phone: W.ph(150), password: PW, restaurant_id: far }, W.admin);
  const fo = await W.staff('restaurant', W.ph(150)); await W.call('PUT', '/api/restaurant/location', { lat: 17.44, lng: 78.4867, source: 'manual' }, fo); await W.call('POST', '/api/restaurant/status', { open: true }, fo);
  const fItem = (await W.call('POST', '/api/restaurant/menu', { name: 'Dosa', base_price_paise: 6000, prep_time_min: 10, image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }, fo)).body.id;
  const farO = await order(await addr(17.45, 78.4867), far, fItem); await accept(farO, fo);
  const offers = (await W.call('GET', '/api/rider/offers', null, W.rider)).body;
  assert.deepEqual(offers.offers.map((x) => x.id), [near.id], 'only the nearby order is shown');
  assert.ok(offers.offers[0].on_the_way.drop_km <= 0.5);
  const fr = await W.call('POST', `/api/rider/orders/${farO.id}/accept`, {}, W.rider); assert.equal(fr.status, 409); assert.equal(fr.body.code, 'NOT_NEARBY');
  assert.equal((await W.call('POST', `/api/rider/orders/${near.id}/accept`, {}, W.rider)).status, 200, 'nearby one accepted');
  assert.equal((await W.call('GET', '/api/rider/offers', null, W.rider)).body.offers.length, 0, 'full at 2: no more offers');
});

test('Model A payout table from the partner plan (1–7 km) and SRSA/ERA labels', async () => {
  const { riderPayParts } = await import('../src/services/core.js');
  // short trips step up from Rs 20 (Rs 1 every 250 m after the first km), then the plan's per-km table
  const want = { 0.5: 20, 1: 20, 1.25: 21, 1.5: 22, 1.75: 23, 2: 24, 2.5: 26, 3: 29, 3.5: 34, 4: 38, 4.5: 43, 5: 48, 5.5: 53, 6: 57, 6.5: 62, 7: 67 };
  for (const [km, rs] of Object.entries(want)) { const p = riderPayParts(W.db, Number(km) * 1000); assert.equal(p.total_paise, rs * 100, `${km} km`); }
  assert.equal(riderPayParts(W.db, 5000).route_label, 'SRSA'); assert.equal(riderPayParts(W.db, 5001).route_label, 'ERA'); assert.equal(riderPayParts(W.db, 1000).minimum_applied, true);
});
