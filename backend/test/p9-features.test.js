// Order chat, "What should we call you?", admin username login, opening hours, order radius lookup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, PW } from './helpers/world.js';
import { recordLocation, liveEta } from '../src/services/tracking.js';
import { setRouteFetcher } from '../src/services/liveRoute.js';

const W = await makeWorld('9440');
test.after(() => W.close());

test('chat: only the order customer and its assigned rider; open while delivering; unread + push to the other side', async () => {
  const o = await W.paidOrder();
  const path = `/api/customer/orders/${o.order_code}/messages`;
  assert.equal((await W.call('POST', path, { body: 'hi' }, W.cust)).status, 409, 'closed until a rider is assigned');
  await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, W.owner);
  await W.call('POST', `/api/rider/orders/${o.id}/accept`, {}, W.rider);
  assert.equal((await W.call('POST', path, { body: '  Gate 2,   please  ' }, W.cust)).status, 201);
  assert.equal((await W.call('POST', path, { body: '' }, W.cust)).status, 400);
  assert.equal((await W.call('POST', path, { body: 'x'.repeat(501) }, W.cust)).status, 400);
  const other = await W.customer(W.ph(320), 'Ravi');
  assert.equal((await W.call('GET', path, null, other)).status, 404, 'another customer cannot read it');
  assert.equal((await W.call('GET', path, null, W.owner)).status, 403, 'restaurant cannot read it');
  const job = (await W.call('GET', `/api/rider/orders/${o.id}`, null, W.rider)).body;
  assert.equal(job.chat.unread, 1);
  assert.equal(W.notes(W.riderId, 'message').length, 1, 'rider is notified');
  const seen = (await W.call('GET', `/api/rider/orders/${o.id}/messages`, null, W.rider)).body;
  assert.equal(seen.messages[0].body, 'Gate 2, please'); assert.equal(seen.messages[0].mine, false); assert.equal(seen.can_send, true);
  assert.equal((await W.call('GET', `/api/rider/orders/${o.id}`, null, W.rider)).body.chat.unread, 0, 'read after opening');
  assert.equal((await W.call('POST', `/api/rider/orders/${o.id}/messages`, { body: 'On my way' }, W.rider)).status, 201);
  const v = (await W.call('GET', `/api/customer/orders/${o.order_code}`, null, W.cust)).body;
  assert.equal(v.chat.unread, 1); assert.equal(v.chat.open, true);
  const m = (await W.call('GET', path, null, W.cust)).body.messages;
  assert.equal(m[1].from, 'Delivery partner', 'rider identity not revealed before pickup');
  assert.equal(W.notes(W.custId, 'message').length, 1, 'customer is notified');
});

test('name: new customers without a name are asked; existing named customers are not', async () => {
  const t = await W.customer(W.ph(330));
  const me = (await W.call('GET', '/api/auth/me', null, t)).body.user;
  assert.equal(me.needs_name, true);
  assert.equal((await W.call('POST', '/api/auth/name', { name: ' ' }, t)).status, 400);
  assert.equal((await W.call('POST', '/api/auth/name', { name: '1234' }, t)).status, 400);
  assert.equal((await W.call('POST', '/api/auth/name', { name: 'Meera' }, t)).body.user.needs_name, false);
  assert.equal((await W.call('GET', '/api/auth/me', null, t)).body.user.name, 'Meera');
  assert.equal((await W.call('GET', '/api/auth/me', null, W.cust)).body.user.needs_name, false, 'Asha already has a name');
  W.db.prepare("UPDATE users SET name='Customer' WHERE id=?").run(W.custId);
  assert.equal((await W.call('GET', '/api/auth/me', null, W.cust)).body.user.needs_name, true, 'old placeholder name is asked once');
  W.db.prepare("UPDATE users SET name='Asha' WHERE id=?").run(W.custId);
  assert.equal((await W.call('POST', '/api/auth/name', { name: 'Hacker' }, W.rider)).status, 403, 'staff names are not changed here');
});

