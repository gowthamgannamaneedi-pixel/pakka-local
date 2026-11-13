// Listed PG/hostel/college places with their own delivery charges + fixed charge for unlisted GPS addresses.
// Example charges below (₹20/₹25/₹15/₹35) are TEST VALUES ONLY, not approved prices. GPS readings are simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { testOutbox } from '../src/otpProviders.js';
import { FIX } from './helpers/address.js';

const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const call = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body == null ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { status: r.status, body: j, raw: t }; };
const PW = 'correct-horse-battery', hash = bcrypt.hashSync(PW, 4), now = () => new Date().toISOString();
const mk = (role, phone) => db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run(role, phone, role + phone.slice(-2), hash).lastInsertRowid;
const staff = async (portal, phone) => (await call('POST', '/api/auth/login', { portal, phone, password: PW })).body.token;
const customer = async (phone) => { await call('POST', '/api/auth/customer/otp/request', { phone }); return (await call('POST', '/api/auth/customer/otp/verify', { phone, otp: testOutbox.at(-1).otp })).body.token; };
const S = {};
const cart = (address_id, o = {}) => ({ restaurant_id: S.rid, items: [{ id: S.item, qty: 1 }], address_id, ...o });
const LOC = (o = {}) => ({ name: 'PG A', kind: "Men's PG", address: 'Road 1, Moinabad', area: 'Moinabad', delivery_fee_paise: 2000, lat: 17.3395, lng: 78.3082, ...o });

test('setup', async () => {
  mk('admin', '+919800000001'); S.admin = await staff('admin', '+919800000001');
  S.rid = db.prepare("INSERT INTO restaurants (name,admin_visible,approved,markup_paise,commission_bps) VALUES ('R',1,1,0,1000)").run().lastInsertRowid;
  db.prepare('INSERT INTO restaurant_operating_status (restaurant_id,is_open) VALUES (?,1)').run(S.rid);
  const ru = mk('restaurant', '+919800000002'); db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(ru, S.rid); S.rest = await staff('restaurant', '+919800000002');
  S.item = db.prepare("INSERT INTO food_items (restaurant_id,name,base_price_paise,image_path) VALUES (?,'Meal',10000,'x.png')").run(S.rid).lastInsertRowid;
  const u = mk('rider', '+919800000021'); db.prepare("INSERT INTO riders (user_id,verification_status,is_online,last_seen_at) VALUES (?,'approved',1,?)").run(u, now()); S.rider = await staff('rider', '+919800000021');
  S.a = await customer('+919800000031'); S.b = await customer('+919800000032');
});

test('admin manages places: validation, duplicates, independent charges, search, activate/deactivate', async () => {
  for (const bad of [LOC({ delivery_fee_paise: -100 }), LOC({ delivery_fee_paise: 100001 }), LOC({ delivery_fee_paise: 12.5 }), LOC({ delivery_fee_paise: '2000' }), LOC({ name: '' }), LOC({ lat: 91 }), LOC({ lng: null }),
    LOC({ lat: 0, lng: 0 }), LOC({ maps_link: 'http://maps.example' }), LOC({ hacked: 1 })]) assert.equal((await call('POST', '/api/admin/locations', bad, S.admin)).status, 400, JSON.stringify(bad));
  S.pgA = (await call('POST', '/api/admin/locations', LOC(), S.admin)).body.id;
  S.pgB = (await call('POST', '/api/admin/locations', LOC({ name: 'PG B', delivery_fee_paise: 2500, lat: 17.3435, lng: 78.3238 }), S.admin)).body.id;
  S.colC = (await call('POST', '/api/admin/locations', LOC({ name: 'College C', kind: 'College', delivery_fee_paise: 1500, lat: null, lng: null }), S.admin)).body.id;   // no map point yet
  S.free = (await call('POST', '/api/admin/locations', LOC({ name: 'Free Hostel', delivery_fee_paise: 0, lat: 17.33, lng: 78.30 }), S.admin)).body.id;               // ₹0 is allowed
  assert.ok(S.pgA && S.pgB && S.colC && S.free);
  for (const dup of ['pg a', ' PG  A ', 'P.G. A'.replace(/\./g, '')]) assert.equal((await call('POST', '/api/admin/locations', LOC({ name: dup }), S.admin)).status, 409, dup);
  assert.equal((await call('PUT', `/api/admin/locations/${S.pgB}`, { name: 'pg A' }, S.admin)).status, 409);        // rename into a duplicate
  const l = (await call('GET', '/api/admin/locations?q=moinabad', null, S.admin)).body; assert.equal(l.locations.length, 4); assert.equal(l.gps_fee_paise, 4000);
  assert.equal((await call('GET', '/api/admin/locations?q=college', null, S.admin)).body.locations[0].id, S.colC);
  const fees = Object.fromEntries((await call('GET', '/api/admin/locations', null, S.admin)).body.locations.map((x) => [x.name, x.delivery_fee_paise]));
  assert.deepEqual([fees['PG A'], fees['PG B'], fees['College C']], [2000, 2500, 1500]);
  S.off = (await call('POST', '/api/admin/locations', LOC({ name: 'Closed PG', active: false }), S.admin)).body.id;
  assert.equal((await call('GET', '/api/admin/locations?status=inactive', null, S.admin)).body.locations.length, 1);
});

