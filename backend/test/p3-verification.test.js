// Delivery-agent application and admin verification (API level, in-memory database, test data only).
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { testOutbox } from '../src/otpProviders.js';
import { purgeLocations } from '../src/services/tracking.js';
import { PNG, PDF, fullApplication, completeApplication } from './helpers/rider-application.js';

const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const call = async (method, path, body, token) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body == null ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers }; };
const raw = async (path, token) => { const r = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control') }; };
const PW = 'correct-horse-battery', hash = bcrypt.hashSync(PW, 4);
const mk = (role, phone, name = role) => db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run(role, phone, name, hash).lastInsertRowid;
const staff = async (portal, phone) => (await call('POST', '/api/auth/login', { portal, phone, password: PW })).body.token;
const S = {};

test('setup: admin creates two delivery agents; both start as draft and cannot work', async () => {
  mk('admin', '+919500000001'); S.admin = await staff('admin', '+919500000001');
  for (const [k, phone] of [['a', '+919500000101'], ['b', '+919500000102']]) {
    assert.equal((await call('POST', '/api/admin/users', { role: 'rider', name: 'Agent ' + k, phone, password: PW, approve_now: true }, S.admin)).status, 201);
    S[k] = await staff('rider', phone); S[k + 'id'] = db.prepare('SELECT id FROM users WHERE phone=?').pluck().get(phone);
  }
  const me = (await call('GET', '/api/rider/me', null, S.a)).body.rider;
  assert.equal(me.verification_status, 'draft'); assert.equal(me.can_take_orders, false); assert.ok(me.missing_count > 10);
  assert.equal((await call('POST', '/api/rider/online', { online: true }, S.a)).status, 403);
  const rid = db.prepare("INSERT INTO restaurants (name, admin_visible, approved) VALUES ('R',1,1)").run().lastInsertRowid;
  S.rest = mk('restaurant', '+919500000201'); db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(S.rest, rid); S.rt = await staff('restaurant', '+919500000201');
});

test('save as you go: partial saves persist across sign-out, missing items are listed, incomplete cannot be submitted', async () => {
  let r = await call('PUT', '/api/rider/application', { legal_name: 'Ravi Kumar', date_of_birth: '1998-02-03' }, S.a); assert.equal(r.status, 200);
  assert.ok(!r.body.application.missing.some((m) => m.key === 'legal_name'));
  // sign out everywhere and back in: nothing is lost
  await call('POST', '/api/auth/logout-all', {}, S.a); S.a = await staff('rider', '+919500000101');
  const g = (await call('GET', '/api/rider/application', null, S.a)).body.application;
  assert.equal(g.legal_name, 'Ravi Kumar'); assert.equal(g.date_of_birth, '1998-02-03'); assert.equal(g.status, 'draft');
  assert.ok(g.missing.some((m) => m.key === 'photo') && g.missing.some((m) => m.key === 'payout') && g.missing.some((m) => m.key === 'phone_verified'));
  const s = await call('POST', '/api/rider/application/submit', {}, S.a); assert.equal(s.status, 400); assert.equal(s.body.code, 'INCOMPLETE');
  assert.equal(db.prepare('SELECT verification_status FROM riders WHERE user_id=?').pluck().get(S.aid), 'draft');
});

test('validation: bad formats, unknown fields, under-18 and expired licence are refused', async () => {
  for (const bad of [{ bank_ifsc: 'XYZ' }, { payout_upi: 'not-an-upi' }, { id_last4: '123456789' }, { vehicle_reg_no: 'hello' }, { date_of_birth: '2999-01-01' }, { aadhaar_number: '123412341234' }, { verification_status: 'approved' }])
    assert.equal((await call('PUT', '/api/rider/application', bad, S.b)).status, 400, JSON.stringify(bad));
  await completeApplication(call, S.b, 2, { submit: false });
  await call('PUT', '/api/rider/application', { date_of_birth: new Date(Date.now() - 16 * 365.25 * 864e5).toISOString().slice(0, 10) }, S.b);
  let s = await call('POST', '/api/rider/application/submit', {}, S.b); assert.equal(s.status, 400); assert.equal(s.body.code, 'NOT_ELIGIBLE');
  await call('PUT', '/api/rider/application', { date_of_birth: '1990-01-01', licence_expiry: '2020-01-01' }, S.b);
  s = await call('POST', '/api/rider/application/submit', {}, S.b); assert.equal(s.status, 400); assert.match(s.body.error, /expired/);
  await call('PUT', '/api/rider/application', { licence_expiry: '2035-01-01' }, S.b);
});

test('documents: content-checked types and size; private to the agent and admins; admin views are audited', async () => {
  assert.equal((await call('POST', '/api/rider/application/documents', { kind: 'photo', data: Buffer.from('<html>not an image</html>').toString('base64') }, S.a)).status, 400);
  assert.equal((await call('POST', '/api/rider/application/documents', { kind: 'photo', data: PDF }, S.a)).status, 400);            // photo must be an image
  assert.equal((await call('POST', '/api/rider/application/documents', { kind: 'id_front', data: Buffer.alloc(5_100_000, 1).toString('base64') }, S.a)).status, 400);   // too large
  assert.equal((await call('POST', '/api/rider/application/documents', { kind: 'passport_scan', data: PNG }, S.a)).status, 400);   // unknown kind
  assert.equal((await call('POST', '/api/rider/application/documents', { kind: 'id_front', data: PNG }, S.a)).status, 200);
  const own = await raw(`/api/files/rider-doc/${S.aid}/id_front`, S.a); assert.equal(own.status, 200); assert.equal(own.type, 'image/png'); assert.match(own.cache, /no-store/);
  assert.equal((await raw(`/api/files/rider-doc/${S.aid}/id_front`, S.b)).status, 404);          // another agent
  assert.equal((await raw(`/api/files/rider-doc/${S.aid}/id_front`, S.rt)).status, 404);         // a restaurant
  assert.equal((await raw(`/api/files/rider-doc/${S.aid}/id_front`)).status, 401);               // anonymous
  const name = db.prepare('SELECT id_front_path FROM riders WHERE user_id=?').pluck().get(S.aid);
  assert.equal((await raw(`/api/files/public/${name}`)).status, 404);                              // never reachable as a public file
  const before = db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action='rider.document_viewed'").pluck().get();
  assert.equal((await raw(`/api/files/rider-doc/${S.aid}/id_front`, S.admin)).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action='rider.document_viewed'").pluck().get(), before + 1);
});

test('phone verification: wrong code fails, right code verifies, codes are single-use and not valid for customer login', async () => {
  assert.equal((await call('POST', '/api/rider/application/phone/request', {}, S.a)).status, 200);
  const { otp, phone } = testOutbox.at(-1); assert.equal(phone, '+919500000101');
  assert.equal((await call('POST', '/api/rider/application/phone/verify', { otp: otp === '000000' ? '111111' : '000000' }, S.a)).status, 400);
  assert.equal((await call('POST', '/api/auth/customer/otp/verify', { phone, otp })).status, 401);      // separate table: no customer session
  assert.equal((await call('POST', '/api/rider/application/phone/verify', { otp }, S.a)).status, 200);
  assert.equal((await call('POST', '/api/rider/application/phone/verify', { otp }, S.a)).status, 400);  // single use
  assert.equal((await call('GET', '/api/rider/application', null, S.a)).body.application.phone_verified, true);
});

test('payout details are encrypted at rest and only masked values are shown; full details need fresh auth and are audited', async () => {
  await call('PUT', '/api/rider/application', { payout_method: 'bank', bank_holder: 'Ravi Kumar', bank_account: '123456789012', bank_ifsc: 'SBIN0001234' }, S.a);
  const row = db.prepare('SELECT * FROM riders WHERE user_id=?').get(S.aid);
  assert.ok(!JSON.stringify(row).includes('123456789012')); assert.equal(row.bank_account_last4, '9012');
  const app = (await call('GET', '/api/rider/application', null, S.a)).body.application;
  assert.equal(app.bank_account_last4, '9012'); assert.ok(!JSON.stringify(app).includes('123456789012'));
  assert.ok(!JSON.stringify((await call('GET', `/api/admin/riders/${S.aid}`, null, S.admin)).body).includes('123456789012'));
  assert.equal((await call('POST', `/api/admin/riders/${S.aid}/payout-details`, {}, S.admin)).status, 401);
  assert.equal((await call('POST', `/api/admin/riders/${S.aid}/payout-details`, { reauth_password: 'wrong-password' }, S.admin)).status, 401);
  assert.ok(db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action='auth.reauth_failed'").pluck().get() >= 1);
  const full = await call('POST', `/api/admin/riders/${S.aid}/payout-details`, { reauth_password: PW }, S.admin);
  assert.equal(full.status, 200); assert.equal(full.body.payout.bank_account, '123456789012');
  assert.equal(db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action='rider.payout_details_viewed'").pluck().get(), 1);
  assert.equal((await call('POST', `/api/admin/riders/${S.aid}/payout-details`, { reauth_password: PW }, S.rt)).status, 403);
});

test('submitted -> PENDING_VERIFICATION: locked for editing, not eligible, not offered orders', async () => {
  await completeApplication(call, S.a, 1, { submit: false });
  await call('PUT', '/api/rider/application', { payout_method: 'bank' }, S.a);
  assert.equal((await call('POST', '/api/rider/application/submit', {}, S.a)).status, 200);
  assert.equal((await call('POST', '/api/rider/application/submit', {}, S.b)).status, 200);
  assert.equal(db.prepare('SELECT verification_status FROM riders WHERE user_id=?').pluck().get(S.aid), 'pending');
  const e = await call('PUT', '/api/rider/application', { address: '99 Somewhere Else Road, Hyderabad' }, S.a); assert.equal(e.status, 409); assert.equal(e.body.code, 'UNDER_REVIEW');
  assert.equal((await call('POST', '/api/rider/online', { online: true }, S.a)).status, 403);
  db.prepare('UPDATE riders SET is_online=1 WHERE user_id=?').run(S.aid);              // even if the flag were forced on
  assert.equal((await call('GET', '/api/rider/offers', null, S.a)).body.offers.length, 0);
  db.prepare('UPDATE riders SET is_online=0 WHERE user_id=?').run(S.aid);
});

test('admin queue: counts by status; customers, restaurants and agents cannot use it', async () => {
  const q = (await call('GET', '/api/admin/riders?status=pending', null, S.admin)).body;
  assert.equal(q.counts.pending, 2); assert.equal(q.riders.length, 2); assert.ok(q.riders.every((x) => x.verification_status === 'pending'));
  for (const t of [S.a, S.rt]) assert.equal((await call('GET', '/api/admin/riders', null, t)).status, 403);
  assert.equal((await call('GET', `/api/admin/riders/${S.aid}`, null)).status, 401);
});

test('corrections: fields and reason required; agent sees them, edits and resubmits; history records each step', async () => {
  assert.equal((await call('POST', `/api/admin/riders/${S.aid}/verify`, { action: 'corrections', note: 'Photo is blurry' }, S.admin)).status, 400);   // no fields chosen
  assert.equal((await call('POST', `/api/admin/riders/${S.aid}/verify`, { action: 'corrections', fields: ['photo'] }, S.admin)).status, 400);        // no reason
  assert.equal((await call('POST', `/api/admin/riders/${S.aid}/verify`, { action: 'corrections', fields: ['photo', 'address'], note: 'Photo is blurry; add PIN code' }, S.admin)).status, 200);
  const a = (await call('GET', '/api/rider/application', null, S.a)).body.application;
  assert.equal(a.status, 'corrections_requested'); assert.deepEqual(a.correction_fields, ['photo', 'address']); assert.match(a.decision_note, /blurry/); assert.equal(a.editable, true);
  assert.equal((await call('POST', '/api/rider/online', { online: true }, S.a)).status, 403);
  assert.equal((await call('POST', '/api/rider/application/documents', { kind: 'photo', data: PNG }, S.a)).status, 200);
  assert.equal((await call('PUT', '/api/rider/application', { address: '12 Test Street, Test Nagar, Hyderabad 500075 (near temple)' }, S.a)).status, 200);
  assert.equal((await call('POST', '/api/rider/application/submit', {}, S.a)).status, 200);
  const h = (await call('GET', `/api/admin/riders/${S.aid}`, null, S.admin)).body.application.history;
  assert.deepEqual(h.slice(0, 3).map((x) => x.action), ['submitted', 'corrections', 'submitted']);
  assert.equal(h[1].admin_name, 'admin'); assert.ok(h[1].created_at); assert.deepEqual(h[1].fields, ['photo', 'address']);
});

test('reject needs a reason and locks the application; approve needs fresh auth and a complete application', async () => {
  assert.equal((await call('POST', `/api/admin/riders/${S.bid}/verify`, { action: 'reject' }, S.admin)).status, 400);
  assert.equal((await call('POST', `/api/admin/riders/${S.bid}/verify`, { action: 'reject', note: 'Documents do not match' }, S.admin)).status, 200);
  assert.equal((await call('PUT', '/api/rider/application', { address: '1 New Road, Hyderabad 500001' }, S.b)).status, 409);
  assert.equal((await call('POST', '/api/rider/application/submit', {}, S.b)).status, 409);
  assert.equal((await call('POST', `/api/admin/riders/${S.bid}/verify`, { action: 'approve', reauth_password: PW }, S.admin)).status, 409);   // rejected is final
  assert.equal((await call('POST', `/api/admin/riders/${S.aid}/verify`, { action: 'approve' }, S.admin)).status, 401);
  assert.equal((await call('POST', `/api/admin/riders/${S.aid}/verify`, { action: 'approve', reauth_password: 'nope' }, S.admin)).status, 401);
  assert.equal((await call('POST', `/api/admin/riders/${S.aid}/verify`, { action: 'approve', reauth_password: PW, note: 'All documents checked' }, S.admin)).status, 200);
  const r = db.prepare('SELECT verification_status, decided_by, decided_at FROM riders WHERE user_id=?').get(S.aid);
  assert.equal(r.verification_status, 'approved'); assert.ok(r.decided_by && r.decided_at);
  assert.ok(db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action='rider.approve' AND target_id=?").pluck().get(String(S.aid)) === 1);
  assert.equal((await call('POST', '/api/rider/online', { online: true }, S.a)).status, 200);
  assert.equal((await call('PUT', '/api/rider/application', { address: '5 Changed Road, Hyderabad 500002' }, S.a)).status, 409);   // approved details locked
});

test('verification history and audit log cannot be edited or deleted', () => {
  assert.throws(() => db.prepare('UPDATE rider_verification_history SET note=? ').run('changed'), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM rider_verification_history').run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM audit_logs').run(), /append-only/);
});

test('re-verification: an agent keeps and finishes a delivery already assigned, but gets no new offers and cannot go online', async () => {
  // a paid order, accepted by the restaurant and claimed by the approved agent A
  const rid = db.prepare('SELECT restaurant_id FROM restaurant_users WHERE user_id=?').pluck().get(S.rest);
  const cust = mk('customer', '+919500000301');
  const mkOrder = (code) => db.prepare(`INSERT INTO orders (order_code,customer_id,restaurant_id,status,dest_text,customer_phone,items_base_paise,markup_paise,delivery_paise,total_paise,commission_bps,commission_paise,restaurant_payout_paise,rider_payout_paise)
    VALUES (?,?,?,'READY','House 4, Lane 2',?,10000,1000,3000,14000,1000,1000,9000,3000)`).run(code, cust, rid, '+919500000301').lastInsertRowid;
  const o1 = mkOrder('PLTESTRV01'); db.prepare("INSERT INTO pickup_otps (order_id, otp_hash) VALUES (?, 'x')").run(o1);
  assert.equal((await call('POST', `/api/rider/orders/${o1}/accept`, {}, S.a)).status, 200);
  const o2 = mkOrder('PLTESTRV02');
  // admin places A under re-verification (requests corrections from an approved agent)
  assert.equal((await call('POST', `/api/admin/riders/${S.aid}/verify`, { action: 'corrections', fields: ['licence'], note: 'Licence renewal needed' }, S.admin)).status, 200);
  db.prepare("UPDATE riders SET verification_status='reverification_required' WHERE user_id=?").run(S.aid);    // same effect as the upgrade migration
  const off = (await call('GET', '/api/rider/offers', null, S.a)).body;
  assert.equal(off.offers.length, 0); assert.equal(off.active.length, 1); assert.equal(off.active[0].customer.phone, '+919500000301');   // still sees its own delivery
  assert.equal((await call('POST', `/api/rider/orders/${o2}/accept`, {}, S.a)).status, 403);
  assert.equal((await call('POST', '/api/rider/online', { online: true }, S.a)).status, 403);
  db.prepare("UPDATE orders SET status='PICKED_UP' WHERE id=?").run(o1);
  const loc = await call('POST', '/api/tracking/rider/location', { lat: 17.39, lng: 78.47, recorded_at: Date.now() }, S.a);
  assert.equal(loc.status, 200, JSON.stringify(loc.body));                                       // can still share location for the delivery it holds
  purgeLocations(db); assert.equal(db.prepare('SELECT COUNT(*) FROM rider_locations WHERE rider_id=?').pluck().get(S.aid), 1);   // the background clean-up keeps it too
  assert.equal((await call('GET', '/api/rider/active', null, S.a)).body.active.length, 1);
});

test('admin overrides need fresh authentication; a wrong password is audited', async () => {
  const o = db.prepare("SELECT id FROM orders WHERE order_code='PLTESTRV02'").pluck().get();
  const n0 = db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action='auth.reauth_failed'").pluck().get();
  assert.equal((await call('POST', `/api/admin/orders/${o}/cancel`, { reason: 'Test' }, S.admin)).status, 401);
  assert.equal((await call('POST', `/api/admin/orders/${o}/cancel`, { reason: 'Test', reauth_password: 'bad-password' }, S.admin)).status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) FROM audit_logs WHERE action='auth.reauth_failed'").pluck().get(), n0 + 1);
  assert.equal(db.prepare("SELECT status FROM orders WHERE id=?").pluck().get(o), 'READY');
});
