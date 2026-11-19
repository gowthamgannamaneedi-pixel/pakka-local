// Customer login with a WhatsApp code: Meta Cloud API request, error handling, expiry, attempts, resend wait, hourly limit,
// temporary block, single use, newest code only, delivery reports, and separation from delivery codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { makeWorld } from './helpers/world.js';
import { config } from '../src/config.js';
import { testOutbox, setOtpProvider, OtpSendError } from '../src/otpProviders.js';

const W = await makeWorld('9450');
test.after(() => W.close());
const req = (phone) => W.raw('POST', '/api/auth/customer/otp/request', { phone });
const ver = (phone, otp) => W.raw('POST', '/api/auth/customer/otp/verify', { phone, otp });
const lastCode = () => testOutbox.at(-1).otp;
const age = (phone, ms) => W.db.prepare('UPDATE otp_challenges SET created_at=? WHERE phone=?').run(new Date(Date.now() - ms).toISOString(), phone);   // skip the resend wait
const wrong = (c) => String((Number(c) + 1) % 1_000_000).padStart(6, '0');

test('sends through the Meta Cloud API with the approved authentication template; the code never comes back in a reply', async () => {
  const saved = { ...config.whatsapp }, prov = config.otpProvider, real = globalThis.fetch; let sent;
  Object.assign(config.whatsapp, { token: 'test-token', phoneId: '123456789', template: 'pakka_login', language: 'en_US', copyButton: true }); config.otpProvider = 'whatsapp';
  globalThis.fetch = async (url, o) => { if (!String(url).startsWith('https://graph.facebook.com/')) return real(url, o); sent = { url: String(url), auth: o.headers.Authorization, body: JSON.parse(o.body) };
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.ABC' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const phone = W.ph(501), r = await req(phone.slice(3));                           // 10 digits typed by the customer
    assert.equal(r.status, 200); assert.equal(r.body.channel, 'whatsapp'); assert.ok(!/\b\d{6}\b/.test(JSON.stringify(r.body)), 'no code in the reply');
    assert.match(sent.url, /\/v21\.0\/123456789\/messages$/); assert.equal(sent.auth, 'Bearer test-token');
    assert.equal(sent.body.to, phone.slice(1)); assert.equal(sent.body.template.name, 'pakka_login'); assert.equal(sent.body.template.language.code, 'en_US');
    const code = sent.body.template.components[0].parameters[0].text; assert.match(code, /^\d{6}$/);
    assert.equal(sent.body.template.components[1].sub_type, 'url'); assert.equal(sent.body.template.components[1].parameters[0].text, code, 'copy-code button carries the code');
    assert.equal(W.db.prepare('SELECT wa_message_id FROM otp_challenges WHERE phone=? ORDER BY id DESC').pluck().get(phone), 'wamid.ABC');
    assert.notEqual(W.db.prepare('SELECT otp_hash FROM otp_challenges WHERE phone=? ORDER BY id DESC').pluck().get(phone), code, 'stored hashed');
    const ok = await ver(phone, code); assert.equal(ok.status, 200); assert.ok(ok.body.token); assert.equal(ok.body.user.needs_name, true, 'new customer is asked for a name');
    // Meta says the number is not on WhatsApp -> a clear message, the code is cancelled
    globalThis.fetch = async (url, o) => (String(url).startsWith('https://graph.facebook.com/') ? new Response(JSON.stringify({ error: { code: 131026, message: 'undeliverable' } }), { status: 400 }) : real(url, o));
    const bad = await req(W.ph(502)); assert.equal(bad.status, 400); assert.equal(bad.body.code, 'NOT_ON_WHATSAPP');
    assert.equal(W.db.prepare('SELECT used FROM otp_challenges WHERE phone=?').pluck().get(W.ph(502)), 1);
    globalThis.fetch = async (url, o) => (String(url).startsWith('https://graph.facebook.com/') ? new Response(JSON.stringify({ error: { code: 190, message: 'token expired' } }), { status: 401 }) : real(url, o));
    const down = await req(W.ph(503)); assert.equal(down.status, 503); assert.equal(down.body.code, 'WHATSAPP_UNAVAILABLE');
    assert.equal((await req('+919012')).status, 400, 'invalid number'); assert.equal((await req('5123456789')).body.code, 'BAD_NUMBER', 'not a real Indian mobile');
    config.whatsapp.token = ''; const off = await req(W.ph(504)); assert.equal(off.status, 503, 'not configured: refused, never faked');
  } finally { globalThis.fetch = real; Object.assign(config.whatsapp, saved); config.otpProvider = prov; }
});

