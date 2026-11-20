// Restaurant location management + weekly opening hours (Asia/Kolkata): the server-side acceptance checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, PW } from './helpers/world.js';
import { withinHours, nextOpening, todayHours } from '../src/services/hours.js';

const W = await makeWorld('9470');
test.after(() => W.close());
const istNow = () => { const d = new Date(Date.now() + 330 * 60_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hm = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const week = (open, close, closedDays = []) => [0, 1, 2, 3, 4, 5, 6].map((dow) => closedDays.includes(dow) ? { dow, closed: true } : { dow, closed: false, open, close });
const setHours = (days, tok = W.owner) => W.call('PUT', '/api/restaurant/hours', { days }, tok);
const listed = async () => (await W.call('GET', '/api/public/restaurants')).body.restaurants.find((x) => x.id === W.rest);
const ADDR = { line: '12-1-133, Jaipuri Colony Road', building: 'Laxmi Nilayam', area: 'Nagole', city: 'Hyderabad', state: 'Telangana', pin: '500068' };
// IST timestamps for the pure-function checks: 2026-11-20 is a Friday
const at = (day, h, m = 0) => Date.UTC(2026, 10, day, h, m) - 330 * 60_000;

test('1-3) location by GPS, by map pin and by typed coordinates, each with a full address; confirmed by the owner', async () => {
  const put = (b) => W.call('PUT', '/api/restaurant/location', b, W.owner);
  const g = await put({ lat: 17.3711, lng: 78.5523, source: 'gps', accuracy_m: 18, address: ADDR }); assert.equal(g.status, 200);
  let me = (await W.call('GET', '/api/restaurant/me', null, W.owner)).body.restaurant;
  assert.deepEqual([me.location_source, me.addr_area, me.addr_pin, me.address], ['gps', 'Nagole', '500068', ADDR.line]); assert.ok(me.location_confirmed_at);
  assert.equal((await put({ lat: 17.3712, lng: 78.5524, source: 'map' })).status, 200);
  me = (await W.call('GET', '/api/restaurant/me', null, W.owner)).body.restaurant; assert.deepEqual([me.location_source, me.pickup_lat, me.addr_city], ['map', 17.3712, 'Hyderabad'], 'address kept when only the pin moves');
  assert.equal((await put({ lat: 17.385, lng: 78.4867, source: 'manual', address: { ...ADDR, pin: '50006' } })).status, 400, 'PIN must be 6 digits');
  assert.equal((await put({ lat: 17.385, lng: 78.4867, source: 'manual', address: { ...ADDR, building: '' } })).status, 400, 'building/shop name required');
  assert.equal((await put({ lat: 'x', lng: 78.4, source: 'manual' })).status, 400);
  assert.equal((await put({ lat: 17.385, lng: 78.4867, source: 'manual' })).status, 200);
  assert.equal(W.db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action='restaurant.location' AND target_id=?").pluck().get(String(W.rest)) >= 3, true, 'every change audited');
});

test('4) location persists after logging out and in again', async () => {
  const again = await W.staff('restaurant', W.ph(101));
  const me = (await W.call('GET', '/api/restaurant/me', null, again)).body.restaurant;
  assert.deepEqual([me.pickup_lat, me.pickup_lng, me.location_source, me.addr_building], [17.385, 78.4867, 'manual', 'Laxmi Nilayam']);
});

test('5) admin sees every location with its status, adds a missing one and corrects coordinates', async () => {
  const rid = (await W.call('POST', '/api/admin/restaurants', { name: 'Missing Pin', commission_bps: 1000, markup_paise: 0, admin_visible: true, approved: true }, W.admin)).body.id;
  const row = (id) => W.call('GET', '/api/admin/restaurants', null, W.admin).then((r) => r.body.restaurants.find((x) => x.id === id));
  assert.equal((await row(rid)).location_status, 'missing');
  assert.equal((await row(W.rest)).location_status, 'confirmed');
  W.db.prepare('UPDATE restaurants SET pickup_lat=17.4, pickup_lng=78.5 WHERE id=?').run(rid);
  assert.equal((await row(rid)).location_status, 'unconfirmed', 'coordinates without confirmation are flagged');
  assert.equal((await W.call('PUT', `/api/admin/restaurants/${rid}/pickup`, { lat: 78.5, lng: 17.4 }, W.admin)).status, 400, 'swapped values refused');
  assert.equal((await W.call('PUT', `/api/admin/restaurants/${rid}/pickup`, { lat: 17.4012, lng: 78.5034, address: ADDR }, W.admin)).status, 200);
  const r = await row(rid); assert.deepEqual([r.location_status, r.location_source, r.pickup_lat, r.addr_pin], ['confirmed', 'admin', 17.4012, '500068']);
  assert.ok(W.db.prepare("SELECT 1 FROM audit_logs WHERE action='restaurant.pickup_point' AND target_id=?").get(String(rid)));
  assert.equal((await W.call('PUT', `/api/admin/restaurants/${rid}/pickup`, { lat: 17.4, lng: 78.5 }, W.owner)).status, 403, 'owners cannot use the admin tool');
  assert.equal((await W.call('PUT', `/api/admin/restaurants/${rid}/pickup`, { lat: null, lng: null }, W.admin)).status, 200);
  assert.equal((await row(rid)).location_status, 'missing');
});

test('6) seven-day hours: each day on/off with its own times, past midnight allowed, bad input refused', async () => {
  assert.equal((await setHours(week('10:00', '22:00').slice(0, 6))).status, 400, 'all seven days');
  assert.equal((await setHours(week('25:00', '22:00'))).status, 400);
  assert.equal((await setHours(week('10:00', '10:00'))).status, 400, 'same open/close');
  const days = week('10:00', '22:00', [1]); days[5] = { dow: 5, closed: false, open: '18:00', close: '02:00' }; days[6] = { dow: 6, closed: false, open: '09:30', close: '23:30' };
  const r = await setHours(days); assert.equal(r.status, 200);
  assert.equal(r.body.days[1].closed, true); assert.equal(r.body.days[5].overnight, true); assert.equal(r.body.days[6].open, '09:30');
  const rows = W.db.prepare('SELECT dow, closed, open_min, close_min FROM restaurant_hours WHERE restaurant_id=?').all(W.rest);
  assert.equal(rows.length, 7);
  // Friday 18:00-02:00 (IST): open Fri 23:00 and Sat 01:30, closed Sat 02:00 and Fri 17:59
  assert.equal(withinHours(rows, at(20, 23)), true); assert.equal(withinHours(rows, at(21, 1, 30)), true);
  assert.equal(withinHours(rows, at(21, 2)), false); assert.equal(withinHours(rows, at(20, 17, 59)), false);
  assert.equal(withinHours(rows, at(23, 12)), false, 'Monday closed');
  assert.equal(nextOpening(rows, at(23, 12)), new Date(at(24, 10)).toISOString(), 'after closed Monday comes Tuesday 10:00 IST');
  assert.deepEqual(todayHours(rows, at(20, 9)), { open: '18:00', close: '02:00' }); assert.deepEqual(todayHours(rows, at(23, 9)), { closed: true });
  assert.ok(W.db.prepare("SELECT 1 FROM audit_logs WHERE action='restaurant.hours'").get());
  assert.equal((await W.call('PUT', '/api/restaurant/hours', { days }, W.cust)).status, 403);
});

test('7, 9, 10) closed restaurant: customers see Closed + next opening; quote and order both refused by the server', async () => {
  const n = istNow(); await setHours(week(hm(n + 120), hm(n + 180)));
  const l = await listed(); assert.deepEqual([l.is_open, l.closed_reason], [0, 'outside_hours']); assert.ok(l.next_open_at); assert.ok(l.today_hours);
  const menu = (await W.call('GET', `/api/public/restaurants/${W.rest}/menu`)).body.restaurant; assert.equal(menu.is_open, 0); assert.ok(menu.next_open_at);
  const q = await W.call('POST', '/api/customer/quote', W.cart(), W.cust); assert.equal(q.status, 409); assert.deepEqual([q.body.code, q.body.reason], ['RESTAURANT_CLOSED', 'outside_hours']);
  const before = W.db.prepare('SELECT COUNT(*) FROM orders').pluck().get();
  const o = await W.call('POST', '/api/customer/orders', W.cart(), W.cust); assert.equal(o.status, 409, 'enforced on order creation too, whatever the screen shows');
  assert.equal(W.db.prepare('SELECT COUNT(*) FROM orders').pluck().get(), before);
  const me = (await W.call('GET', '/api/restaurant/me', null, W.owner)).body; assert.deepEqual([me.status.is_open, me.availability.reason], [1, 'outside_hours'], 'dashboard can say: switch on but outside hours');
  // temporarily closed (holiday): switch off for 2 days, reopens automatically
  await setHours(week('00:00', '23:59'));
  await W.call('POST', '/api/restaurant/status', { open: false, mode: 'auto', days: 2 }, W.owner);
  const h = await listed(); assert.deepEqual([h.is_open, h.closed_reason], [0, 'paused']); assert.ok(h.next_open_at, 'reopen time shown');
  assert.equal((await W.call('POST', '/api/customer/quote', W.cart(), W.cust)).body.reason, 'paused');
  await W.call('POST', '/api/restaurant/status', { open: true }, W.owner);
});

test('8, 9) open restaurant within hours accepts orders; customers see Open and today\'s hours', async () => {
  const n = istNow(); await setHours(week(hm(n - 60), hm(n + 60)));
  const l = await listed(); assert.equal(l.is_open, 1); assert.equal(l.today_hours.open, hm(n - 60));
  assert.equal((await W.call('POST', '/api/customer/quote', W.cart(), W.cust)).status, 200);
  const o = await W.paidOrder(); assert.equal(o.status, 'PLACED');
});

test('location missing or unconfirmed: not available for ordering, and cannot be switched on', async () => {
  W.db.prepare('UPDATE restaurants SET location_confirmed_at=NULL WHERE id=?').run(W.rest);
  assert.equal((await listed()).closed_reason, 'no_location');
  assert.equal((await W.call('POST', '/api/customer/quote', W.cart(), W.cust)).body.reason, 'no_location');
  assert.equal((await W.call('POST', '/api/restaurant/status', { open: true }, W.owner)).body.code, 'LOCATION_REQUIRED');
  await W.call('PUT', '/api/restaurant/location', { lat: 17.385, lng: 78.4867, source: 'manual' }, W.owner);
  assert.equal((await listed()).is_open, 1);
});

test('11) distance uses the real restaurant and delivery coordinates; no restaurant point = no invented distance', async () => {
  const q = (await W.call('POST', '/api/customer/quote', W.cart(), W.cust)).body;
  const dest = W.db.prepare('SELECT lat, lng FROM delivery_locations WHERE id=?').get(W.loc);
  if (dest.lat != null) {
    const R = Math.PI / 180, h = Math.sin((dest.lat - 17.385) * R / 2) ** 2 + Math.cos(17.385 * R) * Math.cos(dest.lat * R) * Math.sin((dest.lng - 78.4867) * R / 2) ** 2;
    assert.equal(q.trip_km, Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)) / 100) / 10);
  }
  assert.equal(q.trip_by_road, false, 'no routing service in tests, so it is labelled straight line (with routing it is the road distance)');
});