test('admin username: set with password, then sign in with it; other portals cannot use usernames', async () => {
  assert.equal((await W.call('POST', '/api/admin/username', { username: 'ops.lead' }, W.admin)).status, 401, 'needs current password');
  assert.equal((await W.call('POST', '/api/admin/username', { username: 'x', reauth_password: PW }, W.admin)).status, 400);
  assert.equal((await W.call('POST', '/api/admin/username', { username: 'Ops.Lead', reauth_password: PW }, W.admin)).body.username, 'ops.lead');
  const ok = await W.raw('POST', '/api/auth/login', { portal: 'admin', username: 'OPS.lead', password: PW });
  assert.equal(ok.status, 200); assert.ok(ok.body.token);
  assert.equal((await W.raw('POST', '/api/auth/login', { portal: 'admin', username: 'ops.lead', password: 'wrong-password' })).status, 401);
  assert.equal((await W.raw('POST', '/api/auth/login', { portal: 'admin', phone: W.ph(1), password: PW })).status, 200, 'mobile number still works');
  assert.equal((await W.raw('POST', '/api/auth/login', { portal: 'rider', username: 'ops.lead', password: PW })).status, 400);
  assert.equal((await W.call('POST', '/api/admin/username', { username: 'ops.lead', reauth_password: PW }, W.rider)).status, 403);
});

test('opening hours: restaurant sets them, customers see them', async () => {
  const me = (await W.call('GET', '/api/restaurant/me', null, W.owner)).body.restaurant;
  assert.equal((await W.call('PUT', '/api/restaurant/me', { name: me.name, opens_at: '25:00', closes_at: '23:00' }, W.owner)).status, 400);
  assert.equal((await W.call('PUT', '/api/restaurant/me', { name: me.name, opens_at: '10:00' }, W.owner)).status, 400, 'both or neither');
  assert.equal((await W.call('PUT', '/api/restaurant/me', { name: me.name, opens_at: '10:00', closes_at: '23:30' }, W.owner)).status, 200);
  const list = (await W.call('GET', '/api/public/restaurants')).body.restaurants.find((x) => x.id === W.rest);
  assert.equal(list.opens_at, '10:00'); assert.equal(list.closes_at, '23:30');
  assert.equal((await W.call('GET', `/api/public/restaurants/${W.rest}/menu`)).body.restaurant.closes_at, '23:30');
  assert.equal((await W.call('PUT', '/api/restaurant/me', { name: me.name }, W.owner)).status, 200);
  assert.equal((await W.call('GET', '/api/restaurant/me', null, W.owner)).body.restaurant.opens_at, '10:00', 'other edits keep the hours');
});

test('radius lookup: lists restaurants by distance with in/out of range from the admin max distance', async () => {
  W.db.prepare('UPDATE restaurants SET pickup_lat=17.4000, pickup_lng=78.5000 WHERE id=?').run(W.rest);
  W.db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('distance_max_km','5')").run();
  const near = (await W.call('POST', '/api/admin/distance-pricing/radius', { lat: 17.41, lng: 78.5 }, W.admin)).body;
  const r = near.restaurants.find((x) => x.id === W.rest);
  assert.ok(r.straight_km > 1 && r.straight_km < 1.2); assert.equal(r.within, true); assert.equal(near.max_km, 5);
  const far = (await W.call('POST', '/api/admin/distance-pricing/radius', { lat: 17.5, lng: 78.5 }, W.admin)).body.restaurants.find((x) => x.id === W.rest);
  assert.equal(far.within, false);
  assert.equal((await W.call('POST', '/api/admin/distance-pricing/radius', {}, W.admin)).status, 400);
  assert.equal((await W.call('POST', '/api/admin/distance-pricing/radius', { lat: 17.41, lng: 78.5 }, W.owner)).status, 403);
});

