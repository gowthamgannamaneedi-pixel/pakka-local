// Distance-based delivery charges.
// ROUTING IS MOCKED in this file: (1) a fake router function returns chosen road distances; (2) a tiny fake OSRM HTTP
// server checks the real OSRM client. No real routing engine or map data is used. Charges are TEST VALUES ONLY.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { testOutbox } from '../src/otpProviders.js';
import { config } from '../src/config.js';
import { setRouter, roadDistance, cacheKey } from '../src/services/routing.js';
import { priceFor, validateBands } from '../src/services/distancePricing.js';
import { FIX } from './helpers/address.js';

const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); setRouter(null); });
const call = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body == null ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { status: r.status, body: j, raw: t }; };
const PW = 'correct-horse-battery', hash = bcrypt.hashSync(PW, 4), now = () => new Date().toISOString();
const mk = (role, phone) => db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run(role, phone, role + phone.slice(-2), hash).lastInsertRowid;
const staff = async (portal, phone) => (await call('POST', '/api/auth/login', { portal, phone, password: PW })).body.token;
const customer = async (phone) => { await call('POST', '/api/auth/customer/otp/request', { phone }); return (await call('POST', '/api/auth/customer/otp/verify', { phone, otp: testOutbox.at(-1).otp })).body.token; };
const S = {};
// ---- mock router: road distance (metres) chosen per destination latitude; restaurant 2 adds 1.5 km; can be told to fail ----
const calls = []; let failMode = null; const DIST = new Map();
setRouter(async (from, to) => { calls.push([from, to]); if (failMode) return { error: failMode };
  const d = DIST.get(to.lat.toFixed(6)); if (d == null) return { error: 'no_route' }; return { distance_m: d + (from.lat === 17.2 ? 1500 : 0), duration_s: d / 5 }; });
const BANDS = [{ from_km: 0, to_km: 1, fee_paise: 1000 }, { from_km: 1, to_km: 2, fee_paise: 1500 }, { from_km: 2, to_km: 3, fee_paise: 2000 }, { from_km: 3, to_km: 4, fee_paise: 2500 }, { from_km: 4, to_km: 5, fee_paise: 3000 }, { from_km: 5, to_km: null, fee_paise: 4000 }];
const cart = (id, o = {}) => ({ restaurant_id: S.r1, items: [{ id: S.i1, qty: 1 }], address_id: id, ...o });
const quote = async (id, o) => (await call('POST', '/api/customer/quote', cart(id, o), S.c));
const addr = async (lat, o = {}) => (await call('POST', '/api/customer/addresses', FIX({ lat, lng: 78.3, room: String(Math.round(lat * 1e4) % 1000), ...o }), S.c)).body.address.id;

test('setup: two restaurants with different pickup points, a listed place, a customer', async () => {
  mk('admin', '+919900000001'); S.admin = await staff('admin', '+919900000001');
  for (const [k, lat] of [['r1', 17.1], ['r2', 17.2]]) { S[k] = db.prepare("INSERT INTO restaurants (name,admin_visible,approved,markup_paise,commission_bps) VALUES (?,1,1,0,1000)").run('Rest ' + k).lastInsertRowid;
    db.prepare('INSERT INTO restaurant_operating_status (restaurant_id,is_open) VALUES (?,1)').run(S[k]);
    S['i' + k.slice(1)] = db.prepare("INSERT INTO food_items (restaurant_id,name,base_price_paise,image_path) VALUES (?,'Meal',10000,'x.png')").run(S[k]).lastInsertRowid;
    assert.equal((await call('PUT', `/api/admin/restaurants/${S[k]}/pickup`, { lat, lng: 78.3 }, S.admin)).status, 200); }
  S.r3 = db.prepare("INSERT INTO restaurants (name,admin_visible,approved,markup_paise,commission_bps) VALUES ('No Pickup',1,1,0,1000)").run().lastInsertRowid;
  db.prepare('INSERT INTO restaurant_operating_status (restaurant_id,is_open) VALUES (?,1)').run(S.r3); S.i3 = db.prepare("INSERT INTO food_items (restaurant_id,name,base_price_paise,image_path) VALUES (?,'Meal',10000,'x.png')").run(S.r3).lastInsertRowid;
  const u = mk('rider', '+919900000021'); db.prepare("INSERT INTO riders (user_id,verification_status,is_online,last_seen_at) VALUES (?,'approved',1,?)").run(u, now()); S.rider = await staff('rider', '+919900000021');
  const ru = mk('restaurant', '+919900000002'); db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(ru, S.r1); S.rest = await staff('restaurant', '+919900000002');
  S.place = (await call('POST', '/api/admin/locations', { name: 'Test PG', address: 'Road 9', delivery_fee_paise: 999, lat: 17.0333, lng: 78.3 }, S.admin)).body.id;
  DIST.set('17.033300', 2400);                 // the listed place is 2.4 km by road from restaurant 1
  S.c = await customer('+919900000031'); S.c2 = await customer('+919900000032');
});

