// Restaurant dashboard changes: photos required to publish, upload validation, daily earnings, response timer setting,
// category presets, removed surge requests. In-memory database, test data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { PNG } from './helpers/rider-application.js';

const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const call = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body == null ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const PW = 'correct-horse-battery', hash = bcrypt.hashSync(PW, 4);
const mk = (role, phone) => db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run(role, phone, role, hash).lastInsertRowid;
const staff = async (portal, phone) => (await call('POST', '/api/auth/login', { portal, phone, password: PW })).body.token;
const S = {};

test('setup', async () => {
  mk('admin', '+919600000001'); S.admin = await staff('admin', '+919600000001');
  S.rid = db.prepare("INSERT INTO restaurants (name, admin_visible, approved) VALUES ('Photo Test',1,1)").run().lastInsertRowid;
  const u = mk('restaurant', '+919600000002'); db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(u, S.rid); S.rt = await staff('restaurant', '+919600000002');
});

test('a dish cannot be shown to customers without a photo; it can be saved as sold out and published once a photo is added', async () => {
  const no = await call('POST', '/api/restaurant/menu', { name: 'Paneer Tikka', base_price_paise: 18000, prep_time_min: 15 }, S.rt);
  assert.equal(no.status, 400); assert.equal(no.body.code, 'PHOTO_REQUIRED');
  const draft = await call('POST', '/api/restaurant/menu', { name: 'Paneer Tikka', base_price_paise: 18000, prep_time_min: 15, available: false }, S.rt); assert.equal(draft.status, 201);
  assert.equal((await call('PUT', `/api/restaurant/menu/${draft.body.id}`, { name: 'Paneer Tikka', available: true }, S.rt)).status, 400);   // publishing needs a photo
  assert.equal((await call('GET', `/api/public/restaurants/${S.rid}/menu`)).body.items.filter((i) => i.id === draft.body.id).length, 0);
  assert.equal((await call('PUT', `/api/restaurant/menu/${draft.body.id}`, { name: 'Paneer Tikka', available: true, image: PNG }, S.rt)).status, 200);
  assert.equal((await call('GET', `/api/public/restaurants/${S.rid}/menu`)).body.items.filter((i) => i.id === draft.body.id).length, 1);
  // a dish published before the rule (no photo) keeps working and can still be edited
  const legacy = db.prepare("INSERT INTO food_items (restaurant_id,name,base_price_paise) VALUES (?, 'Old Dish', 9000)").run(S.rid).lastInsertRowid;
  assert.equal((await call('PUT', `/api/restaurant/menu/${legacy}`, { name: 'Old Dish', base_price_paise: 9500 }, S.rt)).status, 200);
});

test('image uploads are checked by content and size, not by name', async () => {
  const fake = Buffer.from('<?php echo 1; ?>').toString('base64');
  assert.equal((await call('POST', '/api/restaurant/menu', { name: 'X', base_price_paise: 100, prep_time_min: 5, image: fake }, S.rt)).status, 400);
  const pdf = Buffer.from('%PDF-1.4 fake').toString('base64');
  assert.equal((await call('POST', '/api/restaurant/menu', { name: 'X', base_price_paise: 100, prep_time_min: 5, image: pdf }, S.rt)).status, 400);
  const big = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(3_200_000)]).toString('base64');
  assert.equal((await call('POST', '/api/restaurant/menu', { name: 'X', base_price_paise: 100, prep_time_min: 5, image: big }, S.rt)).status, 400);
  assert.equal((await call('POST', '/api/restaurant/menu', { name: 'X', base_price_paise: 100, prep_time_min: 5, image: PNG }, S.rt)).status, 201);
});

test('category presets are offered and custom categories still work', async () => {
  const p = (await call('GET', '/api/restaurant/category-presets', null, S.rt)).body.presets;
  assert.ok(p.includes('Starters') && p.includes('Desserts')); assert.equal((await call('GET', '/api/restaurant/category-presets')).status, 401);
  assert.equal((await call('POST', '/api/restaurant/categories', { name: p[0] }, S.rt)).status, 201);
  assert.equal((await call('POST', '/api/restaurant/categories', { name: 'Chef specials' }, S.rt)).status, 201);
  assert.deepEqual((await call('GET', '/api/restaurant/menu', null, S.rt)).body.categories.map((c) => c.name).sort(), ['Chef specials', 'Starters']);
});