test('only admins can manage places or charges', async () => {
  for (const t of [S.a, S.rest, S.rider, null]) {
    assert.ok([401, 403].includes((await call('GET', '/api/admin/locations', null, t)).status));
    assert.ok([401, 403].includes((await call('POST', '/api/admin/locations', LOC({ name: 'Sneaky' }), t)).status));
    assert.ok([401, 403].includes((await call('PUT', `/api/admin/locations/${S.pgA}`, { delivery_fee_paise: 0 }, t)).status));
    assert.ok([401, 403].includes((await call('PUT', '/api/admin/settings', { settings: { gps_delivery_fee_paise: '0' } }, t)).status));
    assert.ok([401, 403].includes((await call('POST', '/api/admin/locations/import', { csv: 'x'.repeat(20), fee_column: 'Fee' }, t)).status));
  }
  assert.equal(db.prepare('SELECT delivery_fee_paise FROM delivery_locations WHERE id=?').pluck().get(S.pgA), 2000);
});

test('customers see only active places, without map points', async () => {
  const pub = (await call('GET', '/api/public/locations')).body.locations;
  assert.ok(pub.some((x) => x.id === S.pgA) && !pub.some((x) => x.id === S.off));
  assert.equal(pub.find((x) => x.id === S.pgA).delivery_fee_paise, 2000);
  assert.ok(!/17\.3395|78\.3082/.test(JSON.stringify(pub)));
});

test('Option A (from the list): each place has its own charge; Option B (GPS, unlisted): the fixed GPS charge', async () => {
  assert.equal((await call('PUT', '/api/admin/settings', { settings: { gps_delivery_fee_paise: '3500' } }, S.admin)).status, 200);
  const add = async (body, t = S.a) => { const r = await call('POST', '/api/customer/addresses', body, t); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.address; };
  // listed: no GPS needed when the place has a map point; room/floor/block details are kept; the list name is used
  const A = await add({ kind: 'listed', label: 'pg', delivery_location_id: S.pgA, place_name: 'Typed Name Ignored', block: 'C', floor: '2', room: '204', instructions: 'Call at gate' });
  assert.equal(A.kind, 'listed'); assert.equal(A.place_name, 'PG A'); assert.equal(A.lat, null); S.addrA = A.id;
  S.addrB = (await add({ kind: 'listed', label: 'pg', delivery_location_id: S.pgB, room: '11' })).id;
  S.addrFree = (await add({ kind: 'listed', label: 'hostel', delivery_location_id: S.free, room: '3' })).id;
  // College C has no map point: the listed address needs the customer's GPS before ordering
  const C = await add({ kind: 'listed', label: 'college', delivery_location_id: S.colC, landmark: 'Library' }); S.addrC = C.id;
  S.gps = (await add(FIX({ place_name: 'Unlisted PG', room: '9' }))).id;
  const q = async (id) => (await call('POST', '/api/customer/quote', cart(id), S.a)).body;
  const qa = await q(S.addrA); assert.deepEqual([qa.delivery_paise, qa.delivery_type, qa.delivery_location], [2000, 'listed', 'PG A']);
  assert.equal((await q(S.addrB)).delivery_paise, 2500);
  assert.equal((await q(S.addrFree)).delivery_paise, 0);
  const qg = await q(S.gps); assert.deepEqual([qg.delivery_paise, qg.delivery_type, qg.delivery_location], [3500, 'gps', null]);
  const nc = await call('POST', '/api/customer/quote', cart(S.addrC), S.a); assert.equal(nc.status, 400); assert.equal(nc.body.code, 'NO_MAP_POINT');
  assert.equal((await call('PUT', `/api/customer/addresses/${S.addrC}`, { lat: 17.336, lng: 78.301, accuracy_m: 11, captured_at: now(), confirm: true }, S.a)).status, 200);
  assert.equal((await q(S.addrC)).delivery_paise, 1500);                                         // College C's charge, with the customer's own GPS point
  // a listed address can only point at an active place
  assert.equal((await call('POST', '/api/customer/addresses', { kind: 'listed', label: 'pg', delivery_location_id: S.off, room: '1' }, S.a)).status, 400);
  assert.equal((await call('POST', '/api/customer/addresses', { kind: 'listed', label: 'pg', delivery_location_id: 999999, room: '1' }, S.a)).status, 400);
  assert.equal((await call('POST', '/api/customer/addresses', { kind: 'listed', label: 'pg', delivery_location_id: S.pgA }, S.a)).status, 400);   // needs room/gate/landmark
});

