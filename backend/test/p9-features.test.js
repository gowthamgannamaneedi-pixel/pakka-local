// Order chat, "What should we call you?", admin username login, opening hours, order radius lookup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, PW } from './helpers/world.js';

const W = await makeWorld('9440');
test.after(() => W.close());

test('chat: only the order customer and its assigned rider; open while delivering; unread + push to the other side', async () => {
  const o = await W.paidOrder();
  const path = `/api/customer/orders/${o.order_code}/messages`;
  assert.equal((await W.call('POST', path, { body: 'hi' }, W.cust)).status, 409, 'closed until a rider is assigned');
  await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, W.owner);
  await W.call('POST', `/api/rider/orders/${o.id}/accept`, {}, W.rider);
  assert.equal((await W.call('POST', path, { body: '  Gate 2,   please  ' }, W.cust)).status, 201);
  assert.equal((await W.call('POST', path, { body: '' }, W.cust)).status, 400);
  assert.equal((await W.call('POST', path, { body: 'x'.repeat(501) }, W.cust)).status, 400);
  const other = await W.customer(W.ph(320), 'Ravi');
  assert.equal((await W.call('GET', path, null, other)).status, 404, 'another customer cannot read it');
  assert.equal((await W.call('GET', path, null, W.owner)).status, 403, 'restaurant cannot read it');
  const job = (await W.call('GET', `/api/rider/orders/${o.id}`, null, W.rider)).body;
  assert.equal(job.chat.unread, 1);
  assert.equal(W.notes(W.riderId, 'message').length, 1, 'rider is notified');
  const seen = (await W.call('GET', `/api/rider/orders/${o.id}/messages`, null, W.rider)).body;
  assert.equal(seen.messages[0].body, 'Gate 2, please'); assert.equal(seen.messages[0].mine, false); assert.equal(seen.can_send, true);
  assert.equal((await W.call('GET', `/api/rider/orders/${o.id}`, null, W.rider)).body.chat.unread, 0, 'read after opening');
  assert.equal((await W.call('POST', `/api/rider/orders/${o.id}/messages`, { body: 'On my way' }, W.rider)).status, 201);
  const v = (await W.call('GET', `/api/customer/orders/${o.order_code}`, null, W.cust)).body;
  assert.equal(v.chat.unread, 1); assert.equal(v.chat.open, true);
  const m = (await W.call('GET', path, null, W.cust)).body.messages;
  assert.equal(m[1].from, 'Delivery partner', 'rider identity not revealed before pickup');
  assert.equal(W.notes(W.custId, 'message').length, 1, 'customer is notified');
});

test('name: new customers without a name are asked; existing named customers are not', async () => {
  const t = await W.customer(W.ph(330));
  const me = (await W.call('GET', '/api/auth/me', null, t)).body.user;
  assert.equal(me.needs_name, true);
  assert.equal((await W.call('POST', '/api/auth/name', { name: ' ' }, t)).status, 400);
  assert.equal((await W.call('POST', '/api/auth/name', { name: '1234' }, t)).status, 400);
  assert.equal((await W.call('POST', '/api/auth/name', { name: 'Meera' }, t)).body.user.needs_name, false);
  assert.equal((await W.call('GET', '/api/auth/me', null, t)).body.user.name, 'Meera');
  assert.equal((await W.call('GET', '/api/auth/me', null, W.cust)).body.user.needs_name, false, 'Asha already has a name');
  W.db.prepare("UPDATE users SET name='Customer' WHERE id=?").run(W.custId);
  assert.equal((await W.call('GET', '/api/auth/me', null, W.cust)).body.user.needs_name, true, 'old placeholder name is asked once');
  W.db.prepare("UPDATE users SET name='Asha' WHERE id=?").run(W.custId);
  assert.equal((await W.call('POST', '/api/auth/name', { name: 'Hacker' }, W.rider)).status, 403, 'staff names are not changed here');
});

test('admin username: set with password, then sign in with it; other portals cannot use usernames', async () => {
  assert.equal((await W.call('POST', '/api/admin/username', { username: 'ops.lead' }, W.admin)).status, 401, 'needs current password');
  assert.equal((await W.call('POST', '/api/admin/username', { username: 'x', reauth_password: PW }, W.admin)).status, 400);
  assert.equal((await W.call('POST', '/api/admin/username', { username: 'Ops.Lead', reauth_password: PW }, W.admin)).body.username, 'ops.lead');
  const ok = await W.raw('POST', '/api/auth/login', { portal: 'admin', username: 'OPS.lead', password: PW });
  assert.equal(ok.status, 200); assert.ok(ok.body.token);
  assert.equal((await W.raw('POST', '/api/auth/login', { portal: 'admin', username: 'ops.lead', password: 'wrong-password' })).status, 401);
  assert.equal((await W.raw('POST', '/api/auth/login', { portal: 'admin', phone: W.ph(1), password: PW })).status, 200, 'mobile number still works');
  assert.equal((await W.raw('POST', '/api/auth/login', { portal: 'rider', username: 'ops.lead', password: PW })).status, 400);
  assert.equal((await W.call('POST', '/api/admin/username', { username: 'ops.lead', reauth_password: PW }, W.rider)).status, 403);
});

test('opening hours: restaurant sets them, customers see them', async () => {
  const me = (await W.call('GET', '/api/restaurant/me', null, W.owner)).body.restaurant;
  assert.equal((await W.call('PUT', '/api/restaurant/me', { name: me.name, opens_at: '25:00', closes_at: '23:00' }, W.owner)).status, 400);
  assert.equal((await W.call('PUT', '/api/restaurant/me', { name: me.name, opens_at: '10:00' }, W.owner)).status, 400, 'both or neither');
  assert.equal((await W.call('PUT', '/api/restaurant/me', { name: me.name, opens_at: '10:00', closes_at: '23:30' }, W.owner)).status, 200);
  const list = (await W.call('GET', '/api/public/restaurants')).body.restaurants.find((x) => x.id === W.rest);
  assert.equal(list.opens_at, '10:00'); assert.equal(list.closes_at, '23:30');
  assert.equal((await W.call('GET', `/api/public/restaurants/${W.rest}/menu`)).body.restaurant.closes_at, '23:30');
  assert.equal((await W.call('PUT', '/api/restaurant/me', { name: me.name }, W.owner)).status, 200);
  assert.equal((await W.call('GET', '/api/restaurant/me', null, W.owner)).body.restaurant.opens_at, '10:00', 'other edits keep the hours');
});

test('radius lookup: lists restaurants by distance with in/out of range from the admin max distance', async () => {
  W.db.prepare('UPDATE restaurants SET pickup_lat=17.4000, pickup_lng=78.5000 WHERE id=?').run(W.rest);
  W.db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('distance_max_km','5')").run();
  const near = (await W.call('POST', '/api/admin/distance-pricing/radius', { lat: 17.41, lng: 78.5 }, W.admin)).body;
  const r = near.restaurants.find((x) => x.id === W.rest);
  assert.ok(r.straight_km > 1 && r.straight_km < 1.2); assert.equal(r.within, true); assert.equal(near.max_km, 5);
  const far = (await W.call('POST', '/api/admin/distance-pricing/radius', { lat: 17.5, lng: 78.5 }, W.admin)).body.restaurants.find((x) => x.id === W.rest);
  assert.equal(far.within, false);
  assert.equal((await W.call('POST', '/api/admin/distance-pricing/radius', {}, W.admin)).status, 400);
  assert.equal((await W.call('POST', '/api/admin/distance-pricing/radius', { lat: 17.41, lng: 78.5 }, W.owner)).status, 403);
});