test('surge-charge requests are gone for restaurants and admins; old rows are untouched', async () => {
  db.prepare("INSERT INTO surge_charge_requests (restaurant_id, reason) VALUES (?, 'old request')").run(S.rid);
  assert.equal((await call('GET', '/api/restaurant/surge-requests', null, S.rt)).status, 404);
  assert.equal((await call('POST', '/api/restaurant/surge-requests', { reason: 'busy evening' }, S.rt)).status, 404);
  assert.equal((await call('POST', '/api/admin/surge/requests/1/decide', { approve: true }, S.admin)).status, 404);
  assert.equal((await call('GET', '/api/admin/surge', null, S.admin)).status, 200);                 // surge rules remain
  assert.equal(db.prepare('SELECT COUNT(*) FROM surge_charge_requests').pluck().get(), 1);
});

test('response timer: off by default, admin-configurable (1-120 min), sent with orders', async () => {
  let o = (await call('GET', '/api/restaurant/orders', null, S.rt)).body; assert.equal(o.accept_timeout_sec, null); assert.ok(o.server_time);
  for (const bad of ['0', '121', 'abc', '5.5']) assert.equal((await call('PUT', '/api/admin/settings', { settings: { restaurant_accept_timeout_min: bad } }, S.admin)).status, 400, bad);
  assert.equal((await call('PUT', '/api/admin/settings', { settings: { restaurant_accept_timeout_min: '5' } }, S.admin)).status, 200);
  o = (await call('GET', '/api/restaurant/orders', null, S.rt)).body; assert.equal(o.accept_timeout_sec, 300);
  assert.equal((await call('PUT', '/api/admin/settings', { settings: { restaurant_accept_timeout_min: '' } }, S.admin)).status, 200);
  assert.equal((await call('GET', '/api/restaurant/orders', null, S.rt)).body.accept_timeout_sec, null);
  assert.equal((await call('PUT', '/api/admin/settings', { settings: { restaurant_accept_timeout_min: '5' } }, S.rt)).status, 403);
});

test('daily earnings: India-day buckets from delivered orders; matches the per-order records', async () => {
  const cust = mk('customer', '+919600000003');
  const add = (code, at, base, comm) => { const id = db.prepare(`INSERT INTO orders (order_code,customer_id,restaurant_id,status,items_base_paise,markup_paise,delivery_paise,total_paise,commission_bps,commission_paise,restaurant_payout_paise,created_at,updated_at)
      VALUES (?,?,?,'DELIVERED',?,0,0,?,1000,?,?,?,?)`).run(code, cust, S.rid, base, base, comm, base - comm, at, at).lastInsertRowid;
    db.prepare('INSERT INTO restaurant_commissions (order_id,restaurant_id,base_paise,commission_bps,commission_paise,payout_paise,created_at) VALUES (?,?,?,?,?,?,?)').run(id, S.rid, base, 1000, comm, base - comm, at); };
  const istMidnight = Date.parse(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10) + 'T00:00:00Z') - 330 * 60_000;
  add('PLE1', new Date(istMidnight + 60_000).toISOString(), 20000, 2000);        // today 00:01 IST
  add('PLE2', new Date(istMidnight + 3_600_000).toISOString(), 10000, 1000);     // today 01:00 IST
  add('PLE3', new Date(istMidnight - 60_000).toISOString(), 5000, 500);          // yesterday 23:59 IST
  const d = (await call('GET', '/api/restaurant/earnings', null, S.rt)).body;
  assert.equal(d.daily.length, 14);
  assert.deepEqual([d.today.orders, d.today.sales_paise, d.today.commission_paise, d.today.payout_paise], [2, 30000, 3000, 27000]);
  assert.deepEqual([d.yesterday.orders, d.yesterday.payout_paise], [1, 4500]);
  assert.equal(d.daily.reduce((s, x) => s + x.payout_paise, 0), d.orders.reduce((s, o) => s + o.restaurant_payout_paise, 0));
});

test('admin "needs attention" lists live counts and is admin-only', async () => {
  db.prepare("INSERT INTO cashout_requests (account_type, account_id, requested_by, amount_paise, payout_method, beneficiary, status) VALUES ('restaurant', ?, 1, 5000, 'upi', 'test@okbank', 'PENDING')").run(S.rid);
  const a = (await call('GET', '/api/admin/attention', null, S.admin)).body;
  assert.ok(a.items.find((x) => x.key === 'cashouts')?.n >= 1); assert.ok(a.items.find((x) => x.key === 'no_riders')); assert.ok(a.total >= 2);
  assert.ok(a.items.every((x) => x.n > 0 && x.path && x.text));
  assert.equal((await call('GET', '/api/admin/attention', null, S.rt)).status, 403);
});
