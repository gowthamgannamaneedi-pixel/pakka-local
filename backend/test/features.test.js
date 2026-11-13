import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { testOutbox } from '../src/otpProviders.js';
import { setPushSender, dispatchPush } from '../src/services/push.js';

const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const call = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body == null ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const PW = 'correct-horse-battery', hash = bcrypt.hashSync(PW, 4), now = () => new Date().toISOString();
const mk = (role, phone) => db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run(role, phone, role + phone.slice(-2), hash).lastInsertRowid;
const staff = async (portal, phone) => (await call('POST', '/api/auth/login', { portal, phone, password: PW })).body.token;
const customer = async (phone) => { await call('POST', '/api/auth/customer/otp/request', { phone }); return (await call('POST', '/api/auth/customer/otp/verify', { phone, otp: testOutbox.at(-1).otp })).body.token; };
const S = {}; const sent = []; setPushSender(async (s, p) => { sent.push({ ep: s.endpoint, ...JSON.parse(p) }); });

test('setup', async () => {
  mk('admin', '+919400000001'); S.admin = await staff('admin', '+919400000001');
  for (const i of [0, 1]) { const r = db.prepare("INSERT INTO restaurants (name,admin_visible,approved,markup_paise,commission_bps) VALUES (?,1,1,2000,1000)").run('R' + i).lastInsertRowid; S['r' + i] = r;
    const u = mk('restaurant', `+91940000010${i}`); db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(u, r); S['ru' + i] = u; db.prepare('INSERT INTO restaurant_operating_status (restaurant_id,is_open) VALUES (?,1)').run(r); S['rt' + i] = await staff('restaurant', `+91940000010${i}`); }
  S.item = db.prepare("INSERT INTO food_items (restaurant_id,name,base_price_paise,prep_time_min) VALUES (?,'Biryani',14000,20)").run(S.r0).lastInsertRowid;
  S.cheap = db.prepare("INSERT INTO food_items (restaurant_id,name,base_price_paise,prep_time_min) VALUES (?,'Chai',2000,5)").run(S.r0).lastInsertRowid;
  S.loc = db.prepare("INSERT INTO delivery_locations (name,address,delivery_fee_paise) VALUES ('Hostel','Road 1',4000)").run().lastInsertRowid;
  for (const i of [1, 2]) { const u = mk('rider', `+91940000020${i}`); db.prepare("INSERT INTO riders (user_id,verification_status,is_online,last_seen_at) VALUES (?,'approved',1,?)").run(u, now()); S['rid' + i] = u; S['rd' + i] = await staff('rider', `+91940000020${i}`); await call('POST', '/api/push/subscribe', { endpoint: `https://push.example/rd${i}`, keys: { p256dh: 'BPubKeyPubKeyPubKey' + i, auth: 'authkey' + i } }, S['rd' + i]); }
  S.cust = await customer('+919500000001'); S.cust2 = await customer('+919500000002');
});
const cart = (o = {}) => ({ restaurant_id: S.r0, items: [{ id: S.item, qty: 1 }], location_id: S.loc, ...o });
const place = async (t = S.cust) => { const o = await call('POST', '/api/customer/orders', cart(), t); await call('POST', `/api/customer/payments/sandbox/${o.body.order_code}/complete`, { outcome: 'success' }, t); return { code: o.body.order_code, id: db.prepare('SELECT id FROM orders WHERE order_code=?').pluck().get(o.body.order_code) }; };
const toPickedUp = async (o, rider) => { await call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, S.rt0); await call('POST', `/api/rider/orders/${o.id}/accept`, {}, rider); await call('POST', `/api/restaurant/orders/${o.id}/ready`, {}, S.rt0);
  const otp = (await call('GET', '/api/restaurant/orders', null, S.rt0)).body.orders.find((x) => x.id === o.id).pickup_otp; await call('POST', `/api/rider/orders/${o.id}/pickup`, { otp }, rider); };
const deliver = async (o, rider) => { await toPickedUp(o, rider); const dotp = (await call('GET', `/api/customer/orders/${o.code}`, null, S.cust)).body.delivery_otp; return call('POST', `/api/rider/orders/${o.id}/deliver`, { otp: dotp }, rider); };

