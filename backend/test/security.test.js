import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { testOutbox } from '../src/otpProviders.js';
import { codeAt, decrypt } from '../src/totp.js';

const db = openDb(':memory:'); const server = createApp(db).listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const raw = (method, path, body, token, headers = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers }, body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
const call = async (...a) => { const r = await raw(...a); return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers }; };
const PW = 'correct-horse-battery', hash = bcrypt.hashSync(PW, 4);
const mk = (role, phone) => db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run(role, phone, role, hash).lastInsertRowid;
const login = async (portal, phone, extra = {}) => call('POST', '/api/auth/login', { portal, phone, password: PW, ...extra });
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const S = {};

test('setup', async () => {
  S.adminId = mk('admin', '+919800000001'); S.admin = (await login('admin', '+919800000001')).body.token;
  for (const [i, n] of ['A', 'B'].entries()) { const r = db.prepare("INSERT INTO restaurants (name,admin_visible,approved) VALUES (?,1,1)").run(n).lastInsertRowid; S['r' + i] = r;
    const u = mk('restaurant', `+91980000010${i}`); db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(u, r); db.prepare('INSERT INTO restaurant_operating_status (restaurant_id,is_open) VALUES (?,1)').run(r); S['rt' + i] = (await login('restaurant', `+91980000010${i}`)).body.token; }
  S.item = db.prepare("INSERT INTO food_items (restaurant_id,name,base_price_paise) VALUES (?,'Dish',10000)").run(S.r0).lastInsertRowid;
  S.riderId = mk('rider', '+919800000201'); db.prepare("INSERT INTO riders (user_id,verification_status) VALUES (?,'approved')").run(S.riderId); S.rider = (await login('rider', '+919800000201')).body.token;
  await call('POST', '/api/auth/customer/otp/request', { phone: '+919900000001' }); S.cust = (await call('POST', '/api/auth/customer/otp/verify', { phone: '+919900000001', otp: testOutbox.at(-1).otp })).body.token;
});

