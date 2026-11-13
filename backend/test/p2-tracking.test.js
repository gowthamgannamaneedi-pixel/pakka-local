// Priority 2: live rider tracking + restaurant background push. Run with the rest of the suite (npm test).
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { testOutbox } from '../src/otpProviders.js';
import { setPushSender, dispatchPush } from '../src/services/push.js';
import { recordLocation, customerView, adminActive, purgeLocations } from '../src/services/tracking.js';
import { derivedOtp } from '../src/services/core.js';

const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const call = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const PW = 'correct-horse-battery', hash = bcrypt.hashSync(PW, 4);
const mk = (role, phone) => db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run(role, phone, role + phone.slice(-2), hash).lastInsertRowid;
const staff = async (portal, phone) => (await call('POST', '/api/auth/login', { portal, phone, password: PW })).body.token;
const customer = async (phone) => { await call('POST', '/api/auth/customer/otp/request', { phone }); return (await call('POST', '/api/auth/customer/otp/verify', { phone, otp: testOutbox.at(-1).otp })).body.token; };
const sub = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'BPubKeyPubKeyPubKey' + n, auth: 'authkey' + n }, label: n });
const sent = [], fail = {};
setPushSender(async (s, payload) => { if (fail[s.endpoint]) throw Object.assign(new Error('push error'), { statusCode: fail[s.endpoint] }); sent.push({ endpoint: s.endpoint, ...JSON.parse(payload) }); });
const pushesFor = (ep) => sent.filter((x) => x.endpoint === `https://push.example/${ep}`);
const S = {}, HYD = { lat: 17.385, lng: 78.4867 };
const place = async (rid = S.ridA, item = S.itemA, cust = S.cust) => { const o = await call('POST', '/api/customer/orders', { restaurant_id: rid, items: [{ id: item, qty: 1 }], location_id: S.loc }, cust);
  await call('POST', `/api/customer/payments/sandbox/${o.body.order_code}/complete`, { outcome: 'success' }, cust); return { code: o.body.order_code, id: db.prepare('SELECT id FROM orders WHERE order_code=?').pluck().get(o.body.order_code) }; };
const toPickedUp = async (o, restTok, riderTok) => { await call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, restTok); assert.equal((await call('POST', `/api/rider/orders/${o.id}/accept`, {}, riderTok)).status, 200);
  await call('POST', `/api/restaurant/orders/${o.id}/ready`, {}, restTok); assert.equal((await call('POST', `/api/rider/orders/${o.id}/pickup`, { otp: derivedOtp('pickup', o.code) }, riderTok)).status, 200); };

test('setup', async () => {
  mk('admin', '+919700000001'); S.admin = await staff('admin', '+919700000001');
  for (const k of ['A', 'B']) { const rid = db.prepare("INSERT INTO restaurants (name,admin_visible,approved,markup_paise) VALUES (?,1,1,2000)").run('Rest ' + k).lastInsertRowid; S['rid' + k] = rid;
    const ph = k === 'A' ? '+919700000002' : '+919700000003'; S['ru' + k] = mk('restaurant', ph); db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(S['ru' + k], rid); db.prepare('INSERT INTO restaurant_operating_status (restaurant_id,is_open) VALUES (?,1)').run(rid);
    S['item' + k] = db.prepare("INSERT INTO food_items (restaurant_id,name,base_price_paise) VALUES (?,'Biryani',14000)").run(rid).lastInsertRowid; S['rest' + k] = await staff('restaurant', ph); }
  S.loc = db.prepare("INSERT INTO delivery_locations (name,address,delivery_fee_paise,lat,lng) VALUES ('Hostel','Road 1',4000,17.40,78.50)").run().lastInsertRowid;
  for (const [i, ph] of [[1, '+919700000011'], [2, '+919700000012']]) { S['rdId' + i] = mk('rider', ph); db.prepare("INSERT INTO riders (user_id,verification_status,is_online,last_seen_at) VALUES (?,'approved',1,?)").run(S['rdId' + i], new Date().toISOString()); S['rd' + i] = await staff('rider', ph); }
  S.cust = await customer('+919800000001'); S.cust2 = await customer('+919800000002');
});