test('menu shows restaurant base price AND final price; categories group items; restaurant list has an ETA', async () => {
  const c = await call('POST', '/api/restaurant/categories', { name: 'Mains', sort_order: 1 }, S.rt0); assert.equal(c.status, 201);
  assert.equal((await call('PUT', `/api/restaurant/menu/${S.item}`, { name: 'Biryani', category_id: c.body.id }, S.rt0)).status, 200);
  const other = await call('POST', '/api/restaurant/categories', { name: 'Theirs' }, S.rt1);
  assert.equal((await call('PUT', `/api/restaurant/menu/${S.item}`, { name: 'Biryani', category_id: other.body.id }, S.rt0)).status, 400);      // another restaurant's category
  assert.equal((await call('DELETE', `/api/restaurant/categories/${c.body.id}`, null, S.rt1)).status, 404);
  const m = (await call('GET', `/api/public/restaurants/${S.r0}/menu`)).body; const i = m.items.find((x) => x.id === S.item);
  assert.deepEqual([i.restaurant_price_paise, i.price_paise, i.category_id], [14000, 16000, c.body.id]); assert.equal(m.categories[0].name, 'Mains');
  const r = (await call('GET', '/api/public/restaurants')).body.restaurants.find((x) => x.id === S.r0); assert.equal(r.eta_min, 12 + 5 + 8 + 12);   // avg prep + buffer + rider travel + delivery
});

test('per-restaurant delivery rules: minimum order and free-delivery threshold', async () => {
  assert.equal((await call('PUT', `/api/admin/restaurants/${S.r0}`, { name: 'R0', min_order_paise: 20000, free_delivery_above_paise: 30000 }, S.admin)).status, 200);
  const small = await call('POST', '/api/customer/quote', cart({ items: [{ id: S.cheap, qty: 1 }] }), S.cust); assert.equal(small.status, 400); assert.equal(small.body.code, 'MIN_ORDER'); assert.match(small.body.error, /₹200/);
  const mid = await call('POST', '/api/customer/quote', cart({ items: [{ id: S.item, qty: 2 }] }), S.cust); assert.equal(mid.body.delivery_paise, 0);           // 2 x ₹160 = ₹320 is above the ₹300 free-delivery threshold
  assert.equal((await call('PUT', `/api/admin/restaurants/${S.r0}`, { name: 'R0', min_order_paise: 0, free_delivery_above_paise: 30000 }, S.admin)).status, 200);
  const free = await call('POST', '/api/customer/quote', cart({ items: [{ id: S.item, qty: 2 }] }), S.cust); assert.equal(free.body.delivery_paise, 0); assert.equal(free.body.total_paise, 32000);
  const paid = await call('POST', '/api/customer/quote', cart(), S.cust); assert.equal(paid.body.delivery_paise, 4000);                                     // below threshold still charged
  await call('PUT', `/api/admin/restaurants/${S.r0}`, { name: 'R0', min_order_paise: 0, free_delivery_above_paise: null }, S.admin);
});

test('admin cancel: reason required, refund started, everyone notified, audited, nothing credited', async () => {
  const o = await place(); await call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, S.rt0); await call('POST', `/api/rider/orders/${o.id}/accept`, {}, S.rd1);
  assert.equal((await call('POST', `/api/admin/orders/${o.id}/cancel`, { reauth_password: PW, }, S.admin)).status, 400);
  assert.equal((await call('POST', `/api/admin/orders/${o.id}/cancel`, { reauth_password: PW, reason: 'Kitchen fire' }, S.rt0)).status, 403);
  assert.equal((await call('POST', `/api/admin/orders/${o.id}/cancel`, { reauth_password: PW, reason: 'Kitchen fire' }, S.admin)).status, 200);
  const d = (await call('GET', `/api/customer/orders/${o.code}`, null, S.cust)).body; assert.equal(d.status, 'CANCELLED'); assert.equal(d.refund, 'REFUND_INITIATED');
  const ev = db.prepare('SELECT event_type, actor_role FROM order_events WHERE order_id=?').all(o.id).map((e) => e.event_type); assert.ok(ev.includes('ADMIN_CANCELLED') && ev.includes('ADMIN_INTERVENTION') && ev.includes('REFUND_REQUESTED'));
  for (const uid of [S.cust ? db.prepare("SELECT id FROM users WHERE phone='+919500000001'").pluck().get() : 0, S.ru0, S.rid1]) assert.ok(db.prepare('SELECT COUNT(*) FROM notifications WHERE user_id=? AND order_id=? AND title LIKE ?').pluck().get(uid, o.id, '%ancel%') >= 1);
  assert.equal((await call('GET', '/api/rider/active', null, S.rd1)).body.active.length, 0);
  assert.equal((await call('POST', `/api/admin/orders/${o.id}/cancel`, { reauth_password: PW, reason: 'again' }, S.admin)).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) FROM platform_transactions WHERE order_id=?").pluck().get(o.id), 0);
  assert.ok(db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action='order.cancel'").pluck().get() >= 1);
  const dl = await place(); assert.equal((await deliver(dl, S.rd2)).status, 200); assert.equal((await call('POST', `/api/admin/orders/${dl.id}/cancel`, { reauth_password: PW, reason: 'too late' }, S.admin)).status, 409);   // delivered orders can't be cancelled
  S.delivered = dl;
});