test('forged / tampered / expired tokens are rejected', async () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: S.adminId, role: 'admin', tv: 0 })}.`;
  assert.equal((await call('GET', '/api/admin/ping', null, none)).status, 401);                                           // alg=none
  const wrongKey = jwt.sign({ sub: S.adminId, role: 'admin', tv: 0 }, 'attacker-secret-attacker-secret-1234');
  assert.equal((await call('GET', '/api/admin/ping', null, wrongKey)).status, 401);                                       // wrong signature
  const [h, , sig] = S.rider.split('.'); const swapped = `${h}.${b64({ sub: S.adminId, role: 'admin', tv: 0 })}.${sig}`;
  assert.equal((await call('GET', '/api/admin/ping', null, swapped)).status, 401);                                        // payload swapped, signature reused
  const expired = jwt.sign({ sub: S.adminId, role: 'admin', tv: 0 }, config.jwtSecret, { expiresIn: -10 });
  assert.equal((await call('GET', '/api/admin/ping', null, expired)).status, 401);
  const hs512 = jwt.sign({ sub: S.adminId, role: 'admin', tv: 0 }, config.jwtSecret, { algorithm: 'HS512' });
  assert.equal((await call('GET', '/api/admin/ping', null, hs512)).status, 401);                                          // only HS256 accepted
  const claimsRole = jwt.sign({ sub: S.riderId, role: 'admin', tv: 0 }, config.jwtSecret);                                 // correct signature but role claim lies
  assert.equal((await call('GET', '/api/admin/ping', null, claimsRole)).status, 401);
  assert.equal((await call('GET', '/api/admin/ping', null, 'Bearer')).status, 401);
});

test('deactivating an account kills its existing tokens immediately', async () => {
  assert.equal((await call('GET', '/api/rider/me', null, S.rider)).status, 200);
  await call('POST', `/api/admin/users/${S.riderId}/active`, { active: false }, S.admin);
  assert.equal((await call('GET', '/api/rider/me', null, S.rider)).status, 401);
  assert.equal((await login('rider', '+919800000201')).status, 403);
  await call('POST', `/api/admin/users/${S.riderId}/active`, { active: true }, S.admin);
});

test('SQL injection attempts are inert (parameterised queries)', async () => {
  for (const phone of ["' OR 1=1--", "+919800000001' OR '1'='1", '+91"; DROP TABLE users;--']) assert.ok([400, 401].includes((await login('admin', phone)).status));
  assert.equal((await call('GET', "/api/admin/orders/search/PL' OR '1'='1", null, S.admin)).status, 404);
  assert.equal((await call('GET', "/api/restaurant/orders/by-code/x' OR 1=1--", null, S.rt0)).status, 404);
  const q = await call('GET', "/api/admin/orders?status=' OR 1=1--", null, S.admin); assert.equal(q.status, 200); assert.equal(q.body.orders.length, 0);
  assert.equal((await call('POST', '/api/customer/quote', { restaurant_id: S.r0, items: [{ id: "1 OR 1=1", qty: 1 }] }, S.cust)).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) FROM users').pluck().get() >= 4, true);                                         // tables intact
});

test('privilege escalation and mass assignment are blocked', async () => {
  for (const [m, p] of [['GET', '/api/admin/overview'], ['POST', '/api/admin/users'], ['GET', '/api/admin/cashouts'], ['PUT', '/api/admin/settings'], ['GET', '/api/restaurant/orders'], ['GET', '/api/rider/offers']])
    assert.equal((await call(m, p, m === 'GET' ? undefined : {}, S.cust)).status, 403, `customer reached ${p}`);
  assert.equal((await call('POST', '/api/admin/users', { role: 'admin', name: 'x', phone: '+919811111111', password: 'longpassword1' }, S.rt0)).status, 403);
  assert.equal((await call('PUT', '/api/admin/restaurants/' + S.r0, { name: 'A', commission_bps: 0 }, S.rt0)).status, 403);
  await call('PUT', '/api/restaurant/me', { name: 'A', commission_bps: 0, markup_paise: 99999, admin_visible: false, approved: false }, S.rt0);   // owner tries to set admin-only fields
  const r = db.prepare('SELECT commission_bps, markup_paise, admin_visible, approved FROM restaurants WHERE id=?').get(S.r0); assert.deepEqual(r, { commission_bps: 1000, markup_paise: 0, admin_visible: 1, approved: 1 });
  await call('POST', '/api/auth/customer/otp/request', { phone: '+919922222222' }); const v = await call('POST', '/api/auth/customer/otp/verify', { phone: '+919922222222', otp: testOutbox.at(-1).otp, role: 'admin', active: 1 });
  assert.equal(v.body.user.role, 'customer');
});

test('IDOR: restaurants cannot touch each other\'s menu; customers cannot pay for others\' orders', async () => {
  assert.equal((await call('PUT', `/api/restaurant/menu/${S.item}`, { name: 'Hacked', base_price_paise: 1 }, S.rt1)).status, 404);
  assert.equal((await call('DELETE', `/api/restaurant/menu/${S.item}`, undefined, S.rt1)).status, 404);
  assert.equal(db.prepare('SELECT name FROM food_items WHERE id=?').pluck().get(S.item), 'Dish');
  S.o = await call('POST', '/api/customer/orders', { restaurant_id: S.r0, items: [{ id: S.item, qty: 1 }], lat: 17.4, lng: 78.5 }, S.cust);
  db.prepare("UPDATE riders SET is_online=1,last_seen_at=? WHERE user_id=?").run(new Date().toISOString(), S.riderId);
  S.o = await call('POST', '/api/customer/orders', { restaurant_id: S.r0, items: [{ id: S.item, qty: 1 }], lat: 17.4, lng: 78.5 }, S.cust); assert.equal(S.o.status, 201);
  await call('POST', '/api/auth/customer/otp/request', { phone: '+919933333333' }); const other = (await call('POST', '/api/auth/customer/otp/verify', { phone: '+919933333333', otp: testOutbox.at(-1).otp })).body.token;
  assert.equal((await call('POST', `/api/customer/payments/sandbox/${S.o.body.order_code}/complete`, { outcome: 'success' }, other)).status, 404);
  assert.equal((await call('GET', `/api/customer/orders/${S.o.body.order_code}`, null, other)).status, 404);
  assert.equal((await call('POST', '/api/customer/orders', { restaurant_id: S.r1, items: [{ id: S.item, qty: 1 }], lat: 17.4, lng: 78.5 }, S.cust)).status, 409);   // item from a different restaurant
  for (const qty of [0, -3, 21, 1.5, '5']) assert.equal((await call('POST', '/api/customer/quote', { restaurant_id: S.r0, items: [{ id: S.item, qty }], lat: 1, lng: 1 }, S.cust)).status, 400);
  assert.equal((await call('GET', `/api/files/rider-doc/${S.riderId}/rc`, null, S.rt0)).status, 404);                     // other roles can't read rider documents
  assert.equal((await call('GET', `/api/files/rider-doc/${S.riderId}/rc`)).status, 401);
});

test('upload attacks: wrong types, disguised files, oversize, traversal', async () => {
  const b64 = (s) => Buffer.from(s).toString('base64'); const post = (image) => call('POST', '/api/restaurant/menu', { name: 'x', base_price_paise: 1, prep_time_min: 5, image }, S.rt0);
  assert.equal((await post(b64('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).status, 400);   // SVG (script-capable) refused
  assert.equal((await post(b64('<html><script>alert(1)</script></html>'))).status, 400);
  assert.equal((await post(b64('GIF89a......'))).status, 400);
  assert.equal((await post(b64('MZ\x90\x00 executable'))).status, 400);
  assert.equal((await post(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(3_200_000)]).toString('base64'))).status, 400);   // > 3 MB
  const big = await raw('POST', '/api/restaurant/menu', { name: 'x', base_price_paise: 1, prep_time_min: 5, image: 'A'.repeat(9_000_000) }, S.rt0); assert.equal(big.status, 413);
  assert.equal((await raw('POST', '/api/auth/login', 'x'.repeat(200_000))).status, 413);                                  // small limit on ordinary endpoints
  const ok = await post(PNG); assert.equal(ok.status, 201);
  const name = db.prepare('SELECT image_path FROM food_items WHERE id=?').pluck().get(ok.body.id);
  const f = await fetch(`${base}/api/files/public/${name}`); assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'image/png'); assert.equal(f.headers.get('x-content-type-options'), 'nosniff');
  for (const p of ['..%2f..%2fpackage.json', '..%2F..%2F..%2Fetc%2Fpasswd', '%2e%2e%2f%2e%2e%2fsrc%2fconfig.js', 'a.png', `${name}.exe`, `${name}/../../x`]) assert.equal((await fetch(`${base}/api/files/public/${p}`)).status, 404, p);
});

test('rate limits stop brute force (login and OTP request)', async () => {
  config.isTest = false; const app2 = createApp(db); config.isTest = true; const s2 = app2.listen(0); const b2 = `http://127.0.0.1:${s2.address().port}`;
  const hit = (path, body) => fetch(b2 + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
  let last; for (let i = 0; i < 22; i++) last = await hit('/api/auth/login', { portal: 'admin', phone: `+9198000099${String(i).padStart(2, '0')}`, password: 'nope-nope-nope' }); assert.equal(last, 429);   // different phones, same IP: IP limit
  let l2; for (let i = 0; i < 12; i++) l2 = await hit('/api/auth/customer/otp/request', { phone: `+9197000099${String(i).padStart(2, '0')}` }); assert.equal(l2, 429);
  s2.close();
});

