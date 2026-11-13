// GPS-first delivery addresses, order destination snapshot, rider navigation link and access control.
// SIMULATED GPS: coordinates, accuracy and capture time are typed into the requests; no device GPS is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { testOutbox } from '../src/otpProviders.js';
import { derivedOtp } from '../src/services/core.js';
import { FIX } from './helpers/address.js';

const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const call = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body == null ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { status: r.status, body: j, raw: t, headers: r.headers }; };
const PW = 'correct-horse-battery', hash = bcrypt.hashSync(PW, 4), now = () => new Date().toISOString();
const mk = (role, phone) => db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run(role, phone, role + phone.slice(-2), hash).lastInsertRowid;
const staff = async (portal, phone) => (await call('POST', '/api/auth/login', { portal, phone, password: PW })).body.token;
const customer = async (phone) => { await call('POST', '/api/auth/customer/otp/request', { phone }); return (await call('POST', '/api/auth/customer/otp/verify', { phone, otp: testOutbox.at(-1).otp })).body.token; };
const S = {};

test('setup: restaurant, delivery area, two approved online riders, two customers', async () => {
  mk('admin', '+919700000001'); S.admin = await staff('admin', '+919700000001');
  S.rid = db.prepare("INSERT INTO restaurants (name,admin_visible,approved,markup_paise,commission_bps) VALUES ('R',1,1,0,1000)").run().lastInsertRowid;
  db.prepare('INSERT INTO restaurant_operating_status (restaurant_id,is_open) VALUES (?,1)').run(S.rid);
  const ru = mk('restaurant', '+919700000002'); db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(ru, S.rid); S.rest = await staff('restaurant', '+919700000002');
  S.item = db.prepare("INSERT INTO food_items (restaurant_id,name,base_price_paise,image_path) VALUES (?,'Meal',10000,'x.png')").run(S.rid).lastInsertRowid;
  S.area = db.prepare("INSERT INTO delivery_locations (name,address,delivery_fee_paise,lat,lng) VALUES ('Area One','Road 1',2500,17.1,78.1)").run().lastInsertRowid;
  for (const i of [1, 2]) { const u = mk('rider', `+91970000002${i}`); db.prepare("INSERT INTO riders (user_id,verification_status,is_online,last_seen_at) VALUES (?,'approved',1,?)").run(u, now()); S['rd' + i] = await staff('rider', `+91970000002${i}`); S['rdId' + i] = u; }
  S.a = await customer('+919700000031'); S.b = await customer('+919700000032');
});

test('save address: needs confirmed, fresh, valid GPS and enough written detail', async () => {
  const bad = [
    { lat: 91 }, { lat: -91 }, { lng: 181 }, { lng: -180.5 }, { lat: '17.4' }, { lat: null }, { lng: undefined }, { lat: 0, lng: 0 },
    { accuracy_m: undefined }, { accuracy_m: -5 }, { captured_at: undefined }, { captured_at: 'yesterday-ish' },
    { captured_at: new Date(Date.now() - 11 * 60_000).toISOString() },        // older than the 10-minute default
    { captured_at: new Date(Date.now() + 10 * 60_000).toISOString() },        // phone clock in the future
    { confirm: false }, { confirm: undefined }, { label: 'mansion' },
    { place_name: '', building: '' }, { room: '', entrance: '', landmark: '' }, { unknown_field: 1 }
  ];
  for (const o of bad) { const body = FIX(o); for (const k of Object.keys(o)) if (o[k] === undefined) delete body[k];
    assert.equal((await call('POST', '/api/customer/addresses', body, S.a)).status, 400, JSON.stringify(o)); }
  assert.equal(db.prepare('SELECT COUNT(*) FROM customer_addresses').pluck().get(), 0);
  const ok = await call('POST', '/api/customer/addresses', FIX({ place_name: 'Sri Sai PG <b>', floor: '2', entrance: 'Back gate', landmark: 'Opp. temple', instructions: 'Call at gate' }), S.a);
  assert.equal(ok.status, 201); S.addrA = ok.body.address.id;
  assert.equal(ok.body.address.place_name, 'Sri Sai PG b'); assert.equal(ok.body.address.is_default, true);   // markup stripped; first address is default
  assert.equal(ok.body.address.lat, 17.4401); assert.equal(ok.body.address.accuracy_m, 12);
  assert.match(ok.headers.get('cache-control') || '', /no-store/);
});