test('pricing setup is validated: no gaps, no overlaps, starts at 0, only the last range open-ended', async () => {
  const bad = [[], [{ from_km: 1, to_km: 2, fee_paise: 100 }], [{ from_km: 0, to_km: 1, fee_paise: 100 }, { from_km: 1.5, to_km: 2, fee_paise: 100 }], [{ from_km: 0, to_km: 2, fee_paise: 100 }, { from_km: 1, to_km: 3, fee_paise: 100 }],
    [{ from_km: 0, to_km: null, fee_paise: 100 }, { from_km: 1, to_km: 2, fee_paise: 100 }], [{ from_km: 0, to_km: 1, fee_paise: -1 }], [{ from_km: 0, to_km: 1, fee_paise: 10.5 }], [{ from_km: 0, to_km: 0, fee_paise: 100 }]];
  for (const b of bad) { assert.ok(validateBands(b).error, JSON.stringify(b)); assert.equal((await call('PUT', '/api/admin/distance-pricing', { bands: b }, S.admin)).status, 400); }
  assert.equal((await call('PUT', '/api/admin/distance-pricing', { enabled: true }, S.admin)).status, 400);                                   // no ranges yet
  assert.equal((await call('PUT', '/api/admin/distance-pricing', { bands: BANDS.slice(0, 5), max_km: 8, enabled: true }, S.admin)).status, 400);   // ranges stop at 5 km, max 8 km
  for (const v of [{ max_km: -1 }, { max_km: 0 }, { fallback_fee_paise: -100 }, { min_fee_paise: 1.5 }]) assert.equal((await call('PUT', '/api/admin/distance-pricing', v, S.admin)).status, 400);
  // the order of ranges sent does not matter
  const ok = await call('PUT', '/api/admin/distance-pricing', { bands: [...BANDS].reverse(), max_km: 8, enabled: true }, S.admin); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.config.bands, BANDS);
});

test('only admins can see or change distance pricing and pickup points', async () => {
  for (const t of [S.c, S.rest, S.rider, null]) {
    assert.ok([401, 403].includes((await call('GET', '/api/admin/distance-pricing', null, t)).status));
    assert.ok([401, 403].includes((await call('PUT', '/api/admin/distance-pricing', { enabled: false }, t)).status));
    assert.ok([401, 403].includes((await call('PUT', `/api/admin/restaurants/${S.r1}/pickup`, { lat: 1, lng: 1 }, t)).status));
    assert.ok([401, 403].includes((await call('POST', '/api/admin/distance-pricing/check', { restaurant_id: S.r1, location_id: S.place }, t)).status)); }
  for (const b of [{ lat: 91, lng: 1 }, { lat: 17, lng: null }, { lat: 0, lng: 0 }]) assert.equal((await call('PUT', `/api/admin/restaurants/${S.r1}/pickup`, b, S.admin)).status, 400);
});