test('location updates: only an authenticated rider with an active delivery; nothing stored otherwise', async () => {
  assert.equal((await call('POST', '/api/tracking/rider/location', HYD)).status, 401);
  for (const t of [S.cust, S.restA, S.admin]) assert.equal((await call('POST', '/api/tracking/rider/location', HYD, t)).status, 403);
  const r = await call('POST', '/api/tracking/rider/location', HYD, S.rd1);                         // approved + online, but no delivery
  assert.equal(r.status, 409); assert.equal(r.body.tracking, false); assert.equal(r.body.code, 'NOT_TRACKING');
  assert.equal(db.prepare('SELECT COUNT(*) FROM rider_locations').pluck().get(), 0);
  S.o1 = await place(); await call('POST', `/api/restaurant/orders/${S.o1.id}/accept`, {}, S.restA);
  assert.equal((await call('POST', '/api/tracking/rider/location', HYD, S.rd1)).status, 409);       // offered, not yet claimed: still no tracking
  assert.equal((await call('POST', `/api/rider/orders/${S.o1.id}/accept`, {}, S.rd1)).status, 200);
  const ok = await call('POST', '/api/tracking/rider/location', { ...HYD, accuracy: 12, heading: 90, speed: 4 }, S.rd1);
  assert.equal(ok.status, 200); assert.equal(ok.body.tracking, true);
  assert.equal((await call('POST', '/api/tracking/rider/location', HYD, S.rd2)).status, 409);       // the other rider has no delivery
  const row = db.prepare('SELECT * FROM rider_locations').all(); assert.equal(row.length, 1); assert.equal(row[0].rider_id, S.rdId1); assert.equal(row[0].order_id, S.o1.id);
});

test('validation: coordinates, timestamps, ownership and frequency', async () => {
  const t0 = Date.now() + 10_000, rec = (b, now) => recordLocation(db, S.rdId1, b, now);
  assert.equal((await call('POST', '/api/tracking/rider/location', HYD, S.rd1)).status, 429);       // second update within 3 s
  for (const bad of [{ lat: 91, lng: 0 }, { lat: 17, lng: 181 }, { lat: '17.3', lng: 78.4 }, { lat: 0, lng: 0 }, { lat: NaN, lng: 78 }, {}, { lat: 17.3 }]) assert.equal(rec(bad, t0).code, 'BAD_COORDS', JSON.stringify(bad));
  assert.equal(rec({ ...HYD, accuracy: -5 }, t0).code, 'BAD_FIX'); assert.equal(rec({ ...HYD, heading: 400 }, t0).code, 'BAD_FIX');
  assert.equal(rec({ ...HYD, recorded_at: t0 + 120_000 }, t0).code, 'BAD_TIME');                    // from the future
  assert.equal(rec({ ...HYD, recorded_at: 'yesterday-ish' }, t0).code, 'BAD_TIME');
  assert.equal(rec({ ...HYD, recorded_at: t0 - 300_000 }, t0).code, 'OLD_FIX');                     // queued while offline: too old
  assert.equal(rec({ ...HYD, order_id: 999999 }, t0).code, 'NOT_YOUR_ORDER');
  assert.equal(rec({ lat: 17.39, lng: 78.49, recorded_at: t0 }, t0).ok, true);
  assert.equal(rec({ lat: 17.50, lng: 78.60, recorded_at: t0 - 5000 }, t0 + 4000).ignored, true);   // older than the stored fix: ignored
  assert.equal(db.prepare('SELECT lat FROM rider_locations WHERE rider_id=?').pluck().get(S.rdId1), 17.39);
  assert.equal(rec({ lat: 17.391, lng: 78.491 }, t0 + 5000).ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) FROM rider_locations').pluck().get(), 1);                // latest only, never a history
  db.prepare("UPDATE riders SET verification_status='suspended' WHERE user_id=?").run(S.rdId1);
  assert.equal(rec(HYD, t0 + 20_000).code, 'NOT_ALLOWED');
  db.prepare("UPDATE riders SET verification_status='approved' WHERE user_id=?").run(S.rdId1);
});