test('accuracy policy: off by default; when the admin sets a limit, a worse reading needs an explicit "use anyway"', async () => {
  assert.equal((await call('POST', '/api/customer/addresses', FIX({ accuracy_m: 400, room: '7' }), S.b)).status, 201);        // no limit configured
  for (const v of ['4', '6000', 'abc']) assert.equal((await call('PUT', '/api/admin/settings', { settings: { gps_accuracy_warn_m: v } }, S.admin)).status, 400, v);
  assert.equal((await call('PUT', '/api/admin/settings', { settings: { gps_accuracy_warn_m: '50' } }, S.admin)).status, 200);
  const r = await call('POST', '/api/customer/addresses', FIX({ accuracy_m: 120 }), S.b); assert.equal(r.status, 400); assert.equal(r.body.code, 'ACCURACY_CONFIRM'); assert.match(r.body.error, /120 m/);
  assert.equal((await call('POST', '/api/customer/addresses', FIX({ accuracy_m: 120, accuracy_acknowledged: true }), S.b)).status, 201);
  assert.equal((await call('POST', '/api/customer/addresses', FIX({ accuracy_m: 30 }), S.b)).status, 201);
  assert.equal((await call('GET', '/api/customer/addresses', null, S.b)).body.policy.warn_m, 50);
  assert.equal((await call('PUT', '/api/admin/settings', { settings: { gps_accuracy_warn_m: '' } }, S.admin)).status, 200);
});

test('multiple addresses, edit, default, deactivate; another customer can never see or touch them', async () => {
  const two = await call('POST', '/api/customer/addresses', FIX({ label: 'college', place_name: 'Test College', building: 'Library', room: '', landmark: 'Main gate', lat: 17.45, lng: 78.36, make_default: true }), S.a);
  assert.equal(two.status, 201); S.addrA2 = two.body.address.id;
  let l = (await call('GET', '/api/customer/addresses', null, S.a)).body.addresses; assert.equal(l.length, 2); assert.equal(l[0].id, S.addrA2); assert.equal(l.filter((x) => x.is_default).length, 1);
  assert.equal((await call('PUT', `/api/customer/addresses/${S.addrA}`, { room: '204' }, S.a)).body.address.room, '204');
  assert.equal((await call('PUT', `/api/customer/addresses/${S.addrA}`, { lat: 17.5, lng: 78.4, accuracy_m: 8, captured_at: now() }, S.a)).status, 400);   // new GPS needs a confirmation
  assert.equal((await call('PUT', `/api/customer/addresses/${S.addrA}`, { lat: 17.5 }, S.a)).status, 400);                                             // partial GPS refused
  // customer B: no read, edit, delete or ordering with A's address
  assert.ok(!(await call('GET', '/api/customer/addresses', null, S.b)).body.addresses.some((x) => x.id === S.addrA));
  assert.equal((await call('PUT', `/api/customer/addresses/${S.addrA}`, { room: '999' }, S.b)).status, 404);
  assert.equal((await call('DELETE', `/api/customer/addresses/${S.addrA}`, null, S.b)).status, 404);
  assert.equal((await call('POST', '/api/customer/quote', { restaurant_id: S.rid, items: [{ id: S.item, qty: 1 }], address_id: S.addrA }, S.b)).status, 404);
  for (const t of [S.rest, S.rd1, S.admin, null]) assert.ok([401, 403].includes((await call('GET', '/api/customer/addresses', null, t)).status));
  // deactivate: hidden and unusable, row kept
  assert.equal((await call('DELETE', `/api/customer/addresses/${S.addrA2}`, null, S.a)).status, 200);
  l = (await call('GET', '/api/customer/addresses', null, S.a)).body.addresses; assert.deepEqual(l.map((x) => x.id), [S.addrA]); assert.equal(l[0].is_default, true);
  assert.equal(db.prepare('SELECT active FROM customer_addresses WHERE id=?').pluck().get(S.addrA2), 0);
  assert.equal((await call('POST', '/api/customer/quote', { restaurant_id: S.rid, items: [{ id: S.item, qty: 1 }], address_id: S.addrA2 }, S.a)).status, 404);
});