test('admin menu: Super Admin adds, edits, hides and deletes dishes and categories for any restaurant; others cannot', async () => {
  const base = `/api/admin/restaurants/${W.rest}`;
  const cat = (await W.call('POST', `${base}/categories`, { name: 'Specials' }, W.admin));
  assert.equal(cat.status, 201);
  assert.equal((await W.call('POST', `${base}/menu`, { name: 'Paneer Roll', base_price_paise: 9000, prep_time_min: 10 }, W.admin)).status, 400, 'photo still required to show it');
  const it = await W.call('POST', `${base}/menu`, { name: 'Paneer Roll', base_price_paise: 9000, prep_time_min: 10, available: false, category_id: cat.body.id }, W.admin);
  assert.equal(it.status, 201);
  assert.equal((await W.call('PUT', `${base}/menu/${it.body.id}`, { name: 'Paneer Kathi Roll', base_price_paise: 9500 }, W.admin)).status, 200);
  const own = (await W.call('GET', '/api/restaurant/menu', null, W.owner)).body.items.find((x) => x.id === it.body.id);
  assert.equal(own.name, 'Paneer Kathi Roll'); assert.equal(own.base_price_paise, 9500);
  assert.equal((await W.call('GET', `${base}/menu`, null, W.admin)).body.items.some((x) => x.id === it.body.id), true);
  assert.equal((await W.call('GET', `${base}/menu`, null, W.owner)).status, 403, 'restaurant users cannot use the admin route');
  assert.equal((await W.call('POST', `${base}/menu`, { name: 'X', base_price_paise: 100, prep_time_min: 5, available: false }, W.cust)).status, 403);
  assert.equal((await W.call('GET', '/api/admin/restaurants/999999/menu', null, W.admin)).status, 404);
  assert.equal((await W.call('DELETE', `${base}/menu/${it.body.id}`, null, W.admin)).status, 200);
  assert.ok(!(await W.call('GET', '/api/restaurant/menu', null, W.owner)).body.items.some((x) => x.id === it.body.id));
  assert.ok(W.db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'menu.%'").pluck().get() >= 4, 'admin menu changes are audited');
});

test('live ETA: recalculated from the rider position, shown on tracking, never from an offline phone', async () => {
  const o = await W.paidOrder();
  await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, W.owner);
  await W.call('POST', `/api/rider/orders/${o.id}/accept`, {}, W.rider);
  await W.call('POST', `/api/restaurant/orders/${o.id}/ready`, {}, W.owner);
  const pick = (await W.call('GET', `/api/restaurant/orders/${o.id}`, null, W.owner)).body.order.pickup_otp;
  await W.call('POST', `/api/rider/orders/${o.id}/pickup`, { otp: pick }, W.rider);
  const d = W.db.prepare('SELECT dest_lat,dest_lng FROM orders WHERE id=?').get(o.id), t0 = Date.now();
  assert.ok(recordLocation(W.db, W.riderId, { lat: d.dest_lat + 0.03, lng: d.dest_lng, accuracy: 10 }, t0).ok);       // ~3.3 km away
  const far = Date.parse(W.db.prepare('SELECT eta_at FROM orders WHERE id=?').pluck().get(o.id)) - t0;
  const v = (await W.call('GET', `/api/tracking/orders/${o.order_code}`, null, W.cust)).body;
  assert.ok(v.eta.minutes >= 10 && v.eta.minutes <= 25, `minutes ${v.eta.minutes}`); assert.ok(v.eta.straight_m > 3000 && v.eta.straight_m < 3700);
  assert.equal((await W.call('GET', `/api/customer/orders/${o.order_code}`, null, W.cust)).body.eta_live, true);
  recordLocation(W.db, W.riderId, { lat: d.dest_lat + 0.005, lng: d.dest_lng, accuracy: 10 }, t0 + 5000);
  const near = Date.parse(W.db.prepare('SELECT eta_at FROM orders WHERE id=?').pluck().get(o.id)) - (t0 + 5000);
  assert.ok(near < far, 'closer rider -> earlier arrival');
  assert.equal(liveEta(W.db, { lat: 17.4, lng: 78.5 }, { lat: 17.4005, lng: 78.5 }).minutes, 1, 'under 150 m is arriving now');
  const fast = liveEta(W.db, { lat: 17.4, lng: 78.5, speed_mps: 11 }, { lat: 17.43, lng: 78.5 }).minutes, slow = liveEta(W.db, { lat: 17.4, lng: 78.5 }, { lat: 17.43, lng: 78.5 }).minutes;
  assert.ok(fast < slow, 'a rider moving at a real riding speed arrives sooner');
  W.db.prepare("UPDATE rider_locations SET received_at=? WHERE rider_id=?").run(new Date(Date.now() - 600_000).toISOString(), W.riderId);
  const off = (await W.call('GET', `/api/tracking/orders/${o.order_code}`, null, W.cust)).body;
  assert.equal(off.state, 'offline'); assert.equal(off.eta, null, 'no live estimate from an offline phone');
  assert.equal((await W.call('GET', `/api/customer/orders/${o.order_code}`, null, W.cust)).body.eta_live, false);
});