test('each range and its boundaries (exact boundary belongs to the higher range), and the maximum distance', async () => {
  const cases = [[0.25, 1000], [0.999, 1000], [1.0, 1500], [1.999, 1500], [2.0, 2000], [3.0, 2500], [4.5, 3000], [4.999, 3000], [5.0, 4000], [7.2, 4000], [8.0, 4000]];
  for (const [km, fee] of cases) { const lat = 17.0 + km / 100; DIST.set(lat.toFixed(6), km * 1000);
    const id = await addr(lat), q = (await quote(id)).body; assert.equal(q.delivery_paise, fee, `${km} km`); assert.equal(q.delivery_pricing, 'distance'); assert.equal(q.delivery_distance_km, Math.round(km * 100) / 100);
    await call('DELETE', `/api/customer/addresses/${id}`, null, S.c); }                                        // customers may keep up to 10 addresses
  DIST.set('17.080100', 8010); const farId = await addr(17.0801), far = await quote(farId);
  assert.equal(far.status, 409); assert.equal(far.body.code, 'OUT_OF_RANGE'); assert.match(far.body.error, /8\.0 km.*up to 8 km/);
  assert.equal((await call('POST', '/api/customer/orders', cart(farId, { confirm_destination: true }), S.c)).status, 409);       // not silently accepted
  await call('DELETE', `/api/customer/addresses/${farId}`, null, S.c);
});

test('listed places and GPS addresses are both priced by road distance from THIS restaurant when it is on', async () => {
  const listed = (await call('POST', '/api/customer/addresses', { kind: 'listed', label: 'pg', delivery_location_id: S.place, room: '5' }, S.c)).body.address.id;
  const q1 = (await quote(listed)).body; assert.deepEqual([q1.delivery_paise, q1.delivery_distance_km, q1.delivery_pricing], [2000, 2.4, 'distance']);   // not the place's own ₹9.99
  const q2 = (await quote(listed, { restaurant_id: S.r2, items: [{ id: S.i2, qty: 1 }] })).body; assert.deepEqual([q2.delivery_distance_km, q2.delivery_paise], [3.9, 2500]);   // other restaurant, farther away
  S.listed = listed;
  // switching distance pricing off brings back the place's own charge and the fixed GPS charge
  await call('PUT', '/api/admin/distance-pricing', { enabled: false }, S.admin);
  assert.equal((await quote(listed)).body.delivery_paise, 999); assert.equal((await quote(listed)).body.delivery_pricing, 'listed');
  await call('PUT', '/api/admin/distance-pricing', { enabled: true }, S.admin);
});

test('minimum charge applies when set', async () => {
  await call('PUT', '/api/admin/distance-pricing', { min_fee_paise: 1200 }, S.admin);
  DIST.set('17.003000', 300); const mid = await addr(17.003), q = (await quote(mid)).body; assert.equal(q.delivery_paise, 1200); assert.match(q.delivery_band, /minimum ₹12/); await call('DELETE', `/api/customer/addresses/${mid}`, null, S.c);
  await call('PUT', '/api/admin/distance-pricing', { min_fee_paise: null }, S.admin);
});

test('routing failure: fallback charge if configured and clearly recorded; refused if no fallback; no invented distance', async () => {
  const id = await addr(17.0222); DIST.set('17.022200', 2200);
  failMode = 'unreachable';
  const no = await quote(id); assert.equal(no.status, 503); assert.equal(no.body.code, 'DISTANCE_UNAVAILABLE');
  const n0 = db.prepare('SELECT COUNT(*) FROM orders').pluck().get();
  assert.equal((await call('POST', '/api/customer/orders', cart(id, { confirm_destination: true }), S.c)).status, 503); assert.equal(db.prepare('SELECT COUNT(*) FROM orders').pluck().get(), n0);
  await call('PUT', '/api/admin/distance-pricing', { fallback_fee_paise: 3500 }, S.admin);
  const fb = (await quote(id)).body; assert.deepEqual([fb.delivery_paise, fb.delivery_fallback, fb.delivery_distance_km, fb.delivery_pricing], [3500, true, null, 'distance_fallback']);
  const o = await call('POST', '/api/customer/orders', cart(id, { confirm_destination: true }), S.c); assert.equal(o.status, 201);
  const row = db.prepare('SELECT delivery_paise, delivery_pricing, delivery_distance_m, delivery_route_source FROM orders WHERE order_code=?').get(o.body.order_code);
  assert.deepEqual([row.delivery_paise, row.delivery_pricing, row.delivery_distance_m, row.delivery_route_source], [3500, 'distance_fallback', null, 'none:unreachable']);
  failMode = null;
  // a restaurant without a pickup point cannot be measured: fallback, with the reason recorded
  const q3 = (await quote(id, { restaurant_id: S.r3, items: [{ id: S.i3, qty: 1 }] })).body; assert.deepEqual([q3.delivery_paise, q3.delivery_pricing], [3500, 'distance_fallback']);
});

