// Review correction T5: production can never run simulated payments. Each case starts the real server entry point with a chosen environment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let port = 18300;
const boot = (extra) => new Promise((resolve) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-pay-')), p = ++port;
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_OPTIONS: '--no-warnings', JWT_SECRET: 'x'.repeat(40), DB_PATH: path.join(dir, 'db.sqlite'), UPLOAD_DIR: path.join(dir, 'up'), BACKUP_DIR: path.join(dir, 'bk'), PORT: String(p), OTP_PROVIDER: 'testcode', TEST_OTP_CODE: '424242', TEST_OTP_PHONES: '+919811111111,+919822222222', ALLOW_TEST_OTP: '1', ...extra };
  const child = spawn(process.execPath, ['src/server.js'], { cwd: root, env }); let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const t = setInterval(async () => { try { const r = await fetch(`http://127.0.0.1:${p}/healthz`); if (r.ok) { clearInterval(t); resolve({ up: true, base: `http://127.0.0.1:${p}`, stop: () => child.kill(), db: env.DB_PATH }); } } catch { /* not up yet */ } }, 150);
  child.on('exit', (code) => { clearInterval(t); resolve({ up: false, code, out }); });
});
const call = async (base, method, p, body, token) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const login = async (base, phone) => { await call(base, 'POST', '/api/auth/customer/otp/request', { phone }); return (await call(base, 'POST', '/api/auth/customer/otp/verify', { phone, otp: '424242', name: 'Tester' })).body.token; };

test('production refuses to start with simulated payments (no override exists)', async () => {
  for (const extra of [{ NODE_ENV: 'production', PAYMENT_PROVIDER: 'sandbox' }, { NODE_ENV: 'production', APP_ENV: 'production', PAYMENT_PROVIDER: 'sandbox', ALLOW_SANDBOX: '1', ALLOW_TEST_PAYMENTS: 'true' }]) {
    const s = await boot(extra); assert.equal(s.up, false, 'server must not start'); assert.notEqual(s.code, 0); assert.match(s.out, /sandbox is not allowed in production/);
  }
  const bad = await boot({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'cash' }); assert.equal(bad.up, false); assert.match(bad.out, /PAYMENT_PROVIDER must be/);
  const st = await boot({ NODE_ENV: 'production', APP_ENV: 'staging', PAYMENT_PROVIDER: 'sandbox' }); assert.equal(st.up, false); assert.match(st.out, /SANDBOX_PAYMENT_PHONES/);
  const dev = await boot({ NODE_ENV: 'production', APP_ENV: 'development', PAYMENT_PROVIDER: 'sandbox' }); assert.equal(dev.up, false, 'a production host cannot be relabelled as development');
});

test('production default: ordering closed, no order rows, every simulated-payment route is gone', async () => {
  for (const extra of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', PAYMENT_PROVIDER: 'phonepe' }]) {      // 'phonepe' is not integrated, so it must also stay closed
    const s = await boot(extra); assert.equal(s.up, true, s.out);
    try {
      const cfg = (await call(s.base, 'GET', '/api/public/config')).body; assert.equal(cfg.testPayments, false); assert.equal(cfg.paymentsAvailable, false);
      const tok = await login(s.base, '+919811111111'); assert.ok(tok);
      const o = await call(s.base, 'POST', '/api/customer/orders', { restaurant_id: 1, items: [{ id: 1, qty: 1 }], location_id: 1 }, tok);
      assert.equal(o.status, 503); assert.equal(o.body.code, 'ORDERING_CLOSED');
      assert.equal((await call(s.base, 'POST', '/api/customer/payments/sandbox/PL123/complete', { outcome: 'success' }, tok)).status, 404);
      const { DatabaseSync } = await import('node:sqlite'); const d = new DatabaseSync(s.db, { readOnly: true });
      assert.equal(d.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0); assert.equal(d.prepare('SELECT COUNT(*) AS n FROM payments').get().n, 0); d.close();
    } finally { s.stop(); }
  }
});

test('staging: simulated payments only for allow-listed tester phones', async () => {
  const s = await boot({ NODE_ENV: 'production', APP_ENV: 'staging', PAYMENT_PROVIDER: 'sandbox', SANDBOX_PAYMENT_PHONES: '+919811111111' }); assert.equal(s.up, true, s.out);
  try {
    assert.equal((await call(s.base, 'GET', '/api/public/config')).body.testPayments, true);
    const outsider = await login(s.base, '+919822222222');
    assert.equal((await call(s.base, 'POST', '/api/customer/orders', { restaurant_id: 1, items: [{ id: 1, qty: 1 }], location_id: 1 }, outsider)).status, 403);
    assert.equal((await call(s.base, 'POST', '/api/customer/payments/sandbox/PL123/complete', { outcome: 'success' }, outsider)).status, 404);
    const tester = await login(s.base, '+919811111111');
    const o = await call(s.base, 'POST', '/api/customer/orders', { restaurant_id: 1, items: [{ id: 1, qty: 1 }], location_id: 1 }, tester);
    assert.notEqual(o.status, 503); assert.notEqual(o.status, 403);                                // gets past the payment gate (fails later only because this empty database has no restaurant)
  } finally { s.stop(); }
});