test('road route: drawn from a routing service, used for the time, looked up sparingly; no service = no line', async () => {
  W.db.prepare("UPDATE orders SET status='DELIVERED' WHERE rider_id=? AND status IN ('ACCEPTED','PREPARING','READY','PICKED_UP')").run(W.riderId);      // earlier tests left this rider on a delivery
  W.db.prepare('DELETE FROM rider_locations WHERE rider_id=?').run(W.riderId);
  const o = await W.paidOrder();
  await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, W.owner);
  await W.call('POST', `/api/rider/orders/${o.id}/accept`, {}, W.rider);
  await W.call('POST', `/api/restaurant/orders/${o.id}/ready`, {}, W.owner);
  const pick = (await W.call('GET', `/api/restaurant/orders/${o.id}`, null, W.owner)).body.order.pickup_otp;
  await W.call('POST', `/api/rider/orders/${o.id}/pickup`, { otp: pick }, W.rider);
  const d = W.db.prepare('SELECT dest_lat,dest_lng FROM orders WHERE id=?').get(o.id), t0 = Date.now();
  const start = { lat: d.dest_lat - 0.02, lng: d.dest_lng };
  recordLocation(W.db, W.riderId, { ...start, accuracy: 10 }, t0);
  assert.equal((await W.call('GET', `/api/tracking/orders/${o.order_code}`, null, W.cust)).body.route, null, 'no routing service: no line');
  // an L-shaped road: east 0.02, then north 0.02, then back west to the drop-off (longer than the straight line)
  let calls = 0;
  setRouteFetcher(async (from) => { calls++; const pts = []; for (let i = 0; i <= 10; i++) pts.push([from.lat, from.lng + 0.002 * i]); for (let i = 1; i <= 10; i++) pts.push([from.lat + 0.002 * i, from.lng + 0.02]); for (let i = 1; i <= 10; i++) pts.push([d.dest_lat, d.dest_lng + 0.02 - 0.002 * i]); return pts; });
  const v = (await W.call('GET', `/api/tracking/orders/${o.order_code}`, null, W.cust)).body;
  assert.ok(v.route.coords.length > 20, 'road points returned'); assert.deepEqual(v.route.coords[0], [start.lat, start.lng]);
  assert.ok(v.route.distance_m > 5500 && v.route.distance_m < 7000, `road ${v.route.distance_m}`);
  assert.equal(v.eta.by_road, true); assert.ok(v.eta.minutes > liveEta(W.db, start, { lat: d.dest_lat, lng: d.dest_lng }).minutes, 'longer road -> later than the straight-line guess');
  await W.call('GET', `/api/tracking/orders/${o.order_code}`, null, W.cust); await W.call('GET', `/api/tracking/orders/${o.order_code}`, null, W.admin);
  assert.equal(calls, 1, 'repeat views reuse the stored route');
  recordLocation(W.db, W.riderId, { lat: start.lat, lng: start.lng + 0.01, accuracy: 10 }, t0 + 5000);       // moved along the road
  const v2 = (await W.call('GET', `/api/tracking/orders/${o.order_code}`, null, W.cust)).body;
  assert.equal(calls, 1, 'still on the route: no new lookup'); assert.ok(v2.route.distance_m < v.route.distance_m - 900, 'route trimmed to what is left');
  const a = (await W.call('GET', '/api/tracking/admin/active', null, W.admin)).body.deliveries.find((x) => x.id === o.id);
  assert.ok(Array.isArray(a.route) && a.route.length > 5, 'admin live map gets the same route'); assert.equal(calls, 1);
  setRouteFetcher(null);
});
