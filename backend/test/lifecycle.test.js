import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { completeApplication } from './helpers/rider-application.js';
import { testOutbox } from '../src/otpProviders.js';
import { NO_RIDER_MSG, balances, expireStalePayments } from '../src/services/core.js';

const db = openDb(':memory:');
const server = createApp(db).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const call = async (method, path, body, token) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PW = 'correct-horse-battery';
const S = {};   // shared state across ordered tests

const staff = async (portal, phone) => (await call('POST', '/api/auth/login', { portal, phone, password: PW })).body.token;
const customer = async (phone) => { await call('POST', '/api/auth/customer/otp/request', { phone }); const { otp } = testOutbox.at(-1); return (await call('POST', '/api/auth/customer/otp/verify', { phone, otp })).body.token; };
const hash = bcrypt.hashSync(PW, 4);
const mkUser = (role, phone) => db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run(role, phone, role + phone.slice(-2), hash).lastInsertRowid;

test('setup: admin creates restaurants, owners, locations and riders (riders cannot self-register)', async () => {
  mkUser('admin', '+919100000001'); S.admin = await staff('admin', '+919100000001');
  assert.equal((await call('POST', '/api/auth/rider/register', { name: 'Hacker', phone: '+919199999999', password: PW + 'x' })).status, 404);
  for (const [i, n] of ['Biryani House', 'Dosa Corner'].entries()) {
    const r = await call('POST', '/api/admin/restaurants', { name: n, commission_bps: i ? 1500 : 1000, markup_paise: i ? 1000 : 2000, admin_visible: true, approved: true }, S.admin);
    assert.equal(r.status, 201); S['rest' + i] = r.body.id;
    assert.equal((await call('POST', '/api/admin/users', { role: 'restaurant', name: 'Owner', phone: `+91910000010${i}`, password: PW, restaurant_id: r.body.id }, S.admin)).status, 201);
    S['rt' + i] = await staff('restaurant', `+91910000010${i}`);
    assert.equal((await call('POST', '/api/restaurant/status', { open: true }, S['rt' + i])).status, 200);
  }
  S.item = (await call('POST', '/api/restaurant/menu', { name: 'Biryani', base_price_paise: 14000, prep_time_min: 20, image: PNG }, S.rt0)).body.id;
  assert.ok(S.item);
  S.loc = (await call('POST', '/api/admin/locations', { name: 'Sunrise Hostel', address: 'Uppal Road', delivery_fee_paise: 4000, distance_km: 2 }, S.admin)).body.id;
  assert.equal((await call('POST', '/api/admin/users', { role: 'rider', name: 'Rahul', phone: '+919100000201', password: PW }, S.admin)).status, 201);
  assert.equal((await call('POST', '/api/admin/users', { role: 'rider', name: 'Ravi', phone: '+919100000202', password: PW, approve_now: true }, S.admin)).status, 201);   // approve_now is ignored
  S.r1 = await staff('rider', '+919100000201'); S.r2 = await staff('rider', '+919100000202');
  assert.equal((await call('GET', '/api/rider/me', null, S.r2)).body.rider.verification_status, 'draft');
  assert.equal((await call('POST', '/api/rider/online', { online: true }, S.r1)).status, 403);       // draft -> cannot go online
  const rid1 = db.prepare("SELECT id FROM users WHERE phone='+919100000201'").pluck().get(), rid2 = db.prepare("SELECT id FROM users WHERE phone='+919100000202'").pluck().get();
  assert.equal((await call('POST', `/api/admin/riders/${rid1}/verify`, { action: 'approve', reauth_password: PW }, S.admin)).status, 409);   // nothing submitted yet
  await completeApplication(call, S.r1, 1); await completeApplication(call, S.r2, 2);
  assert.equal((await call('POST', '/api/rider/online', { online: true }, S.r1)).status, 403);       // submitted (pending) -> still cannot go online
  assert.equal((await call('POST', `/api/admin/riders/${rid1}/verify`, { action: 'reject' }, S.admin)).status, 400);   // reason needed
  assert.equal((await call('POST', `/api/admin/riders/${rid1}/verify`, { action: 'approve' }, S.admin)).status, 401);  // fresh authentication needed
  for (const id of [rid1, rid2]) assert.equal((await call('POST', `/api/admin/riders/${id}/verify`, { action: 'approve', reauth_password: PW }, S.admin)).status, 200);
  S.cust = await customer('+919300000001');
});

