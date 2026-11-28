// The customer's delivery charge always covers the delivery partner's pay (Pakka Local pays no delivery cost), and only
// delivery partners inside the service area (e.g. 7 km circle) can go online, see offers and accept them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';
import { FIX } from './helpers/address.js';

const W = await makeWorld('9528');
test.after(() => W.close());
const set = (s) => W.call('PUT', '/api/admin/settings', { settings: s }, W.admin);
const addr = async (lat, lng) => (await W.call('POST', '/api/customer/addresses', FIX({ lat, lng }), W.cust)).body.address.id;
const order = async (id) => { const r = await W.call('POST', '/api/customer/orders', { restaurant_id: W.rest, items: [{ id: W.item, qty: 1 }], address_id: id, confirm_destination: true }, W.cust);
  assert.equal(r.status, 201, JSON.stringify(r.body)); await W.call('POST', `/api/customer/payments/sandbox/${r.body.order_code}/complete`, { outcome: 'success' }, W.cust);
  return W.db.prepare('SELECT * FROM orders WHERE order_code=?').get(r.body.order_code); };

test('delivery charge covers the partner pay: ~0.6 km = ₹10 per-km charge but ₹20 partner minimum, so the customer pays ₹20', async () => {
  await set({ delivery_covers_rider: '1' });
  const near = await order(await addr(17.3905, 78.4867));
  assert.equal(near.rider_payout_paise, 2000); assert.equal(near.delivery_paise, 2000, 'customer pays at least what the partner gets');
  const far = await order(await addr(17.43, 78.4867));
  assert.ok(far.delivery_paise >= far.rider_payout_paise, `${far.delivery_paise} >= ${far.rider_payout_paise}`);
  assert.equal((await set({ delivery_covers_rider: 'x' })).status, 400);
});

test('only partners inside the service area: going online, offers and accepting all need a position inside the circle', async () => {
  await set({ service_center_lat: '17.38500', service_center_lng: '78.48670', service_radius_km: '7' });
  W.db.prepare('UPDATE riders SET area_lat=NULL, area_lng=NULL WHERE user_id=?').run(W.riderId);
  await W.call('POST', '/api/rider/online', { online: false }, W.rider);
  let r = await W.call('POST', '/api/rider/online', { online: true }, W.rider); assert.equal(r.status, 403); assert.equal(r.body.code, 'NEED_LOCATION');
  r = await W.call('POST', '/api/rider/position', { lat: 17.55, lng: 78.4867 }, W.rider); assert.equal(r.body.area.ok, false);
  r = await W.call('POST', '/api/rider/online', { online: true }, W.rider); assert.equal(r.status, 403); assert.equal(r.body.code, 'OUT_OF_AREA'); assert.match(r.body.error, /within 7 km/);
  r = await W.call('POST', '/api/rider/position', { lat: 17.39, lng: 78.49 }, W.rider); assert.equal(r.body.area.ok, true);
  assert.equal((await W.call('POST', '/api/rider/online', { online: true }, W.rider)).status, 200);
  const o = await order(await addr(17.3905, 78.4867)); await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, W.owner);
  assert.ok((await W.call('GET', '/api/rider/offers', null, W.rider)).body.offers.some((x) => x.id === o.id), 'inside: sees the offer');
  await W.call('POST', '/api/rider/position', { lat: 17.55, lng: 78.4867 }, W.rider);
  const d = (await W.call('GET', '/api/rider/offers', null, W.rider)).body; assert.equal(d.offers.length, 0); assert.equal(d.out_of_area.code, 'OUT_OF_AREA');
  r = await W.call('POST', `/api/rider/orders/${o.id}/accept`, {}, W.rider); assert.equal(r.status, 403);
  await W.call('POST', '/api/rider/position', { lat: 17.39, lng: 78.49 }, W.rider);
  assert.equal((await W.call('POST', `/api/rider/orders/${o.id}/accept`, {}, W.rider)).status, 200, 'back inside: can accept');
});

