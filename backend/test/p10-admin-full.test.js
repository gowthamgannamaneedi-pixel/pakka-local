// Admin full control: restaurant hours + open/close, order steps on a restaurant's behalf, edit/block customers and riders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';

const W = await makeWorld('9480');
test.after(() => W.close());
const week = (open, close) => [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, closed: dow === 1, open, close }));
const audited = (action, id) => !!W.db.prepare('SELECT 1 FROM audit_logs WHERE action=? AND target_id=?').get(action, String(id));

test('admin sets any restaurant\'s weekly hours and opens / closes it (temporary closure reopens by itself); owners and customers cannot use this', async () => {
  const id = W.rest;
  const h = await W.call('PUT', `/api/admin/restaurants/${id}/hours`, { days: week('09:00', '21:00') }, W.admin); assert.equal(h.status, 200); assert.equal(h.body.days[1].closed, true);
  assert.equal((await W.call('PUT', `/api/admin/restaurants/${id}/hours`, { days: week('09:00', '09:00') }, W.admin)).status, 400, 'validated the same way');
  assert.ok(audited('restaurant.hours', id));
  const g = (await W.call('GET', `/api/admin/restaurants/${id}/hours`, null, W.admin)).body; assert.equal(g.days[2].open, '09:00'); assert.ok('availability' in g);
  const c = await W.call('POST', `/api/admin/restaurants/${id}/status`, { open: false, mode: 'auto', days: 1 }, W.admin); assert.equal(c.status, 200); assert.equal(c.body.status.is_open, 0); assert.ok(c.body.status.reopen_at);
  assert.ok(audited('restaurant.close', id));
  assert.equal((await W.call('POST', `/api/admin/restaurants/${id}/status`, { open: true }, W.admin)).body.status.is_open, 1);
  assert.equal((await W.call('POST', '/api/admin/restaurants/99999/status', { open: true }, W.admin)).status, 404);
  assert.equal((await W.call('POST', `/api/admin/restaurants/${id}/status`, { open: true }, W.owner)).status, 403);
  assert.equal((await W.call('PUT', `/api/admin/restaurants/${id}/hours`, { days: week('09:00', '21:00') }, W.cust)).status, 403);
  // no location: admin cannot switch it on either
  const nr = (await W.call('POST', '/api/admin/restaurants', { name: 'No Pin', commission_bps: 1000, markup_paise: 0, admin_visible: true, approved: true }, W.admin)).body.id;
  assert.equal((await W.call('POST', `/api/admin/restaurants/${nr}/status`, { open: true }, W.admin)).body.code, 'LOCATION_REQUIRED');
  await W.call('PUT', `/api/admin/restaurants/${id}/hours`, { days: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, closed: false, open: '00:00', close: '23:59' })) }, W.admin);
});

test('admin can accept / prepare / ready / reject for a restaurant; same rules, recorded as admin', async () => {
  const o = await W.paidOrder();
  assert.equal((await W.call('POST', `/api/admin/orders/${o.id}/restaurant/ready`, {}, W.admin)).status, 409, 'cannot skip accepting');
  assert.equal((await W.call('POST', `/api/admin/orders/${o.id}/restaurant/accept`, {}, W.admin)).status, 200);
  assert.equal((await W.call('POST', `/api/admin/orders/${o.id}/restaurant/accept`, {}, W.admin)).status, 409, 'not twice');
  assert.equal((await W.call('POST', `/api/admin/orders/${o.id}/restaurant/preparing`, {}, W.admin)).status, 200);
  assert.equal((await W.call('POST', `/api/admin/orders/${o.id}/restaurant/ready`, {}, W.admin)).status, 200);
  assert.equal(W.db.prepare('SELECT status FROM orders WHERE id=?').pluck().get(o.id), 'READY');
  assert.equal(W.db.prepare("SELECT actor_role FROM order_events WHERE order_id=? AND event_type='FOOD_READY'").pluck().get(o.id), 'admin');
  assert.ok(audited('order.restaurant_ready', o.id));
  assert.equal((await W.call('POST', `/api/admin/orders/${o.id}/restaurant/ready`, {}, W.owner)).status, 403, 'restaurant uses its own portal');
  const o2 = await W.paidOrder();
  assert.equal((await W.call('POST', `/api/admin/orders/${o2.id}/restaurant/reject`, {}, W.admin)).status, 400, 'reason required');
  assert.equal((await W.call('POST', `/api/admin/orders/${o2.id}/restaurant/reject`, { reason: 'Items unavailable' }, W.admin)).status, 200);
  assert.equal(W.db.prepare('SELECT status FROM orders WHERE id=?').pluck().get(o2.id), 'REJECTED');
  assert.equal((await W.call('POST', '/api/admin/orders/999999/restaurant/accept', {}, W.admin)).status, 404);
});

test('admin edits a customer\'s / rider\'s name and mobile, blocks and unblocks; mobile change signs them out; audited', async () => {
  const before = W.db.prepare('SELECT token_version FROM users WHERE id=?').pluck().get(W.custId);
  assert.equal((await W.call('PUT', `/api/admin/users/${W.custId}`, { name: 'Asha K', phone: '9876' }, W.admin)).status, 400, 'format checked');
  await W.customer(W.ph(390), 'Other customer');
  assert.equal((await W.call('PUT', `/api/admin/users/${W.custId}`, { name: 'Asha K', phone: W.ph(390) }, W.admin)).status, 409, 'number already used by another customer');
  assert.equal((await W.call('PUT', `/api/admin/users/${W.custId}`, { name: 'Asha K', phone: W.ph(301) }, W.admin)).status, 200, 'name only');
  assert.equal(W.db.prepare('SELECT token_version FROM users WHERE id=?').pluck().get(W.custId), before, 'name change keeps them signed in');
  assert.equal((await W.call('PUT', `/api/admin/users/${W.custId}`, { name: 'Asha K', phone: W.ph(399) }, W.admin)).status, 200);
  const u = W.db.prepare('SELECT name, phone, token_version FROM users WHERE id=?').get(W.custId); assert.deepEqual([u.name, u.phone], ['Asha K', W.ph(399)]); assert.equal(u.token_version, before + 1);
  assert.equal((await W.call('GET', '/api/customer/me', null, W.cust)).status, 401, 'old session ends after a number change');
  assert.ok(audited('user.update', W.custId));
  assert.equal((await W.call('PUT', `/api/admin/users/${W.riderId}`, { name: 'Rahul S', phone: W.ph(201) }, W.admin)).status, 200);
  assert.equal(W.db.prepare('SELECT name FROM users WHERE id=?').pluck().get(W.riderId), 'Rahul S');
  assert.equal((await W.call('POST', `/api/admin/users/${W.riderId}/active`, { active: false }, W.admin)).status, 200);
  assert.equal(W.db.prepare('SELECT active FROM users WHERE id=?').pluck().get(W.riderId), 0);
  await W.call('POST', `/api/admin/users/${W.riderId}/active`, { active: true }, W.admin);
  assert.equal((await W.call('PUT', `/api/admin/users/${W.custId}`, { name: 'x', phone: W.ph(399) }, W.owner)).status, 403);
  const otherAdmin = W.db.prepare("INSERT INTO users (role,phone,name) VALUES ('admin',?, 'Other')").run(W.ph(2)).lastInsertRowid;
  assert.equal((await W.call('PUT', `/api/admin/users/${otherAdmin}`, { name: 'Hacked', phone: W.ph(2) }, W.admin)).status, 403, 'other admins are not editable');
});