test('charge tampering is impossible: browser-sent charges, ids and kinds are ignored or refused', async () => {
  const o = await call('POST', '/api/customer/orders', cart(S.gps, { confirm_destination: true, delivery_paise: 0, total_paise: 1, delivery_location_id: S.free, delivery_fee_paise: 0 }), S.a);
  assert.equal(o.status, 201); const row = db.prepare('SELECT delivery_paise, total_paise, delivery_location_id, dest_kind FROM orders WHERE order_code=?').get(o.body.order_code);
  assert.deepEqual([row.delivery_paise, row.total_paise, row.delivery_location_id, row.dest_kind], [3500, 13500, null, 'gps']);
  // a GPS address cannot be turned into (or linked to) a cheaper listed place, and kinds cannot be switched
  assert.equal((await call('PUT', `/api/customer/addresses/${S.gps}`, { delivery_location_id: S.free }, S.a)).body.code, 'USE_LIST');
  assert.equal((await call('PUT', `/api/customer/addresses/${S.gps}`, { kind: 'listed', delivery_location_id: S.free }, S.a)).status, 400);
  assert.equal((await call('PUT', `/api/customer/addresses/${S.addrA}`, { kind: 'gps' }, S.a)).status, 400);
  assert.equal((await call('POST', '/api/customer/addresses', FIX({ kind: 'gps', delivery_location_id: S.free }), S.a)).body.code, 'USE_LIST');
  // another customer cannot use these addresses at all
  assert.equal((await call('POST', '/api/customer/quote', cart(S.addrFree), S.b)).status, 404);
  assert.equal((await call('POST', '/api/customer/orders', cart(S.addrFree, { confirm_destination: true }), S.b)).status, 404);
  // a listed address may move to another active place (e.g. the student changed PG); the new place's charge applies
  assert.equal((await call('PUT', `/api/customer/addresses/${S.addrB}`, { delivery_location_id: S.pgA }, S.a)).status, 200);
  assert.equal((await call('POST', '/api/customer/quote', cart(S.addrB), S.a)).body.delivery_paise, 2000);
  assert.equal((await call('PUT', `/api/customer/addresses/${S.addrB}`, { delivery_location_id: S.pgB }, S.a)).status, 200);
});