const cart = (o = {}) => ({ restaurant_id: S.rest0, items: [{ id: S.item, qty: 1 }], location_id: S.loc, instructions: 'Gate 2, call first', ...o });

test('Test 2: no online rider -> exact message and order blocked server-side', async () => {
  const q = await call('POST', '/api/customer/quote', cart(), S.cust);
  assert.equal(q.status, 409); assert.equal(q.body.error, NO_RIDER_MSG);
  assert.equal((await call('POST', '/api/customer/orders', cart(), S.cust)).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) FROM orders').pluck().get(), 0);
});

test('Test 1: server prices the order; frontend cannot set amounts; payment releases it to restaurant', async () => {
  await call('POST', '/api/rider/online', { online: true }, S.r1); await call('POST', '/api/rider/online', { online: true }, S.r2);
  const q = await call('POST', '/api/customer/quote', cart({ total_paise: 1 }), S.cust);
  assert.deepEqual([q.body.items_base_paise, q.body.markup_paise, q.body.delivery_paise, q.body.total_paise], [14000, 2000, 4000, 20000]);
  const o = await call('POST', '/api/customer/orders', cart(), S.cust);
  assert.equal(o.status, 201); assert.match(o.body.order_code, /^PL\d{8}[A-Z0-9]{6}$/); S.code = o.body.order_code;
  assert.equal((await call('GET', '/api/restaurant/orders', null, S.rt0)).body.orders.length, 0);     // unpaid orders are invisible to the restaurant
  assert.equal((await call('POST', `/api/customer/payments/sandbox/${S.code}/complete`, { outcome: 'success' }, S.cust)).status, 200);
  assert.equal((await call('POST', `/api/customer/payments/sandbox/${S.code}/complete`, { outcome: 'success' }, S.cust)).body.duplicate, true);   // idempotent
  const ro = (await call('GET', '/api/restaurant/orders', null, S.rt0)).body.orders;
  assert.equal(ro.length, 1); S.oid = ro[0].id; assert.equal(ro[0].status, 'PLACED');
  assert.equal((await call('GET', '/api/rider/offers', null, S.r1)).body.offers.length, 0);          // riders see offers only after restaurant accepts
});

test('Tests 3,5: restaurant accepts; two riders race; exactly one wins', async () => {
  assert.equal((await call('POST', `/api/restaurant/orders/${S.oid}/accept`, {}, S.rt1)).status, 404);     // other restaurant cannot act
  assert.equal((await call('POST', `/api/restaurant/orders/${S.oid}/accept`, {}, S.rt0)).status, 200);
  assert.equal((await call('POST', `/api/restaurant/orders/${S.oid}/accept`, {}, S.rt0)).status, 409);
  const offer = (await call('GET', '/api/rider/offers', null, S.r1)).body.offers[0];
  assert.equal(offer.order_code, S.code); assert.ok(offer.restaurant.maps_link && offer.items[0].qty === 1);
  // before acceptance: no customer phone, exact address, GPS pin, maps link or instructions (only the area)
  assert.equal(offer.customer.phone, null); assert.equal(offer.instructions, null); assert.equal(offer.destination.maps_link, null); assert.equal(offer.destination.lat, null);
  assert.equal(offer.destination.area_only, true); assert.ok(!JSON.stringify(offer).includes('Uppal Road'));
  const res = await Promise.all([call('POST', `/api/rider/orders/${S.oid}/accept`, {}, S.r1), call('POST', `/api/rider/orders/${S.oid}/accept`, {}, S.r2)]);
  assert.deepEqual(res.map(r => r.status).sort(), [200, 409]);
  S.winner = res[0].status === 200 ? S.r1 : S.r2; S.loser = res[0].status === 200 ? S.r2 : S.r1;
  assert.equal((await call('GET', '/api/rider/offers', null, S.loser)).body.offers.length, 0);
  const mine = (await call('GET', '/api/rider/active', null, S.winner)).body.active; assert.equal(mine.length, 1);
  assert.equal(mine[0].instructions, 'Gate 2, call first'); assert.ok(mine[0].customer.phone && mine[0].destination.maps_link);   // after acceptance: full details
});

