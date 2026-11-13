// STAGING-ONLY e-mail login for allow-listed testers. Uses the in-memory test mail outbox (no e-mail is sent here).
process.env.EMAIL_OTP_ENABLED = '1';
process.env.EMAIL_OTP_ALLOWLIST = 'Tester.One@Example.com=9876500001, two@example.com=+919876500002, staff@example.com=+919700000088';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { openDb } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');
const { testEmailOutbox } = await import('../src/emailProviders.js');
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const db = openDb(':memory:'), srv = createApp(db).listen(0), base = `http://127.0.0.1:${srv.address().port}`;
const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const req = (email) => call('POST', '/api/auth/customer/email-otp/request', { email });
const ver = (email, otp, name) => call('POST', '/api/auth/customer/email-otp/verify', { email, otp, ...(name && { name }) });
const lastCode = (to) => [...testEmailOutbox].reverse().find((m) => m.to === to)?.code;
const age = (email, ms) => db.prepare('UPDATE email_otp_challenges SET created_at = ? WHERE email = ?').run(new Date(Date.now() - ms).toISOString(), email);
test.after(() => srv.close());

test('public config tells the login screen that staging e-mail login is on', async () => {
  assert.equal((await call('GET', '/api/public/config')).body.emailLogin, true);
});

test('only allow-listed addresses get a code; the code is never returned and is stored hashed', async () => {
  const no = await req('stranger@example.com'); assert.equal(no.status, 403); assert.equal(testEmailOutbox.length, 0);
  const bad = await req('not-an-email'); assert.equal(bad.status, 400);
  const ok = await req('  TESTER.one@example.com '); assert.equal(ok.status, 200); assert.equal(ok.body.resendAfterSec, 60);
  assert.ok(!JSON.stringify(ok.body).match(/\d{6}/), 'no code in the reply');
  const code = lastCode('tester.one@example.com'); assert.match(code, /^\d{6}$/);
  const row = db.prepare('SELECT * FROM email_otp_challenges WHERE email = ?').get('tester.one@example.com');
  assert.notEqual(row.otp_hash, code); assert.equal(row.otp_hash.length, 64);
  const mins = (Date.parse(row.expires_at) - Date.parse(row.created_at)) / 60000; assert.ok(mins > 4.9 && mins <= 5.01, '5-minute expiry');
});

test('60-second resend wait, then the new code replaces the old one; 6 codes per hour at most', async () => {
  assert.equal((await req('tester.one@example.com')).status, 429);
  const old = lastCode('tester.one@example.com'); age('tester.one@example.com', 61_000);
  assert.equal((await req('tester.one@example.com')).status, 200);
  const now = lastCode('tester.one@example.com');
  if (old !== now) assert.equal((await ver('tester.one@example.com', old)).status, 401, 'an older code stops working');
  for (let i = 0; i < 4; i++) { age('tester.one@example.com', 61_000 + i); assert.equal((await req('tester.one@example.com')).status, 200); }
  age('tester.one@example.com', 61_000); assert.equal((await req('tester.one@example.com')).status, 429, 'hourly cap');
  db.prepare('DELETE FROM email_otp_challenges').run();
});

test('wrong codes: 5 attempts, then even the right code is refused', async () => {
  assert.equal((await req('two@example.com')).status, 200); const code = lastCode('two@example.com');
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await ver('two@example.com', wrong)).status, 401);
  assert.equal((await ver('two@example.com', code)).status, 401);
  db.prepare('DELETE FROM email_otp_challenges').run();
});

test('right code signs in as the mapped customer once; reuse and expiry fail', async () => {
  assert.equal((await req('two@example.com')).status, 200); const code = lastCode('two@example.com');
  const ok = await ver('two@example.com', code, 'Tester Two'); assert.equal(ok.status, 200);
  assert.equal(ok.body.user.role, 'customer'); assert.equal(ok.body.user.name, 'Tester Two'); assert.ok(ok.body.token);
  const u = db.prepare('SELECT phone FROM users WHERE id = ?').get(ok.body.user.id); assert.equal(u.phone, '+919876500002');
  assert.equal((await ver('two@example.com', code)).status, 401, 'single use');
  // the session works on customer endpoints
  const me = await fetch(base + '/api/auth/me', { headers: { Authorization: 'Bearer ' + ok.body.token } }); assert.equal((await me.json()).user.role, 'customer');
  // expired code
  age('two@example.com', 61_000); assert.equal((await req('two@example.com')).status, 200); const c2 = lastCode('two@example.com');
  db.prepare("UPDATE email_otp_challenges SET expires_at = ? WHERE email = 'two@example.com' AND used = 0").run(new Date(Date.now() - 1000).toISOString());
  assert.equal((await ver('two@example.com', c2)).status, 401);
});

test('an allow-list entry pointing at a staff phone can never open a staff account', async () => {
  db.prepare("INSERT INTO users (role, phone, name, password_hash) VALUES ('admin', '+919700000088', 'Admin', 'x')").run();
  assert.equal((await req('staff@example.com')).status, 200);
  assert.equal((await ver('staff@example.com', lastCode('staff@example.com'))).status, 401);
});

