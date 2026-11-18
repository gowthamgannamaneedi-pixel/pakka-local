// Endpoints added for the v4 UI: the in-app notification centre (every role, own rows only) and the read-only admin customer directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { testOutbox } from '../src/otpProviders.js';
import { notify } from '../src/services/core.js';

const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const call = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const PW = 'correct-horse-battery', hash = bcrypt.hashSync(PW, 4);
const mk = (role, phone) => db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run(role, phone, role + ' ' + phone.slice(-2), hash).lastInsertRowid;
const staff = async (portal, phone) => (await call('POST', '/api/auth/login', { portal, phone, password: PW })).body.token;
const customer = async (phone) => { await call('POST', '/api/auth/customer/otp/request', { phone }); return (await call('POST', '/api/auth/customer/otp/verify', { phone, otp: testOutbox.at(-1).otp })).body.token; };

test('notification inbox: every role sees only its own notifications, and can mark them read', async () => {
  const rid = mk('rider', '+919600000001'); db.prepare("INSERT INTO riders (user_id,verification_status) VALUES (?,'approved')").run(rid);
  const own = mk('restaurant', '+919600000002');
  const tRider = await staff('rider', '+919600000001'), tOwn = await staff('restaurant', '+919600000002');
  notify(db, rid, 'transactional', 'Delivery reassigned', 'X was taken off you.', '/rider/#/jobs', null, 'k1');
  notify(db, rid, 'transactional', 'Delivery cancelled', 'Y was cancelled.', '/rider/#/jobs', null, 'k2');
  notify(db, own, 'transactional', 'New order', 'New order Z', '/restaurant/#/order/1', null, 'k3', 'restaurant_new');
  const a = await call('GET', '/api/push/inbox', null, tRider);
  assert.equal(a.status, 200); assert.equal(a.body.unread, 2); assert.deepEqual(a.body.notifications.map((n) => n.title).sort(), ['Delivery cancelled', 'Delivery reassigned']);
  const b = await call('GET', '/api/push/inbox', null, tOwn);
  assert.equal(b.body.notifications.length, 1); assert.equal(b.body.notifications[0].kind, 'restaurant_new');
  assert.equal((await call('POST', '/api/push/inbox/read', {}, tRider)).status, 200);
  assert.equal((await call('GET', '/api/push/inbox', null, tRider)).body.unread, 0);
  assert.equal((await call('GET', '/api/push/inbox', null, tOwn)).body.unread, 1, 'marking read never touches another account');
  assert.equal((await call('GET', '/api/push/inbox')).status, 401, 'signed-out callers get nothing');
});

test('admin customer directory: admin only, read-only, searchable', async () => {
  mk('admin', '+919600000009'); const tAdm = await staff('admin', '+919600000009');
  const tCus = await customer('+919600000077');
  const tOwn = await staff('restaurant', '+919600000002');
  const all = await call('GET', '/api/admin/customers', null, tAdm);
  assert.equal(all.status, 200); assert.ok(all.body.total >= 1); const me = all.body.customers.find((c) => c.phone === '+919600000077');
  assert.ok(me); assert.equal(me.orders, 0); assert.equal(me.spent_paise, 0);
  assert.equal((await call('GET', '/api/admin/customers?q=00077', null, tAdm)).body.customers.length, 1);
  assert.equal((await call('GET', '/api/admin/customers?q=nobody-matches', null, tAdm)).body.customers.length, 0);
  assert.equal((await call('GET', '/api/admin/customers', null, tCus)).status, 403);
  assert.equal((await call('GET', '/api/admin/customers', null, tOwn)).status, 403);
  assert.equal((await call('POST', '/api/admin/customers', {}, tAdm)).status, 404, 'no write action exists');
});