test('customer sees the rider only for their own order and only between pickup and delivery', async () => {
  let v = (await call('GET', `/api/tracking/orders/${S.o1.code}`, null, S.cust)).body;
  assert.equal(v.tracking, false); assert.equal(v.rider, undefined);                                // rider has claimed but not picked up: hidden
  await call('POST', `/api/restaurant/orders/${S.o1.id}/ready`, {}, S.restA);
  assert.equal((await call('POST', `/api/rider/orders/${S.o1.id}/pickup`, { otp: derivedOtp('pickup', S.o1.code) }, S.rd1)).status, 200);
  recordLocation(db, S.rdId1, { lat: 17.392, lng: 78.492 }, Date.now() + 30_000);
  db.prepare('UPDATE rider_locations SET received_at=? WHERE rider_id=?').run(new Date().toISOString(), S.rdId1);
  v = (await call('GET', `/api/tracking/orders/${S.o1.code}`, null, S.cust)).body;
  assert.equal(v.tracking, true); assert.equal(v.state, 'live'); assert.equal(v.rider.lat, 17.392); assert.deepEqual([v.destination.lat, v.destination.lng], [17.4, 78.5]);
  assert.equal(JSON.stringify(v).includes('97000000'), false);                                      // no phone numbers in tracking data
  assert.equal((await call('GET', `/api/tracking/orders/${S.o1.code}`, null, S.cust2)).status, 404);  // another customer
  assert.equal((await call('GET', `/api/tracking/orders/${S.o1.code}`)).status, 401);
  for (const t of [S.rd2, S.restB, S.restA]) assert.equal((await call('GET', `/api/tracking/orders/${S.o1.code}`, null, t)).status, 403);
});

test('stale and offline are reported honestly, with the age', async () => {
  const cid = db.prepare('SELECT customer_id FROM orders WHERE id=?').pluck().get(S.o1.id), at = Date.parse(db.prepare('SELECT received_at FROM rider_locations WHERE rider_id=?').pluck().get(S.rdId1));
  assert.equal(customerView(db, cid, S.o1.code, at + 10_000).state, 'live');
  const st = customerView(db, cid, S.o1.code, at + 90_000); assert.equal(st.state, 'stale'); assert.equal(st.age_sec, 90);
  assert.equal(customerView(db, cid, S.o1.code, at + 600_000).state, 'offline');
  db.prepare('DELETE FROM rider_locations').run();
  const none = customerView(db, cid, S.o1.code); assert.equal(none.state, 'unavailable'); assert.equal(none.rider, null);
});

test('admin map lists active deliveries only; other roles are refused', async () => {
  recordLocation(db, S.rdId1, { lat: 17.393, lng: 78.493 }, Date.now() + 60_000);
  for (const t of [S.cust, S.rd1, S.restA]) assert.equal((await call('GET', '/api/tracking/admin/active', null, t)).status, 403);
  const a = (await call('GET', '/api/tracking/admin/active', null, S.admin)).body.deliveries;
  assert.equal(a.length, 1); assert.equal(a[0].order_code, S.o1.code); assert.equal(a[0].location.lat, 17.393); assert.equal(a[0].rider.id, S.rdId1);
  const cfg = await call('GET', '/api/tracking/config', null, S.cust); assert.equal(cfg.status, 200); assert.ok('tile_url' in cfg.body);
  assert.equal((await call('GET', '/api/tracking/config')).status, 401);
});

