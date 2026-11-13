import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { testOutbox } from '../src/otpProviders.js';
import { reopenDueRestaurants } from '../src/jobs.js';

const db = openDb(':memory:');
const app = createApp(db);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const call = async (method, path, body, token) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const mk = (role, phone, pw = 'correct-horse-battery') =>
  db.prepare('INSERT INTO users (role, phone, name, password_hash) VALUES (?,?,?,?)').run(role, phone, role, bcrypt.hashSync(pw, 4)).lastInsertRowid;
const login = async (portal, phone, password = 'correct-horse-battery') => (await call('POST', '/api/auth/login', { portal, phone, password }));

const adminId = mk('admin', '+919000000001');
const restA = db.prepare("INSERT INTO restaurants (name) VALUES ('A')").run().lastInsertRowid;
const restB = db.prepare("INSERT INTO restaurants (name) VALUES ('B')").run().lastInsertRowid;
const uA = mk('restaurant', '+919000000002'); db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(uA, restA);
const uB = mk('restaurant', '+919000000003'); db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(uB, restB);
const riderId = mk('rider', '+919000000004'); db.prepare('INSERT INTO riders (user_id) VALUES (?)').run(riderId);

test('login only works through the matching portal', async () => {
  assert.equal((await login('admin', '+919000000004')).status, 401);   // rider via admin form
  assert.equal((await login('rider', '+919000000004')).status, 200);
});

test('RBAC: every portal rejects other roles and anonymous users', async () => {
  const t = Object.fromEntries(await Promise.all([['admin', '+919000000001'], ['restaurant', '+919000000002'], ['rider', '+919000000004']]
    .map(async ([p, ph]) => [p, (await login(p, ph)).body.token])));
  assert.equal((await call('GET', '/api/admin/ping')).status, 401);
  assert.equal((await call('GET', '/api/admin/ping', null, t.admin)).status, 200);
  assert.equal((await call('GET', '/api/admin/ping', null, t.rider)).status, 403);
  assert.equal((await call('GET', '/api/admin/ping', null, t.restaurant)).status, 403);
  assert.equal((await call('GET', '/api/rider/me', null, t.restaurant)).status, 403);
  assert.equal((await call('GET', '/api/restaurant/me', null, t.rider)).status, 403);
  assert.equal((await call('GET', '/api/restaurant/me', null, t.admin)).status, 403);  // admin has its own API surface
});

test('IDOR: a restaurant cannot read another restaurant\'s order by code', async () => {
  db.prepare(`INSERT INTO orders (order_code, customer_id, restaurant_id, status, items_base_paise, markup_paise, delivery_paise,
    total_paise, commission_bps, commission_paise, restaurant_payout_paise) VALUES ('PL20261105AAAAAA', ?, ?, 'PLACED', 14000, 2000, 4000, 20000, 1000, 1400, 12600)`).run(adminId, restB);
  const tA = (await login('restaurant', '+919000000002')).body.token;
  const tB = (await login('restaurant', '+919000000003')).body.token;
  assert.equal((await call('GET', '/api/restaurant/orders/by-code/PL20261105AAAAAA', null, tA)).status, 404);
  assert.equal((await call('GET', '/api/restaurant/orders/by-code/PL20261105AAAAAA', null, tB)).status, 200);
});

test('brute force: account locks after 5 wrong passwords', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login('rider', '+919000000004', 'wrong-password')).status, 401);
  assert.equal((await login('rider', '+919000000004')).status, 429);
  db.prepare('UPDATE users SET locked_until = NULL WHERE id = ?').run(riderId);
});

test('unapproved riders cannot go online; approved ones can; revoked tokens die', async () => {
  const t = (await login('rider', '+919000000004')).body.token;
  assert.equal((await call('POST', '/api/rider/online', { online: true }, t)).status, 403);
  db.prepare("UPDATE riders SET verification_status = 'approved' WHERE user_id = ?").run(riderId);
  assert.equal((await call('POST', '/api/rider/online', { online: true }, t)).status, 200);
  await call('POST', '/api/auth/logout-all', {}, t);
  assert.equal((await call('GET', '/api/rider/me', null, t)).status, 401);
});