test('admin can take a rider off an order that is not yet picked up; other riders are re-offered', async () => {
  const o = await place(); await call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, S.rt0); await call('POST', `/api/rider/orders/${o.id}/accept`, {}, S.rd1);
  assert.equal((await call('GET', `/api/rider/orders/${o.id}`, null, S.rd2)).status, 404);                              // not available to rd2 while rd1 holds it
  assert.equal((await call('POST', `/api/admin/orders/${o.id}/unassign-rider`, { reauth_password: PW, note: 'rider unreachable' }, S.admin)).status, 200);
  assert.equal(db.prepare('SELECT rider_id FROM orders WHERE id=?').pluck().get(o.id), null);
  const offer = db.prepare("SELECT user_id, deep_link FROM notifications WHERE order_id=? AND kind='rider_offer' ORDER BY id DESC").all(o.id);
  assert.ok(offer.some((x) => x.user_id === S.rid2 && x.deep_link === `/rider/#/job/${o.id}`)); assert.ok(!offer.some((x, i) => x.user_id === S.rid1 && i === 0));
  assert.equal((await call('GET', `/api/rider/orders/${o.id}`, null, S.rd2)).status, 200);                              // deep link now resolves for rd2
  assert.equal((await call('POST', `/api/rider/orders/${o.id}/accept`, {}, S.rd2)).status, 200);
  await call('POST', `/api/restaurant/orders/${o.id}/ready`, {}, S.rt0); const otp = (await call('GET', '/api/restaurant/orders', null, S.rt0)).body.orders.find((x) => x.id === o.id).pickup_otp; await call('POST', `/api/rider/orders/${o.id}/pickup`, { otp }, S.rd2);
  assert.equal((await call('POST', `/api/admin/orders/${o.id}/unassign-rider`, { reauth_password: PW, note: 'rider unreachable' }, S.admin)).status, 409);               // already picked up -> cancel instead
});

test('admin restaurant tools: per-restaurant orders, owner logins can be deactivated', async () => {
  const list = (await call('GET', `/api/admin/restaurants/${S.r0}/orders`, null, S.admin)).body.orders; assert.ok(list.length >= 3); assert.ok(list.every((x) => x.order_code));
  const users = (await call('GET', `/api/admin/restaurants/${S.r0}/users`, null, S.admin)).body.users; assert.equal(users[0].id, S.ru0);
  assert.equal((await call('GET', '/api/restaurant/me', null, S.rt0)).status, 200);
  assert.equal((await call('POST', `/api/admin/users/${S.ru0}/active`, { active: false }, S.admin)).status, 200);
  assert.equal((await call('GET', '/api/restaurant/me', null, S.rt0)).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { portal: 'restaurant', phone: '+919400000100', password: PW })).status, 403);
  await call('POST', `/api/admin/users/${S.ru0}/active`, { active: true }, S.admin); S.rt0 = await staff('restaurant', '+919400000100');
});

test('operating expenses reduce estimated net profit; daily series feeds the chart', async () => {
  const before = (await call('GET', '/api/admin/overview?preset=today', null, S.admin)).body;
  assert.ok(before.money.platform_revenue_paise > 0); assert.equal(before.daily.length, 1); assert.equal(before.daily[0].revenue_paise, before.money.platform_revenue_paise); assert.ok(before.daily[0].orders >= 1);
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  assert.equal((await call('POST', '/api/admin/expenses', { spent_on: today, category: 'Marketing', amount_paise: 50000 }, S.cust)).status, 403);
  const ex = await call('POST', '/api/admin/expenses', { spent_on: today, category: 'Marketing', amount_paise: 50000, note: 'flyers' }, S.admin); assert.equal(ex.status, 201);
  const after = (await call('GET', '/api/admin/overview?preset=today', null, S.admin)).body.money;
  assert.equal(after.expenses_paise, 50000); assert.equal(after.estimated_net_profit_paise, before.money.estimated_net_profit_paise - 50000);
  assert.equal((await call('GET', '/api/admin/overview?preset=7d', null, S.admin)).body.daily.length, 7);
  assert.equal((await call('POST', '/api/admin/expenses', { spent_on: 'yesterday', category: 'x', amount_paise: 100 }, S.admin)).status, 400);
  assert.equal((await call('DELETE', `/api/admin/expenses/${ex.body.id}`, null, S.admin)).status, 200);
});