test('price changes affect future orders only; past orders keep their charge and place', async () => {
  const place = async (id) => { const o = await call('POST', '/api/customer/orders', cart(id, { confirm_destination: true }), S.a); assert.equal(o.status, 201);
    await call('POST', `/api/customer/payments/sandbox/${o.body.order_code}/complete`, { outcome: 'success' }, S.a); return o.body.order_code; };
  S.oA = await place(S.addrA); S.oG = await place(S.gps);
  const snap = (c) => db.prepare('SELECT delivery_paise, total_paise, delivery_location_id, dest_kind, dest_location_name, dest_coord_source, dest_lat, dest_lng FROM orders WHERE order_code=?').get(c);
  const beforeA = snap(S.oA), beforeG = snap(S.oG);
  assert.deepEqual([beforeA.delivery_paise, beforeA.dest_kind, beforeA.dest_location_name, beforeA.dest_coord_source, beforeA.dest_lat], [2000, 'listed', 'PG A', 'location', 17.3395]);
  assert.deepEqual([beforeG.delivery_paise, beforeG.dest_kind, beforeG.dest_coord_source], [3500, 'gps', 'customer_gps']);
  // admin raises PG A to ₹30, renames it, and raises the GPS charge to ₹40
  const ch = await call('PUT', `/api/admin/locations/${S.pgA}`, { delivery_fee_paise: 3000, name: 'PG A (New Block)' }, S.admin);
  assert.deepEqual(ch.body.changed.delivery_fee_paise, { from: 2000, to: 3000 });
  assert.equal((await call('PUT', '/api/admin/settings', { settings: { gps_delivery_fee_paise: '4000' } }, S.admin)).body.changed.gps_delivery_fee_paise.to, '4000');
  assert.deepEqual(snap(S.oA), beforeA); assert.deepEqual(snap(S.oG), beforeG);
  assert.equal((await call('POST', '/api/customer/quote', cart(S.addrA), S.a)).body.delivery_paise, 3000);
  assert.equal((await call('POST', '/api/customer/quote', cart(S.gps), S.a)).body.delivery_paise, 4000);
  assert.throws(() => db.prepare('UPDATE orders SET delivery_paise=0 WHERE order_code=?').run(S.oA), /fixed once payment/);
  assert.equal((await call('GET', `/api/customer/orders/${S.oA}`, null, S.a)).body.destination.location_name, 'PG A');
});

