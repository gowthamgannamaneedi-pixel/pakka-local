// Staging-only dummy accounts: created once with server-generated passwords (private file only), never overwriting
// anything, visible restaurant, draft rider, OTP customer; removable; refused on production.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedStagingTestAccounts, removeStagingTestAccounts, TEST } from '../src/services/stagingSeed.js';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pl-seed-'));
const read = (dir) => fs.readFileSync(path.join(dir, 'TEST-ACCOUNTS.txt'), 'utf8');
const pwOf = (txt, phone) => txt.split('\n\n').find((b) => b.includes(`Mobile: ${phone}`))?.match(/Password: (\S+)/)?.[1];

test('creates the four accounts, test restaurant (visible, open, with menu), draft rider and a delivery place; passwords work and live only in the private file', async () => {
  const db = openDb(':memory:'), sec = tmp();
  const s = seedStagingTestAccounts(db, { secretsDir: sec, appEnv: 'staging', testOtp: { code: '246810', phones: [TEST.rider.phone, TEST.customer.phone] } });
  assert.equal(s.skipped.length, 0); assert.ok(s.made.length >= 6);
  const txt = read(sec);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(sec, 'TEST-ACCOUNTS.txt')).mode & 0o777, 0o600);
  assert.match(txt, /\+915000000301: test code 246810/);
  for (const p of [TEST.admin.phone, TEST.owner.phone, TEST.rider.phone]) assert.ok(pwOf(txt, p)?.length >= 20, p);
  assert.equal(new Set([TEST.admin.phone, TEST.owner.phone, TEST.rider.phone].map((p) => pwOf(txt, p))).size, 3, 'unique passwords');
  assert.equal(db.prepare("SELECT verification_status FROM riders r JOIN users u ON u.id = r.user_id WHERE u.phone = ?").pluck().get(TEST.rider.phone), 'draft');
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE phone = ?').pluck().get(TEST.customer.phone), null, 'customer has no password');
  const srv = createApp(db).listen(0), base = `http://127.0.0.1:${srv.address().port}`;
  const login = (portal, phone, password) => fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portal, phone, password }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    assert.equal((await login('admin', TEST.admin.phone, pwOf(txt, TEST.admin.phone))).status, 200);
    const owner = await login('restaurant', TEST.owner.phone, pwOf(txt, TEST.owner.phone)); assert.equal(owner.status, 200);
    const me = await fetch(base + '/api/restaurant/me', { headers: { Authorization: 'Bearer ' + owner.body.token } }).then((r) => r.json());
    assert.equal(me.restaurant?.name ?? me.name, TEST.restaurant.name, 'owner is linked to the test restaurant');
    assert.equal((await login('rider', TEST.rider.phone, pwOf(txt, TEST.rider.phone))).status, 200);
    assert.equal((await login('admin', TEST.owner.phone, pwOf(txt, TEST.owner.phone))).status, 401, 'roles stay separate');
    const pub = await fetch(base + '/api/public/restaurants').then((r) => r.json());
    const r = pub.restaurants.find((x) => x.name === TEST.restaurant.name); assert.ok(r, 'visible to customers'); assert.equal(r.is_open, 1);
    const menu = await fetch(`${base}/api/public/restaurants/${r.id}/menu`).then((x) => x.json()); assert.equal(menu.items?.length ?? menu.menu?.length, 2);
  } finally { srv.close(); }
});