test('tracking stops at delivery: updates refused, position forgotten, customer view closed', async () => {
  const code = (await call('GET', `/api/customer/orders/${S.o1.code}`, null, S.cust)).body.delivery_otp;
  assert.equal((await call('POST', `/api/rider/orders/${S.o1.id}/deliver`, { otp: code }, S.rd1)).status, 200);
  const r = await call('POST', '/api/tracking/rider/location', HYD, S.rd1);
  assert.equal(r.status, 409); assert.equal(r.body.tracking, false);
  assert.equal(db.prepare('SELECT COUNT(*) FROM rider_locations').pluck().get(), 0);
  const v = (await call('GET', `/api/tracking/orders/${S.o1.code}`, null, S.cust)).body; assert.equal(v.tracking, false); assert.equal(v.rider, undefined);
  assert.equal((await call('GET', '/api/tracking/admin/active', null, S.admin)).body.deliveries.length, 0);
});

test('an admin-cancelled delivery also ends tracking', async () => {
  const o = await place(); await toPickedUp(o, S.restA, S.rd1);
  assert.equal(recordLocation(db, S.rdId1, HYD, Date.now() + 120_000).ok, true);
  assert.equal((await call('POST', `/api/admin/orders/${o.id}/cancel`, { reauth_password: PW, reason: 'Customer unreachable' }, S.admin)).status, 200);
  assert.equal(recordLocation(db, S.rdId1, HYD, Date.now() + 130_000).code, 'NOT_TRACKING');
  assert.equal(adminActive(db).length, 0); assert.equal(db.prepare('SELECT COUNT(*) FROM rider_locations').pluck().get(), 0);
});

// ---------------- review corrections: cleanup, stop endpoint, cache headers ----------------
const locCount = (rid) => db.prepare('SELECT COUNT(*) FROM rider_locations' + (rid ? ' WHERE rider_id=?' : '')).pluck().get(...(rid ? [rid] : []));
const share = (rid, offset) => assert.equal(recordLocation(db, rid, HYD, Date.now() + offset).ok, true);
const claimed = async (riderTok) => { const o = await place(); await call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, S.restA); assert.equal((await call('POST', `/api/rider/orders/${o.id}/accept`, {}, riderTok)).status, 200); return o; };

test('cleanup is immediate and server-side for every way a delivery can end (no screen or request needed)', async () => {
  let o = await claimed(S.rd1); await call('POST', `/api/restaurant/orders/${o.id}/ready`, {}, S.restA);
  await call('POST', `/api/rider/orders/${o.id}/pickup`, { otp: derivedOtp('pickup', o.code) }, S.rd1); share(S.rdId1, 200_000); assert.equal(locCount(S.rdId1), 1);
  const dcode = (await call('GET', `/api/customer/orders/${o.code}`, null, S.cust)).body.delivery_otp;
  assert.equal((await call('POST', `/api/rider/orders/${o.id}/deliver`, { otp: dcode }, S.rd1)).status, 200);
  assert.equal(locCount(), 0, 'deleted at delivery, before anyone calls a tracking endpoint');

  o = await claimed(S.rd1); share(S.rdId1, 210_000);                                              // cancelled before pickup
  assert.equal((await call('POST', `/api/admin/orders/${o.id}/cancel`, { reauth_password: PW, reason: 'Restaurant closed' }, S.admin)).status, 200); assert.equal(locCount(), 0, 'deleted at admin cancel');

  o = await claimed(S.rd1); share(S.rdId1, 220_000);                                              // rider removed by admin, order re-offered
  assert.equal((await call('POST', `/api/admin/orders/${o.id}/unassign-rider`, { reauth_password: PW, note: 'Rider unreachable' }, S.admin)).status, 200); assert.equal(locCount(S.rdId1), 0, 'deleted when the rider is unassigned');
  assert.equal((await call('POST', `/api/rider/orders/${o.id}/accept`, {}, S.rd2)).status, 200); share(S.rdId2, 230_000);      // reassigned to rider 2
  assert.equal(locCount(S.rdId1), 0); assert.equal(locCount(S.rdId2), 1);
  await call('POST', `/api/restaurant/orders/${o.id}/ready`, {}, S.restA); await call('POST', `/api/rider/orders/${o.id}/pickup`, { otp: derivedOtp('pickup', o.code) }, S.rd2);
  const v = (await call('GET', `/api/tracking/orders/${o.code}`, null, S.cust)).body; assert.equal(v.tracking, true); assert.ok(v.rider, 'customer sees the NEW rider only');
  assert.equal((await call('POST', `/api/admin/orders/${o.id}/cancel`, { reauth_password: PW, reason: 'Customer unreachable' }, S.admin)).status, 200); assert.equal(locCount(), 0, 'deleted at cancel after pickup');
});