test('MSG91: sends the WhatsApp authentication template through MSG91; failures explained; nothing faked', async () => {
  const saved = { ...config.msg91 }, prov = config.otpProvider, real = globalThis.fetch; let sent;
  Object.assign(config.msg91, { authKey: 'msg91-test-key', number: '919876500000', template: 'pakka_login', language: 'en', namespace: '', copyButton: true }); config.otpProvider = 'msg91';
  globalThis.fetch = async (url, o) => { if (!String(url).startsWith('https://api.msg91.com/')) return real(url, o); sent = { url: String(url), headers: o.headers, body: JSON.parse(o.body) };
    return new Response(JSON.stringify({ status: 'success', hasError: false, request_id: 'req-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const phone = W.ph(560), r = await req(phone); assert.equal(r.status, 200); assert.equal(r.body.channel, 'whatsapp'); assert.ok(!/\d{6}/.test(JSON.stringify(r.body)));
    assert.equal(sent.url, 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/'); assert.equal(sent.headers.authkey, 'msg91-test-key');
    assert.equal(sent.body.integrated_number, '919876500000'); assert.equal(sent.body.content_type, 'template');
    const t = sent.body.payload.template; assert.equal(t.name, 'pakka_login'); assert.deepEqual(t.language, { code: 'en', policy: 'deterministic' });
    assert.deepEqual(t.to_and_components[0].to, [phone.slice(1)]);
    const code = t.to_and_components[0].components.body_1.value; assert.match(code, /^\d{6}$/); assert.equal(t.to_and_components[0].components.button_1.value, code);
    assert.equal(W.db.prepare('SELECT wa_message_id FROM otp_challenges WHERE phone=? ORDER BY id DESC').pluck().get(phone), 'req-1');
    assert.equal((await ver(phone, code)).status, 200, 'the code sent through MSG91 logs in');
    globalThis.fetch = async (url, o) => (String(url).startsWith('https://api.msg91.com/') ? new Response(JSON.stringify({ hasError: true, status: 'fail', errors: 'Invalid mobile number' }), { status: 400 }) : real(url, o));
    const bad = await req(W.ph(561)); assert.equal(bad.status, 400); assert.equal(bad.body.code, 'NOT_ON_WHATSAPP');
    globalThis.fetch = async (url, o) => (String(url).startsWith('https://api.msg91.com/') ? new Response(JSON.stringify({ hasError: true, status: 'fail', errors: 'Authentication failure' }), { status: 401 }) : real(url, o));
    assert.equal((await req(W.ph(562))).status, 503);
    globalThis.fetch = async (url, o) => (String(url).startsWith('https://api.msg91.com/') ? new Response(JSON.stringify({ hasError: true, status: 'fail', errors: 'template not found' }), { status: 200 }) : real(url, o));
    assert.equal((await req(W.ph(563))).status, 503, 'an error inside a 200 reply is still a failure');
    config.msg91.authKey = ''; assert.equal((await req(W.ph(564))).status, 503, 'not configured: refused');
    assert.equal((await req('5123456789')).body.code, 'BAD_NUMBER');
  } finally { globalThis.fetch = real; Object.assign(config.msg91, saved); config.otpProvider = prov; }
});

test('existing customer logs into the same account; no duplicate', async () => {
  const before = W.db.prepare('SELECT COUNT(*) FROM users WHERE phone=?').pluck().get(W.ph(301));
  age(W.ph(301), 60_000); assert.equal((await req(W.ph(301))).status, 200); const r = await ver(W.ph(301), lastCode());
  assert.equal(r.status, 200); assert.equal(r.body.user.id, W.custId); assert.equal(r.body.user.needs_name, false);
  assert.equal(W.db.prepare('SELECT COUNT(*) FROM users WHERE phone=?').pluck().get(W.ph(301)), before);
});

test('resend wait, newest code only, single use, expiry, hourly limit', async () => {
  const p = W.ph(510);
  await req(p); const first = lastCode();
  const again = await req(p); assert.equal(again.status, 429); assert.equal(again.body.code, 'WAIT'); assert.ok(again.body.retryAfterSec > 0);
  age(p, 60_000); await req(p); const second = lastCode();
  if (first !== second) assert.equal((await ver(p, first)).status, 401, 'old code stops working once a new one is sent');
  assert.equal((await ver(p, second)).status, 200); assert.equal((await ver(p, second)).status, 401, 'no reuse');
  const e = W.ph(511); await req(e); W.db.prepare('UPDATE otp_challenges SET expires_at=? WHERE phone=?').run(new Date(Date.now() - 1000).toISOString(), e);
  const ex = await ver(e, lastCode()); assert.equal(ex.status, 401); assert.equal(ex.body.code, 'EXPIRED');
  const h = W.ph(512); for (let i = 0; i < config.otp.maxPerHour; i++) { age(h, 50_000); assert.equal((await req(h)).status, 200); }
  age(h, 50_000); const lim = await req(h); assert.equal(lim.status, 429); assert.equal(lim.body.code, 'HOURLY_LIMIT');
});

test('wrong codes: tries left, code cancelled after the maximum, number blocked for a while after repeated failures', async () => {
  const p = W.ph(520); await req(p); const c = lastCode();
  const w1 = await ver(p, wrong(c)); assert.equal(w1.status, 401); assert.match(w1.body.error, /4 tries left/);
  for (let i = 0; i < config.otp.maxAttempts - 1; i++) await ver(p, wrong(c));
  assert.equal((await ver(p, c)).status, 401, 'right code no longer works after too many tries');
  let blockedSeen = false;
  for (let k = 0; k < 4 && !blockedSeen; k++) { age(p, 60_000); const r = await req(p); if (r.body.code === 'BLOCKED') { blockedSeen = true; break; }
    for (let i = 0; i < config.otp.maxAttempts; i++) { const v = await ver(p, wrong(lastCode())); if (v.body.code === 'BLOCKED') { blockedSeen = true; break; } } }
  assert.ok(blockedSeen, 'temporary block after repeated wrong codes');
  const r = await req(p); assert.equal(r.status, 429); assert.equal(r.body.code, 'BLOCKED');
  W.db.prepare('UPDATE otp_blocks SET blocked_until=? WHERE phone=?').run(new Date(Date.now() - 1000).toISOString(), p); age(p, 60_000);
  await req(p); assert.equal((await ver(p, lastCode())).status, 200, 'works again after the block'); assert.equal(W.db.prepare('SELECT COUNT(*) FROM otp_blocks WHERE phone=?').pluck().get(p), 0);
});

test('send failure from the provider: clear message, nothing usable left behind', async () => {
  setOtpProvider({ async send() { throw new OtpSendError('rate_limited', 'busy'); } });
  try { const r = await req(W.ph(530)); assert.equal(r.status, 429); assert.equal(r.body.code, 'WHATSAPP_BUSY');
    assert.equal(W.db.prepare('SELECT COUNT(*) FROM otp_challenges WHERE phone=? AND used=0').pluck().get(W.ph(530)), 0); }
  finally { setOtpProvider(null); }
});

test('delivery reports: signed webhook only; the code screen sees delivered / failed', async () => {
  const saved = { ...config.whatsapp }; Object.assign(config.whatsapp, { appSecret: 's3cret', verifyToken: 'vt-123' });
  try {
    assert.equal((await fetch(`${W.base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=vt-123&hub.challenge=42`).then((r) => r.text())), '42');
    assert.equal((await fetch(`${W.base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`)).status, 403);
    const p = W.ph(540); await req(p); const id = W.db.prepare('SELECT wa_message_id FROM otp_challenges WHERE phone=? ORDER BY id DESC').pluck().get(p);
    const send = (body, secret = 's3cret') => { const raw = JSON.stringify(body); return fetch(`${W.base}/api/whatsapp/webhook`, { method: 'POST', body: raw,
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex') } }); };
    const st = (s, extra = {}) => ({ entry: [{ changes: [{ value: { statuses: [{ id, status: s, ...extra }] } }] }] });
    assert.equal((await send(st('delivered'), 'wrong')).status, 401, 'unsigned / wrongly signed reports are refused');
    assert.equal((await W.raw('GET', `/api/auth/customer/otp/status?phone=${encodeURIComponent(p)}`)).body.status, 'sent');
    assert.equal((await send(st('delivered'))).status, 200);
    assert.equal((await W.raw('GET', `/api/auth/customer/otp/status?phone=${encodeURIComponent(p)}`)).body.status, 'delivered');
    await send(st('failed', { errors: [{ code: 131026, title: 'Message undeliverable' }] }));
    assert.equal((await W.raw('GET', `/api/auth/customer/otp/status?phone=${encodeURIComponent(p)}`)).body.status, 'failed');
  } finally { Object.assign(config.whatsapp, saved); }
});

test('login codes and delivery codes are separate', async () => {
  const o = await W.paidOrder();
  await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, W.owner); await W.call('POST', `/api/rider/orders/${o.id}/accept`, {}, W.rider);
  await W.call('POST', `/api/restaurant/orders/${o.id}/ready`, {}, W.owner);
  const pick = (await W.call('GET', `/api/restaurant/orders/${o.id}`, null, W.owner)).body.order.pickup_otp;
  await W.call('POST', `/api/rider/orders/${o.id}/pickup`, { otp: pick }, W.rider);
  const dcode = (await W.call('GET', `/api/customer/orders/${o.order_code}`, null, W.cust)).body.delivery_otp;
  age(W.ph(301), 60_000); await req(W.ph(301)); const login = lastCode();
  if (dcode && String(dcode).length === 6 && dcode !== login) assert.equal((await ver(W.ph(301), String(dcode))).status, 401, 'a delivery code cannot log in');
  if (login !== String(dcode)) assert.equal((await W.call('POST', `/api/rider/orders/${o.id}/deliver`, { otp: login }, W.rider)).status, 400, 'a login code cannot complete a delivery');
});

test('production refuses the fixed test code and test outbox; staging may use the fixed code for allow-listed testers', () => {
  const run = (extra) => spawnSync(process.execPath, ['-e', "import('./src/config.js').then(()=>console.log('OK'))"], { cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), DOTENV_CONFIG_PATH: 'no-such.env', PAYMENT_PROVIDER: 'disabled', ...extra } });
  for (const p of ['testcode', 'test']) { const r = run({ APP_ENV: 'production', OTP_PROVIDER: p, TEST_OTP_CODE: '424242', TEST_OTP_PHONES: '+919811111111', ALLOW_TEST_OTP: '1' });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /not allowed when APP_ENV=production|not allowed in production/); }
  assert.match(run({ APP_ENV: 'staging', OTP_PROVIDER: 'testcode', TEST_OTP_CODE: '424242', TEST_OTP_PHONES: '+919811111111', ALLOW_TEST_OTP: '1' }).stdout, /OK/);
  const w = run({ APP_ENV: 'production', OTP_PROVIDER: 'whatsapp' }); assert.match(w.stdout, /OK/); assert.match(w.stderr, /WhatsApp OTP is not configured/, 'missing setup is reported, not hidden');
});