test('12) a paid order is never cancelled when the restaurant closes; it can still be handled', async () => {
  const o = await W.paidOrder();
  await W.call('POST', '/api/restaurant/status', { open: false }, W.owner);
  const n = istNow(); await setHours(week(hm(n + 120), hm(n + 180)));
  W.db.prepare("UPDATE restaurant_operating_status SET reopen_mode='auto', reopen_at=? WHERE restaurant_id=?").run(new Date(Date.now() - 1000).toISOString(), W.rest);
  await W.call('GET', '/api/public/restaurants');      // runs the reopen/close checks
  assert.equal(W.db.prepare('SELECT status FROM orders WHERE id=?').pluck().get(o.id), 'PLACED', 'still placed');
  assert.equal((await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, W.owner)).status, 200, 'restaurant can still accept it');
  assert.notEqual(W.db.prepare('SELECT status FROM orders WHERE id=?').pluck().get(o.id), 'CANCELLED');
});

test('migration: an old single opening/closing time becomes the same hours on all seven days; admin-entered points count as confirmed', async () => {
  const { openDb } = await import('../src/db/index.js'); const { migrations } = await import('../src/db/migrations.js');
  const db = openDb(':memory:'), sql = migrations.find((m) => m.id === 'p10_001_location_and_hours').sql, backfill = sql.slice(sql.indexOf('INSERT INTO restaurant_hours'));
  const a = db.prepare("INSERT INTO restaurants (name, opens_at, closes_at, pickup_lat, pickup_lng, pickup_updated_at) VALUES ('Old', '18:30', '01:00', 17.4, 78.5, '2026-01-01T00:00:00Z')").run().lastInsertRowid;
  const b = db.prepare("INSERT INTO restaurants (name) VALUES ('No hours, no point')").run().lastInsertRowid;
  db.exec(backfill);
  const rows = db.prepare('SELECT dow, closed, open_min, close_min FROM restaurant_hours WHERE restaurant_id=? ORDER BY dow').all(a);
  assert.equal(rows.length, 7); assert.ok(rows.every((r) => r.open_min === 1110 && r.close_min === 60 && !r.closed));
  assert.equal(db.prepare('SELECT COUNT(*) FROM restaurant_hours WHERE restaurant_id=?').pluck().get(b), 0, 'no hours invented');
  const conf = (id) => db.prepare('SELECT location_source, location_confirmed_at FROM restaurants WHERE id=?').get(id);
  assert.deepEqual(conf(a), { location_source: 'admin', location_confirmed_at: '2026-01-01T00:00:00Z' }); assert.deepEqual(conf(b), { location_source: null, location_confirmed_at: null });
  void PW;
});
