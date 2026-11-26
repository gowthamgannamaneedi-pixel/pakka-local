// Maintenance mode: admin switch; customers cannot quote or order; tracking and the other portals keep working.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';

const W = await makeWorld('9580');
test.after(() => W.close());
const set = (s) => W.call('PUT', '/api/admin/settings', { settings: s }, W.admin);

test('off by default; on: config says so, new orders and quotes are refused with the message; existing orders still progress', async () => {
  assert.equal((await W.call('GET', '/api/public/config')).body.maintenance, null);
  const o = await W.paidOrder();
  assert.equal((await set({ maintenance_mode: '1', maintenance_message: 'Back at 6 pm' })).status, 200);
  const c = (await W.call('GET', '/api/public/config')).body; assert.deepEqual(c.maintenance, { message: 'Back at 6 pm' });
  const place = await W.call('POST', '/api/customer/orders', W.cart(), W.cust); assert.equal(place.status, 503); assert.equal(place.body.code, 'MAINTENANCE'); assert.equal(place.body.error, 'Back at 6 pm');
  const q = await W.call('POST', '/api/customer/quote', W.cart(), W.cust); assert.equal(q.status, 503);
  assert.equal((await W.call('GET', `/api/customer/orders/${o.order_code}`, null, W.cust)).status, 200, 'tracking still works');
  assert.equal((await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, W.owner)).status, 200, 'restaurants carry on');
  const att = (await W.call('GET', '/api/admin/attention', null, W.admin)).body; assert.ok(JSON.stringify(att).includes('Maintenance mode is ON'));
});

test('empty message uses the default; off again restores ordering; bad values refused', async () => {
  await set({ maintenance_message: '' });
  assert.match((await W.call('GET', '/api/public/config')).body.maintenance.message, /Ordering will be back shortly/);
  assert.equal((await set({ maintenance_mode: 'yes' })).status, 400);
  assert.equal((await set({ maintenance_message: 'x'.repeat(201) })).status, 400);
  await set({ maintenance_mode: '0' });
  assert.equal((await W.call('GET', '/api/public/config')).body.maintenance, null);
  assert.equal((await W.call('POST', '/api/customer/orders', W.cart(), W.cust)).status, 201);
});