test('cache: identical points are not routed twice; moving the restaurant or the address forces a new lookup', async () => {
  const id = await addr(17.0444); DIST.set('17.044400', 4400); calls.length = 0;
  await quote(id); await quote(id); await call('POST', '/api/customer/quote', cart(id), S.c);
  assert.equal(calls.length, 1, 'second and third quotes use the cache');
  await call('PUT', `/api/admin/restaurants/${S.r1}/pickup`, { lat: 17.1001, lng: 78.3 }, S.admin); await quote(id); assert.equal(calls.length, 2, 'restaurant moved');
  await call('PUT', `/api/customer/addresses/${id}`, { lat: 17.0445, lng: 78.3, accuracy_m: 9, captured_at: now(), confirm: true }, S.c); DIST.set('17.044500', 4450);
  await quote(id); assert.equal(calls.length, 3, 'address moved');
  db.prepare("UPDATE route_cache SET created_at='2000-01-01T00:00:00.000Z'").run(); await quote(id); assert.equal(calls.length, 4, 'expired entries are not used');
  assert.ok(cacheKey('osrm', { lat: 1, lng: 2 }, { lat: 3, lng: 4 }) !== cacheKey('osrm', { lat: 1.000001, lng: 2 }, { lat: 3, lng: 4 }));
  assert.equal((await call('DELETE', '/api/admin/distance-pricing/cache', null, S.c)).status, 403);
  const cl = await call('DELETE', '/api/admin/distance-pricing/cache', null, S.admin); assert.equal(cl.status, 200); assert.ok(cl.body.removed >= 1);
  assert.equal(db.prepare('SELECT COUNT(*) FROM route_cache').pluck().get(), 0); await quote(id); assert.equal(calls.length, 5, 'after clearing, the engine is asked again');
  await call('PUT', `/api/admin/restaurants/${S.r1}/pickup`, { lat: 17.1, lng: 78.3 }, S.admin);
  assert.equal(db.prepare('SELECT COUNT(*) FROM route_cache WHERE distance_m IS NULL').pluck().get(), 0);                  // failures are never cached
});

test('orders keep distance, range and charge; later price changes and tampering do not affect them', async () => {
  const o = await call('POST', '/api/customer/orders', cart(S.listed, { confirm_destination: true, delivery_paise: 0, distance_m: 1, delivery_band: 'free', route: { distance_m: 10 } }), S.c);
  assert.equal(o.status, 201); S.code = o.body.order_code;
  await call('POST', `/api/customer/payments/sandbox/${S.code}/complete`, { outcome: 'success' }, S.c);
  const snap = () => db.prepare('SELECT delivery_paise, total_paise, delivery_pricing, delivery_distance_m, delivery_band, delivery_route_source FROM orders WHERE order_code=?').get(S.code);
  const before = snap(); assert.deepEqual([before.delivery_paise, before.delivery_pricing, before.delivery_distance_m, before.delivery_band], [2000, 'distance', 2400, '2–3 km: ₹20']);
  const nb = BANDS.map((b) => (b.from_km === 2 ? { ...b, fee_paise: 2200 } : b));
  const ch = await call('PUT', '/api/admin/distance-pricing', { bands: nb }, S.admin); assert.equal(ch.status, 200); assert.ok(ch.body.changed.bands);
  assert.deepEqual(snap(), before); assert.equal((await quote(S.listed)).body.delivery_paise, 2200);
  assert.throws(() => db.prepare('UPDATE orders SET delivery_distance_m=1 WHERE order_code=?').run(S.code), /fixed once payment/);
  const audit = db.prepare("SELECT metadata FROM audit_logs WHERE action='distance_pricing.update' ORDER BY id DESC LIMIT 1").pluck().get();
  assert.ok(JSON.parse(audit).changed.bands.from.some((b) => b.fee_paise === 2000) && JSON.parse(audit).changed.bands.to.some((b) => b.fee_paise === 2200));
  // the admin can see the distance and charge of the order
  const ao = (await call('GET', `/api/admin/orders/search/${S.code}`, null, S.admin)).body.order; assert.deepEqual([ao.delivery_distance_m, ao.delivery_band], [2400, '2–3 km: ₹20']);
  assert.ok((await call('GET', '/api/admin/distance-pricing', null, S.admin)).body.recent.some((x) => x.order_code === S.code));
  // another customer still cannot use these addresses; restaurants see no distance or coordinates
  assert.equal((await call('POST', '/api/customer/quote', cart(S.listed), S.c2)).status, 404);
  assert.ok(!/17\.0333|delivery_distance/.test((await call('GET', '/api/restaurant/orders', null, S.rest)).raw));
});