test('staff password login and phone OTP routes are unchanged', async () => {
  assert.equal((await call('POST', '/api/auth/login', { portal: 'admin', phone: '+919700000088', password: 'nope' })).status, 401);
  assert.equal((await call('POST', '/api/auth/customer/otp/request', { phone: '+919876500009' })).status, 200);
});

const run = (extra) => spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify('file://' + path.join(BACKEND, 'src', 'config.js').split(path.sep).join('/'))}).then((m) => console.log('LOADED', m.config.emailOtp.enabled))`],
  { cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'pl-em-')), encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', JWT_SECRET: 's'.repeat(40), PAYMENT_PROVIDER: 'disabled', OTP_PROVIDER: 'whatsapp',
    DB_PATH: path.join(os.tmpdir(), 'x', 'p.sqlite'), UPLOAD_DIR: path.join(os.tmpdir(), 'x', 'u'), BACKUP_DIR: path.join(os.tmpdir(), 'x', 'b'), ...extra } });
test('production refuses to start with e-mail login switched on; staging needs an allow-list and sender', () => {
  const on = { EMAIL_OTP_ENABLED: '1', EMAIL_OTP_ALLOWLIST: 'a@example.com=+919876500001', EMAIL_FROM: 'sender@example.com', BREVO_API_KEY: 'k' };
  const prod = run({ APP_ENV: 'production', ...on }); assert.notEqual(prod.status, 0); assert.match(prod.stderr, /staging testing only/);
  assert.match(run({ APP_ENV: 'production' }).stdout, /LOADED false/);
  assert.match(run({ APP_ENV: 'staging', ...on }).stdout, /LOADED true/);
  assert.match(run({ APP_ENV: 'staging', ...on, EMAIL_OTP_ALLOWLIST: '' }).stderr, /needs EMAIL_OTP_ALLOWLIST/);
  assert.match(run({ APP_ENV: 'staging', ...on, EMAIL_OTP_ALLOWLIST: 'a@example.com' }).stderr, /must look like/);
  assert.match(run({ APP_ENV: 'staging', ...on, EMAIL_FROM: '' }).stderr, /needs EMAIL_FROM/);
});

test('with e-mail login off (default), the routes do not exist', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const { openDb } = await import(${JSON.stringify('file://' + path.join(BACKEND, 'src/db/index.js').split(path.sep).join('/'))}); const { createApp } = await import(${JSON.stringify('file://' + path.join(BACKEND, 'src/app.js').split(path.sep).join('/'))});
    const s = createApp(openDb(':memory:')).listen(0); const b = 'http://127.0.0.1:' + s.address().port;
    const a = await fetch(b + '/api/auth/customer/email-otp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"a@example.com"}' });
    const c = await (await fetch(b + '/api/public/config')).json(); console.log('STATUS', a.status, 'FLAG', c.emailLogin); s.close();`],
    { cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'pl-em-')), encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'test' } });
  assert.match(r.stdout, /STATUS 404 FLAG false/, r.stderr);
});

test('Brevo sender: correct request, code only in the e-mail, failures reported (never "sent"), nothing secret logged', async () => {
  const http = await import('node:http'); const { config } = await import('../src/config.js');
  let got = null, status = 201;
  const fake = http.createServer((q, s) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { got = { key: q.headers['api-key'], body: JSON.parse(b) }; s.statusCode = status; s.end('{}'); }); }).listen(0);
  const old = { ...config.emailOtp }; Object.assign(config.emailOtp, { provider: 'brevo', apiUrl: `http://127.0.0.1:${fake.address().port}/v3/smtp/email`, apiKey: 'xkeysib-test', from: 'sender@example.com' });
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    db.prepare('DELETE FROM email_otp_challenges').run();
    assert.equal((await req('tester.one@example.com')).status, 200);
    assert.equal(got.key, 'xkeysib-test'); assert.deepEqual(got.body.to, [{ email: 'tester.one@example.com' }]); assert.equal(got.body.sender.email, 'sender@example.com');
    const code = got.body.subject.match(/^(\d{6}) /)[1]; assert.ok(got.body.textContent.includes(code));
    assert.equal((await ver('tester.one@example.com', code)).status, 200, 'the e-mailed code signs in');
    status = 401; age('tester.one@example.com', 61_000);
    const r = await req('tester.one@example.com'); assert.equal(r.status, 502); assert.match(r.body.error, /could not send/);
    const failedCode = got.body.subject.match(/^(\d{6}) /)[1];
    assert.equal((await ver('tester.one@example.com', failedCode)).status, 401, 'a code whose e-mail failed never works');
    assert.ok(logs.some((l) => /HTTP 401/.test(l))); assert.ok(!logs.join(' ').includes(failedCode) && !logs.join(' ').includes('xkeysib'), 'no code or key in logs');
  } finally { console.error = orig; Object.assign(config.emailOtp, old); fake.close(); }
});