test('orders need a saved address and a confirmation; fees: GPS address = fixed GPS charge, listed place = its own charge', async () => {
  const cart = (o = {}) => ({ restaurant_id: S.rid, items: [{ id: S.item, qty: 1 }], ...o });
  assert.equal((await call('POST', '/api/customer/orders', cart(), S.a)).status, 400);                                      // no address
  assert.equal((await call('POST', '/api/customer/orders', cart({ lat: 17.4, lng: 78.5 }), S.a)).status, 400);              // raw coordinates no longer accepted
  assert.equal((await call('POST', '/api/customer/orders', cart({ location_id: S.area }), S.a)).status, 400);               // an area alone has no customer GPS
  const nc = await call('POST', '/api/customer/orders', cart({ address_id: S.addrA }), S.a); assert.equal(nc.status, 400); assert.equal(nc.body.code, 'CONFIRM_DESTINATION');
  assert.equal((await call('POST', '/api/customer/quote', cart({ address_id: S.addrA }), S.a)).body.delivery_paise, 4000);   // gps_delivery_fee_paise default
  assert.equal((await call('POST', '/api/customer/addresses', FIX({ delivery_location_id: S.area, room: '12' }), S.a)).body.code, 'USE_LIST');   // a GPS address cannot borrow a listed place's charge
  const linked = (await call('POST', '/api/customer/addresses', FIX({ kind: 'listed', delivery_location_id: S.area, room: '12' }), S.a)).body.address.id;
  assert.equal((await call('POST', '/api/customer/quote', cart({ address_id: linked }), S.a)).body.delivery_paise, 2500);     // the area's own fee
  assert.equal((await call('POST', '/api/customer/addresses', FIX({ delivery_location_id: 99999 }), S.a)).status, 400);
});

test('order keeps an immutable destination snapshot: editing or removing the saved address never moves it', async () => {
  await call('PUT', `/api/customer/addresses/${S.addrA}`, { entrance: 'Back gate', landmark: 'Opp. temple', floor: '2' }, S.a);
  const o = await call('POST', '/api/customer/orders', { restaurant_id: S.rid, items: [{ id: S.item, qty: 1 }], address_id: S.addrA, confirm_destination: true, instructions: 'Ring twice' }, S.a);
  assert.equal(o.status, 201); S.code = o.body.order_code; S.oid = db.prepare('SELECT id FROM orders WHERE order_code=?').pluck().get(S.code);
  assert.equal((await call('POST', `/api/customer/payments/sandbox/${S.code}/complete`, { outcome: 'success' }, S.a)).status, 200);
  const snap = () => db.prepare('SELECT dest_lat,dest_lng,dest_room,dest_floor,dest_entrance,dest_landmark,dest_place_name,dest_accuracy_m,dest_captured_at,dest_confirmed_at,instructions,dest_address_id FROM orders WHERE id=?').get(S.oid);
  const before = snap();
  assert.deepEqual([before.dest_lat, before.dest_lng, before.dest_room, before.dest_floor, before.dest_entrance], [17.4401, 78.3489, '204', '2', 'Back gate']);
  assert.ok(before.dest_confirmed_at && before.dest_captured_at); assert.match(before.instructions, /Call at gate · Ring twice/);
  // the customer moves: new GPS + room on the saved address
  assert.equal((await call('PUT', `/api/customer/addresses/${S.addrA}`, { lat: 17.6, lng: 78.6, accuracy_m: 9, captured_at: now(), confirm: true, room: '999' }, S.a)).status, 200);
  assert.equal((await call('DELETE', `/api/customer/addresses/${S.addrA}`, null, S.a)).status, 200);
  assert.deepEqual(snap(), before);
  assert.throws(() => db.prepare('UPDATE orders SET dest_lat=1 WHERE id=?').run(S.oid), /fixed once payment/);           // database refuses direct changes too
  assert.throws(() => db.prepare("UPDATE orders SET dest_room='x' WHERE id=?").run(S.oid), /fixed once payment/);
  const mine = (await call('GET', `/api/customer/orders/${S.code}`, null, S.a)).body; assert.equal(mine.destination.room, '204'); assert.equal(mine.destination.lat, 17.4401);
  assert.equal((await call('GET', `/api/customer/orders/${S.code}`, null, S.b)).status, 404);
});