test('customer OTP: wrong code, correct code, single use, no OTP leaked in response', async () => {
  const phone = '+919111111111';
  const r = await call('POST', '/api/auth/customer/otp/request', { phone });
  assert.equal(r.status, 200); assert.equal(JSON.stringify(r.body).match(/\d{6}/), null);
  assert.equal((await call('POST', '/api/auth/customer/otp/request', { phone })).status, 429);   // resend cooldown
  const { otp } = testOutbox.at(-1);
  const wrong = otp === '000000' ? '111111' : '000000';
  assert.equal((await call('POST', '/api/auth/customer/otp/verify', { phone, otp: wrong })).status, 401);
  const ok = await call('POST', '/api/auth/customer/otp/verify', { phone, otp });
  assert.equal(ok.status, 200); assert.equal(ok.body.user.role, 'customer');
  assert.equal((await call('POST', '/api/auth/customer/otp/verify', { phone, otp })).status, 401);  // reuse blocked
  assert.equal((await call('GET', '/api/customer/me', null, ok.body.token)).status, 200);
  assert.equal((await call('GET', '/api/admin/ping', null, ok.body.token)).status, 403);
});

test('customer OTP locks after 5 wrong attempts even if the final guess is right', async () => {
  const phone = '+919222222222';
  await call('POST', '/api/auth/customer/otp/request', { phone });
  const { otp } = testOutbox.at(-1);
  const wrong = otp === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/customer/otp/verify', { phone, otp: wrong });
  assert.equal((await call('POST', '/api/auth/customer/otp/verify', { phone, otp })).status, 401);
});

test('DB guarantees one accepted rider per order and one cashout open request per account', () => {
  const oid = db.prepare('SELECT id FROM orders LIMIT 1').get().id;
  const r2 = mk('rider', '+919000000005');
  db.prepare("INSERT INTO rider_assignments (order_id, rider_id, status) VALUES (?,?, 'ACCEPTED')").run(oid, riderId);
  assert.throws(() => db.prepare("INSERT INTO rider_assignments (order_id, rider_id, status) VALUES (?,?, 'ACCEPTED')").run(oid, r2), /UNIQUE/);
  const ins = () => db.prepare("INSERT INTO cashout_requests (account_type, account_id, requested_by, amount_paise, payout_method, beneficiary) VALUES ('rider', ?, ?, 100, 'upi', 'x@upi')").run(riderId, riderId);
  ins(); assert.throws(ins, /UNIQUE/);
  db.prepare("INSERT INTO rider_earnings (rider_id, order_id, amount_paise) VALUES (?,?,3000)").run(riderId, oid);
  assert.throws(() => db.prepare("INSERT INTO rider_earnings (rider_id, order_id, amount_paise) VALUES (?,?,3000)").run(riderId, oid), /UNIQUE/);
});

test('server-side job reopens an auto-closed restaurant without any browser session', () => {
  db.prepare("INSERT INTO restaurant_operating_status VALUES (?, 0, 'auto', ?, NULL)").run(restA, new Date(Date.now() - 1000).toISOString());
  db.prepare("INSERT INTO restaurant_operating_status VALUES (?, 0, 'manual', NULL, NULL)").run(restB);
  assert.equal(reopenDueRestaurants(db), 1);
  assert.equal(db.prepare('SELECT is_open FROM restaurant_operating_status WHERE restaurant_id = ?').get(restA).is_open, 1);
  assert.equal(db.prepare('SELECT is_open FROM restaurant_operating_status WHERE restaurant_id = ?').get(restB).is_open, 0);  // manual stays closed
});

test('errors do not leak internals; unknown API routes 404 as JSON', async () => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(r.status, 400);
  assert.ok(!(await r.text()).includes('node_modules'));
  assert.equal((await call('GET', '/api/nope')).status, 404);
});