test('payout methods are admin-configurable; cashout records list the underlying orders', async () => {
  await call('PUT', '/api/admin/settings', { settings: { payout_methods: 'upi' } }, S.admin);
  assert.deepEqual((await call('GET', '/api/rider/earnings', null, S.rd2)).body.methods, ['upi']);
  assert.equal((await call('POST', '/api/rider/cashouts', { amount_paise: 1000, payout_method: 'bank', beneficiary: '1234567890 IFSC0001' }, S.rd2)).status, 400);
  assert.equal((await call('PUT', '/api/admin/settings', { settings: { payout_methods: 'UPI; drop table' } }, S.admin)).status, 400);
  const c = await call('POST', '/api/rider/cashouts', { amount_paise: 1000, payout_method: 'upi', beneficiary: 'rider@upi' }, S.rd2); assert.equal(c.status, 201);
  const rec = (await call('GET', `/api/admin/cashouts/${c.body.id}/records`, null, S.admin)).body; assert.ok(rec.records.some((x) => x.order_code === S.delivered.code && x.kind === 'rider_earning')); assert.ok(rec.balance.available >= 0);
  assert.equal((await call('GET', `/api/admin/cashouts/${c.body.id}/records`, null, S.rd2)).status, 403);
  assert.equal((await call('GET', '/api/rider/earnings', null, S.rd2)).body.completed_count, 1);
  await call('PUT', '/api/admin/settings', { settings: { payout_methods: 'upi,bank' } }, S.admin);
});

test('ratings: only after delivery, once, by the customer; restaurant average updates', async () => {
  const code = S.delivered.code;
  assert.equal((await call('POST', `/api/customer/orders/${code}/rating`, { stars: 4 }, S.cust2)).status, 404);          // someone else's order
  assert.equal((await call('POST', `/api/customer/orders/${code}/rating`, { stars: 6 }, S.cust)).status, 400);
  assert.equal((await call('POST', `/api/customer/orders/${code}/rating`, { stars: 4, comment: 'Tasty' }, S.cust)).status, 201);
  assert.equal((await call('POST', `/api/customer/orders/${code}/rating`, { stars: 1 }, S.cust)).status, 409);
  const r = (await call('GET', '/api/public/restaurants')).body.restaurants.find((x) => x.id === S.r0); assert.deepEqual([r.rating, r.rating_count], [4, 1]);
  assert.equal((await call('GET', `/api/customer/orders/${code}`, null, S.cust)).body.rating, 4);
  const fresh = await place(); assert.equal((await call('POST', `/api/customer/orders/${fresh.code}/rating`, { stars: 5 }, S.cust)).status, 404);   // not delivered yet
});

test('campaign drafts and restaurant deep links; rider email; stale offers expire', async () => {
  const body = { title: 'Try R0', body: 'New menu', audience_type: 'all_customers', deep_link: `/user/#/r/${S.r0}` };
  const dr = await call('POST', '/api/admin/campaigns', { ...body, draft: true }, S.admin); assert.equal(dr.status, 201);
  assert.equal((await call('GET', '/api/admin/campaigns', null, S.admin)).body.campaigns[0].status, 'draft'); assert.equal(db.prepare('SELECT COUNT(*) FROM notifications WHERE campaign_id=?').pluck().get(dr.body.id), 0);
  assert.equal((await call('POST', `/api/admin/campaigns/${dr.body.id}/send`, {}, S.admin)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) FROM notifications WHERE campaign_id=?').pluck().get(dr.body.id), 2);
  assert.equal((await call('DELETE', `/api/admin/campaigns/${dr.body.id}`, null, S.admin)).status, 409);                // only drafts are deletable
  const d2 = await call('POST', '/api/admin/campaigns', { ...body, draft: true }, S.admin); assert.equal((await call('DELETE', `/api/admin/campaigns/${d2.body.id}`, null, S.admin)).status, 200);
  const ed = await call('PUT', '/api/rider/application', { email: 'rahul@example.com' }, S.rd1); assert.equal(ed.status, 409); assert.equal(ed.body.code, 'LOCKED');   // approved details are locked
  const o = await place(); await call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, S.rt0);                           // offers queued
  db.prepare("UPDATE notifications SET created_at='2020-01-01T00:00:00.000Z' WHERE order_id=? AND kind='rider_offer'").run(o.id);
  const b = sent.length; await dispatchPush(db); assert.ok(!sent.slice(b).some((p) => p.kind === 'rider_offer'));         // 15-minute expiry
});