test('admin analysis: per-restaurant orders and earnings, how orders ended, rejection and turn-down reasons, refunds, payouts, hours', async () => {
  for (const p of ['today', '7d', '10d', '30d']) {
    const a = (await W.call('GET', `/api/admin/analytics?preset=${p}`, null, W.admin)); assert.equal(a.status, 200, p);
    const r = a.body.by_restaurant.find((x) => x.id === W.rest); assert.ok(r && r.orders >= 3, JSON.stringify(a.body.by_restaurant));
    assert.ok(a.body.status_mix.length); assert.equal(a.body.by_hour.length, 24); assert.ok('rider_paid_paise' in a.body.payouts && 'count' in a.body.refunds);
    assert.ok(Array.isArray(a.body.restaurant_rejections.reasons) && Array.isArray(a.body.rider_turndowns.riders));
  }
  assert.equal((await W.call('GET', '/api/admin/analytics?preset=today', null, W.rider)).status, 403);
});

test('fast offers: a waiting request comes back about half a second after the restaurant accepts an order (not at Food is ready)', async () => {
  await W.call('POST', '/api/rider/position', { lat: 17.39, lng: 78.49 }, W.rider); await W.call('POST', '/api/rider/online', { online: true }, W.rider);
  for (const o of (await W.call('GET', '/api/rider/offers', null, W.rider)).body.active) W.db.prepare("UPDATE orders SET status='DELIVERED' WHERE id=?").run(o.id);
  const first = (await W.call('GET', '/api/rider/offers', null, W.rider)).body; assert.ok(first.key != null);
  const t0 = Date.now(), waiting = W.call('GET', `/api/rider/offers?wait=10&key=${encodeURIComponent(first.key)}`, null, W.rider);
  const r = await W.call('POST', '/api/customer/orders', { restaurant_id: W.rest, items: [{ id: W.item, qty: 1 }], address_id: await (async () => (await W.call('POST', '/api/customer/addresses', FIX({ lat: 17.3905, lng: 78.4867 }), W.cust)).body.address.id)(), confirm_destination: true }, W.cust);
  await W.call('POST', `/api/customer/payments/sandbox/${r.body.order_code}/complete`, { outcome: 'success' }, W.cust);
  const id = W.db.prepare('SELECT id FROM orders WHERE order_code=?').pluck().get(r.body.order_code);
  await new Promise((ok) => setTimeout(ok, 1200)); const tAcc = Date.now();
  await W.call('POST', `/api/restaurant/orders/${id}/accept`, {}, W.owner);
  const got = (await waiting).body; const ms = Date.now() - tAcc;
  assert.ok(got.offers.some((x) => x.id === id), 'offer arrives on Accept'); assert.ok(ms < 1500, `came back ${ms} ms after Accept`); assert.ok(Date.now() - t0 < 9000);
  const t1 = Date.now(); const same = (await W.call('GET', `/api/rider/offers?wait=1&key=${encodeURIComponent(got.key)}`, null, W.rider)).body; assert.ok(Date.now() - t1 >= 900, 'no change: waits'); assert.equal(same.key, got.key);
});

test('rider navigates to the same restaurant point customers see (saved pin), never a typed link or name search', async () => {
  W.db.prepare("UPDATE restaurants SET maps_link='https://maps.google.com/?q=Some+Other+Branch' WHERE id=?").run(W.rest);
  const pin = W.db.prepare('SELECT pickup_lat AS lat, pickup_lng AS lng FROM restaurants WHERE id=?').get(W.rest);
  const pub = (await W.call('GET', '/api/public/restaurants')).body.restaurants.find((x) => x.id === W.rest); assert.deepEqual([pub.lat, pub.lng], [pin.lat, pin.lng], 'customer sees the pin');
  const d = (await W.call('GET', '/api/rider/offers', null, W.rider)).body, c = [...d.offers, ...d.active][0]; assert.ok(c, 'has an offer or delivery');
  assert.deepEqual([c.restaurant.lat, c.restaurant.lng], [pin.lat, pin.lng]); assert.match(c.restaurant.maps_link, new RegExp(`destination=${pin.lat}%2C${pin.lng}`)); assert.doesNotMatch(c.restaurant.maps_link, /Other/);
});
