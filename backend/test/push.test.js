import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { testOutbox } from '../src/otpProviders.js';
import { setPushSender, dispatchPush, processCampaigns } from '../src/services/push.js';

const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const call = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const PW = 'correct-horse-battery', hash = bcrypt.hashSync(PW, 4);
const mk = (role, phone) => db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run(role, phone, role, hash).lastInsertRowid;
const staff = async (portal, phone) => (await call('POST', '/api/auth/login', { portal, phone, password: PW })).body.token;
const customer = async (phone) => { await call('POST', '/api/auth/customer/otp/request', { phone }); return (await call('POST', '/api/auth/customer/otp/verify', { phone, otp: testOutbox.at(-1).otp })).body.token; };
const sub = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'BPubKeyPubKeyPubKey' + n, auth: 'authkey' + n }, label: n });
const sent = [], fail = {};
setPushSender(async (s, payload) => { if (fail[s.endpoint]) throw Object.assign(new Error('push error'), { statusCode: fail[s.endpoint] }); sent.push({ endpoint: s.endpoint, ...JSON.parse(payload) }); });
const pushesFor = (ep) => sent.filter((x) => x.endpoint === `https://push.example/${ep}`);
const S = {};

test('setup', async () => {
  mk('admin', '+919500000001'); S.admin = await staff('admin', '+919500000001');
  const rid = db.prepare("INSERT INTO restaurants (name,admin_visible,approved,markup_paise) VALUES ('R',1,1,2000)").run().lastInsertRowid;
  const ru = mk('restaurant', '+919500000002'); db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(ru, rid); db.prepare('INSERT INTO restaurant_operating_status (restaurant_id,is_open) VALUES (?,1)').run(rid);
  S.item = db.prepare("INSERT INTO food_items (restaurant_id,name,base_price_paise) VALUES (?,'Biryani',14000)").run(rid).lastInsertRowid; S.rid = rid;
  S.loc = db.prepare("INSERT INTO delivery_locations (name,address,delivery_fee_paise) VALUES ('Hostel','Road 1, Secret Lane',4000)").run().lastInsertRowid;
  for (const [i, ph, on] of [[1, '+919500000011', 1], [2, '+919500000012', 0], [3, '+919500000013', 1]]) { const u = mk('rider', ph); db.prepare("INSERT INTO riders (user_id,verification_status,is_online,last_seen_at) VALUES (?,'approved',?,?)").run(u, on, new Date().toISOString()); S['rd' + i] = await staff('rider', ph); }
  S.rest = await staff('restaurant', '+919500000002'); S.cust = await customer('+919600000001');
});

test('subscribe: auth required, validated, multi-device, can only remove own', async () => {
  assert.equal((await call('POST', '/api/push/subscribe', sub('x'))).status, 401);
  assert.equal((await call('POST', '/api/push/subscribe', { endpoint: 'http://insecure/x', keys: sub('x').keys }, S.rest)).status, 400);
  for (const [t, n] of [[S.rest, 'rest1'], [S.rd1, 'rd1'], [S.rd2, 'rd2'], [S.rd3, 'rd3'], [S.cust, 'c1'], [S.cust, 'c2']]) assert.equal((await call('POST', '/api/push/subscribe', sub(n), t)).status, 201);
  assert.equal((await call('GET', '/api/push/devices', null, S.cust)).body.devices.length, 2);
  await call('POST', '/api/push/unsubscribe', { endpoint: sub('rest1').endpoint }, S.cust);                       // someone else's device: no effect
  assert.equal(db.prepare('SELECT COUNT(*) FROM push_subscriptions').pluck().get(), 6);
});

const place = async () => { const o = await call('POST', '/api/customer/orders', { restaurant_id: S.rid, items: [{ id: S.item, qty: 1 }], location_id: S.loc, instructions: 'Call 9876543210' }, S.cust);
  await call('POST', `/api/customer/payments/sandbox/${o.body.order_code}/complete`, { outcome: 'success' }, S.cust); return { code: o.body.order_code, id: db.prepare('SELECT id FROM orders WHERE order_code=?').pluck().get(o.body.order_code) }; };