test('a rider with two deliveries keeps sharing until the last one ends', async () => {
  const a = await claimed(S.rd1), b = await claimed(S.rd1); share(S.rdId1, 240_000);
  assert.equal((await call('POST', `/api/admin/orders/${a.id}/cancel`, { reauth_password: PW, reason: 'Out of stock' }, S.admin)).status, 200); assert.equal(locCount(S.rdId1), 1, 'still has an active delivery');
  assert.equal((await call('POST', `/api/admin/orders/${b.id}/cancel`, { reauth_password: PW, reason: 'Out of stock' }, S.admin)).status, 200); assert.equal(locCount(S.rdId1), 0);
});

test('stop-sharing endpoint: own position only, riders only; background purge covers suspended riders', async () => {
  const a = await claimed(S.rd1), b = await claimed(S.rd2); share(S.rdId1, 250_000); share(S.rdId2, 250_000);
  assert.equal((await call('POST', '/api/tracking/rider/stop', {})).status, 401);
  for (const t of [S.cust, S.restA, S.admin]) assert.equal((await call('POST', '/api/tracking/rider/stop', {}, t)).status, 403);
  const r = await call('POST', '/api/tracking/rider/stop', { rider_id: S.rdId1 }, S.rd2);         // rider 2 tries to name rider 1: the body is ignored
  assert.equal(r.status, 200); assert.equal(r.body.removed, 1); assert.equal(r.body.active_deliveries, 1);
  assert.equal(locCount(S.rdId2), 0); assert.equal(locCount(S.rdId1), 1, "another rider's position is untouched");
  db.prepare("UPDATE riders SET verification_status='suspended' WHERE user_id=?").run(S.rdId1);
  assert.equal(purgeLocations(db), 1); assert.equal(locCount(), 0);                                // job backstop
  db.prepare("UPDATE riders SET verification_status='approved' WHERE user_id=?").run(S.rdId1);
  for (const o of [a, b]) await call('POST', `/api/admin/orders/${o.id}/cancel`, { reauth_password: PW, reason: 'Test cleanup' }, S.admin);
});

