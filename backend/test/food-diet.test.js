// Optional diet mark per dish (veg / nonveg / egg): set by the restaurant, shown to customers, NULL by default. Display only.
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const call = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PW = 'correct-horse-battery', hash = bcrypt.hashSync(PW, 4);
const staff = async (portal, phone) => (await call('POST', '/api/auth/login', { portal, phone, password: PW })).body.token;

test('dish diet mark: optional, validated, editable, visible on the public menu', async () => {
  db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run('admin', '+919700000001', 'Admin', hash);
  const adm = await staff('admin', '+919700000001');
  const rid = (await call('POST', '/api/admin/restaurants', { name: 'Diet Test', commission_bps: 1000, markup_paise: 0, admin_visible: true, approved: true }, adm)).body.id;
  assert.equal((await call('POST', '/api/admin/users', { role: 'restaurant', name: 'Owner', phone: '+919700000101', password: PW, restaurant_id: rid }, adm)).status, 201);
  const own = await staff('restaurant', '+919700000101');
  const dish = (b) => call('POST', '/api/restaurant/menu', { base_price_paise: 10000, prep_time_min: 10, image: PNG, ...b }, own);
  const a = await dish({ name: 'Paneer roll', diet: 'veg' }), b = await dish({ name: 'Plain rice' }), c = await dish({ name: 'Egg roll', diet: 'egg' });
  assert.deepEqual([a.status, b.status, c.status], [201, 201, 201]);
  assert.equal((await dish({ name: 'Bad', diet: 'vegan' })).status, 400, 'only veg / nonveg / egg are accepted');
  const pub = async () => Object.fromEntries((await call('GET', `/api/public/restaurants/${rid}/menu`)).body.items.map((i) => [i.name, i.diet]));
  assert.deepEqual(await pub(), { 'Paneer roll': 'veg', 'Plain rice': null, 'Egg roll': 'egg' });
  assert.equal((await call('PUT', `/api/restaurant/menu/${b.body.id}`, { name: 'Plain rice', diet: 'veg' }, own)).status, 200);
  assert.equal((await call('PUT', `/api/restaurant/menu/${a.body.id}`, { name: 'Paneer roll', available: false }, own)).status, 200);
  const m = await pub(); assert.equal(m['Plain rice'], 'veg'); assert.equal(m['Paneer roll'], 'veg', 'other edits keep the mark');
  assert.equal((await call('PUT', `/api/restaurant/menu/${c.body.id}`, { name: 'Egg roll', diet: null }, own)).status, 200);
  assert.equal((await pub())['Egg roll'], null, 'the mark can be cleared');
});