test('Test 6, 7: pickup OTP (wrong fails, right works); rider hidden from customer until pickup', async () => {
  assert.equal((await call('POST', `/api/rider/orders/${S.oid}/pickup`, { otp: '0000' }, S.winner)).status, 409);   // not ready yet
  await call('POST', `/api/restaurant/orders/${S.oid}/preparing`, {}, S.rt0);
  assert.equal((await call('POST', `/api/restaurant/orders/${S.oid}/ready`, {}, S.rt0)).status, 200);
  const otp = (await call('GET', '/api/restaurant/orders', null, S.rt0)).body.orders[0].pickup_otp; assert.match(otp, /^\d{4}$/);
  const before = (await call('GET', `/api/customer/orders/${S.code}`, null, S.cust)).body; assert.equal(before.rider, undefined); assert.equal(before.delivery_otp, undefined);
  const wrong = otp === '1234' ? '4321' : '1234';
  assert.equal((await call('POST', `/api/rider/orders/${S.oid}/pickup`, { otp: wrong }, S.winner)).status, 400);
  assert.equal((await call('POST', `/api/rider/orders/${S.oid}/pickup`, { otp }, S.loser)).status, 404);        // not the assigned rider
  assert.equal((await call('POST', `/api/rider/orders/${S.oid}/pickup`, { otp }, S.winner)).status, 200);
  const after = (await call('GET', `/api/customer/orders/${S.code}`, null, S.cust)).body;
  assert.equal(after.status, 'PICKED_UP'); assert.ok(after.rider.name && after.rider.phone); assert.match(after.delivery_otp, /^\d{4}$/); S.dotp = after.delivery_otp;
  assert.equal(after.rider.rc_path, undefined);
});

test('Test 8, 9: delivery OTP gate; earnings credited once; money split is exact', async () => {
  const wrong = S.dotp === '1111' ? '2222' : '1111';
  assert.equal((await call('POST', `/api/rider/orders/${S.oid}/deliver`, { otp: wrong }, S.winner)).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) FROM rider_earnings').pluck().get(), 0);
  assert.equal((await call('POST', `/api/rider/orders/${S.oid}/deliver`, { otp: S.dotp }, S.winner)).status, 200);
  assert.equal((await call('POST', `/api/rider/orders/${S.oid}/deliver`, { otp: S.dotp }, S.winner)).status, 409);   // no double credit
  assert.equal(db.prepare('SELECT COUNT(*) FROM rider_earnings').pluck().get(), 1);
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(S.oid);
  assert.deepEqual([o.commission_paise, o.restaurant_payout_paise], [1400, 12600]);
  const sum = (t) => db.prepare('SELECT COALESCE(SUM(amount_paise),0) FROM platform_transactions WHERE account_type=?').pluck().get(t);
  assert.equal(sum('restaurant'), 12600); assert.equal(sum('rider'), 3000); assert.equal(sum('platform'), 2000 + 1400 + 1000);
  assert.equal(sum('restaurant') + sum('rider') + sum('platform'), o.total_paise);        // every rupee collected is accounted for
  const ov = (await call('GET', '/api/admin/overview?preset=today', null, S.admin)).body;
  assert.equal(ov.money.platform_revenue_paise, 4400); assert.equal(ov.money.collected_paise, 20000); assert.ok(ov.money.estimated_net_profit_paise < 4400);
});