test('rider: only the assigned rider gets the coordinates, written details and a correct Google Maps link', async () => {
  // before acceptance: open offer has no coordinates, no link, no room/phone
  const offer = (await call('GET', '/api/rider/offers', null, S.rd1)).body.offers.find((x) => x.id === S.oid);
  assert.equal(offer, undefined);                                                                                              // still PLACED: not offered yet
  assert.equal((await call('POST', `/api/restaurant/orders/${S.oid}/accept`, {}, S.rest)).status, 200);
  const o1 = (await call('GET', '/api/rider/offers', null, S.rd1)).body.offers.find((x) => x.id === S.oid);
  for (const k of ['17.4401', '78.3489', '204', 'Back gate', '9700000031', 'google.com/maps/dir']) assert.ok(!JSON.stringify(o1).includes(k), k);
  assert.equal(o1.destination.nav_url, undefined); assert.equal(o1.destination.lat, null);
  assert.equal((await call('POST', `/api/rider/orders/${S.oid}/accept`, {}, S.rd1)).status, 200);
  const d = (await call('GET', '/api/rider/active', null, S.rd1)).body.active.find((x) => x.id === S.oid).destination;
  assert.deepEqual([d.lat, d.lng, d.room, d.floor, d.entrance, d.landmark, d.place_name], [17.4401, 78.3489, '204', '2', 'Back gate', 'Opp. temple', 'Sri Sai PG b']);
  const u = new URL(d.nav_url);
  assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/dir/');
  assert.deepEqual([u.searchParams.get('api'), u.searchParams.get('destination'), u.searchParams.get('travelmode'), u.searchParams.get('dir_action')], ['1', '17.4401,78.3489', 'two-wheeler', 'navigate']);
  assert.ok(!/key=/.test(d.nav_url));                                                                                         // no API key
  // rider 2 cannot read rider 1's order in any way
  assert.equal((await call('GET', `/api/rider/orders/${S.oid}`, null, S.rd2)).status, 404);
  for (const p of ['/api/rider/offers', '/api/rider/active']) assert.ok(!(await call('GET', p, null, S.rd2)).raw.includes('17.4401'));
  assert.equal((await call('GET', `/api/tracking/orders/${S.code}`, null, S.rd2)).status, 403);
  // delivery still finishes with the normal OTP
  await call('POST', `/api/restaurant/orders/${S.oid}/ready`, {}, S.rest);
  assert.equal((await call('POST', `/api/rider/orders/${S.oid}/pickup`, { otp: derivedOtp('pickup', S.code) }, S.rd1)).status, 200);
  const otp = (await call('GET', `/api/customer/orders/${S.code}`, null, S.a)).body.delivery_otp;
  assert.equal((await call('POST', `/api/rider/orders/${S.oid}/deliver`, { otp: '0000' === otp ? '1111' : '0000' }, S.rd1)).status, 400);
  assert.equal((await call('POST', `/api/rider/orders/${S.oid}/deliver`, { otp }, S.rd1)).status, 200);
});

test('restaurants, public endpoints and notifications never carry the customer GPS point or room', async () => {
  const leaks = (s) => ['17.4401', '78.3489', 'Room 204', '"204"', 'Back gate'].filter((k) => s.includes(k));
  assert.deepEqual(leaks((await call('GET', '/api/restaurant/orders', null, S.rest)).raw), []);
  assert.deepEqual(leaks((await call('GET', `/api/restaurant/orders/by-code/${S.code}`, null, S.rest)).raw), []);
  for (const p of ['/api/public/restaurants', `/api/public/restaurants/${S.rid}/menu`, '/api/public/locations', '/api/public/config']) assert.deepEqual(leaks((await call('GET', p)).raw), [], p);
  assert.deepEqual(leaks(JSON.stringify(db.prepare('SELECT title, body, deep_link FROM notifications').all())), []);
  assert.deepEqual(leaks(JSON.stringify(db.prepare('SELECT * FROM audit_logs').all())), []);
  assert.deepEqual(leaks(JSON.stringify(db.prepare('SELECT * FROM order_events').all())), []);
});

test('customer destination and rider live position are separate records', async () => {
  const before = db.prepare('SELECT dest_lat, dest_lng FROM orders WHERE id=?').get(S.oid);
  db.prepare("UPDATE riders SET verification_status='approved' WHERE user_id=?").run(S.rdId1);
  assert.equal(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('rider_locations','customer_addresses','reference_places')").pluck().get(), 3);
  assert.deepEqual(db.prepare('SELECT dest_lat, dest_lng FROM orders WHERE id=?').get(S.oid), before);
  assert.equal(db.prepare('SELECT COUNT(*) FROM reference_places').pluck().get(), 0);                         // directory prepared, nothing invented
});