test('fee changes are audited with admin, time and old/new values', () => {
  const rows = db.prepare("SELECT a.action, a.metadata, a.created_at, u.role FROM audit_logs a JOIN users u ON u.id=a.actor_user_id WHERE a.action IN ('location.fee_change','settings.gps_fee_change') ORDER BY a.id").all();
  const fee = rows.find((r) => r.action === 'location.fee_change' && JSON.parse(r.metadata).changed.delivery_fee_paise?.to === 3000);
  assert.ok(fee && fee.role === 'admin' && fee.created_at); assert.deepEqual(JSON.parse(fee.metadata).changed.name, { from: 'PG A', to: 'PG A (New Block)' });
  const g = rows.filter((r) => r.action === 'settings.gps_fee_change').map((r) => JSON.parse(r.metadata).changed.gps_delivery_fee_paise);
  assert.deepEqual(g, [{ from: '4000', to: '3500' }, { from: '3500', to: '4000' }]);
  assert.equal((call && db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action='location.create'").pluck().get()), 5);
});

test('deactivating a place keeps history and stops new orders to it, with a clear message', async () => {
  assert.equal((await call('PUT', `/api/admin/locations/${S.pgB}`, { active: false }, S.admin)).status, 200);
  const r = await call('POST', '/api/customer/quote', cart(S.addrB), S.a); assert.equal(r.status, 409); assert.equal(r.body.code, 'LOCATION_UNAVAILABLE');
  assert.ok(!(await call('GET', '/api/public/locations')).body.locations.some((x) => x.id === S.pgB));
  assert.ok((await call('GET', '/api/customer/addresses', null, S.a)).body.addresses.some((x) => x.id === S.addrB));      // the saved address stays (customer can edit it)
  assert.equal((await call('PUT', `/api/admin/locations/${S.pgB}`, { active: true }, S.admin)).status, 200);
});

test('rider sees the listed place name and a navigation link to the right point; restaurant sees neither', async () => {
  const oid = db.prepare('SELECT id FROM orders WHERE order_code=?').pluck().get(S.oA);
  assert.equal((await call('POST', `/api/restaurant/orders/${oid}/accept`, {}, S.rest)).status, 200);
  const offer = (await call('GET', '/api/rider/offers', null, S.rider)).body.offers.find((x) => x.id === oid);
  assert.match(offer.destination.text, /PG A/); assert.equal(offer.destination.lat, null);
  assert.equal((await call('POST', `/api/rider/orders/${oid}/accept`, {}, S.rider)).status, 200);
  const d = (await call('GET', '/api/rider/active', null, S.rider)).body.active.find((x) => x.id === oid).destination;
  assert.deepEqual([d.kind, d.location_name, d.coord_source, d.room, d.block], ['listed', 'PG A', 'location', '204', 'C']);
  assert.equal(new URL(d.nav_url).searchParams.get('destination'), '17.3395,78.3082');
  assert.ok(!/17\.3395|204|PG A/.test((await call('GET', '/api/restaurant/orders', null, S.rest)).raw.replace(/"name":"Meal"/g, '')));
});

test('CSV import of the owner sheet: preview first, then create; re-import updates by reference, never duplicates', async () => {
  const csv = ['Location_ID,Place_Name,Category,Area_Locality,Full_Address,Latitude,Longitude,Straight_Dist_km,Fee_Straight_10_INR,Est_Road_Dist_km,Fee_Road_10_INR,Google_Maps_Link',
    'LOC_001,Sample Boys Hostel,Men\'s PG,Himayatnagar,"Vijay Plaza, Cross Road",17.3395,78.3082,1.37,₹14,1.71,₹17,https://www.google.com/maps/search/?api=1&query=Sample',
    'LOC_002,Sample College,College,Aziznagar,"Near Gate, Aziznagar",17.3459,78.3236,3.14,₹31,3.92,₹39,',
    'LOC_003,Broken Row,Area,Moinabad,Somewhere,17.3,78.3,1,₹abc,1,₹x,'].join('\r\n');
  assert.equal((await call('POST', '/api/admin/locations/import', { csv, fee_column: 'Nope' }, S.admin)).status, 400);
  assert.equal((await call('POST', '/api/admin/locations/import', { csv: 'a,b\n1,2\n3,4', fee_column: 'b' }, S.admin)).status, 400);       // required columns missing
  const n0 = db.prepare('SELECT COUNT(*) FROM delivery_locations').pluck().get();
  const dry = (await call('POST', '/api/admin/locations/import', { csv, fee_column: 'Fee_Road_10_INR' }, S.admin)).body;
  assert.deepEqual([dry.dry_run, dry.created, dry.errors.length], [true, 2, 1]); assert.deepEqual(dry.fee_columns, ['Fee_Straight_10_INR', 'Fee_Road_10_INR']);
  assert.equal(db.prepare('SELECT COUNT(*) FROM delivery_locations').pluck().get(), n0);                                            // preview wrote nothing
  const real = (await call('POST', '/api/admin/locations/import', { csv, fee_column: 'Fee_Road_10_INR', dry_run: false }, S.admin)).body;
  assert.deepEqual([real.created, real.updated, real.errors.length], [2, 0, 1]);
  const h = db.prepare("SELECT * FROM delivery_locations WHERE external_ref='LOC_001'").get();
  assert.deepEqual([h.name, h.kind, h.area, h.delivery_fee_paise, h.lat, h.lng, h.distance_km, h.active], ['Sample Boys Hostel', "Men's PG", 'Himayatnagar', 1700, 17.3395, 78.3082, 1.71, 1]);
  // admin changes a charge by hand; re-import WITHOUT "update charges" keeps it, WITH it applies the sheet value
  await call('PUT', `/api/admin/locations/${h.id}`, { delivery_fee_paise: 2200 }, S.admin);
  let again = (await call('POST', '/api/admin/locations/import', { csv, fee_column: 'Fee_Road_10_INR', dry_run: false }, S.admin)).body;
  assert.deepEqual([again.created, again.updated, again.fee_changes], [0, 0, 0]);
  assert.equal(db.prepare('SELECT delivery_fee_paise FROM delivery_locations WHERE id=?').pluck().get(h.id), 2200);
  again = (await call('POST', '/api/admin/locations/import', { csv, fee_column: 'Fee_Straight_10_INR', dry_run: false, update_fees: true }, S.admin)).body;
  assert.equal(again.fee_changes, 2); assert.equal(db.prepare('SELECT delivery_fee_paise FROM delivery_locations WHERE id=?').pluck().get(h.id), 1400);
  assert.equal(db.prepare("SELECT COUNT(*) FROM delivery_locations WHERE external_ref IN ('LOC_001','LOC_002')").pluck().get(), 2);
  assert.ok(db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action='location.import'").pluck().get() >= 3);
});
