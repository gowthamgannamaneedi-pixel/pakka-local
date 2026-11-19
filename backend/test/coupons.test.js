// Coupons: server-side checks, Pakka Local pays (payouts unchanged), limits safe under simultaneous orders, failed payment frees the use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';

const W = await makeWorld('9430');
test.after(() => W.close());
const mk = async (b) => W.call('POST', '/api/admin/coupons', { discount_type: 'percent', value: 1000, ...b }, W.admin);

test('admin creates coupons; input is validated; only admins can', async () => {
  assert.equal((await mk({ code: 'TEN' })).status, 201);
  assert.equal((await mk({ code: 'ten' })).status, 400, 'duplicate code (case-insensitive)');
  assert.equal((await mk({ code: 'BAD CODE' })).status, 400);
  assert.equal((await mk({ code: 'OVER', value: 20000 })).status, 400, 'more than 100%');
  assert.equal((await mk({ code: 'DATES', starts_at: '2030-01-02', ends_at: '2030-01-01' })).status, 400);
  assert.equal((await W.call('POST', '/api/admin/coupons', { code: 'HACK', discount_type: 'flat', value: 100 }, W.cust)).status, 403);
  assert.equal((await W.call('POST', '/api/admin/coupons', { code: 'HACK', discount_type: 'flat', value: 100 }, W.owner)).status, 403);
});

test('quote: discount applied by the server, capped, min order enforced, bad code explained', async () => {
  await mk({ code: 'CAP', value: 5000, max_discount_paise: 3000 });
  await mk({ code: 'BIG', discount_type: 'flat', value: 5000, min_order_paise: 100000 });
  const plain = (await W.call('POST', '/api/customer/quote', W.cart(), W.cust)).body;
  const ten = (await W.call('POST', '/api/customer/quote', W.cart({ coupon: 'ten' }), W.cust)).body;
  assert.equal(ten.discount_paise, Math.floor((plain.items_base_paise + plain.markup_paise) * 0.1));
  assert.equal(ten.total_paise, plain.total_paise - ten.discount_paise);
  assert.equal((await W.call('POST', '/api/customer/quote', W.cart({ coupon: 'CAP' }), W.cust)).body.discount_paise, 3000);
  const big = (await W.call('POST', '/api/customer/quote', W.cart({ coupon: 'BIG' }), W.cust)).body;
  assert.equal(big.discount_paise, 0); assert.match(big.coupon_error, /minimum/);
  assert.match((await W.call('POST', '/api/customer/quote', W.cart({ coupon: 'NOPE' }), W.cust)).body.coupon_error, /not valid/);
  assert.equal((await W.call('POST', '/api/customer/orders', W.cart({ coupon: 'BIG' }), W.cust)).status, 409, 'an order never silently drops a coupon');
});

test('Pakka Local pays: payment amount is discounted, restaurant and rider payouts are not', async () => {
  const plain = (await W.call('POST', '/api/customer/quote', W.cart(), W.cust)).body;
  const o = await W.paidOrder({ coupon: 'TEN' });
  assert.equal(o.discount_paise, Math.floor((plain.items_base_paise + plain.markup_paise) * 0.1)); assert.equal(o.coupon_code, 'TEN');
  assert.equal(o.total_paise, plain.total_paise - o.discount_paise);
  assert.equal(W.db.prepare('SELECT amount_paise FROM payments WHERE order_id=?').pluck().get(o.id), o.total_paise);
  const ref = W.db.prepare("SELECT restaurant_payout_paise, rider_payout_paise FROM orders WHERE coupon_code IS NULL ORDER BY id DESC LIMIT 1").get();
  const any = await W.paidOrder();
  const p = W.db.prepare('SELECT restaurant_payout_paise, rider_payout_paise FROM orders WHERE id=?').get(any.id);
  assert.deepEqual({ r: o.restaurant_payout_paise, d: o.rider_payout_paise }, { r: p.restaurant_payout_paise, d: p.rider_payout_paise }); void ref;
  assert.equal(W.db.prepare("SELECT status FROM coupon_redemptions WHERE order_id=?").pluck().get(o.id), 'used');
  assert.equal((await W.call('POST', '/api/customer/quote', W.cart({ coupon: 'TEN' }), W.cust)).body.coupon_error, 'You have already used this coupon.');
  const list = (await W.call('GET', '/api/admin/coupons', null, W.admin)).body.coupons.find((c) => c.code === 'TEN');
  assert.equal(list.uses, 1); assert.equal(list.discount_given_paise, o.discount_paise);
});

test('failed payment frees the use; last use cannot be taken twice at the same moment', async () => {
  await mk({ code: 'ONCE', max_uses: 1 });
  const r = await W.call('POST', '/api/customer/orders', W.cart({ coupon: 'ONCE' }), W.cust);
  assert.equal(r.status, 201);
  assert.match((await W.call('POST', '/api/customer/quote', W.cart({ coupon: 'ONCE' }), await W.customer(W.ph(310), 'B'))).body.coupon_error, /fully used/, 'reserved while paying');
  await W.call('POST', `/api/customer/payments/sandbox/${r.body.order_code}/complete`, { outcome: 'failed' }, W.cust);
  assert.equal(W.db.prepare("SELECT status FROM coupon_redemptions WHERE order_id=(SELECT id FROM orders WHERE order_code=?)").pluck().get(r.body.order_code), 'released');
  const [a, b] = [await W.customer(W.ph(311), 'C'), await W.customer(W.ph(312), 'D')];
  const res = await Promise.all([W.call('POST', '/api/customer/orders', W.cart({ coupon: 'ONCE' }), a), W.call('POST', '/api/customer/orders', W.cart({ coupon: 'ONCE' }), b)]);
  assert.deepEqual(res.map((x) => x.status).sort(), [201, 409]);
});

test('admin can disable, edit and delete; customers see only usable offers', async () => {
  const id = (await W.call('GET', '/api/admin/coupons', null, W.admin)).body.coupons.find((c) => c.code === 'CAP').id;
  const vis = async () => (await W.call('GET', `/api/customer/coupons?restaurant_id=${W.rest}`, null, W.cust)).body.coupons.map((c) => c.code);
  assert.ok((await vis()).includes('CAP')); assert.ok(!(await vis()).includes('TEN'), 'already used by this customer');
  assert.equal((await W.call('PUT', `/api/admin/coupons/${id}`, { code: 'CAP', discount_type: 'percent', value: 5000, active: false }, W.admin)).status, 200);
  assert.ok(!(await vis()).includes('CAP'));
  assert.equal((await W.call('DELETE', `/api/admin/coupons/${id}`, null, W.admin)).status, 200);
  assert.equal((await mk({ code: 'CAP' })).status, 201, 'code can be reused after delete');
});