test('CORS allow-list, security headers, and error hygiene', async () => {
  config.allowedOrigins.push('https://app.example');
  const ok = await raw('GET', '/healthz', undefined, null, { Origin: 'https://app.example' }), bad = await raw('GET', '/healthz', undefined, null, { Origin: 'https://evil.example' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example'); assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const h = ok.headers; assert.ok(h.get('content-security-policy').includes("script-src 'self'")); assert.ok(h.get('strict-transport-security')); assert.equal(h.get('x-content-type-options'), 'nosniff'); assert.equal(h.get('x-powered-by'), null);
  for (const [m, p, b] of [['POST', '/api/restaurant/orders/abc/accept', {}], ['GET', '/api/admin/orders/search/%00%ff', null], ['POST', '/api/auth/login', '{"portal":']]) {
    const r = await raw(m, p, b === null ? undefined : b, m === 'POST' && p.includes('restaurant') ? S.rt0 : S.admin); const t = await r.text(); assert.ok(r.status < 500, `${p} -> ${r.status}`); assert.ok(!/node_modules|\/home\/|at .*\(|SQLITE|stack/i.test(t), `leak in ${p}: ${t.slice(0, 120)}`); }
});

test('admin MFA: enrol, login requires a fresh code, replays and wrong codes fail, secret encrypted at rest', async () => {
  const setup = await call('POST', '/api/admin/mfa/setup', {}, S.admin); assert.equal(setup.status, 200); assert.match(setup.body.secret, /^[A-Z2-7]{32}$/); assert.ok(setup.body.uri.startsWith('otpauth://totp/'));
  assert.notEqual(db.prepare('SELECT mfa_secret FROM users WHERE id=?').pluck().get(S.adminId), setup.body.secret); assert.equal(decrypt(db.prepare('SELECT mfa_secret FROM users WHERE id=?').pluck().get(S.adminId)), setup.body.secret);
  assert.equal((await call('POST', '/api/admin/mfa/enable', { code: '000000' }, S.admin)).status, 400);
  assert.equal((await call('POST', '/api/admin/mfa/enable', { code: codeAt(setup.body.secret) }, S.admin)).status, 200);
  const noCode = await login('admin', '+919800000001'); assert.equal(noCode.status, 401); assert.equal(noCode.body.code, 'MFA_REQUIRED');
  const next = codeAt(setup.body.secret, Date.now() + 30000);                                    // the following 30s window (enrol consumed the current one)
  assert.equal((await login('admin', '+919800000001', { totp: next })).status, 200);
  assert.equal((await login('admin', '+919800000001', { totp: next })).status, 401);              // same code again = replay
  assert.equal((await login('admin', '+919800000001', { totp: '123456' })).status, 401);
  assert.equal((await login('restaurant', '+919800000001', { totp: next })).status, 401);        // still portal-bound
  const t2 = codeAt(setup.body.secret, Date.now() + 60000);                                       // 2 steps ahead is outside the allowed drift
  assert.equal((await login('admin', '+919800000001', { totp: t2 })).status, 401);
  db.prepare('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?').run(S.adminId);
  for (let i = 0; i < 5; i++) await login('admin', '+919800000001', { totp: '654321' }); assert.equal((await login('admin', '+919800000001', { totp: codeAt(setup.body.secret, Date.now() - 30000) })).status, 429);   // lockout applies to the 2nd factor too
});

test('test-login OTP mode: allow-listed numbers only, code never returned', async () => {
  const saved = [config.otpProvider, config.testOtp]; config.otpProvider = 'testcode'; config.testOtp = { code: '246810', phones: ['+919777777777'] };
  try {
    const no = await call('POST', '/api/auth/customer/otp/request', { phone: '+919766666666' }); assert.equal(no.status, 403);
    const yes = await call('POST', '/api/auth/customer/otp/request', { phone: '+919777777777' }); assert.equal(yes.status, 200); assert.ok(!JSON.stringify(yes.body).includes('246810'));
    assert.equal((await call('POST', '/api/auth/customer/otp/verify', { phone: '+919777777777', otp: '111111' })).status, 401);
    const ok = await call('POST', '/api/auth/customer/otp/verify', { phone: '+919777777777', otp: '246810' }); assert.equal(ok.status, 200); assert.equal(ok.body.user.role, 'customer');
  } finally { [config.otpProvider, config.testOtp] = saved; }
});