test('never overwrites: a second run creates nothing new and an existing account on a test number is left untouched', () => {
  const db = openDb(':memory:'), sec = tmp();
  const keep = bcrypt.hashSync('existing-password', 4);
  db.prepare("INSERT INTO users (role, phone, name, password_hash) VALUES ('rider', ?, 'Someone', ?)").run(TEST.rider.phone, keep);
  const s1 = seedStagingTestAccounts(db, { secretsDir: sec, appEnv: 'staging' });
  assert.ok(s1.skipped.some((x) => x.includes(TEST.rider.phone)));
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE phone = ?').pluck().get(TEST.rider.phone), keep);
  assert.equal(db.prepare('SELECT name FROM users WHERE phone = ?').pluck().get(TEST.rider.phone), 'Someone');
  const size = read(sec).length, s2 = seedStagingTestAccounts(db, { secretsDir: sec, appEnv: 'staging' });
  assert.equal(s2.made.length, 0); assert.equal(read(sec).length, size, 'no new passwords written');
  assert.equal(db.prepare('SELECT COUNT(*) FROM restaurants WHERE name = ?').pluck().get(TEST.restaurant.name), 1, 'no duplicate restaurant');
  assert.match(read(sec), /NOT enabled for the staging test code/);
});

test('remove deletes everything recorded (and nothing else); refused on production', () => {
  const db = openDb(':memory:'), sec = tmp();
  db.prepare("INSERT INTO users (role, phone, name) VALUES ('admin', '+919700000099', 'Real admin')").run();
  seedStagingTestAccounts(db, { secretsDir: sec, appEnv: 'staging' });
  const out = removeStagingTestAccounts(db, { secretsDir: sec, appEnv: 'staging' });
  assert.ok(out.every((x) => /deleted/.test(x)), out.join('; '));
  assert.equal(db.prepare("SELECT COUNT(*) FROM users WHERE phone LIKE '+915000000%'").pluck().get(), 0);
  assert.equal(db.prepare("SELECT COUNT(*) FROM users WHERE phone = '+919700000099'").pluck().get(), 1, 'real admin kept');
  assert.equal(db.prepare('SELECT COUNT(*) FROM restaurants').pluck().get(), 0);
  assert.throws(() => seedStagingTestAccounts(db, { secretsDir: sec, appEnv: 'production' }), /refused on production/);
  assert.throws(() => removeStagingTestAccounts(db, { secretsDir: sec, appEnv: 'production' }), /production/);
});

test('config: STAGING_TEST_ACCOUNTS refused on production; staging test code is generated on the server (600) when not set', () => {
  const out = tmp(), sec = path.join(out, 's');
  const code = `const { config } = await import(${JSON.stringify('file://' + path.join(BACKEND, 'src', 'config.js').split(path.sep).join('/'))}); console.log('CODE', config.testOtp.code, config.stagingTestAccounts);`;
  const run = (extra) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: out, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', PAYMENT_PROVIDER: 'disabled',
    DB_PATH: path.join(out, 'p.sqlite'), UPLOAD_DIR: path.join(out, 'u'), BACKUP_DIR: path.join(out, 'b'), SECRETS_DIR: sec, ...extra } });
  const prod = run({ APP_ENV: 'production', OTP_PROVIDER: 'whatsapp', STAGING_TEST_ACCOUNTS: '1' }); assert.notEqual(prod.status, 0); assert.match(prod.stderr, /staging testing only/);
  const st = run({ APP_ENV: 'staging', OTP_PROVIDER: 'testcode', ALLOW_TEST_OTP: '1', TEST_OTP_PHONES: TEST.customer.phone, STAGING_TEST_ACCOUNTS: '1' });
  assert.equal(st.status, 0, st.stderr); const c = st.stdout.match(/CODE (\d{6}) 1/)[1];
  assert.equal(fs.readFileSync(path.join(sec, 'test-otp-code'), 'utf8').trim(), c);
  assert.match(run({ APP_ENV: 'staging', OTP_PROVIDER: 'testcode', ALLOW_TEST_OTP: '1', TEST_OTP_PHONES: TEST.customer.phone }).stdout, new RegExp(`CODE ${c}`), 'same code after restart');
  assert.match(run({ APP_ENV: 'staging', OTP_PROVIDER: 'whatsapp', STAGING_TEST_ACCOUNTS: 'yes' }).stderr, /must be 1 or remove/);
});