test('admin check tool shows distance and charge for a restaurant and a place', async () => {
  const r = (await call('POST', '/api/admin/distance-pricing/check', { restaurant_id: S.r1, location_id: S.place }, S.admin)).body;
  assert.deepEqual([r.distance_km, r.price.fee_paise, r.price.band], [2.4, 2200, '2–3 km: ₹22']);
});

test('real OSRM client against a FAKE OSRM HTTP server: success, no route, server error, timeout', async () => {
  let mode = 'ok'; const fake = http.createServer((req, res) => {
    if (mode === 'slow') return;                                                                       // never answers
    const m = /\/route\/v1\/driving\/([\d.]+),([\d.]+);([\d.]+),([\d.]+)/.exec(req.url);
    if (mode === 'ok' && m) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 3123.4, duration: 400 }] })); }
    if (mode === 'noroute') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ code: 'NoRoute', message: 'Impossible route' })); }
    res.statusCode = 500; res.end('{}'); }).listen(0);
  const old = { ...config.routing }; config.routing.osrmUrl = `http://127.0.0.1:${fake.address().port}`; config.routing.timeoutMs = 300; setRouter(null);
  try {
    const a = { lat: 17.11, lng: 78.31 }, b = { lat: 17.12, lng: 78.32 };
    assert.deepEqual(await roadDistance(db, a, b), { distance_m: 3123.4, source: 'osrm' });
    assert.deepEqual(await roadDistance(db, a, b), { distance_m: 3123.4, source: 'cache' });
    mode = 'noroute'; assert.equal((await roadDistance(db, a, { lat: 17.13, lng: 78.3 })).reason, 'no_route');
    mode = 'err'; assert.equal((await roadDistance(db, a, { lat: 17.14, lng: 78.3 })).reason, 'router_error_500');
    mode = 'slow'; assert.equal((await roadDistance(db, a, { lat: 17.15, lng: 78.3 })).reason, 'timeout');
    assert.equal((await roadDistance(db, null, b)).reason, 'restaurant_has_no_pickup_point');
    config.routing.osrmUrl = ''; assert.equal((await roadDistance(db, a, { lat: 17.16, lng: 78.3 })).reason, 'routing_not_configured');
  } finally { Object.assign(config.routing, old); fake.closeAllConnections?.(); fake.close(); }
});

test('pure pricing function: fallback without a configured fallback refuses, never guesses', () => {
  const cfg = { bands: BANDS, max_km: null, min_fee_paise: null, fallback_fee_paise: null };
  assert.equal(priceFor(cfg, { distance_m: null, reason: 'timeout' }).code, 'DISTANCE_UNAVAILABLE');
  assert.equal(priceFor(cfg, { distance_m: 99_000 }).fee, 4000);                                              // open-ended last range, no maximum
  assert.equal(priceFor({ ...cfg, bands: BANDS.slice(0, 5) }, { distance_m: 6000 }).code, 'OUT_OF_RANGE');     // beyond the last closed range
});