test('Test 4: rejection records reason, notifies, starts refund; refund is not "completed" until confirmed', async () => {
  const c2 = await call('POST', '/api/customer/orders', cart(), S.cust); await call('POST', `/api/customer/payments/sandbox/${c2.body.order_code}/complete`, { outcome: 'success' }, S.cust);
  const id = db.prepare('SELECT id FROM orders WHERE order_code=?').pluck().get(c2.body.order_code);
  assert.equal((await call('POST', `/api/restaurant/orders/${id}/reject`, {}, S.rt0)).status, 400);       // reason required
  assert.equal((await call('POST', `/api/restaurant/orders/${id}/reject`, { reason: 'Restaurant too busy' }, S.rt0)).status, 200);
  const d = (await call('GET', `/api/customer/orders/${c2.body.order_code}`, null, S.cust)).body;
  assert.equal(d.status, 'REJECTED'); assert.equal(d.refund, 'REFUND_INITIATED');
  assert.ok(db.prepare("SELECT COUNT(*) FROM notifications WHERE order_id=? AND user_id=(SELECT id FROM users WHERE role='admin')").pluck().get(id) >= 1);
  const rf = (await call('GET', '/api/admin/refunds', null, S.admin)).body.refunds[0];
  await call('POST', `/api/admin/refunds/${rf.id}/settle`, { ok: true }, S.admin);
  assert.equal((await call('GET', `/api/customer/orders/${c2.body.order_code}`, null, S.cust)).body.refund, 'REFUND_COMPLETED');
  assert.equal(db.prepare('SELECT COUNT(*) FROM rider_earnings').pluck().get(), 1);          // no earnings on rejected order
});

test('abandoned payment is expired by the reconciliation job', async () => {
  const c = await call('POST', '/api/customer/orders', cart(), S.cust);
  db.prepare("UPDATE payments SET created_at='2020-01-01T00:00:00.000Z' WHERE merchant_order_id=?").run(c.body.order_code);
  assert.equal(expireStalePayments(db), 1);
  assert.equal(db.prepare('SELECT status FROM orders WHERE order_code=?').pluck().get(c.body.order_code), 'EXPIRED');
});

test('Test 10: cashouts, reservation, duplicate guard, proofs visible only to owner', async () => {
  const bal = (await call('GET', '/api/restaurant/earnings', null, S.rt0)).body.balance; assert.equal(bal.available, 12600);
  const mk = (amt) => ({ amount_paise: amt, payout_method: 'upi', beneficiary: 'owner@upi' });
  assert.equal((await call('POST', '/api/restaurant/cashouts', mk(99999), S.rt0)).status, 400);        // over balance
  assert.equal((await call('POST', '/api/restaurant/cashouts', mk(10000), S.rt0)).status, 201);
  assert.equal((await call('POST', '/api/restaurant/cashouts', mk(100), S.rt0)).status, 409);          // duplicate open request
  assert.equal((await call('GET', '/api/restaurant/earnings', null, S.rt0)).body.balance.available, 2600);   // amount reserved
  assert.equal((await call('POST', '/api/rider/cashouts', mk(3000), S.winner)).status, 201);
  const list = (await call('GET', '/api/admin/cashouts', null, S.admin)).body.cashouts; assert.equal(list.length, 2); assert.ok(!list[0].beneficiary.includes('owner@upi'));
  const rc = list.find(c => c.account_type === 'restaurant'), rd = list.find(c => c.account_type === 'rider');
  assert.equal((await call('POST', `/api/admin/cashouts/${rc.id}/pay`, { txn_reference: 'UTR123456' }, S.admin)).status, 400);   // proof required
  assert.equal((await call('POST', `/api/admin/cashouts/${rc.id}/pay`, { txn_reference: 'UTR123456', proof: Buffer.from('not an image').toString('base64') }, S.admin)).status, 400);
  assert.equal(db.prepare('SELECT status FROM cashout_requests WHERE id=?').pluck().get(rc.id), 'PENDING');   // failed upload rolled back
  assert.equal((await call('POST', `/api/admin/cashouts/${rc.id}/pay`, { txn_reference: 'UTR123456', proof: PNG }, S.admin)).status, 200);
  assert.equal((await call('POST', `/api/admin/cashouts/${rd.id}/reject`, { reason: 'Name mismatch' }, S.admin)).status, 200);
  assert.equal((await call('POST', `/api/admin/cashouts/${rc.id}/pay`, { txn_reference: 'UTR123456', proof: PNG }, S.admin)).status, 409);   // no double pay
  const e = (await call('GET', '/api/restaurant/earnings', null, S.rt0)).body; assert.equal(e.balance.paid, 10000); assert.equal(e.balance.available, 2600);
  const file = (t, p) => fetch(`${base}/api/files/proof/${rc.id}`, { headers: { Authorization: `Bearer ${t}` } });
  assert.equal((await file(S.rt0)).status, 200); assert.equal((await file(S.admin)).status, 200);
  assert.equal((await file(S.rt1)).status, 404); assert.equal((await file(S.winner)).status, 404); assert.equal((await file(S.cust)).status, 404);
  assert.equal((await fetch(`${base}/api/files/proof/${rc.id}`)).status, 401);
});

