// Manual UPI refunds: started by the system only, customer adds UPI, admin approves -> pays (UTR, fresh password) -> completed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, PW } from './helpers/world.js';

const W = await makeWorld('9420');
test.after(() => W.close());
let o, rid;

test('restaurant rejects: refund starts, customer is asked for a UPI ID', async () => {
  o = await W.paidOrder();
  assert.equal((await W.call('POST', `/api/restaurant/orders/${o.id}/reject`, { reason: 'Items unavailable' }, W.owner)).status, 200);
  const v = (await W.call('GET', `/api/customer/orders/${o.order_code}`, null, W.cust)).body;
  assert.equal(v.refund_detail.stage, 'awaiting_details'); assert.equal(v.refund_detail.amount_paise, o.total_paise); assert.equal(v.refund_detail.can_edit, true);
  rid = v.refund_detail.id;
  assert.equal(W.notes(W.custId, 'refund').length, 1);
});

test('customer UPI: validated, only for own order, can be corrected before approval', async () => {
  assert.equal((await W.call('POST', `/api/customer/orders/${o.order_code}/refund-upi`, { upi_id: 'not a upi' }, W.cust)).status, 400);
  const other = await W.customer(W.ph(302), 'Other');
  assert.equal((await W.call('POST', `/api/customer/orders/${o.order_code}/refund-upi`, { upi_id: 'x@okaxis' }, other)).status, 404, 'someone else cannot add a UPI ID');
  assert.equal((await W.call('POST', `/api/customer/orders/${o.order_code}/refund-upi`, { upi_id: 'asha@oksbi' }, W.cust)).status, 200);
  const r = await W.call('POST', `/api/customer/orders/${o.order_code}/refund-upi`, { upi_id: 'asha.k@okaxis', upi_name: 'Asha K' }, W.cust);
  assert.equal(r.body.refund.stage, 'requested'); assert.equal(r.body.refund.upi_id, 'asha.k@okaxis');
});

test('admin: sees the full UPI ID; customers and restaurants cannot see refunds', async () => {
  const list = (await W.call('GET', '/api/admin/refunds', null, W.admin)).body.refunds;
  const f = list.find((x) => x.id === rid); assert.equal(f.upi_id, 'asha.k@okaxis'); assert.equal(f.stage, 'requested');
  assert.equal((await W.call('GET', '/api/admin/refunds', null, W.cust)).status, 403);
  assert.equal((await W.call('GET', '/api/admin/refunds', null, W.owner)).status, 403);
});

test('admin workflow: cannot pay before approval; pay needs password + UTR; no double payment; customer told', async () => {
  assert.equal((await W.call('POST', `/api/admin/refunds/${rid}/paid`, { utr: 'UTR123456', reauth_password: PW }, W.admin)).status, 409, 'approve first');
  assert.equal((await W.call('POST', `/api/admin/refunds/${rid}/approve`, {}, W.admin)).status, 200);
  assert.equal((await W.call('POST', `/api/customer/orders/${o.order_code}/refund-upi`, { upi_id: 'late@oksbi' }, W.cust)).status, 409, 'locked after approval');
  assert.equal((await W.call('POST', `/api/admin/refunds/${rid}/paid`, { utr: 'UTR123456' }, W.admin)).status, 401, 'fresh password needed');
  assert.equal((await W.call('POST', `/api/admin/refunds/${rid}/paid`, { utr: '12', reauth_password: PW }, W.admin)).status, 400);
  assert.equal((await W.call('POST', `/api/admin/refunds/${rid}/paid`, { utr: 'UTR123456', reauth_password: PW }, W.admin)).status, 200);
  assert.equal((await W.call('POST', `/api/admin/refunds/${rid}/paid`, { utr: 'UTR123456', reauth_password: PW }, W.admin)).status, 409, 'not paid twice');
  const v = (await W.call('GET', `/api/customer/orders/${o.order_code}`, null, W.cust)).body;
  assert.equal(v.refund_detail.stage, 'completed'); assert.equal(v.refund_detail.reference, 'UTR123456'); assert.equal(v.refund, 'REFUND_COMPLETED');
  assert.deepEqual(v.refund_detail.history.map((h) => h.stage), ['awaiting_details', 'requested', 'approved', 'completed']);
  assert.ok(W.notes(W.custId, 'Refund paid').length === 1);
});

test('failed payment goes back to the customer to fix; reject needs a reason', async () => {
  const o2 = await W.paidOrder();
  await W.call('POST', `/api/restaurant/orders/${o2.id}/reject`, { reason: 'Restaurant too busy' }, W.owner);
  await W.call('POST', `/api/customer/orders/${o2.order_code}/refund-upi`, { upi_id: 'asha@ybl' }, W.cust);
  const id2 = W.db.prepare('SELECT id FROM refunds WHERE order_id=?').pluck().get(o2.id);
  assert.equal((await W.call('POST', `/api/admin/refunds/${id2}/reject`, {}, W.admin)).status, 400);
  await W.call('POST', `/api/admin/refunds/${id2}/approve`, {}, W.admin);
  assert.equal((await W.call('POST', `/api/admin/refunds/${id2}/failed`, { note: 'UPI ID does not exist' }, W.admin)).status, 200);
  assert.equal((await W.call('POST', `/api/customer/orders/${o2.order_code}/refund-upi`, { upi_id: 'asha@okhdfcbank' }, W.cust)).body.refund.stage, 'requested');
  assert.equal((await W.call('POST', `/api/admin/refunds/${id2}/paid`, { utr: 'UTR123456', reauth_password: PW }, W.admin)).status, 409);
});