test('tracking responses are never cacheable, and coordinates need the right login', async () => {
  const o = await claimed(S.rd1); await call('POST', `/api/restaurant/orders/${o.id}/ready`, {}, S.restA); await call('POST', `/api/rider/orders/${o.id}/pickup`, { otp: derivedOtp('pickup', o.code) }, S.rd1); share(S.rdId1, 260_000);
  const get = (path, token) => fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const cases = [[`/api/tracking/orders/${o.code}`, S.cust, 200], ['/api/tracking/admin/active', S.admin, 200], ['/api/tracking/config', S.cust, 200],
    [`/api/tracking/orders/${o.code}`, null, 401], ['/api/tracking/admin/active', null, 401], ['/api/tracking/config', null, 401],
    [`/api/tracking/orders/${o.code}`, S.cust2, 404], [`/api/tracking/orders/${o.code}`, S.rd1, 403], [`/api/tracking/orders/${o.code}`, S.admin, 403],
    ['/api/tracking/admin/active', S.cust, 403], ['/api/tracking/admin/active', S.rd1, 403], ['/api/tracking/admin/active', S.restA, 403], ['/api/tracking/admin/active', 'not-a-token', 401]];
  for (const [path, token, want] of cases) { const r = await get(path, token), text = await r.text();
    assert.equal(r.status, want, `${path} as ${token ? token.slice(0, 6) : 'anonymous'}`); assert.equal(r.headers.get('cache-control'), 'no-store, private', path);
    if (want !== 200) assert.equal(/"lat"|17\.385/.test(text), false, 'no coordinates in a refused response'); }
  const post = await fetch(base + '/api/tracking/rider/location', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${S.rd1}` }, body: JSON.stringify({ lat: 91, lng: 0 }) });
  assert.equal(post.headers.get('cache-control'), 'no-store, private');
  await call('POST', `/api/admin/orders/${o.id}/cancel`, { reauth_password: PW, reason: 'Test cleanup' }, S.admin); assert.equal(locCount(), 0);
});

// ---------------- Task B: restaurant background push ----------------
test('restaurant push: only the right restaurant, once, with a deep link and no customer data', async () => {
  for (const [t, n] of [[S.restA, 'restA'], [S.restB, 'restB'], [S.cust, 'cust']]) assert.equal((await call('POST', '/api/push/subscribe', sub(n), t)).status, 201);
  sent.length = 0; const o = await place(S.ridA, S.itemA); S.o3 = o; await dispatchPush(db); await dispatchPush(db);
  const a = pushesFor('restA').filter((x) => x.kind === 'restaurant_new');
  assert.equal(a.length, 1); assert.equal(a[0].url, `/restaurant/#/order/${o.id}`); assert.equal(a[0].urgent, true);
  assert.equal(pushesFor('restB').length, 0);                                                         // the other restaurant hears nothing
  assert.equal(/98000000|Hostel|Road 1|Biryani/.test(JSON.stringify(a[0])), false);                 // no customer phone, address or items in the payload
  assert.equal((await call('GET', `/api/restaurant/orders/${o.id}`, null, S.restB)).status, 404);     // and the link is useless to another restaurant
});

test('the order is stored even when every push fails; expired subscriptions are removed', async () => {
  fail['https://push.example/restA'] = 410; sent.length = 0;
  const o = await place(S.ridA, S.itemA); await dispatchPush(db);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').pluck().get(o.id), 'PLACED');
  assert.equal((await call('GET', '/api/restaurant/orders', null, S.restA)).body.orders.some((x) => x.id === o.id), true);    // still in the restaurant's list
  assert.equal(db.prepare("SELECT COUNT(*) FROM push_subscriptions WHERE endpoint='https://push.example/restA'").pluck().get(), 0);
  delete fail['https://push.example/restA'];
});

test('no push for an order that no longer needs action, a deactivated login, or a login moved to another restaurant', async () => {
  await call('POST', '/api/push/subscribe', sub('restA2'), S.restA);
  let o = await place(S.ridA, S.itemA); await call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, S.restA); sent.length = 0; await dispatchPush(db);
  assert.equal(pushesFor('restA2').filter((x) => x.kind === 'restaurant_new').length, 0);            // accepted before the push went out
  o = await place(S.ridA, S.itemA); db.prepare('UPDATE restaurant_users SET restaurant_id=? WHERE user_id=?').run(S.ridB, S.ruA); sent.length = 0; await dispatchPush(db);
  assert.equal(pushesFor('restA2').filter((x) => x.kind === 'restaurant_new').length, 0);            // login no longer belongs to restaurant A
  db.prepare('UPDATE restaurant_users SET restaurant_id=? WHERE user_id=?').run(S.ridA, S.ruA);
  o = await place(S.ridA, S.itemA); db.prepare('UPDATE users SET active=0 WHERE id=?').run(S.ruA); sent.length = 0; await dispatchPush(db);
  assert.equal(pushesFor('restA2').length, 0);                                                        // deactivated account
  db.prepare('UPDATE users SET active=1 WHERE id=?').run(S.ruA);
});

test('test notification: own devices only, needs a subscribed device', async () => {
  assert.equal((await call('POST', '/api/push/test', {})).status, 401);
  assert.equal((await call('POST', '/api/push/test', {}, S.rd2)).status, 409);                        // no device registered
  sent.length = 0; const r = await call('POST', '/api/push/test', {}, S.restB); assert.equal(r.status, 202); assert.equal(r.body.devices, 1);
  await dispatchPush(db);
  assert.equal(pushesFor('restB').filter((x) => x.kind === 'test').length, 1); assert.equal(sent.filter((x) => x.kind === 'test').length, 1);
});