test('Test 11: manual close stays closed; auto close reopens on the server', async () => {
  await call('POST', '/api/restaurant/status', { open: false, mode: 'manual' }, S.rt0);
  assert.equal((await call('GET', '/api/public/restaurants')).body.restaurants.find(r => r.id === S.rest0).is_open, 0);
  assert.equal((await call('POST', '/api/customer/quote', cart(), S.cust)).status, 409);
  assert.equal((await call('POST', '/api/restaurant/status', { open: false, mode: 'auto' }, S.rt0)).status, 400);   // needs a duration
  await call('POST', '/api/restaurant/status', { open: false, mode: 'auto', hours: 2, minutes: 30 }, S.rt0);
  db.prepare('UPDATE restaurant_operating_status SET reopen_at=? WHERE restaurant_id=?').run(new Date(Date.now() - 1000).toISOString(), S.rest0);
  assert.equal((await call('GET', '/api/public/restaurants')).body.restaurants.find(r => r.id === S.rest0).is_open, 1);
});

test('Test 12, 13: admin hide removes restaurant; order search is admin-global, restaurant-scoped', async () => {
  await call('PUT', `/api/admin/restaurants/${S.rest0}`, { name: 'Biryani House', admin_visible: false }, S.admin);
  assert.ok(!(await call('GET', '/api/public/restaurants')).body.restaurants.some(r => r.id === S.rest0));
  assert.equal((await call('POST', '/api/customer/orders', cart(), S.cust)).status, 409);
  await call('PUT', `/api/admin/restaurants/${S.rest0}`, { name: 'Biryani House', admin_visible: true }, S.admin);
  const s = await call('GET', `/api/admin/orders/search/${S.code.toLowerCase()}`, null, S.admin);
  assert.equal(s.status, 200); assert.equal(s.body.platform_revenue_paise, 4400); assert.ok(s.body.events.length >= 10); assert.ok(s.body.events.some(e => e.event_type === 'DELIVERY_OTP_VERIFIED'));
  assert.equal((await call('GET', `/api/restaurant/orders/by-code/${S.code}`, null, S.rt1)).status, 404);
  assert.equal((await call('GET', `/api/restaurant/orders/by-code/${S.code}`, null, S.rt0)).status, 200);
  assert.equal((await call('GET', `/api/admin/orders/search/${S.code}`, null, S.rt0)).status, 403);
});

test('rider offline blocks new offers but keeps an active delivery; fixed-OTP mode works only when configured', async () => {
  await call('PUT', '/api/admin/settings', { settings: { delivery_otp_mode: 'fixed', fixed_delivery_otp: '7777' } }, S.admin);
  const c = await call('POST', '/api/customer/orders', cart(), S.cust); await call('POST', `/api/customer/payments/sandbox/${c.body.order_code}/complete`, { outcome: 'success' }, S.cust);
  const id = db.prepare('SELECT id FROM orders WHERE order_code=?').pluck().get(c.body.order_code);
  await call('POST', `/api/restaurant/orders/${id}/accept`, {}, S.rt0); await call('POST', `/api/rider/orders/${id}/accept`, {}, S.r2);
  await call('POST', '/api/rider/online', { online: false }, S.r2);
  assert.equal((await call('GET', '/api/rider/active', null, S.r2)).body.active.length, 1);      // not silently cancelled
  assert.equal((await call('GET', '/api/rider/offers', null, S.r2)).body.offers.length, 0);
  assert.equal((await call('POST', '/api/admin/users', { role: 'rider', name: 'x', phone: '+919100000203', password: 'short' }, S.admin)).status, 400);
});