test('new paid order: restaurant + customer devices get exactly one push each; re-dispatch adds none', async () => {
  const o = await place(); S.o1 = o; await dispatchPush(db);
  assert.equal(pushesFor('rest1').length, 1); assert.equal(pushesFor('rest1')[0].kind, 'restaurant_new'); assert.equal(pushesFor('rest1')[0].url, `/restaurant/#/order/${S.o1.id}`);
  assert.equal(pushesFor('c1').length, 1); assert.equal(pushesFor('c2').length, 1);                              // both customer devices
  const n = sent.length; await dispatchPush(db); await dispatchPush(db); assert.equal(sent.length, n);          // no duplicates
});

test('accept: only ONLINE riders are offered; each status push is sent once with a deep link', async () => {
  await call('POST', `/api/restaurant/orders/${S.o1.id}/accept`, {}, S.rest); await dispatchPush(db);
  assert.equal(pushesFor('rd1').length, 1); assert.equal(pushesFor('rd3').length, 1); assert.equal(pushesFor('rd2').length, 0);   // rd2 is offline
  assert.equal(pushesFor('rd1')[0].url, `/rider/#/job/${S.o1.id}`);
  assert.ok(pushesFor('c1').some((p) => p.title === 'Restaurant accepted' && p.url === `/user/orders/${S.o1.code}`));
});

test('stale offers are never delivered once someone has claimed the order', async () => {
  const o = await place(); await call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, S.rest);               // offers queued, not yet dispatched
  assert.equal((await call('POST', `/api/rider/orders/${o.id}/accept`, {}, S.rd1)).status, 200);
  const before = sent.length; await dispatchPush(db);
  assert.ok(!sent.slice(before).some((p) => p.kind === 'rider_offer'));                                           // rd3's delayed offer was dropped
  assert.ok(db.prepare("SELECT COUNT(*) FROM notifications WHERE kind='rider_offer' AND order_id=? AND push_state='skipped'").pluck().get(o.id) >= 1);
  const o2 = await place(); const b2 = sent.length; await call('POST', `/api/restaurant/orders/${o2.id}/accept`, {}, S.rest); await dispatchPush(db);   // restaurant accepted before its push went out
  assert.ok(!sent.slice(b2).some((p) => p.kind === 'restaurant_new'));
});

test('payloads never carry phone numbers, addresses, OTPs or rider identity', async () => {
  const o = await place(); await call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, S.rest); await call('POST', `/api/restaurant/orders/${o.id}/ready`, {}, S.rest);
  await call('POST', `/api/rider/orders/${o.id}/accept`, {}, S.rd3);
  const otp = (await call('GET', '/api/restaurant/orders', null, S.rest)).body.orders.find((x) => x.id === o.id).pickup_otp;
  await call('POST', `/api/rider/orders/${o.id}/pickup`, { otp }, S.rd3); await dispatchPush(db);
  const all = JSON.stringify(sent); for (const bad of ['9876543210', 'Secret Lane', 'Hostel', 'rider+9195', otp]) assert.ok(!all.includes(bad), `leaked ${bad}`);
  assert.ok(pushesFor('c1').some((p) => p.title === 'Order picked up'));
});

test('expired subscription (410) is removed; temporary failure retries with backoff then gives up', async () => {
  fail['https://push.example/c2'] = 410; fail['https://push.example/rest1'] = 503;
  const o = await place(); await dispatchPush(db);
  assert.equal(db.prepare("SELECT COUNT(*) FROM push_subscriptions WHERE endpoint='https://push.example/c2'").pluck().get(), 0);
  const d = db.prepare("SELECT d.* FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id WHERE s.endpoint='https://push.example/rest1' ORDER BY d.id DESC").get();
  assert.equal(d.status, 'pending'); assert.equal(d.attempts, 1); assert.ok(d.next_attempt_at > new Date().toISOString());
  for (let i = 0; i < 3; i++) { db.prepare("UPDATE push_deliveries SET next_attempt_at='2000-01-01T00:00:00Z' WHERE id=?").run(d.id); await dispatchPush(db); }
  assert.equal(db.prepare('SELECT status FROM push_deliveries WHERE id=?').pluck().get(d.id), 'failed');
  delete fail['https://push.example/rest1'];
});

