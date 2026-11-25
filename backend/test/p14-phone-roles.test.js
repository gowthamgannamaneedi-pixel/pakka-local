// One mobile number may be a customer and also a restaurant login / delivery agent (one account of each kind).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';

const W = await makeWorld('9550');
test.after(() => W.close());
const PW = 'demo-pass-12345';
const login = (portal, phone) => W.call('POST', '/api/auth/login', { portal, phone, password: PW });

test('a customer number can also get a rider and a restaurant login; each portal signs in to its own account', async () => {
  const phone = W.ph(501); const cust = await W.customer(phone, 'Kiran');
  const rider = await W.call('POST', '/api/admin/users', { role: 'rider', name: 'Kiran Rider', phone, password: PW }, W.admin);
  assert.equal(rider.status, 201, JSON.stringify(rider.body));
  const owner = await W.call('POST', '/api/admin/users', { role: 'restaurant', name: 'Kiran Owner', phone, password: PW, restaurant_id: W.rest }, W.admin);
  assert.equal(owner.status, 201, JSON.stringify(owner.body));
  const ids = W.db.prepare('SELECT role, id FROM users WHERE phone=? ORDER BY role').all(phone);
  assert.deepEqual(ids.map((x) => x.role), ['customer', 'restaurant', 'rider']);
  const r = await login('rider', phone), o = await login('restaurant', phone);
  assert.equal(r.status, 200); assert.equal(r.body.user.role, 'rider'); assert.equal(r.body.user.id, ids.find((x) => x.role === 'rider').id);
  assert.equal(o.status, 200); assert.equal(o.body.user.role, 'restaurant');
  assert.equal((await login('admin', phone)).status, 401, 'no admin account for this number');
  const me = await W.call('GET', '/api/customer/me', null, cust);       // the customer session keeps working and is the customer account
  assert.equal(me.status, 200); assert.equal(me.body.user.id, ids.find((x) => x.role === 'customer').id);
});

test('still only one account of each kind per number', async () => {
  const phone = W.ph(502);
  assert.equal((await W.call('POST', '/api/admin/users', { role: 'rider', name: 'A', phone, password: PW }, W.admin)).status, 201);
  const dup = await W.call('POST', '/api/admin/users', { role: 'rider', name: 'B', phone, password: PW }, W.admin);
  assert.equal(dup.status, 409); assert.match(dup.body.error, /delivery-agent/);
  assert.equal(W.db.prepare("SELECT COUNT(*) FROM users WHERE phone=? AND role='rider'").pluck().get(phone), 1);
  const c = await W.customer(phone, 'Ravi');                          // a rider's number can now also order food as a customer
  assert.equal((await W.call('GET', '/api/customer/me', null, c)).status, 200);
  assert.equal(W.db.prepare("SELECT COUNT(*) FROM users WHERE phone=? AND role='customer'").pluck().get(phone), 1);
  assert.deepEqual(W.db.pragma('foreign_key_check'), []);
});