test('promo opt-out blocks promotions but never order updates', async () => {
  assert.equal((await call('PUT', '/api/customer/preferences', { promo_opt_in: false }, S.cust)).status, 200);
  const c = await call('POST', '/api/admin/campaigns', { title: 'Offer', body: 'x', audience_type: 'all_customers' }, S.admin); assert.equal(c.status, 400);   // opted-out customers are not in the audience
  const o = await place(); const b = sent.length; await dispatchPush(db);
  assert.ok(sent.slice(b).some((p) => p.kind === 'order_status'));
  await call('PUT', '/api/customer/preferences', { promo_opt_in: true }, S.cust);
});

test('broadcast: admin only, preview, send, cap, schedule, cancel, stats, click tracking', async () => {
  const body = { title: 'Weekend offer', body: 'Free delivery today', audience_type: 'all_customers', deep_link: '/user/' };
  assert.equal((await call('POST', '/api/admin/campaigns', body, S.cust)).status, 403); assert.equal((await call('POST', '/api/admin/campaigns', body, S.rest)).status, 403); assert.equal((await call('POST', '/api/admin/campaigns', body)).status, 401);
  assert.equal((await call('POST', '/api/admin/campaigns/preview', body, S.admin)).body.audience_size, 1);
  assert.equal((await call('POST', '/api/admin/campaigns', { ...body, deep_link: 'javascript:alert(1)' }, S.admin)).status, 400);
  const c1 = await call('POST', '/api/admin/campaigns', body, S.admin); assert.equal(c1.status, 201);
  const b = sent.length; await dispatchPush(db); processCampaigns(db);
  const promo = sent.slice(b).filter((p) => p.kind === 'promo'); assert.equal(promo.length, 1);                      // customer has 1 live device left (c1)
  const click = await call('POST', '/api/push/click', { nid: promo[0].nid, t: promo[0].t }); assert.equal(click.status, 200);
  assert.equal((await call('POST', '/api/push/click', { nid: promo[0].nid, t: 'f'.repeat(24) })).status, 400);        // forged
  let list = (await call('GET', '/api/admin/campaigns', null, S.admin)).body.campaigns; assert.deepEqual([list[0].status, list[0].targeted, list[0].stats.sent, list[0].stats.clicked], ['completed', 1, 1, 1]);
  await call('PUT', '/api/admin/settings', { settings: { promo_daily_cap: '1' } }, S.admin);                          // daily cap
  await call('POST', '/api/admin/campaigns', { ...body, title: 'Second' }, S.admin); let l2 = (await call('GET', '/api/admin/campaigns', null, S.admin)).body.campaigns[0]; assert.equal(l2.targeted, 0); assert.equal(l2.capped, 1);
  const later = new Date(Date.now() + 3600e3).toISOString();                                                          // scheduled + cancel
  const sc = await call('POST', '/api/admin/campaigns', { ...body, title: 'Later', scheduled_at: later }, S.admin); processCampaigns(db);
  assert.equal(db.prepare('SELECT status FROM campaigns WHERE id=?').pluck().get(sc.body.id), 'scheduled');
  assert.equal((await call('POST', `/api/admin/campaigns/${sc.body.id}/cancel`, {}, S.admin)).status, 200);
  db.prepare("UPDATE campaigns SET status='scheduled', scheduled_at='2000-01-01T00:00:00Z' WHERE id=?").run(sc.body.id); db.prepare("UPDATE campaigns SET status='cancelled' WHERE id=?").run(sc.body.id);
  processCampaigns(db); assert.equal(db.prepare("SELECT COUNT(*) FROM notifications WHERE campaign_id=?").pluck().get(sc.body.id), 0);   // cancelled never sends
  const rb = await call('POST', '/api/admin/campaigns', { title: 'Riders only', body: 'Bonus tonight', audience_type: 'riders' }, S.admin); assert.equal(rb.body.audience_size, 3);
  assert.equal(db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'campaign.%'").pluck().get() >= 4, true);
});
